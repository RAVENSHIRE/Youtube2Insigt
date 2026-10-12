const test = require('node:test');
const assert = require('node:assert/strict');
const { commodityTradingView } = require('../instruments/commodityTradingView');
const { tradingViewLink } = require('../instruments/marketIdentity');
const { projectResearchForRead } = require('../instruments/instrumentProjection');
const { tickerLink } = require('../web/report-view');
const url='https://www.tradingview.com/symbols/OANDA-XAUUSD/';

test('Gold commodity links work without a ticker and with supported USD aliases',()=>{
 for(const ticker of [null,'GOLD','XAU','XAUUSD','XAU/USD','xauusd'])for(const asset_type of ['commodity','COMMODITY']) {
  const asset={company:'Gold',ticker,asset_type};
  assert.equal(tradingViewLink(asset),url);
  assert.match(commodityTradingView(asset).label,/Referenzchart/u);
 }
 assert.equal(tradingViewLink({company:'Goldpreis',asset_type:'commodity'}),url);
});
test('commodity navigation never conflates a mining equity, ETF, future, other currency or conflicting name',()=>{
 for(const asset of [
  {company:'Barrick Gold',ticker:'GOLD',asset_type:'stock',verified_listing:{exchange:'NYSE'}},
  {company:'Gold',ticker:'GOLD',asset_type:'stock'},
  {company:'Gold',ticker:'GLD',asset_type:'etf'},
  {company:'Gold',ticker:'GC1!',asset_type:'commodity'},
  {company:'Gold',ticker:'XAUEUR',asset_type:'commodity'},
  {company:'Gold',asset_type:'commodity',currency:'EUR'},
  {company:'Gold',ticker:'GOLD',asset_type:'commodity',identity_conflict:true},
  {company:'Barrick Gold',ticker:'GOLD',asset_type:'commodity'},
  {company:'Silver',ticker:'GOLD',asset_type:'commodity'},
  {company:'Copper',ticker:'HG',asset_type:'commodity'},
  {company:'Gold'}, {asset_type:'commodity'}
 ]) {
  assert.equal(commodityTradingView(asset),null);
  assert.notEqual(tradingViewLink(asset),url);
 }
});
test('saved commodity reports receive reference navigation on read without rewritten ticker, quotes or prices',()=>{
 const stored={video:{id:'J3Y_JBATcWg'},companies:[{company:'Gold',ticker:null,asset_type:'commodity',evidence:[{original_text:'Gold source quotation',start_seconds:42}],price_targets:[{value:2500,currency:'USD'}]}]};
 const before=JSON.stringify(stored),projected=projectResearchForRead(stored);
 assert.equal(JSON.stringify(stored),before);
 assert.equal(projected.companies[0].ticker,null);
 assert.equal(projected.companies[0].tradingview_url,url);
 assert.deepEqual(projected.companies[0].evidence,stored.companies[0].evidence);
 assert.deepEqual(projected.companies[0].price_targets,stored.companies[0].price_targets);
 assert.match(tickerLink(projected.companies[0]),/OANDA-XAUUSD/u);
 assert.match(tickerLink(projected.companies[0]),/Referenzchart/u);
});
test('unknown commodities never fall back to an ambiguous equity symbol search',()=>{
 assert.doesNotMatch(tickerLink({company:'Gold',ticker:'GOLD',asset_type:'commodity'}),/href=/u);
 assert.doesNotMatch(tickerLink({company:'Copper',ticker:'HG',asset_type:'COMMODITY'}),/href=/u);
 assert.match(tickerLink({company:'Equity',ticker:'GOLD',asset_type:'stock'}),/chart\/\?symbol=GOLD/u);
});
