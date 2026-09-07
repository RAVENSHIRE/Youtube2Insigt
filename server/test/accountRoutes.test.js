const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { AccountStore } = require('../accounts/store');
const { installAccounts } = require('../accounts/routes');

test('HTTP onboarding: two accounts, explicit consumption, free limit, isolation and rereads', async t => {
  const app = express(), store = new AccountStore(':memory:');
  const mail = [];
  const runtime = installAccounts(app, { store, mailer: { isConfigured: () => true, send: async (email, code, kind) => mail.push({ email, code, kind }) },
    analyze: async ({ videoId }) => ({ analysis_version: 8, video: { id: videoId, title: 'Synthetic HTTP fixture', creator: 'Test' }, companies: [] }),
    analysisConfigured: true, profileToChannel: p => ({ creatorId: p.creator_id, analyzedVideos: p.analyzed_videos }),
    buildDashboard: async videos => ({ videos: Object.values(videos).map(r => ({ id: r.video.id })) })
  }, { PUBLIC_BASE_URL: 'http://localhost:3000' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { runtime.jobs.stop(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(endpoint, body, token) {
    const response = await fetch(base + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function onboard(email) {
    assert.equal((await request('/auth/register', { email, password: 'a sufficiently long password' })).status, 202);
    return (await request('/auth/verify', { token: mail.find(item => item.email === email).code })).body.token;
  }
  const alice = await onboard('alice@example.test'), bob = await onboard('bob@example.test');
  assert.equal((await request('/dashboard', undefined, bob)).body.videos.length, 0);
  assert.equal((await request('/analyze', { videoId: 'TestVideo01' }, alice)).body.code, 'CREDIT_CONFIRMATION_REQUIRED');
  const first = await request('/analyze', { videoId: 'TestVideo01', confirmCredit: true }, alice);
  assert.equal(first.status, 202);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request(`/analysis-jobs/${first.body.jobId}`, undefined, alice)).body.state, 'complete');
  assert.equal((await request(`/analysis-jobs/${first.body.jobId}`, undefined, bob)).status, 404);
  assert.equal((await request('/videos/TestVideo01', undefined, bob)).status, 404);
  assert.equal((await request('/videos/TestVideo01')).status, 401);
  assert.equal((await request('/videos/TestVideo01', undefined, alice)).status, 200);
  assert.equal((await request('/me', undefined, alice)).body.analyses_available, 0);
  assert.equal((await request('/analyze', { videoId: 'TestVideo02', confirmCredit: true }, alice)).status, 402);
  assert.equal((await request('/analyze', { videoId: 'TestVideo01', confirmCredit: true }, alice)).body.credits_consumed, 0);
  assert.equal((await request('/me', undefined, bob)).body.analyses_available, 1);
  assert.equal((await fetch(base + '/account/')).status, 200);
  const hostile = await fetch(base + '/me', { headers: { origin: 'https://evil.test', authorization: `Bearer ${alice}` } });
  assert.equal(hostile.status, 403);
  const forgedWebhook = await request('/billing/webhook', { type: 'invoice.paid' });
  assert.equal(forgedWebhook.status, 503); // no webhook secret configured, no grants
  assert.equal((await request('/market-snapshots/arbitrary', undefined, alice)).status, 404);
});
