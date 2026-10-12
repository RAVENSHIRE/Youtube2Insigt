const test = require('node:test');
const assert = require('node:assert/strict');
const { exportWatchlist, HEADERS } = require('../exports/watchlistCsv');
const { render, publicationDate } = require('../web/report-view');

test('watchlist exports unique resolved symbols without inventing prices or positions', () => {
  const report = {video:{id:'J3Y_JBATcWg',published_at:'2025-04-25T17:05:00Z'},companies:[
    {company:'Rocket Lab',ticker:'RKLB'}, {company:'AST Spacemobile',ticker:'ASTS'},
    {company:'Rocket Lab',ticker:'RKLB'}, {company:'Resolve AI',ticker:'RZLB'},
    {company:'Innodata Inc',ticker:'INDO'}, {company:'Unknown',ticker:'=CMD()'},
    {company:'Unknown',ticker:'SAP'}, {company:'Canter Equity Partners',ticker:'CEP'}
  ]};
  const original = JSON.stringify(report), result = exportWatchlist(report);
  assert.deepEqual(result.symbols,['RKLB','ASTS','RZLV']);
  assert.equal(result.skipped.length,4);
  assert.equal(JSON.stringify(report),original);
  const lines = result.csv.trim().split('\r\n');
  assert.equal(lines[0].split(',')[0],'Symbol');
  for (const line of lines.slice(1)) {
    const values = line.split(','); assert.equal(values.length,HEADERS.length);
    assert.ok(values.slice(1).every(value=>value===''));
  }
  assert.ok(!result.csv.includes('=CMD'));
});
test('publication is separate from analysis time and report export stays in its library scope', () => {
  assert.equal(publicationDate(null),'nicht bekannt');
  assert.equal(publicationDate('not-a-date'),'nicht bekannt');
  assert.equal(publicationDate('2026-09-02T23:30:00Z'),'3. September 2026');
  const data = {video:{id:'J3Y_JBATcWg',published_at:'2025-04-25T17:05:00Z'},companies:[]};
  assert.ok(render(data).includes('Veröffentlicht: 25. April 2025'));
  assert.ok(render(data).includes('href="/videos/J3Y_JBATcWg/report.csv"'));
  assert.ok(render({...data,example:true}).includes('href="/examples/videos/J3Y_JBATcWg/report.csv"'));
});
