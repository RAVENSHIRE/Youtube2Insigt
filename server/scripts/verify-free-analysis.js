// Explicit, credit-consuming acceptance probe against the EXISTING local server.
// Credentials arrive through stdin, never command-line arguments or output.
// Does not create/verify accounts, change settings, seed credits or call billing.
const { once } = require('node:events');

async function verifyFreeAnalysis({ base = 'http://localhost:3000', videoUrl, email, password,
  consumeCredit = false, fetchImpl = fetch, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onProgress = () => {}, maxPolls = 170 } = {}) {
  const origin = new URL(base), video = new URL(videoUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
    origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('LOCAL_SERVER_REQUIRED');
  if (!['https:', 'http:'].includes(video.protocol) || !['www.youtube.com', 'youtube.com', 'youtu.be'].includes(video.hostname) || video.username || video.password) throw Error('YOUTUBE_URL_INVALID');
  const videoId = video.hostname === 'youtu.be' ? video.pathname.slice(1) : video.searchParams.get('v');
  if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId || '')) throw Error('YOUTUBE_URL_INVALID');
  if (!consumeCredit) throw Error('EXPLICIT_CREDIT_CONSENT_REQUIRED');
  let token;
  const request = async (path, body) => {
    const response = await fetchImpl(`${origin.origin}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: AbortSignal.timeout(15000), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) {
      const code = /^[A-Z_]{3,80}$/u.test(data.code || '') ? data.code : `HTTP_${response.status}`;
      throw Object.assign(new Error(code), { code });
    }
    return data;
  };
  try {
    const health = await request('/health');
    if (!health.analysisConfigured) throw Error('ANALYSIS_NOT_CONFIGURED');
    const login = await request('/auth/login', { email, password }); token = login.token;
    const before = await request('/me');
    if (before.plan !== 'free' || before.analyses_available !== 1) throw Error('VERIFIED_FREE_ACCOUNT_WITH_ONE_CREDIT_REQUIRED');
    const startedAt = Date.now();
    const started = await request('/analyze', { videoId, confirmCredit: true });
    if (!started.jobId || started.cached) return { status: 'not_verified_cached_report', videoId, credits_before: before.analyses_available };
    onProgress({ jobId: started.jobId, videoId });
    let job = started;
    for (let n = 0; job.state === 'reserved' && n < maxPolls; n++) {
      await delay(1500); job = await request(`/analysis-jobs/${encodeURIComponent(started.jobId)}`);
    }
    const after = await request('/me');
    const result = { proof_version: 1, verified_at: new Date().toISOString(), videoId, jobId: started.jobId,
      status: job.state === 'complete' ? 'success' : job.state === 'failed' ? 'analysis_failed' : 'still_running',
      code: job.code || null, credits_before: before.analyses_available, credits_after: after.analyses_available,
      credit_released: job.state === 'failed' && after.analyses_available === before.analyses_available };
    if (job.state === 'complete') {
      const report = await request(`/videos/${videoId}`);
      result.report_saved = report.video?.id === videoId && Array.isArray(report.companies) && report.companies.length > 0;
      result.source_verified = report.evidence_version === 1 && report.source?.video_id === videoId &&
        ['en', 'de'].includes(report.source?.language) && report.source.segments?.length > 0;
      result.fresh_source = Number.isFinite(Date.parse(report.source?.retrieved_at)) && Date.parse(report.source.retrieved_at) >= startedAt;
      result.credit_consumed_once = after.analyses_available === before.analyses_available - 1;
      const replay = await request('/analyze', { videoId, confirmCredit: true });
      result.reread_free = replay.cached === true && replay.credits_consumed === 0 && (await request('/me')).analyses_available === after.analyses_available;
      if (!result.report_saved || !result.source_verified || !result.credit_consumed_once || !result.reread_free) result.status = 'verification_failed';
      else if (!result.fresh_source) result.status = 'not_verified_cached_source';
    }
    return result;
  } finally {
    if (token) { try { await request('/auth/logout', {}); } catch { /* Only this probe's session is discarded. */ } }
  }
}

if (require.main === module) {
  (async () => {
    if (process.stdin.isTTY) throw Error('PIPE_CREDENTIALS_USING_DOCUMENTED_POWERSHELL_BLOCK');
    let raw = '';
    process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { raw += chunk; if (raw.length > 8192) process.stdin.destroy(Error('INPUT_TOO_LARGE')); });
    await once(process.stdin, 'end');
    const input = JSON.parse(raw.replace(/^\uFEFF/u, '')); raw = '';
    const result = await verifyFreeAnalysis({ ...input, consumeCredit: process.argv.includes('--consume-credit'),
      onProgress: progress => process.stderr.write(`Prüfe Auftrag ${progress.jobId} für ${progress.videoId}. Details stehen im Server-Terminal.\n`) });
    input.password = '';
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'success') process.exitCode = 1;
  })().catch(error => {
    // Only known diagnostic identifiers are printed, never raw transport/input errors.
    console.error(JSON.stringify({ status: 'blocked', code: /^[A-Z_]{3,80}$/u.test(error.message || '') ? error.message : 'VERIFICATION_REQUEST_FAILED' }));
    process.exitCode = 1;
  });
}
module.exports = { verifyFreeAnalysis };
