const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const { AccountStore } = require('../accounts/store');
const { StripeClient, BillingService } = require('../accounts/billing');
const { installAccounts } = require('../accounts/routes');

function fixture(t) {
  let now = Date.parse('2026-09-18T12:00:00Z');
  const store = new AccountStore(':memory:', { now: () => now, proCredits: 3 });
  t.after(() => store.close());
  const user = store.createUser('alice@example.test', 'unused');
  store.emailToken(user.id, 'verify'); store.consumeEmailToken('verify', 'verify');
  const requests = [], sessions = new Map();
  const state = { price: { id: 'price_pro', livemode: false, active: true, type: 'recurring', unit_amount: 1900,
    currency: 'usd', billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } },
    subs: [], fail: false, portal: 'https://billing.stripe.com/p/session/test', nextUrl: null };
  const client = new StripeClient({ secret: 'sk_test_fixture', priceId: 'price_pro', publicUrl: 'http://localhost:3000', mode: 'test',
    fetchImpl: async (url, options) => {
      const endpoint = new URL(url).pathname.replace('/v1/', '');
      const form = Object.fromEntries(options.body || []);
      requests.push({ endpoint, method: options.method, form, key: options.headers['Idempotency-Key'] });
      if (state.fail) return Response.json({ error: 'synthetic failure' }, { status: 503 });
      if (endpoint === 'prices/price_pro') return Response.json(state.price);
      if (endpoint === 'customers') return Response.json({ id: 'cus_alice' });
      if (endpoint === 'subscriptions') return Response.json({ data: state.subs, has_more: false });
      if (endpoint.startsWith('subscriptions/')) return Response.json(state.subscription);
      if (endpoint === 'checkout/sessions') {
        const id = `cs_test_${sessions.size + 1}`;
        const session = { id, status: 'open', livemode: false, customer: form.customer, client_reference_id: form.client_reference_id,
          mode: form.mode, expires_at: Number(form.expires_at), url: state.nextUrl || `https://checkout.stripe.com/c/pay/${id}`,
          line_items: { data: [{ price: { id: form['line_items[0][price]'] }, quantity: 1 }], has_more: false } };
        sessions.set(id, session); return Response.json(session);
      }
      if (endpoint.startsWith('checkout/sessions/')) return Response.json(sessions.get(endpoint.split('/').at(-1)));
      if (endpoint === 'billing_portal/sessions') return Response.json({ url: state.portal });
      throw Error(`Unexpected fixture request ${endpoint}`);
    } });
  const secret = 'whsec_fixture';
  const billing = new BillingService({ store, client, webhookSecret: secret });
  const signed = (event) => {
    const raw = Buffer.from(JSON.stringify(event)), stamp = Math.floor(now / 1000);
    return [raw, `t=${stamp},v1=${createHmac('sha256', secret).update(`${stamp}.`).update(raw).digest('hex')}`];
  };
  const canonical = (paid = true) => {
    const start = now / 1000 - 60, end = start + 30 * 86400;
    return { id: 'sub_alice', customer: 'cus_alice', livemode: false, status: 'active',
      items: { data: [{ quantity: 1, price: state.price, current_period_start: start, current_period_end: end }] },
      latest_invoice: { id: 'in_paid', status: paid ? 'paid' : 'open', paid, customer: 'cus_alice', livemode: false,
        parent: { subscription_details: { subscription: 'sub_alice' } },
        lines: { data: [{ pricing: { price_details: { price: 'price_pro' } }, period: { start, end } }] } } };
  };
  const event = (id = 'evt_paid') => ({ id, type: 'invoice.paid', livemode: false,
    data: { object: { customer: 'cus_alice', parent: { subscription_details: { subscription: 'sub_alice' } } } } });
  return { store, user, state, client, billing, requests, sessions, signed, canonical, event, advance: ms => { now += ms; } };
}

test('checkout is disabled by default and rejects live credentials or unsupported price models', async t => {
  for (const mode of ['disabled', 'live', undefined]) assert.equal(new StripeClient({ mode, secret:'sk_test_x', priceId:'price_x', publicUrl:'http://localhost:3000' }).isConfigured(), false);
  assert.equal(new StripeClient({ mode:'test', secret:'sk_live_x', priceId:'price_x', publicUrl:'http://localhost:3000' }).isConfigured(), false);
  const f = fixture(t);
  for (const change of [{livemode:true}, {active:false}, {unit_amount:null}, {billing_scheme:'tiered'}, {recurring:{interval:'year',interval_count:1,usage_type:'licensed'}}]) {
    const saved = f.state.price; f.state.price = {...saved,...change}; f.client.priceCache = null;
    await assert.rejects(f.billing.checkout(f.user.id), {code:'BILLING_PRICE_INVALID'}); f.state.price = saved;
  }
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
});

test('concurrent checkout clicks and retries reuse the same owned session without granting credits', async t => {
  const f = fixture(t);
  const results = await Promise.all([f.billing.checkout(f.user.id), f.billing.checkout(f.user.id)]);
  assert.equal(results[0].url, results[1].url);
  assert.equal(f.requests.filter(r => r.endpoint === 'customers').length, 1);
  assert.equal(f.requests.filter(r => r.endpoint === 'checkout/sessions').length, 1);
  const session = f.sessions.get('cs_test_1');
  assert.match(f.requests.find(r => r.endpoint === 'checkout/sessions').form.success_url, /\{CHECKOUT_SESSION_ID\}/);
  assert.equal(f.billing.checkoutStatus(f.user.id, session.id).status, 'pending');
  assert.equal(f.store.account(f.user.id).analyses_available, 1);
  const other = f.store.createUser('bob@example.test', 'unused');
  assert.throws(() => f.billing.checkoutStatus(other.id, session.id), {code:'CHECKOUT_NOT_FOUND'});
  session.status = 'complete';
  await assert.rejects(f.billing.checkout(f.user.id), {code:'CHECKOUT_PENDING'});
});

test('an expired session gets a new idempotency key and paid canceled accounts can resubscribe', async t => {
  const f = fixture(t); await f.billing.checkout(f.user.id);
  f.sessions.get('cs_test_1').status = 'expired'; await f.billing.checkout(f.user.id);
  const posts = f.requests.filter(r => r.endpoint === 'checkout/sessions');
  assert.notEqual(posts[0].key, posts[1].key);
  f.sessions.get('cs_test_2').status = 'complete';
  f.store.applyBilling('evt_cancel',f.user.id,{id:'sub_alice',status:'canceled',cancelAtPeriodEnd:false,periodEnd:Date.now()+86400000},null);
  await f.billing.checkout(f.user.id);
  assert.equal(f.sessions.size,3);
});

test('provider errors, invalid redirects, and mismatched sessions cannot enable Pro', async t => {
  const f = fixture(t); f.state.fail = true;
  await assert.rejects(f.billing.checkout(f.user.id), {code:'BILLING_PROVIDER_UNAVAILABLE'});
  f.state.fail = false; f.state.nextUrl = 'https://checkout.stripe.com.evil.test/pay';
  await assert.rejects(f.billing.checkout(f.user.id), {code:'BILLING_URL_INVALID'});
  f.state.nextUrl = null; await f.billing.checkout(f.user.id);
  f.sessions.get('cs_test_2').customer = 'cus_someone_else';
  await assert.rejects(f.billing.checkout(f.user.id), {code:'BILLING_SESSION_MISMATCH'});
  f.state.portal = 'http://billing.stripe.com/session';
  await assert.rejects(f.billing.portal(f.user.id), {code:'BILLING_URL_INVALID'});
  assert.equal(f.store.isPro(f.user.id), false);
});

test('active without a verified paid period, foreign invoices, and live events grant no Pro', async t => {
  const f = fixture(t); await f.billing.checkout(f.user.id);
  f.state.subscription = f.canonical(false);
  await f.billing.webhook(...f.signed(f.event('evt_unpaid')));
  assert.equal(f.store.isPro(f.user.id), false);
  assert.equal(f.store.account(f.user.id).analyses_available,1);
  f.state.subscription = f.canonical(true); f.state.subscription.latest_invoice.customer = 'cus_other';
  await assert.rejects(f.billing.webhook(...f.signed(f.event('evt_foreign'))), {code:'BILLING_INVOICE_MISMATCH'});
  await assert.rejects(f.billing.webhook(...f.signed({...f.event('evt_live'),livemode:true})), {code:'BILLING_MODE_MISMATCH'});
  assert.equal(f.store.isPro(f.user.id),false);
});

test('signed paid events unlock Pro once; failed analyses recover credits and expiry preserves saved reports', async t => {
  const f = fixture(t); await f.billing.checkout(f.user.id); f.state.subscription = f.canonical();
  await Promise.all([f.billing.webhook(...f.signed(f.event())), f.billing.webhook(...f.signed(f.event()))]);
  assert.equal(f.billing.checkoutStatus(f.user.id,'cs_test_1').status,'active');
  assert.equal(f.store.account(f.user.id).analyses_available,4);
  const record = { analysis_version:8, video:{id:'TestVideo01',title:'Synthetic'},companies:[] };
  f.store.complete(f.user.id, f.store.reserve(f.user.id,'TestVideo01',8).id,record);
  const second = f.store.reserve(f.user.id,'TestVideo02',8);
  f.store.fail(f.user.id,second.id,'TRANSCRIPT_UNAVAILABLE');
  assert.equal(f.store.account(f.user.id).analyses_available,3);
  f.advance(31*86400000);
  assert.equal(f.store.isPro(f.user.id),false);
  assert.ok(f.store.ownReport(f.user.id,'TestVideo01'));
});

test('HTTP checkout requires authentication and consent; signed webhook alone activates owned return status', async t => {
  const f = fixture(t), app = express();
  const runtime = installAccounts(app, {store:f.store,stripeClient:f.client}, {PUBLIC_BASE_URL:'http://localhost:3000',STRIPE_WEBHOOK_SECRET:'whsec_fixture'});
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{runtime.jobs.stop();await new Promise(r=>server.close(r));});
  const base = `http://127.0.0.1:${server.address().port}`;
  f.store.addSession(f.user.id,'synthetic-session');
  const request = async (url, body, authenticated=true) => {
    const response = await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer synthetic-session'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
  assert.equal((await request('/billing/plan',undefined,false)).status,401);
  assert.equal((await request('/billing/checkout',{})).data.code,'SUBSCRIPTION_CONFIRMATION_REQUIRED');
  const plan = (await request('/billing/plan')).data;
  assert.equal(plan.amount,1900); assert.equal(plan.marketDataIncluded,false);
  assert.equal((await request('/billing/checkout',{confirmSubscription:true})).status,200);
  assert.equal((await request('/billing/checkout-status?session_id=cs_test_1')).data.status,'pending');
  assert.equal((await request('/billing/webhook',f.event(),false)).status,400);
  f.state.subscription=f.canonical(); const [raw,signature]=f.signed(f.event());
  const result=await fetch(base+'/billing/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':signature},body:raw});
  assert.equal(result.status,200);
  assert.equal((await request('/billing/checkout-status?session_id=cs_test_1')).data.account.plan,'pro');
  assert.equal((await request('/config')).data.marketDataAvailable,false);
});
