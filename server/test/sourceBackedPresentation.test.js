const test = require('node:test');
const assert = require('node:assert/strict');
const { projectResearchForRead } = require('../instruments/instrumentProjection');
const { render } = require('../web/report-view');
function report(segments, companies) {
  return { video: { id: 'ew2bSq7u4VI', published_at: '2026-09-28T00:00:00Z' },
    source: { segments: segments.map((text, i) => ({ id: 's' + (i + 1), text, start_seconds: 338 + i * 2 })) },
    companies };
}
test('recovers HPE and SOAR chart links only when explicit ticker exists in source', () => {
  const input = report(['SOAR was trading at 24 cents.', 'ticker symbol HPE, right?'], [
    {company:'Volato Group', ticker:null, evidence:[]},
    {company:'Hewlett Packard Enterprise',ticker:null,evidence:[]}
  ]);
  const before=JSON.stringify(input);
  const output=projectResearchForRead(input);
  assert.equal(output.companies[0].ticker,'SOAR');
  assert.equal(output.companies[0].tradingview_url,'https://www.tradingview.com/symbols/AMEX-SOAR/');
  assert.equal(output.companies[1].ticker,'HPE');
  assert.equal(output.companies[1].tradingview_url,'https://www.tradingview.com/symbols/NYSE-HPE/');
  assert.equal(JSON.stringify(input),before);
  const missing=projectResearchForRead(report(['No symbols are spoken.'],input.companies));
  assert.equal(missing.companies[0].tradingview_url,null);
  assert.equal(missing.companies[1].tradingview_url,null);
  const conflicting=projectResearchForRead(report(['SOAR'],[{company:'Volato Group',ticker:'NOTSOAR',evidence:[]}]));
  assert.equal(conflicting.companies[0].ticker,'NOTSOAR');
});
test('expands a truncated SOAR quote using only adjacent verbatim source segments', () => {
  const input=report(['In my opinion,', 'the stock should move much higher.', 'Another company is discussed.'],[
    {company:'Volato Group',evidence:[{validation:'source_match',original_text:'In my opinion,',segment_ids:['s1'],start_seconds:338}]}
  ]);
  const before=JSON.stringify(input);
  const html=render(input);
  assert.match(html,/In my opinion, the stock should move much higher\./u);
  assert.match(html,/Erweiterter Originalkontext/u);
  assert.match(html,/t=338s/u);
  assert.equal(JSON.stringify(input),before);
  const unverified=report(input.source.segments.map(s=>s.text),[{company:'Other',evidence:[{validation:'unverified',original_text:'In my opinion,',segment_ids:['s1'],start_seconds:338}]}]);
  assert.doesNotMatch(render(unverified),/the stock should move much higher/u);
});
