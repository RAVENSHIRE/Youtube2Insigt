const fs = require('node:fs');
const { AppError } = require('../accounts/store');
const { creatorOf, profiles } = require('../accounts/routes');
const { YouTubeSync } = require('./youtubeSync');
const { AskService } = require('../research/askService');
const { VisualService } = require('../evidence/visualService');
const { MarketIdentity, presentMarket } = require('../instruments/marketIdentity');
const { projectResearchForRead } = require('../instruments/instrumentProjection');
const examples = require('../examples/reviewed-excerpts.json');

function manualIdentifier(value) {
  let input = String(value || '').trim();
  if (input.startsWith('https://')) {
    const url = new URL(input);
    if (!['youtube.com', 'www.youtube.com'].includes(url.hostname)) throw new AppError('CHANNEL_INVALID', 'Nur YouTube-Kanäle sind erlaubt.');
    input = url.pathname.replace(/\/(videos|featured|streams|shorts)\/?$/u, '').replace(/^\/channel\//u, '').replace(/^\//u, '').replace(/\/$/u, '');
  }
  if (!/^UC[\w-]{22}$/u.test(input) && !/^@[\p{L}\p{N}_.-]{3,60}$/u.test(input)) throw new AppError('CHANNEL_INVALID', 'Eine /channel/UC…-URL oder ein @Handle eingeben.');
  return input;
}
function loadPremium(filename) {
  if (!filename) return [];
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  return (data.records || []).filter(record => record.rights_confirmed === true && record.source_reviewed === true &&
    record.report?.evidence_version === 1 && record.report?.source?.sha256 && record.report.video?.id);
}
function createExtensions(deps) {
  return ({ app, store, auth, limited, asyncRoute, env, publicUrl }) => {
    const sync = new YouTubeSync({ store, clientId: env.YOUTUBE_OAUTH_CLIENT_ID, clientSecret: env.YOUTUBE_OAUTH_CLIENT_SECRET,
      encryptionKey: env.APP_ENCRYPTION_KEY, publicUrl });
    const research = new AskService({ ai: deps.ai, model: deps.model });
    const visual = deps.ai ? new VisualService({ ai: deps.ai, model: deps.model }) : null;
    const identities = new MarketIdentity(deps.snapshotProvider);
    const premium = loadPremium(env.PREMIUM_CORPUS_PATH);
    const exampleProfiles = profiles(examples.reports);
    const requirePro = (req, res, next) => store.isPro(req.user.id) ? next() : next(new AppError('PRO_REQUIRED', 'Diese Funktion benötigt Pro.', 403));
    app.get('/examples/creators', (req, res) => res.json({ creators: exampleProfiles.map(deps.profileToChannel), review: examples.review, personal: false }));
    app.get('/examples/creators/resolve', (req, res, next) => {
      const profile = exampleProfiles.find(p => (req.query.handle && String(p.handle).toLowerCase() === req.query.handle.toLowerCase()) ||
        (req.query.channelUrl && p.channel_url === req.query.channelUrl));
      if (!profile) return next(new AppError('CREATOR_NOT_FOUND', 'Creator nicht in den Beispielen.', 404));
      res.json({ creator: deps.profileToChannel(profile) });
    });
    app.get('/examples/creators/:creatorId/dashboard', asyncRoute(async (req, res) => {
      const profile = exampleProfiles.find(p => p.creator_id === req.params.creatorId);
      if (!profile) throw new AppError('CREATOR_NOT_FOUND', 'Creator nicht in den Beispielen.', 404);
      const reports = examples.reports.filter(r => creatorOf(r).creator_id === req.params.creatorId);
      const dashboard = await deps.buildDashboard(Object.fromEntries(reports.map(r => [r.video.id, r])), profile);
      dashboard.videos.forEach(video => { delete video.performance; });
      res.json({ ...dashboard, example: true, review: examples.review });
    }));
    app.get('/examples/videos/:videoId', (req, res, next) => {
      const report = examples.reports.find(r => r.video.id === req.params.videoId);
      if (!report) return next(new AppError('VIDEO_NOT_FOUND', 'Video nicht in den Beispielen.', 404));
      res.json({ ...projectResearchForRead(report), example: true, review: examples.review });
    });
    app.get('/premium/previews', auth, (req, res) => res.json({ available_records: premium.length,
      status: premium.length ? 'available' : 'no_reviewed_corpus_configured',
      records: premium.map(record => ({ video_id: record.report.video.id, title: record.report.video.title,
        creator: record.report.video.creator, published_at: record.report.video.published_at, locked: !store.isPro(req.user.id) })) }));
    app.get('/premium/videos/:videoId', auth, requirePro, (req, res, next) => {
      const record = premium.find(item => item.report.video.id === req.params.videoId);
      if (!record) return next(new AppError('VIDEO_NOT_FOUND', 'Report nicht verfügbar.', 404));
      res.json(projectResearchForRead(record.report));
    });
    app.post('/research/ask', auth, limited('ask-library', 20, 86400000), asyncRoute(async (req, res) => {
      const reports = req.body.scope === 'examples' ? examples.reports : store.library(req.user.id);
      res.json(await research.ask(req.body.question, reports));
    }));
    app.post('/onboarding/creators', auth, limited('manual-creator', 50, 86400000), asyncRoute(async (req, res) => {
      const identifier = manualIdentifier(req.body.channel);
      let channel;
      if (deps.youtubeMetadataService.isConfigured()) channel = await deps.youtubeMetadataService.getChannel(identifier);
      else channel = { id: identifier, handle: identifier.startsWith('@') ? identifier : null, name: identifier,
        url: `https://www.youtube.com/${identifier.startsWith('@') ? identifier : `channel/${identifier}`}`, metadata_status: 'unresolved' };
      store.db.prepare('INSERT OR REPLACE INTO creator_selections VALUES (?,?,?)').run(req.user.id, channel.id, JSON.stringify(channel));
      res.json({ creator: channel, analyses_started: 0 });
    }));
    app.post('/youtube/connect', auth, limited('youtube-connect', 10), (req, res, next) => {
      if (req.body.consent !== true) return next(new AppError('CONSENT_REQUIRED', 'Zustimmung zum schreibgeschützten Aboscan erforderlich.'));
      try { res.json(sync.begin(req.user.id)); } catch (error) { next(error); }
    });
    app.get('/youtube/callback', asyncRoute(async (req, res) => {
      await sync.callback(String(req.query.state || ''), String(req.query.code || ''), Boolean(req.query.error));
      res.redirect('/account/?youtube=connected');
    }));
    app.get('/youtube/status', auth, (req, res) => res.json({ connected: sync.connected(req.user.id), configured: sync.isConfigured(),
      approval: env.YOUTUBE_OAUTH_APPROVAL_CONFIRMED === 'true' ? 'operator_confirmed' : 'not_verified', automatic_analyses: false }));
    app.get('/youtube/subscriptions', auth, limited('subscription-scan', 15), asyncRoute(async (req, res) => res.json(await sync.subscriptions(req.user.id))));
    app.post('/youtube/select', auth, asyncRoute(async (req, res) => res.json(await sync.select(req.user.id, req.body.channelIds))));
    app.post('/youtube/disconnect', auth, asyncRoute(async (req, res) => res.json(await sync.disconnect(req.user.id))));
    app.post('/videos/:videoId/visual-evidence', auth, requirePro, limited('visual-evidence', 3, 86400000), asyncRoute(async (req, res) => {
      const report = store.ownReport(req.user.id, req.params.videoId);
      if (!report) throw new AppError('VIDEO_NOT_FOUND', 'Video nicht in deiner Bibliothek.', 404);
      if (req.body.confirmVisual !== true) throw new AppError('VISUAL_CONFIRMATION_REQUIRED', 'Visuelle Prüfung ausdrücklich bestätigen.');
      if (!visual || env.ENABLE_VISUAL_EXTRACTION !== 'true') throw new AppError('VISUAL_NOT_CONFIGURED', 'Visuelle Extraktion noch nicht freigeschaltet.', 503);
      const duration = report.source?.duration_seconds || (await deps.youtubeMetadataService.getVideo(req.params.videoId)).durationSeconds;
      const result = await visual.extract({ videoId: req.params.videoId, startSeconds: req.body.startSeconds, endSeconds: req.body.endSeconds,
        durationSeconds: duration, language: report.report_language || 'de', signal: AbortSignal.timeout(45000) });
      store.db.exec('CREATE TABLE IF NOT EXISTS visual_evidence (user_id TEXT, video_id TEXT, body TEXT, created_at INTEGER)');
      store.db.prepare('INSERT INTO visual_evidence VALUES (?,?,?,?)').run(req.user.id, req.params.videoId, JSON.stringify(result), store.now());
      res.json({ ...result, analysis_credits_consumed: 0 });
    }));
    app.get('/videos/:videoId/companies/:companyIndex/outcome', auth, asyncRoute(async (req, res) => {
      const report = store.ownReport(req.user.id, req.params.videoId);
      if (!report) throw new AppError('VIDEO_NOT_FOUND', 'Video nicht in deiner Bibliothek.', 404);
      if (env.COMMERCIAL_MARKET_DATA_APPROVED !== 'true') throw new AppError('MARKET_DATA_LICENSE_REQUIRED', 'Kommerzielle Marktdaten sind bis zur Rechtefreigabe deaktiviert.', 403);
      if (!store.isPro(req.user.id)) throw new AppError('PRO_REQUIRED', 'Marktdaten benötigen Pro.', 403);
      if (!deps.outcomeService) throw new AppError('MARKET_NOT_CONFIGURED', 'Marktdaten nicht konfiguriert.', 503);
      const index = Number(req.params.companyIndex), company = report.companies?.[index];
      if (!Number.isInteger(index) || !company) throw new AppError('COMPANY_NOT_FOUND', 'Unternehmen nicht gefunden.', 404);
      try {
        await identities.verify(company);
        const candidate = deps.resolveSnapshotCandidate({ [req.params.videoId]: report }, { videoId: req.params.videoId, companyIndex: index });
        const outcome = await deps.outcomeService.evaluate({ videoId: req.params.videoId, candidate,
          classification: require('../classification/callClassification').classifyCall(company) });
        res.json(presentMarket(outcome));
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(error.code || 'MARKET_UNAVAILABLE', 'Marktdaten derzeit nicht verfügbar. Kein Analyse-Credit verbraucht.', error.status === 429 ? 429 : 503);
      }
    }));
  };
}
module.exports = { createExtensions, manualIdentifier, loadPremium };
