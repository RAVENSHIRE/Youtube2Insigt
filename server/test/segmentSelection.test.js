const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeSource, validateEvidence } = require('../evidence/sourceIntegrity');
const { validateSelectedReport } = require('../evidence/segmentSelection');
const { extractVerifiedReport } = require('../services/evidenceExtractionService');
const { AccountStore } = require('../accounts/store');
const { AnalysisJobs } = require('../accounts/analysisJobs');

function source(language = 'en') {
  const texts = language === 'en' ? ['I, I buy Example at', 'twelve dollars &amp; fifty cents.', 'There is a debt risk.']
    : ['Ich, ich kaufe Example bei', 'zwölf Dollar – nicht dreizehn.', 'Das Risiko ist hoch.'];
  return makeSource({ videoId: 'RN_C7a66OSA', unit: 'seconds', language, durationSeconds: 666,
    items: texts.map((text, i) => ({ text, offset: 10 + i * 2, duration: 2, lang: language })) });
}
const report = (evidence = [{ segment_ids: ['s1', 's2'] }, { segment_ids: ['s3'] }]) => ({
  summary: 'Example', companies: [{ company: 'Example', evidence, risks: [] }]
});

for (const lang of ['en', 'de']) test(`server quotes ${lang} source segments without model rewriting and derives timestamps`, () => {
  const s = source(lang), raw = report(), original = JSON.stringify({ s, raw });
  const result = validateSelectedReport(raw, s);
  const quote = result.companies[0].evidence[0];
  assert.equal(quote.original_text, s.segments.slice(0, 2).map(x => x.text).join(' '));
  assert.equal(quote.start_seconds, 10); assert.equal(quote.end_seconds, 14);
  assert.equal(quote.source_sha256, s.sha256); assert.equal(quote.source_language, lang);
  assert.equal(quote.quote_origin, 'source_segments'); assert.equal(quote.validation, 'source_match');
  assert.equal(result.evidence_extraction_version, 3);
  assert.equal(JSON.stringify({ s, raw }), original);
  assert.equal(quote.translation, null);
});

for (const [name, ids] of [
  ['unknown', ['s999']], ['reversed', ['s2', 's1']],
  ['duplicate', ['s1', 's1']], ['empty', []], ['non-string', [1]], ['oversized', Array.from({length:7}, (_,i)=>`s${i+1}`)]
]) test(`rejects ${name} segment selection`, () => {
  assert.throws(() => validateSelectedReport(report([{ segment_ids: ids }]), source()), { code: 'EVIDENCE_UNSUPPORTED' });
});
test('rejects mixed model quotes/translations/timestamps instead of laundering them into valid evidence', () => {
  for (const extra of [{ original_text: 'Guaranteed profits!' }, { translation: {text: 'Profit'} }, {start_seconds: 100}]) {
    assert.throws(() => validateSelectedReport(report([{ segment_ids: ['s1'], ...extra }]), source()), {code: 'EVIDENCE_SELECTION_INVALID'});
  }
  assert.throws(() => validateEvidence({ segment_ids:['s1'], original_text:'Guaranteed profits!' }, source()), {code:'QUOTE_SOURCE_MISMATCH'});
});
test('rejects missing evidence and wrong-language prose without manufacturing support', () => {
  assert.throws(() => validateSelectedReport(report([]), source()), {code:'EVIDENCE_MISSING'});
  assert.throws(() => validateSelectedReport({...report(), summary:'العربية'}, source()), {code:'SOURCE_LANGUAGE_MISMATCH'});
});
test('a valid selection needs one model call; selection repair remains bounded and uses its own contract', async () => {
  for (const repair of [false, true]) {
    let calls = 0;
    const result = await extractVerifiedReport({ source:source(), prompt:'Source segments', evidenceMode:'segments',
      generate: async prompt => { calls++;
        if (repair && calls === 1) return report([{segment_ids:['s999']}]);
        if (repair) assert.match(prompt, /evidence darf nur segment_ids enthalten/u);
        return report();
      } });
    assert.equal(calls, repair ? 2 : 1);
    assert.equal(result.evidence_extraction_version, 3);
  }
});
test('production generation schema requests IDs only and production analysis enables the selection contract', async () => {
  const code = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const schemaCode = code.slice(code.indexOf('const ANALYSIS_SCHEMA ='), code.indexOf('const app = express();'));
  const schema = vm.runInNewContext(`${schemaCode}\nANALYSIS_SCHEMA`, {ASSET_TYPES:[], SENTIMENTS:[], CALL_TYPES:[], ACTIONS:[], LEVEL_TYPES:[]});
  const item = schema.properties.companies.items.properties.evidence.items;
  assert.deepEqual(Array.from(item.required), ['segment_ids']);
  assert.deepEqual(Object.keys(item.properties), ['segment_ids']);
  const start = code.indexOf('async function analyzeTranscript(');
  const end = code.indexOf('// Shared pure orchestration', start);
  const options = [];
  const analyze = vm.runInNewContext(`${code.slice(start, end)}\nanalyzeTranscript`, {
    extractVerifiedReport: async arg => {options.push(arg); return {summary:'Fixture', companies:[]};},
    generateStructured() {}, buildAnalysisPrompt:()=> 'Fixture', cleanString:x=>x, mergeCompanies:x=>x
  });
  await analyze({source:source()});
  assert.equal(options[0].evidenceMode, 'segments');
});
for (const valid of [true, false]) test(`selection contract ${valid ? 'consumes one Free credit' : 'releases credit after invalid selections'}`, async t => {
  const store = new AccountStore(':memory:'); t.after(()=>store.close());
  const user = store.createUser('selected@example.test','unused'); store.emailToken(user.id,'test');store.consumeEmailToken('test','verify');
  const jobs = new AnalysisJobs({store,logger:{info(){},error(){}}, analyze:async(input,options)=>{
    const verified=await extractVerifiedReport({...options,source:source(),prompt:'Fixture',evidenceMode:'segments',
      generate:async()=>report([{segment_ids:valid ? ['s1','s3'] : ['s999']}])});
    return {...verified,video:{id:input.videoId},analysis_version:8};
  }});
  t.after(()=>jobs.stop());
  const job=jobs.start(user.id,{videoId:'RN_C7a66OSA'}), deadline=Date.now()+2000;
  while(store.job(user.id,job.id).state==='reserved'&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(store.job(user.id,job.id).state,valid?'complete':'failed');
  assert.equal(store.account(user.id).analyses_available,valid?0:1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get().n,1);
  if(!valid) assert.equal(store.ownReport(user.id,'RN_C7a66OSA'),null);
  else assert.deepEqual(store.ownReport(user.id,'RN_C7a66OSA').companies[0].evidence.map(e=>e.segment_ids), [['s1'],['s3']]);
});

for (const lang of ['en','de']) test(`splits separate ${lang} source passages into independently timed evidence without filling gaps`, () => {
  const s=source(lang), raw=report([{segment_ids:['s1','s3']}]);
  const before=JSON.stringify({s,raw});
  const result=validateSelectedReport(raw,s), evidence=result.companies[0].evidence;
  assert.equal(evidence.length,2);
  assert.deepEqual(evidence.map(e=>e.segment_ids),[['s1'],['s3']]);
  assert.deepEqual(evidence.map(e=>[e.start_seconds,e.end_seconds]),[[10,12],[14,16]]);
  assert.deepEqual(evidence.map(e=>e.original_text),[s.segments[0].text,s.segments[2].text]);
  assert.ok(evidence.every(e=>e.validation==='source_match' && e.source_sha256===s.sha256));
  assert.equal(JSON.stringify({s,raw}),before);
  assert.throws(()=>validateEvidence({segment_ids:['s1','s3'],original_text:evidence.map(e=>e.original_text).join(' ')},s),error=>error.selectionReason==='NON_CONTIGUOUS');
});
test('a known separated selection completes without spending a repair request',async()=>{
  let calls=0;
  const result=await extractVerifiedReport({source:source(),prompt:'Fixture',evidenceMode:'segments',generate:async()=>{calls++;return report([{segment_ids:['s1','s3']}]);}});
  assert.equal(calls,1);assert.equal(result.companies[0].evidence.length,2);
});
test('unknown source IDs remain failures, with bounded safe diagnostics and a specific repair reason',async()=>{
  const {logAnalysis}=require('../accounts/analysisDiagnostics');
  let calls=0,failure;
  try {await extractVerifiedReport({source:source(),prompt:'Fixture',evidenceMode:'segments',generate:async prompt=>{
    if(++calls===2)assert.match(prompt,/UNKNOWN_ID/u);
    return report([{segment_ids:['s1','s999']}]);
  }});}catch(error){failure=error;}
  assert.equal(calls,2);assert.equal(failure.selectionReason,'UNKNOWN_ID');
  const logs=[];
  logAnalysis({error:(_,record)=>logs.push(JSON.parse(record))},{jobId:'fixture',videoId:'RN_C7a66OSA',stage:'evidence_validation',state:'failed',error:failure},{});
  assert.deepEqual(logs[0].error.selection,{reason:'UNKNOWN_ID',ids:['s1','s999'],sourceSegmentCount:3});
  assert.equal(JSON.stringify(logs).includes('twelve dollars'),false);
  assert.throws(()=>validateSelectedReport(report([{segment_ids:['password=secret']}]),source()),error=>{
    assert.deepEqual(error.selectedSegmentIds,['[invalid]']);assert.equal(error.message.includes('secret'),false);return true;
  });
});
test('grouping preserves adjacent segments and all selected passages, bounded to thirty excerpts',()=>{
  const s=makeSource({videoId:'RN_C7a66OSA',unit:'seconds',language:'en',durationSeconds:100,items:Array.from({length:12},(_,i)=>({text:`Original segment ${i+1}`,offset:i*2,duration:2,lang:'en'}))});
  const mixed=validateSelectedReport(report([{segment_ids:['s1','s2','s5','s6','s9']}]),s).companies[0].evidence;
  assert.deepEqual(mixed.map(e=>e.segment_ids),[['s1','s2'],['s5','s6'],['s9']]);
  const max=validateSelectedReport(report(Array.from({length:5},()=>({segment_ids:['s1','s3','s5','s7','s9','s11']}))),s);
  assert.equal(max.companies[0].evidence.length,30);
});
