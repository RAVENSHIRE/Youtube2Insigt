#!/usr/bin/env node
// Read-only local diagnosis. No checkout creation, webhook fabrication, or credit writes.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const idOf = value => typeof value === 'string' ? value : value?.id;
const fail = code => Object.assign(new Error(code), { diagnosticCode: code });

async function diagnose({ db, client, eventId, now = Date.now() }) {
  if (!/^evt_[A-Za-z0-9_]+$/.test(eventId || '')) throw fail('EVENT_ID_INVALID');
  const event = await client.request('GET', `events/${encodeURIComponent(eventId)}`);
  if (event.id !== eventId || event.livemode !== false || event.type !== 'invoice.paid') throw fail('EXPECTED_TEST_INVOICE_PAID_EVENT');
  const invoiceEvent = event.data?.object;
  const customer = idOf(invoiceEvent?.customer);
  const subId = idOf(invoiceEvent?.subscription || invoiceEvent?.parent?.subscription_details?.subscription);
  if (!customer || !subId) throw fail('EVENT_IDENTITY_INCOMPLETE');
  const user = db.prepare('SELECT id FROM users WHERE stripe_customer=?').get(customer);
  const processed = Boolean(db.prepare('SELECT 1 FROM webhook_events WHERE id=?').get(eventId));
  const report = { eventId, stripeTestInvoicePaid: invoiceEvent.status === 'paid',
    localCustomerFound: Boolean(user), eventProcessedLocally: processed,
    localSubscriptionStatus: null, paidPeriodGrantFound: false, localProEntitled: false,
    writesPerformed: false, paymentsCreated: false };
  const sub = await client.getSubscription(subId);
  const items = sub.items?.data || [];
  const item = items.find(item => idOf(item.price) === client.priceId);
  let invoice = sub.latest_invoice;
  if (typeof invoice === 'string') invoice = await client.getInvoice(invoice);
  const start = Number(item?.current_period_start || sub.current_period_start) * 1000;
  const end = Number(item?.current_period_end || sub.current_period_end) * 1000;
  const priceMatches = items.length === 1 && Boolean(item) && Number(item.quantity || 1) === 1 &&
    item.price?.recurring?.interval === 'month' && Number(item.price?.recurring?.interval_count || 1) === 1;
  const matchingLine = (invoice?.lines?.data || []).some(line => idOf(line.price || line.pricing?.price_details?.price) === client.priceId &&
    Number(line.period?.start) * 1000 === start && Number(line.period?.end) * 1000 === end);
  Object.assign(report, {
    stripeSubscriptionActive: sub.status === 'active',
    subscriptionIdentityMatches: sub.id === subId && sub.livemode === false && idOf(sub.customer) === customer,
    configuredMonthlyPriceMatches: priceMatches,
    invoiceIdentityMatches: Boolean(invoice && invoice.livemode === false && idOf(invoice.customer) === customer &&
      idOf(invoice.subscription || invoice.parent?.subscription_details?.subscription) === subId),
    latestInvoicePaid: invoice?.status === 'paid' && invoice?.paid !== false,
    invoiceLineMatchesPeriod: matchingLine,
    periodCurrentlyValid: Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now,
    serverTimeUTC: new Date(now).toISOString()
  });
  if (user) {
    const local = db.prepare('SELECT * FROM subscriptions WHERE user_id=?').get(user.id);
    report.localSubscriptionStatus = local?.status || null;
    report.localSubscriptionMatches = local?.subscription_id === subId;
    report.paidPeriodGrantFound = Number.isFinite(start) && Number.isFinite(end) && Boolean(db.prepare(
      "SELECT 1 FROM credit_grants WHERE user_id=? AND kind='pro' AND id=? AND starts_at=? AND expires_at=?"
    ).get(user.id, `pro:${subId}:${start}`, start, end));
    report.localProEntitled = Boolean(local?.status === 'active' && local.period_end > now && db.prepare(
      "SELECT 1 FROM credit_grants WHERE user_id=? AND kind='pro' AND id='pro:' || ? || ':' || starts_at AND starts_at<=? AND expires_at=?"
    ).get(user.id, local.subscription_id, now, local.period_end));
  }
  const canonicalPassed = ['stripeSubscriptionActive','subscriptionIdentityMatches','configuredMonthlyPriceMatches',
    'invoiceIdentityMatches','latestInvoicePaid','invoiceLineMatchesPeriod','periodCurrentlyValid'].every(key => report[key]);
  report.diagnosis = !user ? 'NO_MATCHING_LOCAL_CUSTOMER' : !canonicalPassed ? 'CANONICAL_PAYMENT_CHECK_FAILED' :
    report.localProEntitled ? 'LOCAL_PRO_ACTIVE_CHECK_BROWSER_ACCOUNT_AND_SERVER' :
    !processed ? 'PAID_EVENT_NOT_RECORDED_LOCALLY' : 'EVENT_RECORDED_WITHOUT_CURRENT_PRO_ACCESS';
  return report;
}
async function main(projectRoot, eventId) {
  if (!projectRoot || !path.isAbsolute(projectRoot)) throw fail('ABSOLUTE_PROJECT_ROOT_REQUIRED');
  const dotenv = require(path.join(projectRoot, 'server/node_modules/dotenv'));
  const env = { ...dotenv.parse(fs.readFileSync(path.join(projectRoot, '.env'))), ...process.env };
  if (env.BILLING_MODE !== 'test') throw fail('TEST_MODE_REQUIRED');
  const { StripeClient } = require(path.join(projectRoot, 'server/accounts/billing'));
  const client = new StripeClient({secret:env.STRIPE_SECRET_KEY,priceId:env.STRIPE_PRO_PRICE_ID,
    mode:env.BILLING_MODE,publicUrl:env.PUBLIC_BASE_URL || 'http://localhost:3000'});
  if (!client.isConfigured()) throw fail('BILLING_CONFIGURATION_INVALID');
  const filename = env.ACCOUNT_DB_PATH || path.join(projectRoot, 'server/runtime/accounts.sqlite');
  if (!path.isAbsolute(filename) || !fs.existsSync(filename)) throw fail('EXISTING_ACCOUNT_DATABASE_REQUIRED');
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return await diagnose({db,client,eventId}); } finally { db.close(); }
}
if (require.main === module) main(process.argv[2],process.argv[3]).then(result => {
  console.log(JSON.stringify(result,null,2));
}).catch(error => {
  const code = error.diagnosticCode || (/^(?:BILLING|WEBHOOK)_/.test(error.code || '') ? error.code : 'DIAGNOSTIC_FAILED');
  // No provider response body, exception message, stack, keys, customer details or checkout URL.
  console.error(JSON.stringify({status:'failed',code,writesPerformed:false,paymentsCreated:false}));
  process.exitCode = 1;
});
module.exports = { diagnose, main };
