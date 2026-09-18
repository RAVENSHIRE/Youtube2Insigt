const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { GoogleGenAI } = require('@google/genai');
const { SourceService } = require('../evidence/sourceService');
const { digest } = require('../evidence/sourceIntegrity');
const { requestAnalysisModel, RETRY_POLICY } = require('../services/analysisModelService');
const { AnalysisJobs } = require('../accounts/analysisJobs');
const { AccountStore } = require('../accounts/store');

const videoId = 'av1oUOHihtU';
function captionProvider(lang, translated = false) {
  return async url => String(url).includes('/player') ? Response.json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { languageCode: lang, kind: 'asr', baseUrl: `https://www.youtube.com/api/timedtext?lang=${lang}${translated ? '&tlang=en' : ''}` }
  ] } } }) : new Response('<transcript><text start="1" dur="2">Cybersecurity wächst.</text></transcript>');
}
test('en-US video metadata no longer rejects the available native German captions (reported av1oUOHihtU failure)', async () => {
  const source = await new SourceService({ fetchImpl: captionProvider('de') }).get(videoId, { language: 'en-US', durationSeconds: 2115 });
  assert.equal(source.language, 'de'); assert.equal(source.segments[0].language, 'de');
  assert.equal(source.segments[0].text, 'Cybersecurity wächst.');
  assert.deepEqual(source.language_selection, { metadata_language: 'en-US', caption_language: 'de', metadata_mismatch: true, basis: 'native_caption_track' });
  const { sha256, retrieved_at, ...content } = source;
  assert.equal(sha256, digest(content));
});
test('caption fallback still rejects unsupported Arabic and translated tracks', async () => {
  await assert.rejects(new SourceService({ fetchImpl: captionProvider('ar') }).get(videoId, { language: 'en-US', durationSeconds: 2115 }), { code: 'SOURCE_LANGUAGE_UNSUPPORTED' });
  await assert.rejects(new SourceService({ fetchImpl: captionProvider('de', true) }).get(videoId, { language: 'en-US', durationSeconds: 2115 }), { code: 'SOURCE_URL_REJECTED' });
});

async function modelFixture(t, statuses) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    req.resume(); const status = statuses[Math.min(calls++, statuses.length - 1)];
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { candidates: [{ content: { role: 'model', parts: [{ text: '{"summary":"Fixture"}' }] }, finishReason: 'STOP' }] }
      : { error: { code: status, status: status === 503 ? 'UNAVAILABLE' : 'FAILED', message: status === 503 ? 'This model is currently experiencing high demand.' : 'Fixture error' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const ai = new GoogleGenAI({ apiKey: 'fixture-key', httpOptions: { baseUrl: `http://127.0.0.1:${server.address().port}` } });
  return { calls: () => calls, request: signal => requestAnalysisModel(ai, { model: 'fixture-model', contents: 'Fixture', config: { abortSignal: signal } },
    { ...RETRY_POLICY, initialDelay: 0.001, maxDelay: 0.002, jitter: 0 }) };
}
for (const [name, statuses, expectedCalls, errorCode] of [
  ['temporary 503 recovers', [503, 200], 2, null],
  ['persistent 503 stops after three attempts', [503], 3, 'MODEL_UNAVAILABLE'],
  ['429 remains bounded', [429], 3, 'MODEL_RATE_LIMIT'],
  ['400 is not retried', [400], 1, null]
]) test(`installed Gemini SDK: ${name}`, async t => {
  const f = await modelFixture(t, statuses);
  if (statuses.includes(200)) assert.match((await f.request()).text, /Fixture/u);
  else await assert.rejects(f.request(), error => {
    if (errorCode) { assert.equal(error.code, errorCode); assert.equal(error.cause.status, statuses[0]); }
    else assert.equal(error.status, 400);
    return true;
  });
  assert.equal(f.calls(), expectedCalls);
});
test('aborted Gemini request does not begin retries', async t => {
  const f = await modelFixture(t, [503]), controller = new AbortController(); controller.abort();
  await assert.rejects(f.request(controller.signal)); assert.equal(f.calls(), 0);
});
for (const recover of [true, false]) test(`one Free reservation survives SDK retries; ${recover ? 'success consumes once' : 'exhaustion releases credit'}`, async t => {
  const f = await modelFixture(t, recover ? [503, 200] : [503]);
  const store = new AccountStore(':memory:'); t.after(() => store.close());
  const user = store.createUser('fixture@example.test', 'unused'); store.emailToken(user.id, 'test'); store.consumeEmailToken('test', 'verify');
  const jobs = new AnalysisJobs({ store, logger: { info() {}, error() {} }, analyze: async (input, { signal }) => {
    await f.request(signal); return { video: { id: videoId }, analysis_version: 8, companies: [] };
  } });
  const job = jobs.start(user.id, { videoId });
  const deadline = Date.now() + 2000;
  while (store.job(user.id, job.id).state === 'reserved' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(store.job(user.id, job.id).state, recover ? 'complete' : 'failed');
  assert.equal(store.account(user.id).analyses_available, recover ? 0 : 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get().n, 1);
  jobs.stop();
});
