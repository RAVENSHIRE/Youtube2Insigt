const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {once} = require('node:events');
const {createHmac} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {AccountStore} = require('../accounts/store');
const {BillingService} = require('../accounts/billing');
const {recover,validateEnvironment,assertServerStopped} = require('../scripts/recover-stripe-paid-event.cjs');
const now = Date.parse('2026-09-23T14:00:00Z');
function fixture(t) {
  const root = path.join(__dirname,'.tmp'); fs.mkdirSync(root,{recursive:true});
  const dir = fs.mkdtempSync(path.join(root,'paid-recovery-'));
  const database = path.join(dir,'accounts.sqlite');
  const store = new AccountStore(database,{now:()=>now,proCredits:50});
  const user = store.createUser('alice@example.test','secret-hash');
  store.emailToken(user.id,'verify'); store.consumeEmailToken('verify','verify');
  store.customer(user.id,'cus_alice');
  const other = store.createUser('other@example.test','hash');
  const report = {analysis_version:8,video:{id:'RN_C7a66OSA'},companies:[{ticker:'RKLB',tradingview_url:'https://www.tradingview.com/symbols/NASDAQ-RKLB/'}]};
  store.complete(user.id,store.reserve(user.id,report.video.id,8).id,report);
  const start = now-60000,end = now+30*86400000;
  const invoice = {id:'in_paid',status:'paid',paid:true,livemode:false,customer:'cus_alice',
    parent:{subscription_details:{subscription:'sub_alice'}},
    lines:{data:[{pricing:{price_details:{price:'price_pro'}},period:{start:start/1000,end:end/1000}}]}};
  const event = {id:'evt_paid',livemode:false,type:'invoice.paid',data:{object:structuredClone(invoice)}};
  const sub = {id:'sub_alice',customer:'cus_alice',livemode:false,status:'active',latest_invoice:invoice,
    items:{data:[{quantity:1,price:{id:'price_pro',recurring:{interval:'month',interval_count:1}},current_period_start:start/1000,current_period_end:end/1000}]}};
  const calls = [];
  const client = {mode:'test',priceId:'price_pro',isConfigured:()=>true,
    request:async(method,url)=>{calls.push({method,url});return structuredClone(event);},
    getSubscription:async(id)=>{calls.push({method:'GET',url:`subscriptions/${id}`});return structuredClone(sub);}};
  const billing = new BillingService({store,client,webhookSecret:'whsec_fixture'});
  const input = {database,eventId:'evt_paid',client,proCredits:50,now:()=>now,stoppedCheck:async()=>{}};
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {store,user,other,report,client,billing,input,event,sub,invoice,calls,start,end};
}
test('recovery is read-only by default and a verified SQLite backup precedes the once-only paid grant',async t=>{
  const f=fixture(t);
  const preview=await recover(f.input);
  assert.equal(preview.status,'ready_to_recover');assert.equal(f.store.isPro(f.user.id),false);
  assert.equal(f.store.eventHandled('evt_paid'),false);
  const result=await recover({...f.input,apply:true});
  assert.equal(result.status,'recovered');assert.equal(result.localProEntitled,true);
  assert.equal(result.paymentsCreated,false);assert.equal(result.webhookDeliveryProven,false);
  const copy=new DatabaseSync(result.backup,{readOnly:true});try {
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(copy.prepare('SELECT count(*) n FROM subscriptions').get().n,0);
    assert.equal(copy.prepare("SELECT count(*) n FROM credit_grants WHERE kind='pro'").get().n,0);
  } finally {copy.close();}
  assert.equal(f.store.account(f.user.id).analyses_available,50);
  assert.equal(f.store.isPro(f.other.id),false);
  assert.deepEqual(f.store.ownReport(f.user.id,f.report.video.id).companies,f.report.companies);
  assert.equal((await recover({...f.input,apply:true})).status,'already_active');
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM credit_grants WHERE kind='pro'").get().n,1);
  assert.ok(f.calls.every(call=>call.method==='GET'));
  assert.doesNotMatch(JSON.stringify(result),/cus_alice|alice@example|secret-hash|sk_test|whsec/);
});
test('recovery and later signed webhook for the same paid period do not double grant or reset consumed credits',async t=>{
  const f=fixture(t);await f.billing.recoverPaidEvent('evt_paid');
  f.store.complete(f.user.id,f.store.reserve(f.user.id,'J3Y_JBATcWg',8).id,{analysis_version:8,video:{id:'J3Y_JBATcWg'},companies:[]});
  assert.equal(f.store.account(f.user.id).analyses_available,49);
  const raw=Buffer.from(JSON.stringify({...f.event,id:'evt_checkout_late'})),stamp=now/1000;
  const signature=`t=${stamp},v1=${createHmac('sha256','whsec_fixture').update(`${stamp}.`).update(raw).digest('hex')}`;
  await f.billing.webhook(raw,signature);
  assert.equal(f.store.account(f.user.id).analyses_available,49);
  assert.equal((await f.billing.recoverPaidEvent('evt_paid')).duplicate,true);
  await assert.rejects(f.billing.webhook(raw,'invalid'),{code:'WEBHOOK_EXPIRED'});
});
for (const [name,modify,code] of [
  ['live event',f=>{f.event.livemode=true;},'BILLING_RECOVERY_EVENT_INVALID'],
  ['wrong event',f=>{f.event.id='evt_substituted';},'BILLING_RECOVERY_EVENT_INVALID'],
  ['unpaid event',f=>{f.event.data.object.status='open';},'BILLING_RECOVERY_EVENT_INVALID'],
  ['unknown customer',f=>{f.event.data.object.customer='cus_foreign';},'BILLING_RECOVERY_CUSTOMER_UNKNOWN'],
  ['wrong canonical subscription',f=>{f.sub.id='sub_foreign';},'BILLING_IDENTITY_MISMATCH'],
  ['foreign invoice',f=>{f.invoice.customer='cus_foreign';},'BILLING_INVOICE_MISMATCH'],
  ['wrong price',f=>{f.client.priceId='price_other';},'BILLING_PRICE_MISMATCH'],
  ['unpaid current invoice',f=>{f.invoice.status='open';},'BILLING_RECOVERY_PAYMENT_NOT_CURRENT'],
  ['canceled subscription',f=>{f.sub.status='canceled';},'BILLING_RECOVERY_PAYMENT_NOT_CURRENT'],
  ['expired period',f=>{f.input.now=()=>now+40*86400000;f.store.now=f.input.now;},'BILLING_RECOVERY_PAYMENT_NOT_CURRENT']
]) test(`recovery refuses ${name} without recording the event or granting credits`,async t=>{
  const f=fixture(t);modify(f);
  await assert.rejects(f.billing.recoverPaidEvent('evt_paid'),{code});
  assert.equal(f.store.eventHandled('evt_paid'),false);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM subscriptions').get().n,0);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM credit_grants WHERE kind='pro'").get().n,0);
});
test('recovery aborts before writing when the backup or stopped-server check fails',async t=>{
  const f=fixture(t);
  await assert.rejects(recover({...f.input,apply:true,backupFn:async()=>{throw Error('disk full');}}),/disk full/);
  await assert.rejects(recover({...f.input,apply:true,stoppedCheck:async()=>{throw Error('still running');}}),/still running/);
  assert.equal(f.store.eventHandled('evt_paid'),false);assert.equal(f.store.isPro(f.user.id),false);
});
test('canonical payment is checked again after the backup and a cancellation cannot grant Pro',async t=>{
  const f=fixture(t);const {backupAccounts}=require('../scripts/backup-accounts');
  await assert.rejects(recover({...f.input,apply:true,backupFn:async(...args)=>{
    const result=await backupAccounts(...args);f.sub.status='canceled';return result;
  }}),{code:'BILLING_RECOVERY_PAYMENT_NOT_CURRENT'});
  assert.equal(f.store.eventHandled('evt_paid'),false);
});
test('a lost readback response reports a committed recovery truthfully; retry does not grant twice',async t=>{
  const f=fixture(t);const request=f.client.request;let reads=0;
  f.client.request=async(...args)=>{if(++reads===3)throw Error('provider unavailable');return request(...args);};
  await assert.rejects(recover({...f.input,apply:true}),error=>{
    assert.equal(error.recoveryContext.writesPerformed,true);
    assert.equal(error.recoveryContext.eventProcessedLocally,true);return true;
  });
  assert.equal((await recover({...f.input,apply:true})).status,'already_active');
  assert.equal(f.store.account(f.user.id).analyses_available,50);
});
test('recovery rejects production configuration and a listening local server',async t=>{
  for(const env of [{BILLING_MODE:'live'},{BILLING_MODE:'test',NODE_ENV:'production'},{BILLING_MODE:'test',PUBLIC_BASE_URL:'https://example.com'}])assert.throws(()=>validateEnvironment(env));
  assert.equal(validateEnvironment({BILLING_MODE:'test',PRO_MONTHLY_ANALYSES:'50'}),50);
  const server=net.createServer().listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  await assert.rejects(assertServerStopped(server.address().port),{recoveryCode:'STOP_NODE_SERVER_FIRST'});
});
