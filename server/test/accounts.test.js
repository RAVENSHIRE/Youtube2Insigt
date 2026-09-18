const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountStore, hash } = require('../accounts/store');
const { passwordHash, passwordMatches } = require('../accounts/auth');
const { AnalysisJobs } = require('../accounts/analysisJobs');
const { BillingService, verifyWebhook } = require('../accounts/billing');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const time = Date.parse('2026-09-07T12:00:00Z');
function fixture(t, options = {}) {
  const store = new AccountStore(':memory:', { now: () => time, proCredits: 20, ...options });
  t.after(() => store.close());
  const user = store.createUser('alice@example.test', 'password-not-used-here');
  store.emailToken(user.id, 'verify-alice'); store.consumeEmailToken('verify-alice', 'verify');
  return { store, user };
}
const report = (id = 'TestVideo01') => ({ video: { id, title: 'Synthetic test', creator: 'Fixture Creator' }, analysis_version: 8, companies: [] });
function grantPro(store, user) {
  store.applyBilling('evt_initial', user.id, { id: 'sub_1', status: 'active', periodEnd: time + 86400000, cancelAtPeriodEnd: false },
    { id: 'pro:sub_1:1', start: time - 1000, end: time + 86400000 });
}
const sign = (event, secret, at = time) => {
  const raw = Buffer.from(JSON.stringify(event));
  const timestamp = Math.floor(at / 1000);
  const signature = `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`;
  return [raw, signature];
};

test('passwords use salted scrypt, and sessions store only hashes', async t => {
  const { store, user } = fixture(t);
  const first = await passwordHash('a sufficiently long test password');
  const second = await passwordHash('a sufficiently long test password');
  assert.notEqual(first, second);
  assert.equal(await passwordMatches('a sufficiently long test password', first), true);
  assert.equal(await passwordMatches('incorrect test password', first), false);
  store.addSession(user.id, 'secret-test-session');
  assert.equal(store.session('secret-test-session').id, user.id);
  assert.equal(store.db.prepare('SELECT hash FROM sessions').get().hash, hash('secret-test-session'));
  store.logout('secret-test-session'); assert.equal(store.session('secret-test-session'), undefined);
});
test('verification grants exactly one free analysis and verification links are one-use', t => {
  const { store, user } = fixture(t);
  assert.equal(store.account(user.id).analyses_available, 1);
  assert.throws(() => store.consumeEmailToken('verify-alice', 'verify'), { code: 'TOKEN_INVALID' });
  store.emailToken(user.id, 'verify-again'); store.consumeEmailToken('verify-again', 'verify');
  assert.equal(store.account(user.id).analyses_available, 1);
});
test('same-video concurrent reservations deduplicate; a second video cannot overdraw free quota', t => {
  const { store, user } = fixture(t);
  const first = store.reserve(user.id, 'TestVideo01', 8);
  const second = store.reserve(user.id, 'TestVideo01', 8);
  assert.equal(first.id, second.id); assert.equal(second.reused, true);
  assert.throws(() => store.reserve(user.id, 'TestVideo02', 8), { code: 'ANALYSIS_LIMIT' });
  store.complete(user.id, first.id, report());
  assert.equal(store.reserve(user.id, 'TestVideo01', 8).cached, true);
  assert.equal(store.account(user.id).analyses_available, 0);
});
test('failure releases credit, including rejected source language', t => {
  const { store, user } = fixture(t);
  const job = store.reserve(user.id, 'TestVideo01', 8);
  store.fail(user.id, job.id, 'SOURCE_LANGUAGE_MISMATCH');
  assert.equal(store.account(user.id).analyses_available, 1);
  assert.equal(store.job(user.id, job.id).error_code, 'SOURCE_LANGUAGE_MISMATCH');
  assert.equal(store.library(user.id).length, 0);
});
test('expired jobs are recovered after restart and cannot commit a late result', t => {
  let now = time;
  const { store, user } = fixture(t, { now: () => now });
  const job = store.reserve(user.id, 'TestVideo01', 8);
  now += 240001; store.recoverExpired();
  assert.equal(store.account(user.id).analyses_available, 1);
  assert.throws(() => store.complete(user.id, job.id, report()), { code: 'RESERVATION_EXPIRED' });
});
test('libraries and job results remain isolated between two customers', t => {
  const { store, user } = fixture(t);
  const other = store.createUser('bob@example.test', 'unused');
  const job = store.reserve(user.id, 'TestVideo01', 8); store.complete(user.id, job.id, report());
  assert.equal(store.ownReport(other.id, 'TestVideo01'), null);
  assert.equal(store.library(other.id).length, 0);
  assert.equal(store.job(other.id, job.id), undefined);
});
test('stable personal report numbers survive backdated publications and rereads', t => {
  const { store, user } = fixture(t); grantPro(store, user);
  for (const [id, date] of [['TestVideo01', '2026-09-01'], ['TestVideo02', '2025-01-01']]) {
    const record = report(id); record.video.published_at = date;
    store.complete(user.id, store.reserve(user.id, id, 8).id, record);
  }
  assert.deepEqual(store.library(user.id).map(r => r.personal_sequence), [1, 2]);
  assert.equal(store.ownReport(user.id, 'TestVideo01').personal_sequence, 1);
});
test('password reset revokes old sessions and cannot be replayed', t => {
  const { store, user } = fixture(t);
  store.addSession(user.id, 'old-session'); store.emailToken(user.id, 'reset-once', 'reset');
  store.consumeEmailToken('reset-once', 'reset', 'new-password-hash');
  assert.equal(store.session('old-session'), undefined);
  assert.throws(() => store.consumeEmailToken('reset-once', 'reset', 'x'), { code: 'TOKEN_INVALID' });
});
test('source/provider failures release jobs asynchronously without reports', async t => {
  const { store, user } = fixture(t);
  const jobs = new AnalysisJobs({ store, analyze: async () => { throw Object.assign(Error('outage'), { code: 'PROVIDER_UNAVAILABLE' }); } });
  const result = jobs.start(user.id, { videoId: 'TestVideo01' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.job(user.id, result.id).state, 'failed');
  assert.equal(store.account(user.id).analyses_available, 1);
});
test('sqlite library and credit usage persist across store instances', t => {
  const base = path.join(__dirname, '.tmp'); fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'account-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'accounts.sqlite');
  let store = new AccountStore(filename, { now: () => time });
  const user = store.createUser('persist@example.test', 'unused');
  store.emailToken(user.id, 'code'); store.consumeEmailToken('code', 'verify');
  store.complete(user.id, store.reserve(user.id, 'TestVideo01', 8).id, report()); store.close();
  store = new AccountStore(filename, { now: () => time });
  assert.equal(store.ownReport(user.id, 'TestVideo01').personal_sequence, 1);
  assert.equal(store.account(user.id).analyses_available, 0); store.close();
});
test('Stripe raw-body verification rejects modified bodies, stale timestamps and invalid signatures', () => {
  const event = { id: 'evt_test', type: 'invoice.paid' }, secret = 'whsec_test';
  const [raw, signature] = sign(event, secret);
  assert.deepEqual(verifyWebhook(raw, signature, secret, time), event);
  assert.throws(() => verifyWebhook(Buffer.concat([raw, Buffer.from(' ')]), signature, secret, time));
  assert.throws(() => verifyWebhook(raw, signature, secret, time + 301000));
  assert.throws(() => verifyWebhook(raw, signature, 'wrong', time));
});
test('Stripe contract: paid subscription, duplicate/out-of-order delivery, renewal, failed payment and cancellation', async t => {
  const { store, user } = fixture(t);
  store.customer(user.id, 'cus_test');
  const secret = 'whsec_fixture';
  let start = Math.floor(time / 1000) - 86400, end = start + 30 * 86400;
  let status = 'active', paid = true, cancel = false, requests = 0;
  const canonical = () => ({ id: 'sub_test', customer: 'cus_test', livemode: false, status,
    cancel_at_period_end: cancel, items: { data: [{ quantity: 1, price: { id: 'price_pro', recurring: { interval: 'month', interval_count: 1 } }, current_period_start: start, current_period_end: end }] },
    latest_invoice: { id: 'in_latest', status: paid ? 'paid' : 'open', paid,
      lines: { data: [{ pricing: { price_details: { price: 'price_pro' } }, period: { start, end } }] } } });
  const client = { secret: 'sk_test_fixture', priceId: 'price_pro', getSubscription: async () => { requests++; return canonical(); } };
  const billing = new BillingService({ store, client, webhookSecret: secret });
  const emit = (id, type, extra = {}) => billing.webhook(...sign({ id, type, data: { object: { id: 'in_payload', customer: 'cus_test', parent: { subscription_details: { subscription: 'sub_test' } }, ...extra } } }, secret));
  await emit('evt_paid', 'invoice.paid');
  assert.equal(store.account(user.id).analyses_available, 21);
  await emit('evt_paid', 'invoice.paid'); assert.equal(requests, 1);
  await emit('evt_old_failed', 'invoice.payment_failed'); // Canonical state is paid; old event cannot revoke it.
  assert.equal(store.isPro(user.id), true); assert.equal(store.account(user.id).analyses_available, 21);
  start += 30 * 86400; end += 30 * 86400;
  await emit('evt_renewal', 'invoice.paid'); await emit('evt_renewal_duplicate_invoice', 'invoice.paid');
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM credit_grants WHERE kind='pro'").get().n, 2);
  status = 'past_due'; paid = false; await emit('evt_failed', 'invoice.payment_failed');
  assert.equal(store.isPro(user.id), false); assert.equal(store.account(user.id).analyses_available, 1);
  status = 'active'; paid = true; cancel = true; await emit('evt_cancel_scheduled', 'customer.subscription.updated', { id: 'sub_test' });
  assert.equal(store.isPro(user.id), true);
  assert.equal(store.account(user.id).subscription.cancel_at_period_end, true);
  status = 'canceled'; await emit('evt_deleted', 'customer.subscription.deleted', { id: 'sub_test' });
  assert.equal(store.isPro(user.id), false);
});
