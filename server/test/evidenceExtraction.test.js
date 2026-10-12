const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSource, validateReport } = require('../evidence/sourceIntegrity');
const { extractVerifiedReport } = require('../services/evidenceExtractionService');
const { AccountStore } = require('../accounts/store');
const { AnalysisJobs } = require('../accounts/analysisJobs');

const source = makeSource({ videoId: 'RN_C7a66OSA', unit: 'seconds', language: 'de', durationSeconds: 120,
  items: [{ text: 'Ich kaufe Example bei', offset: 5, duration: 2, lang: 'de' },
    { text: 'zwölf Dollar.', offset: 7, duration: 2, lang: 'de' }] });
function report(valid = true) {
  return { summary: 'Ein Kauf wird beschrieben.', companies: [{ company: 'Example',
    evidence: [{ segment_ids: ['s1', 's2'], original_text: valid ? 'Ich kaufe Example bei zwölf Dollar.' : 'Ich kaufe Example bei 12 Dollar.' }] }] };
}

test('valid exact evidence needs only one model response and retains source-derived timing', async () => {
  let calls = 0;
  const result = await extractVerifiedReport({ source, prompt: 'Original data', generate: async () => { calls++; return report(); } });
  assert.equal(calls, 1);
  assert.equal(result.companies[0].evidence[0].start_seconds, 5);
  assert.equal(result.companies[0].evidence[0].end_seconds, 9);
});
test('a paraphrased quotation can recover once, but only with exact original text', async () => {
  const prompts = [], stages = [], before = JSON.stringify(source);
  const result = await extractVerifiedReport({ source, prompt: 'Original data', onStage: stage => stages.push(stage),
    generate: async prompt => { prompts.push(prompt); return report(prompts.length === 2); } });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Firma 1, Beleg 1/u);
  assert.match(prompts[1], /QUELLENPRUEFUNG: QUOTE_SOURCE_MISMATCH/u);
  assert.equal(result.companies[0].evidence[0].original_text, 'Ich kaufe Example bei zwölf Dollar.');
  assert.deepEqual(stages, ['model_response', 'evidence_validation', 'evidence_repair', 'evidence_validation']);
  assert.equal(JSON.stringify(source), before);
});
test('persistent invented evidence remains rejected after exactly two model responses', async () => {
  let calls = 0;
  await assert.rejects(extractVerifiedReport({ source, prompt: '', generate: async () => { calls++; return report(false); } }),
    { code: 'QUOTE_SOURCE_MISMATCH', analysisStage: 'evidence_validation', companyIndex: 0, evidenceIndex: 0 });
  assert.equal(calls, 2);
});
test('unrelated language errors and provider errors do not trigger evidence repair', async () => {
  for (const mode of ['language', 'provider']) {
    let calls = 0;
    await assert.rejects(extractVerifiedReport({ source, prompt: '', generate: async () => {
      calls++;
      if (mode === 'provider') throw Object.assign(new Error('Unavailable'), { code: 'MODEL_UNAVAILABLE' });
      return { ...report(), summary: 'العربية' };
    } }), { code: mode === 'provider' ? 'MODEL_UNAVAILABLE' : 'SOURCE_LANGUAGE_MISMATCH' });
    assert.equal(calls, 1);
  }
});
test('cancellation prevents a second model call under the existing job deadline', async () => {
  let calls = 0;
  const controller = new AbortController();
  await assert.rejects(extractVerifiedReport({ source, prompt: '', signal: controller.signal,
    generate: async () => { calls++; controller.abort(); return report(false); } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('validation errors identify company and evidence without logging source text', () => {
  const data = report(); data.companies.push(report(false).companies[0]);
  assert.throws(() => validateReport(data, source), error => {
    assert.equal(error.companyIndex, 1); assert.equal(error.evidenceIndex, 0);
    assert.match(error.message, /Firma 2, Beleg 1/u);
    assert.doesNotMatch(error.message, /zwölf|12 Dollar/u);
    return true;
  });
});
for (const recover of [true, false]) test(`Free evidence repair ${recover ? 'consumes once on verified success' : 'releases credit on failure'}`, async t => {
  const store = new AccountStore(':memory:'); t.after(() => store.close());
  const user = store.createUser('evidence@example.test', 'unused');
  store.emailToken(user.id, 'verify-test'); store.consumeEmailToken('verify-test', 'verify');
  let calls = 0;
  const jobs = new AnalysisJobs({ store, logger: { info() {}, error() {} }, analyze: async (input, options) => {
    const verified = await extractVerifiedReport({ ...options, source, prompt: 'Original data',
      generate: async () => { calls++; return report(recover && calls === 2); } });
    return { ...verified, video: { id: source.video_id }, analysis_version: 8 };
  } });
  t.after(() => jobs.stop());
  const job = jobs.start(user.id, { videoId: source.video_id });
  const deadline = Date.now() + 2000;
  while (store.job(user.id, job.id).state === 'reserved' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(store.job(user.id, job.id).state, recover ? 'complete' : 'failed');
  assert.equal(store.account(user.id).analyses_available, recover ? 0 : 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get().n, 1);
  assert.equal(calls, 2);
});
