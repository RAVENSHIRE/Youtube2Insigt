const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const accountView = require('../web/report-view');
const code = fs.readFileSync(path.join(__dirname, '../../extension/sidepanel.js'), 'utf8');
const block = (from, to) => code.slice(code.indexOf(from), code.indexOf(to, code.indexOf(from)));
function panel(extra = {}) {
  const context = vm.createContext({ ...extra });
  vm.runInContext(code.slice(code.indexOf('function escapeHtml(')) + '\n' +
    block('function panelTradingViewTarget(', 'function companyKey(') + '\n' +
    block('function renderCompanyReport(', 'function renderOutcomePlaceholder(') + '\n' +
    block('function handleVideoReportSelection(', 'function handleInspectorClick('), context);
  return context;
}
const listings = ['RKLB', 'ASTS'].map(ticker => ({ ticker, company: ticker,
  tradingview_url: `https://www.tradingview.com/symbols/NASDAQ-${ticker}/`, sentiment: 'bull' }));
test('panel ticker destinations match the working account page for resolved, fallback and conflicted instruments', () => {
  const ctx = panel();
  const cases = [...listings, {ticker:'GO'}, {ticker:'NASDAQ:RKLB'},
    {ticker:'INDO', identity_conflict:true, tradingview_url:listings[0].tradingview_url},
    {ticker:'<img src=x onerror=alert(1)>'}, {ticker:'RKLB',tradingview_url:'javascript:alert(1)'}];
  const href = html => html.match(/href="([^"]+)"/u)?.[1] || null;
  for (const company of cases) {
    const markup = ctx.renderPanelTicker(company);
    assert.equal(href(markup), href(accountView.tickerLink(company)));
    assert.doesNotMatch(markup, /javascript:|<img/u);
    if(href(markup)) {
      assert.match(markup,/target="_blank" rel="noopener noreferrer"/u);
      assert.match(markup,/data-tradingview/u);
    }
  }
  assert.match(ctx.renderPanelTicker({ticker:'GO'}),/Börsenplatz nicht bestätigt/u);
});
test('research card tickers are links while title and chart keep report navigation and stable numbering', () => {
  const list = {innerHTML:''};
  const ctx = panel({videoList:list,currentVideoId:null,buildDonut:()=>({}),renderDonutSvg:()=>'<svg></svg>',
    safeUrl:value=>value,formatDate:()=> '18.09.2026',researchLibrary:{performanceValue:()=>null}});
  ctx.renderVideos([{id:'J3Y_JBATcWg',analysisSequence:12,title:'IPO Market Watch report',companies:listings}]);
  for(const company of listings) assert.ok(list.innerHTML.includes(`href="${company.tradingview_url}"`));
  assert.match(list.innerHTML,/Report 12/u);
  assert.equal((list.innerHTML.match(/data-video-report="J3Y_JBATcWg"/gu)||[]).length,2);
  assert.doesNotMatch(list.innerHTML,/data-company-key/u);
  assert.equal((list.innerHTML.match(/data-tradingview/gu)||[]).length,2);
});
test('ticker click leaves normal link navigation intact; report clicks still open the report and YouTube', () => {
  const calls=[];
  const ctx = panel({retryOutcome:()=>false,selectCompanyReport:()=>calls.push('company'),selectedCompanyKey:null,selectedVideoId:null,
    visibleCompanyReports:[],renderCompanyAllocation:()=>{},renderVideoInspector:id=>calls.push(id),
    openOrFocusVideo:async url=>calls.push(url)});
  let prevented=false;
  ctx.handleVideoReportSelection({target:{closest:selector=>selector==='[data-tradingview]' ? {} : null},preventDefault(){prevented=true;}});
  assert.equal(prevented,false);assert.deepEqual(calls,[]);
  const report={dataset:{videoReport:'J3Y_JBATcWg'},href:'https://www.youtube.com/watch?v=J3Y_JBATcWg'};
  ctx.handleVideoReportSelection({target:{closest:selector=>selector==='[data-video-report]'?report:null},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual(calls,['J3Y_JBATcWg',report.href]);
});
test('full report ticker uses the same destination policy without replacing evidence or report content', () => {
  const ctx = panel({renderCallTypeBadge:()=>'',renderSentimentBadge:()=>'',renderOutcomePlaceholder:()=>'',renderCompanyReportContent:()=>'<p>Saved source evidence</p>'});
  for (const company of [...listings,{ticker:'GO'}]) {
    const markup=ctx.renderCompanyReport(company,0,'J3Y_JBATcWg');
    assert.ok(markup.includes(ctx.panelTradingViewTarget(company).href));
    assert.match(markup,/Saved source evidence/u);
  }
  assert.doesNotMatch(ctx.renderCompanyReport({ticker:'INDO',identity_conflict:true},0,'J3Y_JBATcWg'),/href=/u);
});

test('Gold without ticker is clickable in panel library and full report after backend read projection',()=>{
  const {projectCompanyForRead}=require('../instruments/instrumentProjection');
  const gold=projectCompanyForRead({company:'Gold',asset_type:'COMMODITY',ticker:null});
  const list={innerHTML:''};
  const ctx=panel({videoList:list,currentVideoId:null,buildDonut:()=>({}),renderDonutSvg:()=>'',safeUrl:x=>x,formatDate:()=>'',researchLibrary:{performanceValue:()=>null},
    renderCallTypeBadge:()=>'',renderSentimentBadge:()=>'',renderOutcomePlaceholder:()=>'',renderCompanyReportContent:()=>'<p>Saved gold thesis</p>'});
  ctx.renderVideos([{id:'J3Y_JBATcWg',companies:[gold]}]);
  assert.match(list.innerHTML,/href="https:\/\/www\.tradingview\.com\/symbols\/OANDA-XAUUSD\/"/u);
  assert.match(ctx.renderCompanyReport(gold,0,'J3Y_JBATcWg'),/OANDA-XAUUSD/u);
  assert.match(ctx.renderPanelTicker(gold),/Referenzchart/u);
  assert.equal(ctx.panelTradingViewTarget({company:'Gold',ticker:'GOLD',asset_type:'commodity'}),null);
  assert.equal(ctx.panelTradingViewTarget({company:'Gold',ticker:'GOLD',assetType:'commodity'}),null);
});
