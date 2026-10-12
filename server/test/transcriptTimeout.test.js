const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: wait } = require('node:timers/promises');
const { SourceService } = require('../evidence/sourceService');
const { AccountStore } = require('../accounts/store');
const { AnalysisJobs } = require('../accounts/analysisJobs');

const metadata = { durationSeconds: 1200, language: 'de' };
const videoId = 'RN_C7a66OSA';
const xml = '<transcript><text start="5" dur="2">Das Risiko ist hoch.</text></transcript>';
const timeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');
function provider(failures = 1, bodyFailure = false) {
  let captionCalls = 0;
  return {
    calls: () => captionCalls,
    fetchImpl: async url => {
      if (String(url).includes('/player')) return Response.json({ captions: { playerCaptionsTracklistRenderer: {
        captionTracks: [{ languageCode: 'de', baseUrl: 'https://www.youtube.com/api/timedtext?lang=de' }]
      } } });
      captionCalls++;
      if (captionCalls <= failures) {
        if (bodyFailure) return new Response(new ReadableStream({ start(controller) { controller.error(timeout()); } }));
        throw timeout();
      }
      return new Response(xml);
    }
  };
}

for (const bodyFailure of [false, true]) test(`installed caption library recovers once from ${bodyFailure ? 'body' : 'request'} timeout`, async () => {
  const f = provider(1, bodyFailure);
  const result = await new SourceService({ fetchImpl: f.fetchImpl, retryDelayMs: 1 }).get(videoId, metadata);
  assert.equal(f.calls(), 2);
  assert.equal(result.language, 'de');
  assert.equal(result.segments[0].text, 'Das Risiko ist hoch.');
  assert.equal(result.segments[0].start_seconds, 5);
});
test('persistent timeout stops after two attempts with an accurate code, without audio fallback', async () => {
  const f = provider(Infinity);
  let audioCalls = 0;
  const service = new SourceService({ fetchImpl: f.fetchImpl, retryDelayMs: 1,
    audioFallback: { transcribe() { audioCalls++; } } });
  await assert.rejects(service.get(videoId, { ...metadata, durationSeconds: 120 }), error => {
    assert.equal(error.code, 'TRANSCRIPT_TIMEOUT');
    assert.equal(error.cause.name, 'TimeoutError');
    assert.doesNotMatch(error.message, /15 Minuten|Fallback/u);
    return true;
  });
  assert.equal(f.calls(), 2); assert.equal(audioCalls, 0);
});
test('caller cancellation cannot begin a retry', async () => {
  const controller = new AbortController(); let calls = 0;
  const service = new SourceService({ transcript: { async fetchTranscript() {
    calls++; controller.abort(new Error('job deadline')); throw timeout();
  } }, retryDelayMs: 1 });
  await assert.rejects(service.get(videoId, metadata, { signal: controller.signal }), /job deadline/u);
  assert.equal(calls, 1);
});
test('caption acquisition deadline bounds all attempts and language fallbacks', async () => {
  let calls = 0;
  const service = new SourceService({ transcriptTimeoutMs: 5, retryDelayMs: 1, transcript: {
    async fetchTranscript() { calls++; await wait(20); throw timeout(); }
  } });
  await assert.rejects(service.get(videoId, metadata), { code: 'TRANSCRIPT_TIMEOUT' });
  assert.equal(calls, 1);
});
test('missing captions remain distinct from timeouts and are not retried', async () => {
  let calls = 0;
  const service = new SourceService({ transcript: { async fetchTranscript() { calls++; throw new Error('No captions'); } }, retryDelayMs: 1 });
  await assert.rejects(service.get(videoId, metadata), { code: 'TRANSCRIPT_UNAVAILABLE' });
  assert.equal(calls, 1);
});
for (const recover of [true, false]) test(`Free credit after transcript retry: ${recover ? 'consumed once' : 'released'}`, async t => {
  const f = provider(recover ? 1 : Infinity);
  const service = new SourceService({ fetchImpl: f.fetchImpl, retryDelayMs: 1 });
  const store = new AccountStore(':memory:'); t.after(() => store.close());
  const user = store.createUser('timeout@example.test', 'unused');
  store.emailToken(user.id, 'verify'); store.consumeEmailToken('verify', 'verify');
  const jobs = new AnalysisJobs({ store, logger: { info() {}, error() {} }, analyze: async (input, options) => {
    const source = await service.get(input.videoId, metadata, options);
    // Provider-independent job fixture: production continues through Gemini and evidence validation.
    return { video: { id: videoId }, analysis_version: 8, source, companies: [] };
  } });
  t.after(() => jobs.stop());
  const job = jobs.start(user.id, { videoId });
  const deadline = Date.now() + 2000;
  while (store.job(user.id, job.id).state === 'reserved' && Date.now() < deadline) await wait(5);
  assert.equal(store.job(user.id, job.id).state, recover ? 'complete' : 'failed');
  assert.equal(store.account(user.id).analyses_available, recover ? 0 : 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get().n, 1);
  assert.equal(f.calls(), 2);
});
