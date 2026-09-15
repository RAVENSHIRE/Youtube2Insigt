const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyFreeAnalysis } = require('../scripts/verify-free-analysis');

function fixture(state = 'complete') {
  let available = 1, submitted = false;
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    const route = new URL(url).pathname; calls.push(route);
    if (route === '/health') return Response.json({ analysisConfigured: true });
    if (route === '/auth/login') return Response.json({ token: 'synthetic-session' });
    if (route === '/auth/logout') return Response.json({ ok: true });
    if (route === '/me') return Response.json({ plan: 'free', analyses_available: available });
    if (route === '/analyze') {
      const first = !submitted; submitted = true;
      return Response.json(first ? { jobId: 'synthetic-job', state: 'reserved' } : { cached: true, state: 'complete', credits_consumed: 0 });
    }
    if (route.startsWith('/analysis-jobs/')) {
      available = state === 'complete' ? 0 : 1;
      return Response.json({ state, code: state === 'failed' ? 'QUOTE_SOURCE_MISMATCH' : null });
    }
    if (route.startsWith('/videos/')) return Response.json({ video: { id: 'J3Y_JBATcWg' }, companies: [{ company: 'Fixture' }],
      evidence_version: 1, source: { video_id: 'J3Y_JBATcWg', language: 'en', segments: [{ id: 's1' }], retrieved_at: new Date().toISOString() } });
    throw Error('Unexpected probe endpoint');
  } };
}
const input = { email: 'test@example.test', password: 'synthetic-password', videoUrl: 'https://www.youtube.com/watch?v=J3Y_JBATcWg', consumeCredit: true, delay: async () => {} };

test('live probe requires explicit consumption and a local server before submitting any credentials', async () => {
  let requests = 0; const fetchImpl = async () => { requests++; };
  await assert.rejects(verifyFreeAnalysis({ ...input, fetchImpl, consumeCredit: false }), /EXPLICIT_CREDIT_CONSENT_REQUIRED/u);
  await assert.rejects(verifyFreeAnalysis({ ...input, fetchImpl, base: 'https://untrusted.example.test' }), /LOCAL_SERVER_REQUIRED/u);
  assert.equal(requests, 0);
});
test('probe verifies persistence, fresh source, one-credit consumption and free reread without printing credentials', async () => {
  const f = fixture(), result = await verifyFreeAnalysis({ ...input, fetchImpl: f.fetchImpl });
  assert.equal(result.status, 'success'); assert.equal(result.credit_consumed_once, true); assert.equal(result.reread_free, true);
  assert.equal(result.report_saved, true); assert.equal(result.source_verified, true); assert.equal(result.fresh_source, true);
  assert.equal(JSON.stringify(result).includes(input.password), false);
  assert.equal(JSON.stringify(result).includes('synthetic-session'), false);
  assert.equal(f.calls.at(-1), '/auth/logout');
});
test('probe reports genuine analysis failure and confirms credit recovery instead of claiming success', async () => {
  const f = fixture('failed'), result = await verifyFreeAnalysis({ ...input, fetchImpl: f.fetchImpl });
  assert.equal(result.status, 'analysis_failed'); assert.equal(result.code, 'QUOTE_SOURCE_MISMATCH');
  assert.equal(result.credit_released, true); assert.equal(result.credits_after, 1);
  assert.equal(f.calls.at(-1), '/auth/logout');
});
test('an old globally cached source cannot be reported as a fresh live-provider proof', async () => {
  const f = fixture();
  const result = await verifyFreeAnalysis({ ...input, fetchImpl: async (url, options) => {
    const response = await f.fetchImpl(url, options);
    if (!new URL(url).pathname.startsWith('/videos/')) return response;
    const data = await response.json(); data.source.retrieved_at = '2020-01-01T00:00:00Z'; return Response.json(data);
  } });
  assert.equal(result.status, 'not_verified_cached_source'); assert.equal(result.fresh_source, false);
});
