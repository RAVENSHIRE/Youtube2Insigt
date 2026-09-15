const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { AccountStore, hash } = require('../accounts/store');
const { Mailer } = require('../accounts/auth');
const { installAccounts } = require('../accounts/routes');

const password = 'Synthetic password 123!';
const input = (overrides = {}) => ({ email: 'alice@example.test', confirmEmail: 'alice@example.test', password, confirmPassword: password, ...overrides });
async function fixture(t, { configured = true, providerStatus = 200 } = {}) {
  const state = { providerStatus, now: Date.now(), mail: [], body: { id: 'synthetic-provider-id' }, failNetwork: false };
  const store = new AccountStore(':memory:', { now: () => state.now });
  const mailer = new Mailer({ apiKey: configured ? 'synthetic-secret-never-returned' : '',
    from: 'YT Research <verify@example.test>', publicUrl: 'https://research.example.test/',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails');
      state.mail.push(JSON.parse(options.body));
      if (state.failNetwork) throw Error('Network failed with synthetic-secret-never-returned');
      return new Response(JSON.stringify(state.body), { status: state.providerStatus });
    } });
  const app = express();
  const runtime = installAccounts(app, { store, mailer, buildDashboard: async () => ({ videos: [] }) }, { PUBLIC_BASE_URL: 'https://research.example.test' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { runtime.jobs.stop(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, body, bearer) => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const link = (index = state.mail.length - 1) => new URL(state.mail[index].text.split('\n').at(-1));
  const code = (kind = 'verify', index) => new URLSearchParams(link(index).hash.slice(1)).get(kind);
  return { state, store, request, link, code, base };
}

test('registration validates all four fields, stores a pending account and sends a working verification link', async t => {
  const f = await fixture(t);
  const result = await f.request('/auth/register', input({ email: ' Alice@Example.test ' }));
  assert.equal(result.status, 202); assert.equal(result.body.emailStatus, 'accepted');
  assert.match(result.body.message, /Zustellung.*nicht bestätigt/u);
  const user = f.store.byEmail('alice@example.test');
  assert.equal(user.verified_at, null); assert.notEqual(user.password_hash, password);
  assert.equal(f.state.mail.length, 1); assert.deepEqual(f.state.mail[0].to, ['alice@example.test']);
  assert.equal(f.link().origin, 'https://research.example.test'); assert.equal(f.link().pathname, '/account/');
  assert.equal((await fetch(f.base + f.link().pathname)).status, 200);
  assert.equal(JSON.stringify(result.body).includes(f.code()), false);
  assert.equal(f.store.db.prepare('SELECT hash FROM email_tokens').get().hash, hash(f.code()));
  assert.equal((await f.request('/auth/login', { email: user.email, password })).body.code, 'EMAIL_NOT_VERIFIED');
  const verified = await f.request('/auth/verify', { token: f.code() });
  assert.equal(verified.status, 200); assert.equal(verified.body.account.analyses_available, 1);
  assert.match(verified.headers.get('set-cookie'), /HttpOnly/u);
  assert.match(verified.headers.get('set-cookie'), /SameSite=Strict/u);
  assert.equal((await f.request('/auth/logout', {}, verified.body.token)).status, 200);
  const login = await f.request('/auth/login', { email: user.email, password }); // No confirmation fields on sign-in.
  assert.equal(login.status, 200);
  assert.equal((await f.request('/me', undefined, login.body.token)).body.email, user.email);
  assert.equal((await f.request('/auth/login', { email: user.email, password: 'Wrong password 123!' })).body.code, 'LOGIN_FAILED');
});

for (const [name, fields, error] of [
  ['mismatched emails', { confirmEmail: 'bob@example.test' }, 'EMAIL_MISMATCH'],
  ['mismatched passwords', { confirmPassword: 'Different password 123!' }, 'PASSWORD_MISMATCH'],
  ['missing email confirmation', { confirmEmail: undefined }, 'EMAIL_INVALID'],
  ['missing password confirmation', { confirmPassword: undefined }, 'PASSWORD_MISMATCH'],
  ['invalid email', { email: 'not-an-email' }, 'EMAIL_INVALID'],
  ['invalid domain', { email: 'alice@-example.test' }, 'EMAIL_INVALID'],
  ['invalid local part', { email: 'alice..test@example.test' }, 'EMAIL_INVALID'],
  ['non-string email', { email: ['alice@example.test'] }, 'EMAIL_INVALID'],
  ['short password', { password: 'short', confirmPassword: 'short' }, 'PASSWORD_INVALID']
]) test(`registration rejects ${name} before writing accounts or sending mail`, async t => {
  const f = await fixture(t), result = await f.request('/auth/register', input(fields));
  assert.equal(result.status, 400); assert.equal(result.body.code, error);
  assert.equal(f.state.mail.length, 0);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
});

test('missing email configuration blocks registration and reset explicitly without pretending to send', async t => {
  const f = await fixture(t, { configured: false });
  assert.equal((await f.request('/health')).body.emailConfigured, false);
  for (const [route, body] of [['/auth/register', input()], ['/auth/password-reset', { email: input().email }]]) {
    const result = await f.request(route, body);
    assert.equal(result.status, 503); assert.equal(result.body.code, 'EMAIL_NOT_CONFIGURED');
    assert.match(result.body.error, /RESEND_API_KEY.*MAIL_FROM.*PUBLIC_BASE_URL/u);
  }
  assert.equal(f.state.mail.length, 0); assert.equal(f.store.byEmail(input().email), undefined);
});

test('rejected delivery leaves a recoverable pending account, revokes failed link and permits authenticated resend', async t => {
  const f = await fixture(t, { providerStatus: 403 });
  f.state.body = { message: 'Provider rejected synthetic-secret-never-returned' };
  const result = await f.request('/auth/register', input());
  assert.equal(result.status, 503); assert.equal(result.body.code, 'EMAIL_PROVIDER_REJECTED');
  assert.equal(JSON.stringify(result.body).includes('synthetic-secret-never-returned'), false);
  const user = f.store.byEmail(input().email); assert.equal(user.verified_at, null);
  const oldCode = f.code();
  assert.equal((await f.request('/auth/verify', { token: oldCode })).body.code, 'TOKEN_INVALID');
  assert.equal((await f.request('/auth/resend-verification', { email: user.email, password: 'Wrong password 123!' })).status, 401);
  assert.equal(f.state.mail.length, 1);
  f.state.providerStatus = 200; f.state.body = { id: 'accepted-after-configuration-fix' };
  assert.equal((await f.request('/auth/resend-verification', { email: user.email, password })).status, 202);
  assert.notEqual(f.code(), oldCode);
  assert.equal((await f.request('/auth/verify', { token: f.code() })).status, 200);
  assert.equal(f.store.byEmail(user.email).id, user.id);
  assert.equal((await f.request('/auth/login', { email: user.email, password })).status, 200);
  assert.equal((await f.request('/auth/register', input())).body.status, 'sign_in_required');
  assert.equal(f.state.mail.length, 2); // No claim of another sent email for an already verified user.
});

test('invalid, expired, wrong-purpose and replayed verification links cannot create sessions or extra credits', async t => {
  const f = await fixture(t); await f.request('/auth/register', input());
  const first = f.code();
  assert.equal((await f.request('/auth/verify', { token: 'invalid' })).body.code, 'TOKEN_INVALID');
  f.state.now += 3600001;
  assert.equal((await f.request('/auth/verify', { token: first })).body.code, 'TOKEN_INVALID');
  const user = f.store.byEmail(input().email); f.store.emailToken(user.id, 'reset-token', 'reset');
  assert.equal((await f.request('/auth/verify', { token: 'reset-token' })).body.code, 'TOKEN_INVALID');
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  await f.request('/auth/resend-verification', { email: user.email, password });
  const results = await Promise.all([f.request('/auth/verify', { token: f.code() }), f.request('/auth/verify', { token: f.code() })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM credit_grants').get().n, 1);
});

test('re-registration never silently replaces a password; pending account can recover password and then verify', async t => {
  const f = await fixture(t); await f.request('/auth/register', input());
  const oldCode = f.code(), newPassword = 'Replacement password 456!';
  assert.equal((await f.request('/auth/register', input({ password: newPassword, confirmPassword: newPassword }))).body.code, 'ACCOUNT_ACCESS_REQUIRED');
  await f.request('/auth/password-reset', { email: input().email });
  assert.equal((await f.request('/auth/password-reset/confirm', { token: f.code('reset'), password: newPassword })).status, 200);
  assert.equal((await f.request('/auth/verify', { token: oldCode })).body.code, 'TOKEN_INVALID');
  assert.equal((await f.request('/auth/login', { email: input().email, password })).status, 401);
  assert.equal((await f.request('/auth/login', { email: input().email, password: newPassword })).body.code, 'EMAIL_NOT_VERIFIED');
  await f.request('/auth/resend-verification', { email: input().email, password: newPassword });
  assert.equal((await f.request('/auth/verify', { token: f.code() })).status, 200);
  assert.equal((await f.request('/auth/login', { email: input().email, password: newPassword })).status, 200);
});

test('resends share a per-address limit with registration and keep earlier delivered links valid on failure', async t => {
  const f = await fixture(t); await f.request('/auth/register', input());
  const goodCode = f.code(); f.state.providerStatus = 429;
  for (let n = 0; n < 4; n++) assert.equal((await f.request('/auth/resend-verification', { email: input().email, password })).body.code, 'EMAIL_RATE_LIMIT');
  assert.equal((await f.request('/auth/resend-verification', { email: input().email, password })).status, 429);
  assert.equal(f.state.mail.length, 5);
  assert.equal((await f.request('/auth/verify', { token: goodCode })).status, 200);
});

test('network errors and malformed provider success responses never claim accepted delivery', async t => {
  const f = await fixture(t); f.state.failNetwork = true;
  for (const mode of ['network', 'malformed']) {
    if (mode === 'malformed') { f.state.failNetwork = false; f.state.body = {}; }
    const result = await f.request('/auth/register', input());
    assert.equal(result.status, 503); assert.equal(result.body.code, 'EMAIL_UNAVAILABLE');
    assert.equal(result.body.emailStatus, undefined);
    assert.equal(JSON.stringify(result).includes('synthetic-secret-never-returned'), false);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM email_tokens').get().n, 0);
  }
});

test('email configuration rejects unsafe links and invalid senders without network access', () => {
  const config = { apiKey: 'synthetic-key', from: 'Research <verify@example.test>', publicUrl: 'https://research.example.test' };
  assert.equal(new Mailer(config).isConfigured(), true);
  for (const changes of [{ apiKey: ' ' }, { from: 'invalid' }, { from: 'Research\r\n<verify@example.test>' },
    { publicUrl: 'http://public.example.test' }, { publicUrl: 'https://user:pass@example.test' },
    { publicUrl: 'https://example.test/incorrect/base' }, { publicUrl: 'https://example.test/#fragment' }]) {
    assert.equal(new Mailer({ ...config, ...changes }).isConfigured(), false);
  }
});
