#!/usr/bin/env node
// Local operator recovery only. Never expose this through an HTTP route.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { diagnose } = require('./diagnose-stripe-checkout.cjs');
const { backupAccounts } = require('./backup-accounts');
const { AccountStore } = require('../accounts/store');
const { StripeClient, BillingService } = require('../accounts/billing');
const fail = code => Object.assign(new Error(code), { recoveryCode: code });

function validateEnvironment(env) {
  if (env.NODE_ENV === 'production' || env.BILLING_MODE !== 'test') throw fail('LOCAL_TEST_MODE_REQUIRED');
  let url; try { url = new URL(env.PUBLIC_BASE_URL || 'http://localhost:3000'); } catch { throw fail('LOCAL_URL_REQUIRED'); }
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !['http:','https:'].includes(url.protocol) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fail('LOCAL_URL_REQUIRED');
  const proCredits = Number(env.PRO_MONTHLY_ANALYSES || 20);
  if (!Number.isInteger(proCredits) || proCredits < 1 || proCredits > 10000) throw fail('MONTHLY_ANALYSES_INVALID');
  return proCredits;
}
async function assertServerStopped(port = 3000) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('SERVER_PORT_INVALID');
  await Promise.all(['127.0.0.1','::1'].map(host => new Promise((resolve,reject) => {
    const socket = net.connect({host,port});
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); reject(fail('STOP_NODE_SERVER_FIRST')); });
    socket.once('timeout', () => { socket.destroy(); reject(fail('SERVER_STOP_CHECK_FAILED')); });
    socket.once('error', error => {
      socket.destroy();
      if (['ECONNREFUSED','EAFNOSUPPORT','ENETUNREACH','EADDRNOTAVAIL'].includes(error.code)) resolve();
      else reject(fail('SERVER_STOP_CHECK_FAILED'));
    });
  })));
}
async function recover({ database, eventId, client, proCredits, apply = false, backupFn = backupAccounts, now = () => Date.now(), stoppedCheck }) {
  if (!path.isAbsolute(database) || !fs.existsSync(database) || !fs.statSync(database).isFile()) throw fail('EXISTING_ACCOUNT_DATABASE_REQUIRED');
  if (client.mode !== 'test' || !client.isConfigured()) throw fail('TEST_BILLING_CONFIGURATION_REQUIRED');
  if (!Number.isInteger(proCredits) || proCredits < 1 || proCredits > 10000) throw fail('MONTHLY_ANALYSES_INVALID');
  const read = new DatabaseSync(database, {readOnly:true});
  let before;
  try {
    if (read.prepare('PRAGMA user_version').get().user_version !== 1) throw fail('UNSUPPORTED_ACCOUNT_SCHEMA');
    before = await diagnose({db:read,client,eventId,now:now()});
  } finally { read.close(); }
  if (before.diagnosis === 'LOCAL_PRO_ACTIVE_CHECK_BROWSER_ACCOUNT_AND_SERVER') {
    return {...before,status:'already_active',source:'stripe_api_verification'};
  }
  if (before.diagnosis !== 'PAID_EVENT_NOT_RECORDED_LOCALLY' || !before.stripeTestInvoicePaid) throw fail('PAYMENT_NOT_ELIGIBLE_FOR_RECOVERY');
  if (!apply) return {...before,status:'ready_to_recover',configuredMonthlyAnalyses:proCredits};
  if (!stoppedCheck) throw fail('SERVER_STOP_CONFIRMATION_REQUIRED');
  await stoppedCheck();
  const backupPath = path.join(path.dirname(database),'recovery',`before-stripe-recovery-${now()}-${randomUUID()}.sqlite`);
  const backup = await backupFn(database,backupPath);
  if (backup?.status !== 'verified_backup' || backup.destination !== backupPath) throw fail('VERIFIED_BACKUP_REQUIRED');
  await stoppedCheck();
  const store = new AccountStore(database,{proCredits,now});
  let processed = false;
  try {
    // Re-fetch event and current canonical state AFTER backup. Same rules/transaction as webhooks.
    const service = new BillingService({store,client});
    const result = await service.recoverPaidEvent(eventId);
    processed = Boolean(result.granted);
    if (!result.granted && !result.duplicate) throw fail('RECOVERY_NOT_APPLIED');
    const after = await diagnose({db:store.db,client,eventId,now:now()});
    if (!after.eventProcessedLocally || !after.localProEntitled || !after.paidPeriodGrantFound || !after.localSubscriptionMatches) throw fail('RECOVERY_READBACK_FAILED');
    return {status:'recovered',eventId,source:'stripe_api_recovery',backup:backupPath,
      eventProcessedLocally:after.eventProcessedLocally,localProEntitled:after.localProEntitled,
      paidPeriodGrantFound:after.paidPeriodGrantFound,configuredMonthlyAnalyses:proCredits,
      writesPerformed:processed,paymentsCreated:false,webhookDeliveryProven:false};
  } catch(error) {
    // A provider/readback failure AFTER commit must never be reported as "no writes".
    error.recoveryContext = {backup:backupPath,eventProcessedLocally:store.eventHandled(eventId),writesPerformed:processed,paymentsCreated:false};
    throw error;
  } finally { store.close(); }
}
async function main(args) {
  const [root,eventId,...flags] = args;
  if (!root || !path.isAbsolute(root)) throw fail('ABSOLUTE_PROJECT_ROOT_REQUIRED');
  if (flags.some(flag => !['--apply','--server-stopped'].includes(flag))) throw fail('UNKNOWN_ARGUMENT');
  if (flags.includes('--apply') && !flags.includes('--server-stopped')) throw fail('SERVER_STOP_CONFIRMATION_REQUIRED');
  const dotenv = require(path.join(root,'server/node_modules/dotenv'));
  const env = {...dotenv.parse(fs.readFileSync(path.join(root,'.env'))),...process.env};
  const proCredits = validateEnvironment(env);
  const client = new StripeClient({secret:env.STRIPE_SECRET_KEY,priceId:env.STRIPE_PRO_PRICE_ID,mode:env.BILLING_MODE,
    publicUrl:env.PUBLIC_BASE_URL || 'http://localhost:3000'});
  const database = env.ACCOUNT_DB_PATH || path.join(root,'server/runtime/accounts.sqlite');
  return recover({database,eventId,client,proCredits,apply:flags.includes('--apply'),stoppedCheck:()=>assertServerStopped(Number(env.PORT || 3000))});
}
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result,null,2))).catch(error => {
  const code = error.recoveryCode || error.diagnosticCode || (/^(?:BILLING|WEBHOOK)_/.test(error.code || '') ? error.code : 'RECOVERY_FAILED');
  console.error(JSON.stringify({status:'blocked',code,paymentsCreated:false,...error.recoveryContext}));
  process.exitCode = 1;
});
module.exports = {recover,validateEnvironment,assertServerStopped,main};
