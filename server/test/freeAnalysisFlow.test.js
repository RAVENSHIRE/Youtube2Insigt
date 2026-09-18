const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { AccountStore } = require('../accounts/store');
const { passwordHash } = require('../accounts/auth');
const { AnalysisJobs } = require('../accounts/analysisJobs');
const { redact, logAnalysis } = require('../accounts/analysisDiagnostics');
const { installAccounts } = require('../accounts/routes');
const { createReportAnalyzer } = require('../services/verifiedAnalysisService');
const { SourceService } = require('../evidence/sourceService');
const { extractVerifiedReport } = require('../services/evidenceExtractionService');
const { YouTubeMetadataService } = require('../services/youtubeMetadataService');

const videoId = 'J3Y_JBATcWg'; // Actual URL identity; all provider responses below are explicit fixtures.
const text = 'I buy Rocket Lab.';
const captions = lang => `<transcript><text start="1" dur="2">${lang.startsWith('en') ? text : 'العربية'}</text></transcript>`;
function captionFetch({ regional = false, fail = false, requested = [] } = {}) {
  return async target => {
    const url = new URL(target);
    if (fail) throw new Error('Caption provider unavailable');
    if (url.pathname.includes('/player')) return Response.json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { languageCode: 'ar', baseUrl: 'https://www.youtube.com/api/timedtext?lang=ar' },
      { languageCode: regional ? 'en-US' : 'en', baseUrl: `https://www.youtube.com/api/timedtext?lang=${regional ? 'en-US' : 'en'}` }
    ] } } });
    const language = url.searchParams.get('lang'); requested.push(language);
    return new Response(captions(language));
  };
}

test('installed transcript library selects verified original English instead of the first Arabic caption track', async () => {
  const requested = [];
  const source = await new SourceService({ fetchImpl: captionFetch({ requested }) }).get(videoId, { language: 'en-US', durationSeconds: 600 });
  assert.deepEqual(requested, ['en']); assert.equal(source.language, 'en');
  assert.equal(source.segments[0].text, text); assert.equal(source.segments[0].start_seconds, 1);
});

test('regional original-language caption tracks remain supported without choosing an unrelated language', async () => {
  const requested = [];
  const source = await new SourceService({ fetchImpl: captionFetch({ regional: true, requested }) }).get(videoId, { language: 'en-US', durationSeconds: 600 });
  assert.equal(source.language, 'en'); assert.deepEqual(requested, ['en-US']);
});

test('transcript failures retain the provider cause for safe stage logging', async () => {
  const service = new SourceService({ fetchImpl: captionFetch({ fail: true }) });
  await assert.rejects(service.get(videoId, { language: 'en', durationSeconds: 600 }), error => {
    assert.equal(error.code, 'TRANSCRIPT_UNAVAILABLE');
    assert.match(error.cause.message, /Caption provider unavailable/u); return true;
  });
});

test('real account/job/source orchestration succeeds, consumes one free credit and rereads without another charge (provider fixtures)', async t => {
  const store = new AccountStore(':memory:');
  const user = store.createUser('free-flow@example.test', await passwordHash('Synthetic password 123!'));
  store.emailToken(user.id, 'verified-test-fixture'); store.consumeEmailToken('verified-test-fixture', 'verify');
  const logs = [], stages = [];
  let fail = true, modelCalls = 0;
  const metadata = new YouTubeMetadataService({ apiKey: 'synthetic-youtube-key', fetchImpl: async url => {
    if (new URL(url).pathname.endsWith('/channels')) return Response.json({ items: [] });
    return Response.json({ items: [{ snippet: { title: 'Synthetic Rocket Lab fixture', channelId: `UC${'a'.repeat(22)}`,
      channelTitle: 'Fixture creator', defaultAudioLanguage: 'en-US', publishedAt: '2025-04-25T17:05:00Z' }, contentDetails: { duration: 'PT10M' } }] });
  } });
  const analyzer = createReportAnalyzer({ youtubeMetadataService: metadata,
    sourceService: new SourceService({ fetchImpl: captionFetch() }), analysisVersion: 8, model: 'fixture-only',
    analyzeTranscript: async ({ source, onStage, signal }) => {
      return extractVerifiedReport({ source, onStage, signal, evidenceMode: 'segments', prompt: 'Fixture source', generate: async () => {
        modelCalls++;
        if (fail) throw Object.assign(new Error('Synthetic provider outage'), { code: 'PROVIDER_UNAVAILABLE' });
        return { summary: text, companies: [{ company: 'Rocket Lab', ticker: 'RKLB',
          evidence: [{ segment_ids: ['s1'] }] }] };
      } });
    } });
  const app = express();
  const runtime = installAccounts(app, { store, analysisConfigured: true,
    analysisLogger: { error: (_, record) => logs.push(JSON.parse(record)), info: (_, record) => logs.push(JSON.parse(record)) },
    analyze: (input, options) => analyzer(input, { ...options, onStage: stage => { stages.push(stage); options.onStage(stage); } }),
    buildDashboard: async records => ({ videos: Object.values(records).map(r => ({ id: r.video.id, title: r.video.title })) })
  }, { PUBLIC_BASE_URL: 'http://localhost:3000' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { runtime.jobs.stop(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let token;
  async function request(route, body) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const login = await request('/auth/login', { email: user.email, password: 'Synthetic password 123!' });
  assert.equal(login.status, 200); token = login.body.token;
  assert.equal((await request('/me')).body.analyses_available, 1);
  async function analyze() {
    const accepted = await request('/analyze', { videoId, confirmCredit: true });
    assert.equal(accepted.status, 202);
    for (let i = 0; i < 100; i++) {
      const result = await request(`/analysis-jobs/${accepted.body.jobId}`);
      if (result.body.state !== 'reserved') return result.body;
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail('Job did not settle');
  }
  const failed = await analyze();
  assert.equal(failed.state, 'failed'); assert.equal(failed.credit_released, true);
  assert.equal((await request('/me')).body.analyses_available, 1);
  assert.equal((await request(`/videos/${videoId}`)).status, 404);
  const logged = logs.find(r => r.event === 'analysis_failed');
  assert.equal(logged.stage, 'model_response'); assert.equal(logged.jobId, failed.jobId);
  assert.match(logged.error.message, /Synthetic provider outage/u); assert.match(logged.error.stack, /freeAnalysisFlow/u);
  fail = false;
  const completed = await analyze(); assert.equal(completed.state, 'complete');
  assert.equal((await request('/me')).body.analyses_available, 0);
  const saved = await request(`/videos/${videoId}`); assert.equal(saved.status, 200);
  assert.equal(saved.body.source.language, 'en'); assert.equal(saved.body.companies[0].evidence[0].start_seconds, 1);
  assert.equal(saved.body.evidence_extraction_version, 3);
  assert.equal(saved.body.companies[0].evidence[0].original_text, text);
  assert.equal(saved.body.companies[0].evidence[0].quote_origin, 'source_segments');
  assert.equal((await request('/analyze', { videoId, confirmCredit: true })).body.credits_consumed, 0);
  assert.equal((await request('/analyze', { videoId: 'TestVideo02', confirmCredit: true })).status, 402);
  assert.equal(modelCalls, 2); assert.ok(stages.includes('transcript')); assert.ok(stages.includes('evidence_validation'));
});

test('diagnostics preserve message and stack while redacting known secrets, credentials, signed URLs and causes', () => {
  const secret = 'synthetic-provider-secret-value';
  const error = new Error(`Provider unavailable ${secret}; https://youtube.com/api/timedtext?signature=sensitive; password="do-not-log-me"`);
  error.cause = new Error('Authorization: Bearer private-session\nCookie: yt_session=private-cookie; secondary=another-private-cookie\napi_key=private-key');
  const records = [];
  logAnalysis({ error: (_, value) => records.push(value) }, { jobId: 'fixture-job', videoId, stage: 'model_response', state: 'failed', error }, { GEMINI_API_KEY: secret });
  for (const value of [secret, 'do-not-log-me', 'private-session', 'private-cookie', 'another-private-cookie', 'private-key', 'signature=sensitive']) assert.equal(records[0].includes(value), false);
  const result = JSON.parse(records[0]); assert.match(result.error.message, /Provider unavailable/u); assert.match(result.error.stack, /freeAnalysisFlow/u);
  assert.match(redact(`https://name:private-password@example.test/path?key=x`), /example.test\/path\?\[REDACTED\]/u);
});

test('a provider ignoring cancellation cannot hold a free credit or later persist a timed-out report', async t => {
  const store = new AccountStore(':memory:'); t.after(() => store.close());
  const user = store.createUser('timeout@example.test', 'unused'); store.emailToken(user.id, 'fixture'); store.consumeEmailToken('fixture', 'verify');
  let resolve, aborted = false;
  const worker = new AnalysisJobs({ store, timeoutMs: 10, logger: { error() { throw Error('logger unavailable'); }, info() {} },
    analyze: (input, { signal, onStage }) => { onStage('model_response'); signal.addEventListener('abort', () => { aborted = true; }); return new Promise(done => { resolve = done; }); } });
  const job = worker.start(user.id, { videoId });
  await new Promise(done => setTimeout(done, 30));
  assert.equal(store.job(user.id, job.id).error_code, 'ANALYSIS_TIMEOUT'); assert.equal(aborted, true);
  assert.equal(store.account(user.id).analyses_available, 1);
  resolve({ video: { id: videoId }, analysis_version: 8 });
  await new Promise(done => setImmediate(done));
  assert.equal(store.ownReport(user.id, videoId), null); worker.stop();
});
