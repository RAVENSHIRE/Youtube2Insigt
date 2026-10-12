const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { create, destination } = require('../web/billing-ui');
const html = fs.readFileSync(path.join(__dirname,'../web/index.html'),'utf8');
const free={plan:'free',analyses_available:1};
function fixture(options={}) {
  const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/gu)].map(([,id])=>[id,{hidden:false,disabled:false,textContent:'',checked:false,events:{},addEventListener(type,fn){this.events[type]=fn;}}]));
  const calls=[],redirects=[],messages=[],replacements=[]; let activated=0;
  const request=async(url,body)=>{
    calls.push({url,body});
    if(options.request)return options.request(url,body);
    if(url==='/config')return {billingAvailable:options.enabled!==false,billingMode:'test',proMonthlyAnalyses:20};
    if(url==='/billing/plan')return {mode:'test',interval:'month',amount:1900,currency:'USD',monthlyAnalyses:20};
    if(url==='/billing/checkout')return {mode:'test',url:options.checkoutUrl || 'https://checkout.stripe.com/c/pay/test'};
    if(url==='/billing/portal')return {mode:'test',url:'https://billing.stripe.com/p/session/test'};
    if(url.startsWith('/billing/checkout-status'))return options.status || {status:'pending',account:free};
    throw Error(`Unexpected endpoint ${url}`);
  };
  const ui=create({request,byId:id=>nodes.get(id),message:text=>messages.push(text),onActivated:async()=>{activated++;},
    location:{search:options.search||'',hash:options.hash||'',pathname:'/account/',assign:url=>redirects.push(url)},
    history:{replaceState:(_a,_b,url)=>replacements.push(url)},delay:async()=>{},maxPolls:2});
  return {ui,nodes,calls,redirects,messages,replacements,activated:()=>activated,event:async(id,type='click')=>nodes.get(id).events[type]()};
}
test('compact profile replaces the old account section while retaining account and research controls',()=>{
  assert.match(html,/<details id="profileMenu"/);
  assert.doesNotMatch(html,/Konto &amp; Pro|Konto & Pro/);
  for(const id of ['checkout','portal','checkoutConsent','billingStatus','creatorOverviewSection','authForm','registerForm'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(html.indexOf('src="billing-ui.js"')<html.indexOf('src="account.js"'));
});
test('unconfigured billing stays unavailable and never starts checkout',async()=>{
  const f=fixture({enabled:false});await f.ui.render(free);await f.event('checkout');
  assert.equal(f.nodes.get('checkout').disabled,true);assert.equal(f.redirects.length,0);
  assert.match(f.nodes.get('proDescription').textContent,/noch nicht eingerichtet/);
});
test('monthly amount and quota precede explicit consent and test checkout redirect',async()=>{
  const f=fixture();await f.ui.render(free);await f.event('checkout');
  assert.equal(f.calls.some(c=>c.url==='/billing/checkout'),false);
  assert.match(f.nodes.get('proDescription').textContent,/19[.,]00.*Monat/);
  assert.match(f.nodes.get('proDescription').textContent,/20 neue Analysen/);
  f.nodes.get('checkoutConsent').checked=true;await f.event('checkoutConsent','change');await f.event('checkout');
  assert.deepEqual(f.calls.find(c=>c.url==='/billing/checkout').body,{confirmSubscription:true});
  assert.equal(f.redirects[0],'https://checkout.stripe.com/c/pay/test');
});
test('checkout never navigates to an untrusted provider destination',async()=>{
  const f=fixture({checkoutUrl:'https://checkout.stripe.com.evil.test/pay'});await f.ui.render(free);
  f.nodes.get('checkoutConsent').checked=true;await f.event('checkoutConsent','change');await f.event('checkout');
  assert.equal(f.redirects.length,0);assert.match(f.nodes.get('billingStatus').textContent,/Unerwartete/);
  for(const url of ['http://checkout.stripe.com','https://user:pass@checkout.stripe.com','https://checkout.stripe.com:444'])assert.throws(()=>destination(url,'checkout.stripe.com'));
});
test('return query alone grants nothing and pending webhooks display a bounded retry',async()=>{
  const f=fixture({search:'?checkout=success&session_id=cs_test_1'});await f.ui.render(free);await f.ui.handleReturn();
  assert.equal(f.activated(),0);assert.equal(f.calls.filter(c=>c.url.startsWith('/billing/checkout-status')).length,2);
  assert.equal(f.nodes.get('billingRetry').hidden,false);assert.match(f.nodes.get('billingStatus').textContent,/nicht erneut bezahlen/);
});
test('verified owned checkout result refreshes access and clears the return URL',async()=>{
  const f=fixture({search:'?checkout=success&session_id=cs_test_1',status:{status:'active',account:{plan:'pro'}}});
  await f.ui.render(free);await f.ui.handleReturn();
  assert.equal(f.activated(),1);assert.deepEqual(f.replacements,['/account/']);
  assert.match(f.nodes.get('billingStatus').textContent,/Testmodus ist aktiv/);
});
test('checkout cancellation grants nothing; signed-out return asks for login',async()=>{
  const canceled=fixture({search:'?checkout=cancel'});await canceled.ui.render(free);await canceled.ui.handleReturn();
  assert.equal(canceled.activated(),0);assert.match(canceled.nodes.get('billingStatus').textContent,/abgebrochen/);
  const signedOut=fixture({search:'?checkout=success&session_id=cs_test_1'});await signedOut.ui.render(null);await signedOut.ui.handleReturn();
  assert.equal(signedOut.calls.length,0);assert.match(signedOut.messages[0],/Bitte anmelden/);
});
test('past-due subscribers use the portal instead of creating a second subscription',async()=>{
  const f=fixture();await f.ui.render({...free,subscription:{status:'past_due'}});
  assert.equal(f.nodes.get('checkout').hidden,true);assert.equal(f.nodes.get('portal').hidden,false);
  await f.event('portal');assert.equal(f.redirects[0],'https://billing.stripe.com/p/session/test');
});
test('logout suppresses a late checkout response and prevents cross-account redirect',async()=>{
  let resolveCheckout;
  const f=fixture({request:async url=>{
    if(url==='/config')return {billingAvailable:true,billingMode:'test'};
    if(url==='/billing/plan')return {mode:'test',interval:'month',currency:'USD',amount:1900,monthlyAnalyses:20};
    return new Promise(resolve=>{resolveCheckout=resolve;});
  }});
  await f.ui.render(free);f.nodes.get('checkoutConsent').checked=true;await f.event('checkoutConsent','change');
  const pending=f.event('checkout');await f.ui.render(null);
  resolveCheckout({mode:'test',url:'https://checkout.stripe.com/c/pay/test'});await pending;
  assert.equal(f.redirects.length,0);
});
