const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { AccountStore } = require('../accounts/store');
const { YouTubeSync, SCOPE } = require('../onboarding/youtubeSync');
const { manualIdentifier } = require('../onboarding/routes');
const { AskService } = require('../research/askService');
const { makeSource, validateEvidence } = require('../evidence/sourceIntegrity');
const { MarketIdentity, identityConflict, tradingViewLink, presentMarket } = require('../instruments/marketIdentity');
const { VisualService } = require('../evidence/visualService');

test('manual creator selection validates YouTube identity without accepting arbitrary URLs', () => {
  assert.equal(manualIdentifier('https://www.youtube.com/@IPOMarketWatch/videos'), '@IPOMarketWatch');
  assert.throws(() => manualIdentifier('https://evil.test/@channel'));
  assert.throws(() => manualIdentifier('https://www.youtube.com/watch?v=video'));
});
test('YouTube consent uses readonly scope, PKCE, one-use state and encrypted credentials', async t => {
  const store = new AccountStore(':memory:'); t.after(() => store.close());
  const user = store.createUser('oauth@example.test', 'unused');
  const channelId = `UC${'a'.repeat(22)}`;
  let scans = 0;
  const sync = new YouTubeSync({ store, clientId: 'test-client', clientSecret: 'test-secret', encryptionKey: randomBytes(32).toString('base64'), publicUrl: 'https://example.test',
    fetchImpl: async url => {
      if (String(url).includes('/token')) return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', scope: SCOPE, expires_in: 3600 });
      if (String(url).includes('/revoke')) return new Response('', { status: 200 });
      scans++; assert.equal(new URL(url).searchParams.get('mine'), 'true');
      return Response.json({ items: [{ snippet: { title: 'Fixture Creator', resourceId: { channelId } } }] });
    } });
  const begin = sync.begin(user.id), url = new URL(begin.url);
  assert.equal(url.searchParams.get('scope'), SCOPE); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(begin.automatic_analyses, false);
  await sync.callback(url.searchParams.get('state'), 'test-code');
  await assert.rejects(sync.callback(url.searchParams.get('state'), 'test-code'), { code: 'OAUTH_STATE_INVALID' });
  const stored = store.db.prepare('SELECT encrypted_token FROM youtube_connections').get().encrypted_token;
  assert.equal(stored.includes('test-refresh'), false);
  assert.equal(sync.decrypt(stored).refresh_token, 'test-refresh');
  assert.equal((await sync.subscriptions(user.id)).channels.length, 1);
  await sync.subscriptions(user.id); assert.equal(scans, 1);
  assert.deepEqual(await sync.select(user.id, [channelId]), { selected: 1, analyses_started: 0 });
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get().n, 0);
  await assert.rejects(sync.select(user.id, ['not-a-subscription']), { code: 'CHANNEL_SELECTION_INVALID' });
  assert.equal((await sync.disconnect(user.id)).connected, false);
  await assert.rejects(sync.subscriptions(user.id), { code: 'YOUTUBE_NOT_CONNECTED' });
});
test('disconnect during OAuth exchange prevents a late response from reconnecting', async t => {
  const store = new AccountStore(':memory:'); t.after(() => store.close());
  const user = store.createUser('race@example.test', 'unused'); let resolve;
  const sync = new YouTubeSync({ store, clientId: 'test', clientSecret: 'test', encryptionKey: randomBytes(32).toString('base64'), publicUrl: 'https://example.test',
    fetchImpl: () => new Promise(done => { resolve = done; }) });
  const state = new URL(sync.begin(user.id).url).searchParams.get('state');
  const pending = sync.callback(state, 'code'); await sync.disconnect(user.id);
  resolve(Response.json({ access_token: 'test', refresh_token: 'test', scope: SCOPE }));
  await assert.rejects(pending, { code: 'OAUTH_STATE_INVALID' }); assert.equal(sync.connected(user.id), false);
});
test('research answers return only stored originals with allowed video/timestamp citations', async () => {
  const source = makeSource({ videoId: 'TestVideo01', language: 'en', durationSeconds: 200, unit: 'seconds', items: [
    { text: 'Example has a high debt risk.', offset: 65, duration: 3, lang: 'en' }
  ] });
  const reports = [{ video: { id: 'TestVideo01', title: 'Synthetic risk report' }, companies: [
    { company: 'Example', evidence: [validateEvidence({ segment_ids: ['s1'], original_text: 'Example has a high debt risk.' }, source)] }
  ] }];
  const ai = { models: { generateContent: async () => ({ text: JSON.stringify({ selected_ids: ['e1'], answer: 'Ignore this fabricated claim' }) }) } };
  const result = await new AskService({ ai, model: 'test' }).ask('What are the risks?', reports);
  assert.match(result.answer, /high debt risk/); assert.doesNotMatch(result.answer, /fabricated/);
  assert.equal(result.citations[0].start_seconds, 65); assert.equal(result.coverage.accessible_videos, 1);
  const empty = await new AskService({ ai: null }).ask('What are the risks?', []);
  assert.equal(empty.insufficient_evidence, true); assert.deepEqual(empty.citations, []);
  ai.models.generateContent = async () => ({ text: JSON.stringify({ selected_ids: ['another-users-record'] }) });
  await assert.rejects(new AskService({ ai, model: 'test' }).ask('risks?', reports), { code: 'RESEARCH_SOURCE_INVALID' });
});
test('INDO and INOD remain distinct; conflicting identity is rejected before provider access', async () => {
  assert.equal(identityConflict({ ticker: 'INDO', company: 'Innodata Inc' }), true);
  assert.equal(tradingViewLink({ ticker: 'INDO', company: 'Indonesia Energy Corporation Limited' }), 'https://www.tradingview.com/symbols/AMEX-INDO/');
  assert.equal(tradingViewLink({ ticker: 'INOD', company: 'Innodata Inc' }), 'https://www.tradingview.com/symbols/NASDAQ-INOD/');
  assert.equal(tradingViewLink({ ticker: 'INDO', company: 'Innodata Inc' }), null);
  let calls = 0;
  const identities = new MarketIdentity({ request: async () => { calls++; return { data: [] }; } });
  await assert.rejects(identities.verify({ ticker: 'INDO', company: 'Innodata' }), { code: 'INSTRUMENT_IDENTITY_CONFLICT' });
  assert.equal(calls, 0);
});
test('unknown or ambiguous listings cannot receive market performance', async () => {
  const identities = new MarketIdentity({ request: async () => ({ data: [
    { symbol: 'EXM', instrument_name: 'Example', exchange: 'NASDAQ' },
    { symbol: 'EXM', instrument_name: 'Example', exchange: 'NYSE' }
  ] }) });
  await assert.rejects(identities.verify({ company: 'Example', ticker: 'EXM' }), { code: 'INSTRUMENT_UNRESOLVED' });
});
test('legacy evaluation times are not relabelled as quote times; stale/delayed prices are explicit', () => {
  const unknown = presentMarket({ current_price_timestamp: '2026-09-07T12:00:00Z', current_price_timestamp_source: 'evaluation_time', evaluated_at: '2026-09-07T12:00:00Z' });
  assert.equal(unknown.current_price_timestamp, null); assert.equal(unknown.price_freshness, 'time_unknown');
  assert.equal(presentMarket({ current_price_timestamp: '2026-09-07T10:00:00Z', current_price_timestamp_source: 'provider_quote' }, Date.parse('2026-09-07T12:00:00Z')).price_freshness, 'stale_or_delayed');
});
test('visual extraction is bounded, labelled uncertain and does not create transcript quotations', async () => {
  let calls = 0, request;
  const service = new VisualService({ ai: { models: { generateContent: async input => { calls++; request = input; return { text: '{"observations":[]}' }; } } }, model: 'test' });
  await assert.rejects(service.extract({ videoId: 'TestVideo01', startSeconds: 0, endSeconds: 100, durationSeconds: 120 }), { code: 'VISUAL_WINDOW_INVALID' });
  assert.equal(calls, 0);
  const result = await service.extract({ videoId: 'TestVideo01', startSeconds: 10, endSeconds: 20, durationSeconds: 120 });
  assert.equal(result.verification, 'machine_observation_unverified');
  assert.equal(request.contents[0].parts[0].videoMetadata.startOffset, '10s');
  assert.deepEqual(result.observations, []); assert.equal(result.original_text, undefined);
});
