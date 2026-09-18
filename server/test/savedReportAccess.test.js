const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { once } = require('node:events');
const { AccountStore } = require('../accounts/store');
const { passwordHash } = require('../accounts/auth');
const { installAccounts } = require('../accounts/routes');
const { render, publicationDate, tickerLink } = require('../web/report-view');

const videoId='RN_C7a66OSA';
const report = () => ({analysis_version:8,video:{id:videoId,title:'Fixture report',creator:'Fixture creator'},report_language:'en',summary:'Fixture summary',companies:[{
  company:'Rocket Lab',ticker:'RKLB',tradingview_url:'https://www.tradingview.com/symbols/NASDAQ-RKLB/',sentiment:'bull',
  thesis:'Fixture thesis',action:'buy',call_type:'actionable',sector:'Industrials',risks:['Fixture risk'],
  price_targets:[{value:20,currency:'USD',context:'Fixture target'}],levels:[{type:'entry',value:10,currency:'USD'}],
  evidence:[{original_text:'Original fixture quotation.',start_seconds:65,end_seconds:70,validation:'source_match'}]
}]});

test('full saved report renders thesis, targets, levels, risks, original evidence and verified links',()=>{
  const html=render(report());
  for(const value of ['Fixture thesis','Fixture risk','Fixture target','10 USD','Original fixture quotation.','01:05','NASDAQ-RKLB/','RN_C7a66OSA&amp;t=65s']) assert.ok(html.includes(value),value);
  assert.match(html,/sentiment-bull/u);
  const asts=report();asts.companies[0].ticker='ASTS';asts.companies[0].tradingview_url='https://www.tradingview.com/symbols/NASDAQ-ASTS/';
  assert.match(render(asts),/https:\/\/www\.tradingview\.com\/symbols\/NASDAQ-ASTS\//u);
});
test('saved report escapes extracted content, rejects unsafe links and never invents legacy timestamps',()=>{
  const data=report();data.companies[0].thesis='<img src=x onerror=alert(1)>';
  data.companies[0].tradingview_url='javascript:alert(1)';data.companies[0].evidence=[{original_text:'Legacy quote',start_seconds:65}];
  const html=render(data);
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('&amp;t=65s'));assert.ok(html.includes('Zeitmarke nicht verifiziert'));
  assert.throws(()=>render({...data,video:{id:'bad'}}));
});

test('account report button reads the existing report, toggles it and never requests another analysis',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8');
  const nodes=new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/gu)].map(([,id])=>[id,{
    value:'',innerHTML:'',textContent:'',hidden:false,events:{},classList:{toggle(){}},
    addEventListener(name,callback){this.events[name]=callback;}
  }]));
  const requests=[];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../web/account.js'),'utf8'),{
    document:{getElementById:id=>nodes.get(id)},URL,URLSearchParams,setTimeout,SavedReportView:{render,publicationDate,tickerLink}, ResearchDashboard:require('../web/research-dashboard'), ResearchLibrary:require('../../extension/research-library'),
    location:{hash:'',pathname:'/account/'},history:{replaceState(){}},
    fetch:async(url,options)=>{requests.push({url,method:options.method});
      if(url==='/me')return Response.json({email:'fixture@example.test',plan:'free',analyses_available:0,pro_monthly_analyses:20});
      if(url==='/creators')return Response.json({creators:[{creatorId:'fixture',name:'Fixture'}]});
      if(url==='/creators/fixture/dashboard')return Response.json({videos:[{id:videoId,title:'Fixture',summary:'Fixture',analysisSequence:1}]});
      if(url===`/videos/${videoId}`)return Response.json(report());
      throw Error('Unexpected endpoint');
    }
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(nodes.get('personalLibrary').innerHTML,/Vollständigen Report öffnen/u);
  const panel={hidden:true,dataset:{},innerHTML:''};
  const button={disabled:false,isConnected:true,dataset:{reportVideo:videoId},textContent:'',attributes:{},
    closest:()=>({querySelector:()=>panel}),setAttribute(name,value){this.attributes[name]=value;}};
  const event={preventDefault(){},target:{closest:()=>button}};
  await nodes.get('personalLibrary').events.click(event);
  assert.equal(panel.hidden,false);assert.match(panel.innerHTML,/Fixture thesis/u);assert.equal(button.attributes['aria-expanded'],'true');
  await nodes.get('personalLibrary').events.click(event);assert.equal(panel.hidden,true);
  await nodes.get('personalLibrary').events.click(event);assert.equal(panel.hidden,false);
  assert.equal(requests.filter(x=>x.url===`/videos/${videoId}`).length,1);
  assert.equal(requests.some(x=>x.method!=='GET'),false);
});

test('only the configured extension can sign in and read its saved personal report without consuming credit',async t=>{
  const store=new AccountStore(':memory:'), app=express();
  const password='Synthetic password 123!';
  const alice=store.createUser('alice@example.test',await passwordHash(password));
  const bob=store.createUser('bob@example.test',await passwordHash(password));
  for(const user of [alice,bob]) {store.emailToken(user.id,user.id);store.consumeEmailToken(user.id,'verify');}
  const job=store.reserve(alice.id,videoId,8);store.complete(alice.id,job.id,report());
  const origin=`chrome-extension://${'a'.repeat(32)}`;
  const runtime=installAccounts(app,{store,analyze:async()=>{throw Error('Must not analyze');},profileToChannel:p=>p,
    buildDashboard:async records=>({videos:Object.values(records).map(r=>({id:r.video.id,title:r.video.title}))})},
    {PUBLIC_BASE_URL:'http://localhost:3000',EXTENSION_ORIGINS:origin});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{runtime.jobs.stop();await new Promise(resolve=>server.close(resolve));store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=async(user,from=origin)=>fetch(base+'/auth/login',{method:'POST',headers:{origin:from,'content-type':'application/json'},body:JSON.stringify({email:user.email,password})});
  const denied=await login(alice,`chrome-extension://${'b'.repeat(32)}`);
  assert.equal(denied.status,403);assert.equal((await denied.json()).code,'ORIGIN_DENIED');
  const preflight=await fetch(base+'/auth/login',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  const allowed=await login(alice);assert.equal(allowed.status,200);assert.equal(allowed.headers.get('access-control-allow-origin'),origin);
  const session=await allowed.json();
  const headers={origin,authorization:`Bearer ${session.token}`};
  assert.equal((await (await fetch(base+'/dashboard',{headers})).json()).videos.length,1);
  for(let i=0;i<2;i++) {
    const read=await fetch(base+`/videos/${videoId}`,{headers});assert.equal(read.status,200);
    assert.equal((await read.json()).companies[0].evidence[0].original_text,'Original fixture quotation.');
  }
  assert.equal((await (await fetch(base+'/me',{headers})).json()).analyses_available,0);
  const bobSession=await (await login(bob)).json();
  assert.equal((await fetch(base+`/videos/${videoId}`,{headers:{origin,authorization:`Bearer ${bobSession.token}`}})).status,404);
  assert.equal((await fetch(base+`/videos/${videoId}`,{headers:{origin}})).status,401);
});

test('extension origin failure names its exact ID and successful login leaves example scope',async()=>{
  const code=fs.readFileSync(path.join(__dirname,'../../extension/api.js'),'utf8');
  const id='a'.repeat(32);
  const context=vm.createContext({URL,DOMException,AppConfig:{apiBase:'http://localhost:3000'},chrome:{runtime:{id},storage:{session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}}},
    fetch:async()=>Response.json({code:'ORIGIN_DENIED',error:'Origin nicht freigegeben.'},{status:403})});
  vm.runInContext(code,context);
  await assert.rejects(context.AppApi.ready,error=>{assert.equal(error.code,'ORIGIN_DENIED');assert.ok(error.message.includes(`chrome-extension://${id}`));return true;});
  const calls=[];
  const good=vm.createContext({URL,DOMException,AppConfig:{apiBase:'http://localhost:3000'},chrome:context.chrome,
    fetch:async(url,options)=>{calls.push({url:String(url),options});return String(url).endsWith('/config')?Response.json({accountRequired:true}):Response.json({token:'synthetic-session',account:{plan:'free'}});}});
  vm.runInContext(code,good);await good.AppApi.ready;good.AppApi.scope='examples';await good.AppApi.login('fixture@example.test','fixture');
  assert.equal(good.AppApi.scope,'personal');
  await good.AppApi.fetch('http://localhost:3000/videos/'+videoId);
  assert.ok(!calls.at(-1).url.includes('/examples/'));assert.equal(calls.at(-1).options.credentials,'omit');
});
