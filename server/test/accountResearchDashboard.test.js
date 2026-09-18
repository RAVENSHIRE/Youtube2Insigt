const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dashboard=require('../web/research-dashboard');
const view=require('../web/report-view');
const {reportCsv,cell}=require('../exports/reportCsv');
const videos=[{id:'RN_C7a66OSA',title:'First report',analysisSequence:9,publishedAt:'2026-09-16T10:00:00Z',companies:[
 {company:'Rocket Lab',ticker:'RKLB',sector:'Industrials',sub_sector:'Aerospace',tradingview_url:'https://www.tradingview.com/symbols/NASDAQ-RKLB/'},
 {company:'AST Spacemobile',ticker:'ASTS',sector:'Technology',sub_sector:'Satellite'}]},
 {id:'J3Y_JBATcWg',analysisSequence:2,title:'Older report',companies:[{company:'Rocket Lab',ticker:'RKLB',sector:'Industrials',sub_sector:'Aerospace'}]}];
test('account dashboard matches creator counters, sector drilldown and stable video report numbers',()=>{
 const c={creatorId:'one',name:'IPO Market Watch',subscriberCount:'90100',totalVideos:762,analyzedVideos:2};
 assert.match(dashboard.creators([c],'one'),/aria-pressed="true"/u);
 assert.match(dashboard.channel(c,videos),/2\/762/u);
 assert.match(dashboard.channel(c,videos),/value="2"/u);
 const sectors=dashboard.groups(videos,[]);assert.equal(sectors[0].label,'Industrials');assert.equal(sectors[0].count,2);
 assert.equal(dashboard.groups(videos,['Industrials'])[0].label,'Aerospace');
 assert.deepEqual([...dashboard.groups(videos,['Industrials','Aerospace'])[0].videoIds],['RN_C7a66OSA','J3Y_JBATcWg']);
 assert.match(dashboard.mix(videos,[]),/data-mix-index="0"/u);
 const html=dashboard.videos([...videos].reverse(),view);
 assert.ok(html.indexOf('Report 02')<html.indexOf('Report 09'));
 assert.match(html,/NASDAQ-RKLB/u);assert.match(html,/\/videos\/RN_C7a66OSA\/report.csv/u);
 assert.match(html,/data-report-video="RN_C7a66OSA"/u);
});
test('unresolved TradingView links remain explicitly unverified and unsafe values cannot inject markup',()=>{
 assert.match(view.tickerLink({ticker:'GO'}),/chart\/\?symbol=GO/u);
 assert.match(view.tickerLink({ticker:'GO'}),/Börsenplatz nicht bestätigt/u);
 assert.ok(!view.tickerLink({ticker:'INDO',identity_conflict:true}).includes('href'));
 assert.ok(!view.tickerLink({ticker:'<img src=x>'}).includes('<img'));
 assert.ok(!dashboard.creators([{name:'<script>bad</script>',avatarUrl:'javascript:bad'}]).includes('<script>'));
});
test('CSV report preserves full research and evidence while preventing spreadsheet formula injection',()=>{
 const report={video:{id:'RN_C7a66OSA',title:'=CMD()',published_at:'2026-09-16T10:00:00Z'},companies:[{company:'A,"B"',ticker:'RKLB',thesis:'First\nSecond',risks:['Risk'],price_targets:[{value:20}],evidence:[{original_text:'Original quotation',start_seconds:65,validation:'source_match'}]}]};
 const before=JSON.stringify(report), csv=reportCsv(report);
 assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/"'=CMD\(\)"/u);
 assert.ok(csv.includes('A,""B""'));assert.ok(csv.includes('Original quotation'));assert.ok(csv.includes('start_seconds'));
 assert.equal(JSON.stringify(report),before);
 for(const text of ['=x','+x','-x','@x',' \t=x','\nhello']) assert.ok(cell(text).startsWith('"\''));
});
test('creator switching ignores a late dashboard response and never mixes personal channels',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8');
 const nodes=new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/gu)].map(([,id])=>[id,{value:'',innerHTML:'',textContent:'',hidden:false,events:{},classList:{toggle(){}},addEventListener(name,fn){this.events[name]=fn;}}]));
 let releaseA;const pendingA=new Promise(resolve=>{releaseA=resolve;});
 const requests=[];
 const context=vm.createContext({document:{getElementById:id=>nodes.get(id)},URL,URLSearchParams,setTimeout,
 SavedReportView:view,ResearchDashboard:dashboard,ResearchLibrary:require('../../extension/research-library'),location:{hash:'',pathname:'/account/'},history:{replaceState(){}},
 fetch:async(url,options)=>{requests.push(url);
   if(url==='/me')return Response.json({plan:'free',analyses_available:0});
   if(url==='/creators')return Response.json({creators:[{creatorId:'a',name:'Creator A'},{creatorId:'b',name:'Creator B'}]});
   if(url==='/creators/a/dashboard'){await pendingA;return Response.json({videos:[videos[0]]});}
   if(url==='/creators/b/dashboard')return Response.json({videos:[videos[1]]});
   if(url==='/auth/logout')return Response.json({});
   throw Error(url);
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/account.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 const first=vm.runInContext("selectCreator('a')",context);
 await vm.runInContext("selectCreator('b')",context);
 releaseA();await first;
 assert.match(nodes.get('channelOverview').innerHTML,/Creator B/u);
 assert.ok(!nodes.get('personalLibrary').innerHTML.includes('First report'));
 assert.ok(nodes.get('personalLibrary').innerHTML.includes('Older report'));
 nodes.get('librarySearch').value='nothing matches';nodes.get('librarySearch').events.input();
 assert.match(nodes.get('personalLibrary').innerHTML,/Keine passenden/u);
 assert.equal(requests.filter(p=>p==='/analyze').length,0);
 vm.runInContext('clearResearch()',context);
 assert.equal(nodes.get('creatorResearch').hidden,true);assert.equal(nodes.get('personalLibrary').innerHTML,'');
});
