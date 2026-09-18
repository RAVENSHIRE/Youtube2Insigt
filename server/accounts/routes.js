const express = require('express');
const path = require('node:path');
const { AccountStore, AppError, hash } = require('./store');
const { token, emailAddress, registrationInput, passwordHash, passwordMatches, bearer, authMiddleware, Mailer } = require('./auth');
const { BillingService, StripeClient } = require('./billing');
const { AnalysisJobs } = require('./analysisJobs');
const { projectResearchForRead } = require('../instruments/instrumentProjection');

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const validVideo = id => /^[A-Za-z0-9_-]{11}$/u.test(id || '');
function creatorOf(report) {
  const channel = report.video.channel || {};
  const identity = channel.youtube_channel_id || channel.handle || channel.url || report.video.creator;
  return { creator_id: `creator_${hash(identity).slice(0, 16)}`, display_name: channel.name || report.video.creator,
    youtube_channel_id: channel.youtube_channel_id || null, handle: channel.handle || null,
    channel_url: channel.url || null, avatar_url: channel.avatar_url || null,
    subscriber_count: channel.subscriber_count || null, total_videos: channel.total_videos || null,
    analyzed_videos: 0 };
}
function profiles(reports, selections = []) {
  const map = new Map();
  for (const report of reports) {
    const profile = creatorOf(report);
    if (!map.has(profile.creator_id)) map.set(profile.creator_id, profile);
    map.get(profile.creator_id).analyzed_videos++;
  }
  for (const channel of selections) {
    const already = [...map.values()].some(p => p.youtube_channel_id === channel.id ||
      (channel.handle && String(p.handle).toLowerCase() === channel.handle.toLowerCase()));
    if (already) continue;
    const profile = creatorOf({ video: { creator: channel.name, channel: { ...channel,
      youtube_channel_id: channel.id.startsWith("UC") ? channel.id : null, handle: channel.handle || null } } });
    if (!map.has(profile.creator_id)) map.set(profile.creator_id, profile);
  }
  return [...map.values()];
}
function installAccounts(app, dependencies = {}, env = process.env) {
  const production = env.NODE_ENV === 'production';
  const publicUrl = String(env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/u, '');
  const origin = new URL(publicUrl).origin;
  if (production && !publicUrl.startsWith('https://')) throw Error('Production requires PUBLIC_BASE_URL with HTTPS.');
  if (production && !env.ACCOUNT_DB_PATH) throw Error('Production requires ACCOUNT_DB_PATH on a persistent volume.');
  const store = dependencies.store || new AccountStore(env.ACCOUNT_DB_PATH || path.join(__dirname, '../runtime/accounts.sqlite'), {
    proCredits: Number(env.PRO_MONTHLY_ANALYSES) || 20
  });
  const mailer = dependencies.mailer || new Mailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, publicUrl });
  const client = dependencies.stripeClient || new StripeClient({ secret: env.STRIPE_SECRET_KEY, priceId: env.STRIPE_PRO_PRICE_ID, publicUrl, mode: env.BILLING_MODE || 'disabled' });
  const billing = new BillingService({ store, client, webhookSecret: env.STRIPE_WEBHOOK_SECRET });
  const billingAvailable = () => client.isConfigured() && Boolean(env.STRIPE_WEBHOOK_SECRET);
  const requireBilling = () => { if (!billingAvailable()) throw new AppError('BILLING_NOT_CONFIGURED', 'Stripe-Testcheckout nicht eingerichtet. BILLING_MODE=test, Test-Key, monatlichen Test-Preis und Webhook konfigurieren.', 503); };
  const jobs = new AnalysisJobs({ store, analyze: dependencies.analyze, logger: dependencies.analysisLogger || console });
  const allowedOrigins = new Set([origin, ...(env.EXTENSION_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)]);
  if (!production) allowedOrigins.add('http://localhost:3000');
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', Number(env.TRUST_PROXY_HOPS) || 1);
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://yt3.ggpht.com https://i.ytimg.com https://yt3.googleusercontent.com data:; connect-src 'self'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const requestedOrigin = req.get('origin');
    if (requestedOrigin && !allowedOrigins.has(requestedOrigin) && !(dependencies.allowTestExtension && requestedOrigin.startsWith('chrome-extension://'))) {
      return res.status(403).json({ error: 'Origin nicht freigegeben.', code: 'ORIGIN_DENIED' });
    }
    // Cookie-authenticated mutations require a same-site Origin. Bearer API clients use no ambient credentials.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.cookie && !req.get('authorization') && requestedOrigin !== origin) {
      return res.status(403).json({ error: 'Origin erforderlich.', code: 'CSRF_REJECTED' });
    }
    if (requestedOrigin) res.set({ 'Access-Control-Allow-Origin': requestedOrigin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' });
    if (req.method === 'OPTIONS') return res.set({ 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type' }).sendStatus(204);
    next();
  });
  app.post('/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), asyncRoute(async (req, res) => {
    requireBilling();
    res.json(await billing.webhook(req.body, req.get('stripe-signature')));
  }));
  app.use(express.json({ limit: '100kb' }));
  const auth = authMiddleware(store);
  const limited = (prefix, max = 10, period = 900000) => (req, res, next) => {
    try { store.rateLimit(`${prefix}:${req.user?.id || req.ip}`, max, period); next(); } catch (error) { next(error); }
  };
  const sessionResponse = (res, user) => {
    const value = token(); store.addSession(user.id, value);
    res.cookie('yt_session', value, { httpOnly: true, secure: production, sameSite: 'strict', maxAge: 7 * 86400000, path: '/' });
    return res.json({ token: value, account: store.account(user.id) });
  };
  const requireEmail = () => {
    if (!mailer.isConfigured()) throw new AppError('EMAIL_NOT_CONFIGURED', 'E-Mail-Versand nicht eingerichtet. Betreiber: RESEND_API_KEY, MAIL_FROM und PUBLIC_BASE_URL prüfen.', 503);
  };
  const sendVerification = async user => {
    store.rateLimit(`verification-email:${hash(user.email)}`, 5, 3600000);
    const code = token(); store.emailToken(user.id, code);
    try { await mailer.send(user.email, code, 'verify'); }
    catch (error) { store.revokeEmailToken(code); throw error; }
  };
  const verificationResponse = res => res.status(202).json({ status: 'verification_required', emailStatus: 'accepted',
    message: 'Bestätigungslink an den E-Mail-Anbieter übergeben. Bitte Posteingang und Spam prüfen. Der Link gilt eine Stunde; die Zustellung ist noch nicht bestätigt.' });
  app.get('/health', (req, res) => res.json({ status: 'ok', analysisVersion: 8, accountStorage: 'sqlite-v1',
    analysisConfigured: Boolean(dependencies.analysisConfigured), billingConfigured: billingAvailable(), billingMode: billingAvailable() ? 'test' : 'disabled',
    emailConfigured: mailer.isConfigured(), marketDataCommercial: env.COMMERCIAL_MARKET_DATA_APPROVED === 'true',
    youtubeSync: env.YOUTUBE_OAUTH_CLIENT_ID && env.YOUTUBE_OAUTH_CLIENT_SECRET && env.APP_ENCRYPTION_KEY ? 'configured_approval_unverified' : 'manual_only' }));
  app.get('/config', (req, res) => res.json({ accountRequired: true, freeAnalyses: 1, proMonthlyAnalyses: store.proCredits,
    billingAvailable: billingAvailable(), billingMode: billingAvailable() ? 'test' : 'disabled', analysisAvailable: Boolean(dependencies.analysisConfigured),
    youtubeSyncAvailable: Boolean(env.YOUTUBE_OAUTH_CLIENT_ID && env.YOUTUBE_OAUTH_CLIENT_SECRET && env.APP_ENCRYPTION_KEY), marketDataAvailable: env.COMMERCIAL_MARKET_DATA_APPROVED === 'true' }));
  app.post('/auth/register', limited('register', 5, 3600000), asyncRoute(async (req, res) => {
    const { email, password } = registrationInput(req.body);
    requireEmail();
    const encoded = await passwordHash(password);
    let user = store.byEmail(email);
    if (user && !await passwordMatches(password, user.password_hash)) {
      throw new AppError('ACCOUNT_ACCESS_REQUIRED', 'Registrierung nicht fortgesetzt. Falls bereits ein Konto besteht, mit dem bisherigen Passwort anmelden oder „Passwort vergessen?“ verwenden.', 409);
    }
    if (!user) user = store.createUser(email, encoded);
    if (user.verified_at) return res.json({ status: 'sign_in_required', message: 'Dein Konto ist bereits bestätigt. Bitte anmelden.' });
    await sendVerification(user);
    verificationResponse(res);
  }));
  app.post('/auth/resend-verification', limited('resend-verification', 5, 3600000), asyncRoute(async (req, res) => {
    const user = store.byEmail(emailAddress(req.body.email));
    if (!await passwordMatches(req.body.password, user?.password_hash) || !user) {
      throw new AppError('LOGIN_FAILED', 'E-Mail oder Passwort ist nicht korrekt.', 401);
    }
    if (user.verified_at) return res.json({ status: 'sign_in_required', message: 'Dein Konto ist bereits bestätigt. Bitte anmelden.' });
    requireEmail(); await sendVerification(user); verificationResponse(res);
  }));
  app.post('/auth/verify', limited('verify', 15), asyncRoute(async (req, res) => {
    const user = store.consumeEmailToken(String(req.body.token || ''), 'verify'); sessionResponse(res, user);
  }));
  app.post('/auth/login', limited('login', 10), asyncRoute(async (req, res) => {
    const user = store.byEmail(emailAddress(req.body.email));
    const matches = await passwordMatches(req.body.password, user?.password_hash);
    if (!user || !matches) throw new AppError('LOGIN_FAILED', 'E-Mail oder Passwort ist nicht korrekt.', 401);
    if (!user.verified_at) throw new AppError('EMAIL_NOT_VERIFIED', 'Bitte zuerst die E-Mail bestätigen. Auf der Kontoseite kannst du einen neuen Bestätigungslink anfordern.', 403);
    sessionResponse(res, user);
  }));
  app.post('/auth/password-reset', limited('reset', 5, 3600000), asyncRoute(async (req, res) => {
    const user = store.byEmail(emailAddress(req.body.email));
    requireEmail();
    if (user) {
      store.rateLimit(`reset-email:${hash(user.email)}`, 5, 3600000);
      const code = token(); store.emailToken(user.id, code, 'reset');
      try { await mailer.send(user.email, code, 'reset'); }
      catch (error) { store.revokeEmailToken(code); throw error; }
    }
    res.status(202).json({ status: 'email_requested', message: 'Falls ein Konto existiert, wurde der Link an den E-Mail-Anbieter übergeben. Bitte Posteingang und Spam prüfen; die Zustellung ist nicht bestätigt.' });
  }));
  app.post('/auth/password-reset/confirm', limited('reset-confirm', 10), asyncRoute(async (req, res) => {
    store.consumeEmailToken(String(req.body.token || ''), 'reset', await passwordHash(req.body.password)); res.json({ status: 'password_updated' });
  }));
  app.post('/auth/logout', auth, (req, res) => { store.logout(bearer(req)); res.clearCookie('yt_session', { path: '/' }); res.json({ ok: true }); });
  app.get('/me', auth, (req, res) => res.json(store.account(req.user.id)));
  app.get('/billing/plan', auth, limited('billing-plan', 30), asyncRoute(async (req, res) => {
    requireBilling(); const price = await client.getPrice();
    res.json({ mode: 'test', name: 'Pro', amount: price.unit_amount, currency: price.currency, interval: 'month',
      monthlyAnalyses: store.proCredits, marketDataIncluded: false });
  }));
  app.get('/billing/checkout-status', auth, limited('billing-status', 60), (req, res, next) => {
    try { requireBilling(); res.json(billing.checkoutStatus(req.user.id, req.query.session_id)); } catch(error) { next(error); }
  });
  app.post('/billing/checkout', auth, limited('checkout', 10), asyncRoute(async (req, res) => {
    requireBilling();
    if (req.body.confirmSubscription !== true) throw new AppError('SUBSCRIPTION_CONFIRMATION_REQUIRED', 'Monatliches Test-Abo vor Checkout bestätigen.', 400);
    res.json(await billing.checkout(req.user.id));
  }));
  app.post('/billing/portal', auth, limited('portal', 10), asyncRoute(async (req, res) => { requireBilling(); res.json(await billing.portal(req.user.id)); }));
  app.post('/analyze', auth, limited('analyze', 30), asyncRoute(async (req, res) => {
    if (!validVideo(req.body.videoId)) throw new AppError('VIDEO_INVALID', 'Ungültige Video-ID.');
    if (req.body.confirmCredit !== true) throw new AppError('CREDIT_CONFIRMATION_REQUIRED', 'Analyseverbrauch vor dem Start bestätigen.');
    const existing = store.ownReport(req.user.id, req.body.videoId);
    if (existing) return res.json({ state: 'complete', cached: true, videoId: req.body.videoId, credits_consumed: 0 });
    if (!dependencies.analysisConfigured) throw new AppError('ANALYSIS_NOT_CONFIGURED', 'Analyse-Provider noch nicht eingerichtet.', 503);
    const job = jobs.start(req.user.id, { videoId: req.body.videoId });
    res.status(job.state === 'complete' ? 200 : 202).json({ jobId: job.id, videoId: req.body.videoId, state: job.state, reserved_credits: job.state === 'reserved' ? 1 : 0 });
  }));
  app.get('/analysis-jobs/:id', auth, (req, res, next) => {
    store.recoverExpired(); const job = store.job(req.user.id, req.params.id);
    if (!job) return next(new AppError('JOB_NOT_FOUND', 'Auftrag nicht gefunden.', 404));
    const modelUnavailable = ['MODEL_UNAVAILABLE', 'MODEL_RATE_LIMIT'].includes(job.error_code);
    const transcriptTimedOut = job.error_code === 'TRANSCRIPT_TIMEOUT';
    res.json({ jobId: job.id, videoId: job.video_id, state: job.state, code: job.error_code,
      credit_released: job.state === 'failed', error: job.state === 'failed' ? (modelUnavailable
        ? 'Gemini ist vorübergehend überlastet oder limitiert. Bitte später erneut versuchen. Credit freigegeben.'
        : transcriptTimedOut ? 'YouTube hat das Transkript nicht rechtzeitig geliefert. Bitte erneut versuchen. Credit freigegeben.'
        : 'Analyse konnte nicht sicher abgeschlossen werden. Credit freigegeben.') : null });
  });
  app.get('/videos/:videoId/report.csv', auth, (req, res, next) => {
    const report = store.ownReport(req.user.id, req.params.videoId);
    if (!report) return next(new AppError('VIDEO_NOT_FOUND', 'Video nicht in deiner Bibliothek.', 404));
    try { require('../exports/reportCsv').sendReportCsv(res, projectResearchForRead(report)); } catch (error) { next(error); }
  });
  app.get('/videos/:videoId/watchlist.csv', auth, (req, res, next) => {
    const report = store.ownReport(req.user.id, req.params.videoId);
    if (!report) return next(new AppError('VIDEO_NOT_FOUND', 'Video nicht in deiner Bibliothek.', 404));
    try { require('../exports/watchlistCsv').sendWatchlist(res, report); } catch (error) { next(error); }
  });
  app.get('/videos/:videoId', auth, (req, res, next) => {
    const report = store.ownReport(req.user.id, req.params.videoId);
    if (!report) return next(new AppError('VIDEO_NOT_FOUND', 'Video nicht in deiner Bibliothek.', 404));
    res.json(projectResearchForRead(report));
  });
  app.post('/videos/:videoId/metadata', auth, (req, res, next) => {
    const report = store.ownReport(req.user.id, req.params.videoId);
    if (!report) return next(new AppError('VIDEO_NOT_FOUND', 'Video nicht in deiner Bibliothek.', 404));
    // Browser metadata must not overwrite canonical source identity/publication.
    res.json(projectResearchForRead(report));
  });
  const selections = userId => store.db.prepare('SELECT body FROM creator_selections WHERE user_id=?').all(userId).map(row => JSON.parse(row.body));
  const getProfiles = user => profiles(store.library(user.id), selections(user.id));
  app.get('/creators', auth, (req, res) => {
    const creators = getProfiles(req.user).map(dependencies.profileToChannel);
    res.json({ creators, totalCreators: creators.length, totalAnalyzedVideos: creators.reduce((n, c) => n + c.analyzedVideos, 0) });
  });
  app.get('/creators/resolve', auth, (req, res, next) => {
    const profile = getProfiles(req.user).find(p => (req.query.channelId && req.query.channelId === p.youtube_channel_id) ||
      (req.query.handle && req.query.handle.toLowerCase() === String(p.handle).toLowerCase()) || (req.query.channelUrl && req.query.channelUrl === p.channel_url));
    if (!profile) return next(new AppError('CREATOR_NOT_FOUND', 'Creator nicht gefunden.', 404));
    res.json({ creator: dependencies.profileToChannel(profile) });
  });
  const dashboardFor = async (user, creatorId = null) => {
    const all = store.library(user.id);
    const profile = creatorId ? profiles(all, selections(user.id)).find(p => p.creator_id === creatorId) : null;
    if (creatorId && !profile) throw new AppError('CREATOR_NOT_FOUND', 'Creator nicht gefunden.', 404);
    const records = all.filter(report => !creatorId || creatorOf(report).creator_id === creatorId);
    const result = await dependencies.buildDashboard(Object.fromEntries(records.map(report => [report.video.id, report])), profile);
    for (const video of result.videos) {
      video.analysisSequence = records.find(report => report.video.id === video.id).personal_sequence;
      delete video.performance; // Market aggregation requires licensed access, even when cached.
    }
    return result;
  };
  app.get('/creators/:creatorId/dashboard', auth, asyncRoute(async (req, res) => res.json(await dashboardFor(req.user, req.params.creatorId))));
  app.get('/dashboard', auth, asyncRoute(async (req, res) => res.json(await dashboardFor(req.user))));
  app.get('/companies', auth, asyncRoute(async (req, res) => res.json({ companies: (await dashboardFor(req.user)).companies })));
  dependencies.extend?.({ app, store, auth, limited, asyncRoute, env, publicUrl, dashboardFor });
  app.get('/account/research-library.js', (req, res) => res.sendFile(path.join(__dirname, '../../extension/research-library.js')));
  app.use('/account/', express.static(path.join(__dirname, '../web'), { index: 'index.html' }));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../web/landing.html')));
  app.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', error: 'Endpunkt nicht verfügbar.' }));
  app.use((error, req, res, next) => {
    const status = error instanceof AppError ? error.status : error.type === 'entity.too.large' ? 413 : 500;
    res.status(status).json({ code: error.code || 'REQUEST_FAILED', error: error instanceof AppError ? error.message : 'Anfrage konnte nicht abgeschlossen werden.' });
  });
  return { store, billing, jobs, dashboardFor };
}
module.exports = { installAccounts, creatorOf, profiles };
