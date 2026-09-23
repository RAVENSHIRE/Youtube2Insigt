const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { AccountStore } = require('../accounts/store');
const { diagnose } = require('../scripts/diagnose-stripe-checkout.cjs');
const now = Date.parse('2026-09-23T12:50:00Z');
function fixture(t) {
  const root = path.join(__dirname,'.tmp'); fs.mkdirSync(root,{recursive:true});
  const dir = fs.mkdtempSync(path.join(root,'stripe-diagnosis-'));
  const filename = path.join(dir,'accounts.sqlite');
  const store = new AccountStore(filename,{now:()=>now});
  const user = store.createUser('private@example.test','private-password-hash');store.customer(user.id,'cus_private');
  const start = now-10000,end=now+86400000;
  const invoice = {status:'paid',livemode:false,customer:'cus_private',parent:{subscription_details:{subscription:'sub_private'}},
    lines:{data:[{pricing:{price_details:{price:'price_pro'}},period:{start:start/1000,end:end/1000}}]}};
  const event = {id:'evt_paid',type:'invoice.paid',livemode:false,data:{object:invoice}};
  const sub = {id:'sub_private',customer:'cus_private',status:'active',livemode:false,latest_invoice:invoice,
    items:{data:[{price:{id:'price_pro',recurring:{interval:'month',interval_count:1}},quantity:1,current_period_start:start/1000,current_period_end:end/1000}]}};
  const calls=[];
  const client={priceId:'price_pro',request:async(method,url)=>{calls.push({method,url});return event;},getSubscription:async()=>sub};
  const db = new DatabaseSync(filename,{readOnly:true});
  t.after(()=>{db.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {db,store,user,client,event,sub,invoice,start,end,calls};
}
test('read-only diagnosis identifies an existing paid event missing locally without granting credits',async t=>{
  const f=fixture(t);const before=f.store.db.prepare('SELECT total_changes() AS n').get().n;
  const result=await diagnose({...f,eventId:'evt_paid',now});
  assert.equal(result.diagnosis,'PAID_EVENT_NOT_RECORDED_LOCALLY');assert.equal(result.writesPerformed,false);
  assert.equal(result.invoiceLineMatchesPeriod,true);assert.equal(result.localProEntitled,false);
  assert.deepEqual(f.calls,[{method:'GET',url:'events/evt_paid'}]);
  assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get().n,before);
  assert.doesNotMatch(JSON.stringify(result),/private@example|private-password|cus_private|sub_private/);
});
test('diagnosis differentiates an unknown local customer and does not trust event metadata',async t=>{
  const f=fixture(t);f.event.data.object.customer='cus_unknown';
  const result=await diagnose({...f,eventId:'evt_paid',now});
  assert.equal(result.localCustomerFound,false);assert.equal(result.diagnosis,'NO_MATCHING_LOCAL_CUSTOMER');
});
test('diagnosis reveals configured price mismatch and unpaid canonical invoice',async t=>{
  const f=fixture(t);f.client.priceId='price_other';f.invoice.status='open';
  const result=await diagnose({...f,eventId:'evt_paid',now});
  assert.equal(result.configuredMonthlyPriceMatches,false);assert.equal(result.latestInvoicePaid,false);
  assert.equal(result.diagnosis,'CANONICAL_PAYMENT_CHECK_FAILED');
});
test('diagnosis recognizes recorded paid access without exposing account identity',async t=>{
  const f=fixture(t);f.store.applyBilling('evt_paid',f.user.id,{id:'sub_private',status:'active',periodEnd:f.end,cancelAtPeriodEnd:false},
    {id:`pro:sub_private:${f.start}`,start:f.start,end:f.end});
  const result=await diagnose({...f,eventId:'evt_paid',now});
  assert.equal(result.eventProcessedLocally,true);assert.equal(result.localProEntitled,true);
  assert.equal(result.diagnosis,'LOCAL_PRO_ACTIVE_CHECK_BROWSER_ACCOUNT_AND_SERVER');
});
test('diagnosis rejects a live, substituted or unrelated event before local reconciliation',async t=>{
  const f=fixture(t);
  for(const changes of [{livemode:true},{type:'invoice.created'},{id:'evt_other'}]){
    const saved={...f.event};Object.assign(f.event,changes);
    await assert.rejects(diagnose({...f,eventId:'evt_paid',now}),{diagnosticCode:'EXPECTED_TEST_INVOICE_PAID_EVENT'});
    Object.assign(f.event,saved);
  }
});
