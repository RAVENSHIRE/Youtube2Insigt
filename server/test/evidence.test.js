const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { makeSource, validateEvidence, validateReport } = require('../evidence/sourceIntegrity');
const { SourceService, AudioFallback } = require('../evidence/sourceService');
const { RevisionRepository } = require('../evidence/revisionRepository');
const ui = require('../../extension/evidence-ui');

const videoId = 'TestVideo01';
const items = [{ text: 'I buy Example at 12 dollars.', offset: 65000, duration: 4000, lang: 'en' }];
const source = () => makeSource({ videoId, items, language: 'en', unit: 'milliseconds', durationSeconds: 120 });
const evidence = () => ({ segment_ids: ['s1'], original_text: 'I buy Example at 12 dollars.' });

test('preserves caption language, original text and format-derived seconds', () => {
  const s = source();
  assert.equal(s.segments[0].start_seconds, 65);
  assert.equal(s.segments[0].end_seconds, 69);
  assert.equal(s.segments[0].language, 'en');
  assert.equal(s.segments[0].text, items[0].text);
  assert.throws(() => makeSource({ videoId, items, unit: null }), /Zeitformat/);
});
test('derives quotation times from source, not model-supplied times; translation stays separate', () => {
  const s = source();
  const quote = validateEvidence({ ...evidence(), start_seconds: 999, translation: { text: 'Ich kaufe Example für 12 Dollar.' } }, s, 'de');
  assert.equal(quote.start_seconds, 65);
  assert.equal(quote.original_text, items[0].text);
  assert.equal(quote.translation.label, 'AI translation');
  assert.equal(quote.translation.language, 'de');
});
test('rejects invented quotes, missing segments and unexpected Arabic in English reports', () => {
  const s = source();
  assert.throws(() => validateEvidence({ ...evidence(), original_text: 'Guaranteed profits!' }, s), { code: 'QUOTE_SOURCE_MISMATCH' });
  assert.throws(() => validateEvidence({ ...evidence(), segment_ids: ['s9'] }, s), { code: 'EVIDENCE_UNSUPPORTED' });
  assert.throws(() => validateReport({ summary: 'العربية', companies: [{ evidence: [evidence()] }] }, s), { code: 'SOURCE_LANGUAGE_MISMATCH' });
  assert.throws(() => validateReport({ summary: 'Example', companies: [{ evidence: [] }] }, s), { code: 'EVIDENCE_MISSING' });
});
test('supports coherent original German segments', () => {
  const s = makeSource({ videoId, items: [{ text: 'Das Risiko ist hoch.', lang: 'de', offset: 5, duration: 2 }], unit: 'seconds', language: 'de', durationSeconds: 10 });
  const result = validateReport({ summary: 'Das Risiko ist hoch.', companies: [{ evidence: [{ segment_ids: ['s1'], original_text: 'Das Risiko ist hoch.' }] }] }, s);
  assert.equal(result.report_language, 'de');
});
test('identifies srv3 and classic units from actual transcript responses', async () => {
  for (const [xml, offset, expected] of [['<p t="65000" d="4000">hello</p>', 65000, 65], ['<text start="65" dur="4">hello</text>', 65, 65]]) {
    const service = new SourceService({ fetchImpl: async () => new Response(xml), transcript: {
      async fetchTranscript(id, config) { await config.fetch('https://www.youtube.com/api/timedtext'); return [{ text: 'hello', offset, duration: offset === 65 ? 4 : 4000, lang: 'en' }]; }
    } });
    assert.equal((await service.get(videoId, { durationSeconds: 120, language: 'en' })).segments[0].start_seconds, expected);
  }
});
test('missing transcript has a bounded explicit fallback and rejects wrong audio identity', async () => {
  let called = 0;
  const service = new SourceService({ transcript: { fetchTranscript: async () => { throw Error('unavailable'); } }, audioFallback: {
    transcribe: async () => { called++; return source(); }
  } });
  await service.get(videoId, { durationSeconds: 120 });
  assert.equal(called, 1);
  await assert.rejects(service.get(videoId, { durationSeconds: 1800 }), { code: 'TRANSCRIPT_UNAVAILABLE' });
  assert.equal(called, 1);
  const audio = new AudioFallback({ url: 'https://speech.example.test/transcribe', apiKey: 'test', fetchImpl: async () => Response.json({ translated: false, source_video_id: 'wrong' }) });
  await assert.rejects(audio.transcribe(videoId, { durationSeconds: 120 }), { code: 'AUDIO_SOURCE_UNVERIFIED' });
});
test('repair versions retain an immutable original and do not auto-activate', async t => {
  await fs.mkdir(path.join(__dirname, '.tmp'), { recursive: true });
  const dir = await fs.mkdtemp(path.join(__dirname, '.tmp', 'yt-revisions-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const repo = new RevisionRepository(dir);
  const parent = { video: { id: videoId }, evidence: ['legacy'] };
  const copy = structuredClone(parent);
  const result = await repo.write({ ...parent, source: source() }, { parent });
  assert.equal(result.activated, false);
  assert.deepEqual(parent, copy);
  assert.equal((await fs.readdir(dir)).length, 2);
  assert.ok((await repo.read(result.id)).parent_sha256);
});
test('renders safe clickable mm:ss and never manufactures timestamps for legacy evidence', () => {
  assert.match(ui.render([validateEvidence(evidence(), source())]), /01:05/);
  assert.doesNotMatch(ui.render(['<img src=x onerror=alert(1)>']), /data-seek-evidence/);
  assert.match(ui.render(['<img>']), /&lt;img&gt;/);
});
test('background reuses a tab and seeks; new videos include t= without duplicate tabs', async () => {
  const updates = [], messages = [], created = [];
  let tabs = [{ id: 5, windowId: 1, url: `https://www.youtube.com/watch?v=${videoId}&list=abc` }];
  const context = vm.createContext({ URL, console, Map, setTimeout, clearTimeout, AbortController,
    chrome: { sidePanel: { setPanelBehavior: async () => {} }, runtime: { onMessage: { addListener() {} } },
      tabs: { query: async () => tabs, update: async (...args) => updates.push(args), sendMessage: async (...args) => { messages.push(args); return { ok: true }; }, create: async arg => { created.push(arg); return { id: 9 }; } },
      windows: { update: async () => {} } } });
  vm.runInContext(await fs.readFile(path.join(__dirname, '../../extension/background.js'), 'utf8'), context);
  await vm.runInContext(`openOrFocusVideo('https://www.youtube.com/watch?v=${videoId}', 65)`, context);
  assert.equal(messages[0][1].seconds, 65);
  assert.equal(created.length, 0);
  tabs = [];
  await vm.runInContext(`openOrFocusVideo('https://www.youtube.com/watch?v=${videoId}', 65)`, context);
  assert.equal(new URL(created[0].url).searchParams.get('t'), '65s');
  await assert.rejects(vm.runInContext(`openOrFocusVideo('https://evil.test/watch?v=${videoId}', 65)`, context));
});
