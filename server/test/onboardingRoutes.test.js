const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { AccountStore } = require('../accounts/store');
const { installAccounts } = require('../accounts/routes');
const { createExtensions } = require('../onboarding/routes');

test('HTTP examples, manual creators, licensed-data gate and premium previews cannot expose personal records', async t => {
  const app = express(), store = new AccountStore(':memory:');
  const user = store.createUser('isolated@example.test', 'unused');
  store.emailToken(user.id, 'verify-fixture'); store.consumeEmailToken('verify-fixture', 'verify');
  store.addSession(user.id, 'synthetic-session');
  const report = { analysis_version: 8, video: { id: 'TestVideo01', title: 'PRIVATE FIXTURE', creator: 'Private creator' }, companies: [{ company: 'Innodata Inc', ticker: 'INOD' }] };
  const job = store.reserve(user.id, 'TestVideo01', 8); store.complete(user.id, job.id, report);
  const deps = { ai: null, model: 'test', youtubeMetadataService: { isConfigured: () => true,
    getChannel: async identifier => ({ id: `UC${'a'.repeat(22)}`, name: identifier, handle: identifier,
      url: `https://www.youtube.com/${identifier}`, subscriber_count: '123456', total_videos: 789 }) },
    profileToChannel: p => ({ creatorId: p.creator_id, name: p.display_name, analyzedVideos: p.analyzed_videos,
      subscriberCount: p.subscriber_count, totalVideos: p.total_videos }),
    buildDashboard: async records => ({ videos: Object.values(records).map(r => ({ id: r.video.id, performance: 'must be removed' })), companies: [] }) };
  const runtime = installAccounts(app, { ...deps, store, extend: createExtensions(deps) }, { PUBLIC_BASE_URL: 'http://localhost:3000' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { runtime.jobs.stop(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, { body, authenticated = true } = {}) {
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: {
      ...(authenticated ? { authorization: 'Bearer synthetic-session' } : {}), ...(body ? { 'content-type': 'application/json' } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const examples = await request('/examples/creators', { authenticated: false });
  assert.equal(examples.status, 200); assert.equal(examples.body.creators.length, 3);
  assert.equal(examples.body.creators.every(creator => creator.subscriberCount === '123456' && creator.totalVideos === 789), true);
  assert.equal(JSON.stringify(examples).includes('PRIVATE FIXTURE'), false);
  const ipoExample = await request('/examples/videos/J3Y_JBATcWg', { authenticated: false });
  assert.equal(ipoExample.body.companies.find(company => company.ticker === 'RKLB').tradingview_url, 'https://www.tradingview.com/symbols/NASDAQ-RKLB/');
  assert.equal(ipoExample.body.companies.find(company => company.ticker === 'ASTS').tradingview_url, 'https://www.tradingview.com/symbols/NASDAQ-ASTS/');
  const exportedExample = await fetch(base + '/examples/videos/J3Y_JBATcWg/watchlist.csv');
  assert.equal(exportedExample.status, 200);
  const exampleCsv = await exportedExample.text();
  assert.match(exampleCsv, /RKLB,/u); assert.match(exampleCsv, /ASTS,/u);
  assert.ok(!exampleCsv.includes('INOD,'));
  const headers = {authorization: 'Bearer synthetic-session'};
  const ownCsv = await fetch(base + '/videos/TestVideo01/watchlist.csv', {headers});
  assert.equal(ownCsv.status, 200); assert.match(await ownCsv.text(), /INOD,/u);
  assert.match(ownCsv.headers.get('content-disposition'), /attachment/u);
  assert.equal(ownCsv.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(base + '/videos/TestVideo01/watchlist.csv')).status, 401);
  const other = store.createUser('other@example.test','unused'); store.emailToken(other.id,'other-verify'); store.consumeEmailToken('other-verify','verify'); store.addSession(other.id,'other-session');
  assert.equal((await fetch(base + '/videos/TestVideo01/watchlist.csv', {headers:{authorization:'Bearer other-session'}})).status,404);
  const reportCsv = await fetch(base + '/videos/TestVideo01/report.csv', {headers});
  assert.equal(reportCsv.status,200); assert.match(await reportCsv.text(), /PRIVATE FIXTURE/u);
  assert.match(reportCsv.headers.get('content-disposition'), /-report.csv/u);
  assert.equal((await fetch(base + '/videos/TestVideo01/report.csv')).status,401);
  assert.equal((await fetch(base + '/videos/TestVideo01/report.csv', {headers:{authorization:'Bearer other-session'}})).status,404);
  const publicCsv = await fetch(base + '/examples/videos/J3Y_JBATcWg/report.csv');
  assert.equal(publicCsv.status,200); const publicCsvText = await publicCsv.text();
  assert.match(publicCsvText,/RKLB/u); assert.ok(!publicCsvText.includes('PRIVATE FIXTURE'));
  assert.equal(store.account(user.id).analyses_available, 0);
  const landing = await fetch(base + '/'); assert.equal(landing.status,200);
  assert.match(await landing.text(), /Video gesehen/u);
  assert.equal((await fetch(base + '/account/')).status,200);
  assert.equal((await request('/examples/videos/TestVideo01', { authenticated: false })).status, 404);
  assert.equal((await request('/videos/TestVideo01', { authenticated: false })).status, 401);
  assert.equal((await request('/videos/TestVideo01')).body.companies[0].tradingview_url, 'https://www.tradingview.com/symbols/NASDAQ-INOD/');
  assert.equal(store.ownReport(user.id, 'TestVideo01').companies[0].tradingview_url, undefined);
  assert.equal((await request('/dashboard')).body.videos[0].performance, undefined);
  assert.equal((await request('/videos/TestVideo01/companies/0/outcome')).body.code, 'MARKET_DATA_LICENSE_REQUIRED');
  assert.equal((await request('/premium/previews')).body.available_records, 0);
  assert.equal((await request('/premium/videos/TestVideo01')).status, 403);
  const selected = await request('/onboarding/creators', { body: { channel: '@ManualCreator' } });
  assert.equal(selected.body.analyses_started, 0);
  assert.equal((await request('/creators')).body.creators.some(c => c.name === '@ManualCreator' && c.analyzedVideos === 0), true);
  assert.equal((await request('/youtube/connect', { body: {} })).body.code, 'CONSENT_REQUIRED');
  assert.equal((await request('/youtube/status')).body.configured, false);
  assert.equal((await request('/billing/checkout', { body: {} })).body.code, 'BILLING_NOT_CONFIGURED');
  assert.equal((await request('/config', { authenticated: false })).body.billingAvailable, false);
  assert.equal((await request('/research/ask', { body: { question: 'Which risks are documented?' } })).body.insufficient_evidence, true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM jobs').get().n, 1);
});
