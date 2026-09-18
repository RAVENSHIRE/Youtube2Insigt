const path = require('node:path');
const { Mailer } = require('../accounts/auth');
const { StripeClient } = require('../accounts/billing');
function inspectConfiguration(env, nodeVersion = process.versions.node) {
  const checks = {
    node_supported: Number(nodeVersion.split('.')[0]) >= 24 && Number(nodeVersion.split('.')[0]) < 27,
    account_mode: env.APP_MODE !== 'legacy',
    https_origin: /^https:\/\/[^/]+\/?$/u.test(env.PUBLIC_BASE_URL || ''),
    persistent_database_path: Boolean(env.ACCOUNT_DB_PATH && path.isAbsolute(env.ACCOUNT_DB_PATH)),
    extension_origin: /^chrome-extension:\/\/[a-p]{32}$/u.test((env.EXTENSION_ORIGINS || '').split(',')[0].trim()),
    analysis_credentials_present: Boolean(env.GEMINI_API_KEY && env.YOUTUBE_API_KEY),
    email_credentials_present: Boolean(env.RESEND_API_KEY && env.MAIL_FROM),
    email_configuration_valid: new Mailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, publicUrl: env.PUBLIC_BASE_URL }).isConfigured(),
    stripe_credentials_present: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRO_PRICE_ID && env.STRIPE_WEBHOOK_SECRET),
    stripe_test_mode_enabled: new StripeClient({ secret: env.STRIPE_SECRET_KEY, priceId: env.STRIPE_PRO_PRICE_ID, publicUrl: env.PUBLIC_BASE_URL, mode: env.BILLING_MODE }).isConfigured()
  };
  return { status: Object.values(checks).every(Boolean) ? 'configuration_present_verification_required' : 'blocked', checks,
    stripe_mode: env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? 'test' : env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live_not_verified' : 'missing_or_other',
    youtube_sync: env.YOUTUBE_OAUTH_CLIENT_ID && env.YOUTUBE_OAUTH_CLIENT_SECRET && env.APP_ENCRYPTION_KEY ? 'configured_not_live_verified' : 'manual_only',
    audio_fallback: env.AUDIO_TRANSCRIPTION_URL && env.AUDIO_TRANSCRIPTION_KEY ? 'gateway_configured_not_verified' : 'not_configured',
    commercial_market_data: env.COMMERCIAL_MARKET_DATA_APPROVED === 'true' ? 'operator_flag_requires_contract_evidence' : 'disabled',
    external_verification_required: ['HTTPS deployment and restore drill', 'Real email acceptance, inbox delivery, verification and subsequent login', 'Stripe test Checkout/webhook/Portal lifecycle', 'DE/EN real source and video timestamp checks', 'Chrome extension acceptance', 'Example-source and rights review', 'Operator privacy/terms and support contact'],
    network_requests_performed: false, secrets_printed: false };
}
if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  const report = inspectConfiguration(process.env); console.log(JSON.stringify(report, null, 2));
  if (report.status === 'blocked') process.exitCode = 1;
}
module.exports = { inspectConfiguration };
