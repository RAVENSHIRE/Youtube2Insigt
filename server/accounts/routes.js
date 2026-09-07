const express = require('express');
const path = require('node:path');
const { AccountStore, AppError, hash } = require('./store');
const { token, emailAddress, passwordHash, passwordMatches, bearer, authMiddleware, Mailer } = require('./auth');
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
  const client = dependencies.stripeClient || new StripeClient({ secret: env.STRIPE_SECRET_KEY, priceId: env.STRIPE_PRO_PRICE_ID, publicUrl });
  const billing = new BillingService({ store, client, webhookSecret: env.STRIPE_WEBHOOK_SECRET });
  const jobs = new AnalysisJobs({ store, analyze: dependencies.analyze });
  const allowedOrigins = new Set([origin, ...(env.EXTENSION_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)]);
  if (!production) allowedOrigins.add('http://localhost:3000');
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', Number(env.TRUST_PROXY_HOPS) || 1);
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://i.ytimg.com https://yt3.googleusercontent.com data:; connect-src 'self'; frame-ancestors 'none'",
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
    if (!env.STRIPE_WEBHOOK_SECRET) throw new AppError('BILLING_NOT_CONFIGURED', 'Webhook is not configured.', 503);
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
  app.get('/health', (req, res) => res.json({ status: 'ok', analysisVersion: 8, accountStorage: 'sqlite-v1',
    analysisConfigured: Boolean(dependencies.analysisConfigured), billingConfigured: client.isConfigured() && Boolean(env.STRIPE_WEBHOOK_SECRET),
    emailConfigured: mailer.isConfigured(), marketDataCommercial: env.COMMERCIAL_MARKET_DATA_APPROVED === 'true',
    youtubeSync: env.YOUTUBE_OAUTH_CLIENT_ID && env.YOUTUBE_OAUTH_CLIENT_SECRET && env.APP_ENCRYPTION_KEY ? 'configured_approval_unverified' : 'manual_only' }));
  app.get('/config', (req, res) => res.json({ accountRequired: true, freeAnalyses: 1, proMonthlyAnalyses: store.proCredits,
    billingAvailable: client.isConfigured() && Boolean(env.STRIPE_WEBHOOK_SECRET), analysisAvailable: Boolean(dependencies.analysisConfigured),
    youtubeSyncAvailable: Boolean(env.YOUTUBE_OAUTH_CLIENT_ID && env.YOUTUBE_OAUTH_CLIENT_SECRET && env.APP_ENCRYPTION_KEY), marketDataAvailable: env.COMMERCIAL_MARKET_DATA_APPROVED === 'true' }));
  app.post('/auth/register', limited('register', 5, 3600000), asyncRoute(async (req, res) => {
    if (!mailer.isConfigured()) throw new AppError('EMAIL_NOT_CONFIGURED', 'Registrierung wartet auf bestätigten E-Mail-Versand.', 503);
    const email = emailAddress(req.body.email), password = await passwordHash(req.body.password);
    let user = store.byEmail(email);
    if (!user) user = store.createUser(email, password);
    if (!user.verified_at) { const code = token(); store.emailToken(user.id, code); await mailer.send(email, code, 'verify'); }
    res.status(202).json({ status: 'verification_required', message: 'Falls erforderlich, wurde ein Bestätigungslink gesendet.' });
  }));
  app.post('/auth/verify', limited('verify', 15), asyncRoute(async (req, res) => {
    const user = store.consumeEmailToken(String(req.body.token || ''), 'verify'); sessionResponse(res, user);
  }));
  app.post('/auth/login', limited('login', 10), asyncRoute(async (req, res) => {
    const user = store.byEmail(emailAddress(req.body.email));
    const matches = await passwordMatches(req.body.password, user?.password_hash);
    if (!user || !matches || !user.verified_at) throw new AppError('LOGIN_FAILED', 'Anmeldung fehlgeschlagen. E-Mail-Bestätigung prüfen.', 401);
    sessionResponse(res, user);
  }));
  app.post('/auth/password-reset', limited('reset', 5, 3600000), asyncRoute(async (req, res) => {
    const user = store.byEmail(emailAddress(req.body.email));
    if (user?.verified_at) { const code = token(); store.emailToken(user.id, code, 'reset'); await mailer.send(user.email, code, 'reset'); }
    res.status(202).json({ status: 'email_requested' });
  }));
  app.post('/auth/password-reset/confirm', limited('reset-confirm', 10), asyncRoute(async (req, res) => {
    store.consumeEmailToken(String(req.body.token || ''), 'reset', await passwordHash(req.body.password)); res.json({ status: 'password_updated' });
  }));
  app.post('/auth/logout', auth, (req, res) => { store.logout(bearer(req)); res.clearCookie('yt_session', { path: '/' }); res.json({ ok: true }); });
  app.get('/me', auth, (req, res) => res.json(store.account(req.user.id)));
  app.post('/billing/checkout', auth, limited('checkout', 10), asyncRoute(async (req, res) => {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new AppError('BILLING_NOT_CONFIGURED', 'Abos warten auf den verifizierten Webhook.', 503);
    res.json(await billing.checkout(req.user.id));
  }));
  app.post('/billing/portal', auth, limited('portal', 10), asyncRoute(async (req, res) => res.json(await billing.portal(req.user.id))));
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
    res.json({ jobId: job.id, videoId: job.video_id, state: job.state, code: job.error_code,
      credit_released: job.state === 'failed', error: job.state === 'failed' ? 'Analyse konnte nicht sicher abgeschlossen werden. Credit freigegeben.' : null });
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
  app.use('/account/', express.static(path.join(__dirname, '../web'), { index: 'index.html' }));
  app.get('/', (req, res) => res.redirect('/account/'));
  app.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', error: 'Endpunkt nicht verfügbar.' }));
  app.use((error, req, res, next) => {
    const status = error instanceof AppError ? error.status : error.type === 'entity.too.large' ? 413 : 500;
    res.status(status).json({ code: error.code || 'REQUEST_FAILED', error: error instanceof AppError ? error.message : 'Anfrage konnte nicht abgeschlossen werden.' });
  });
  return { store, billing, jobs, dashboardFor };
}
module.exports = { installAccounts, creatorOf, profiles };
