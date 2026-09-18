const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { validateApiBase } = require('../scripts/build-extension');
const { inspectConfiguration } = require('../scripts/release-check');
const { backupAccounts } = require('../scripts/backup-accounts');
const vm = require('node:vm');

test('release build accepts only credential-free HTTPS origins outside explicit local development', () => {
  assert.equal(validateApiBase('https://beta.example.test'), 'https://beta.example.test');
  assert.equal(validateApiBase('http://localhost:3000', true), 'http://localhost:3000');
  for (const value of ['http://beta.example.test', 'https://user:secret@example.test', 'https://example.test/?key=secret', 'https://example.test/path', 'https://localhost']) assert.throws(() => validateApiBase(value));
});
test('readiness report never confuses configured credentials with live verification or prints keys', () => {
  const missing = inspectConfiguration({}); assert.equal(missing.status, 'blocked');
  const configured = inspectConfiguration({ PUBLIC_BASE_URL: 'https://beta.example.test', ACCOUNT_DB_PATH: path.resolve('unused.sqlite'),
    EXTENSION_ORIGINS: `chrome-extension://${'a'.repeat(32)}`, GEMINI_API_KEY: 'secret-a', YOUTUBE_API_KEY: 'secret-b',
    RESEND_API_KEY: 'secret-c', MAIL_FROM: 'example@example.test', STRIPE_SECRET_KEY: 'sk_test_secret', STRIPE_PRO_PRICE_ID: 'price_fixture', STRIPE_WEBHOOK_SECRET: 'secret-d' });
  assert.equal(configured.status, 'configuration_present_verification_required');
  assert.equal(configured.stripe_mode, 'test'); assert.equal(JSON.stringify(configured).includes('secret-'), false);
});
test('a pending extension response cannot cross a personal/example scope change', async () => {
  let reply;
  const context = vm.createContext({ URL, DOMException,
    AppConfig: { apiBase: 'http://localhost:3000' },
    chrome: { storage: { session: { get: async () => ({}), remove: async () => {} } } },
    fetch: async url => String(url).endsWith('/config') ? Response.json({ accountRequired: true }) : new Promise(resolve => { reply = resolve; })
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension/api.js'), 'utf8'), context);
  await context.AppApi.ready;
  const pending = context.AppApi.fetch('http://localhost:3000/videos/TestVideo01');
  await new Promise(resolve => setImmediate(resolve));
  context.AppApi.scope = 'examples'; reply(Response.json({ title: 'Private fixture' }));
  await assert.rejects(pending, { name: 'AbortError' });
});
test('SQLite recovery backup includes WAL data and verifies integrity without overwriting the source', async t => {
  const root = path.join(__dirname, '.tmp'); fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'yt-backup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.sqlite'), destination = path.join(dir, 'recovery.sqlite');
  const db = new DatabaseSync(source);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE proof (value TEXT); INSERT INTO proof VALUES ('synthetic fixture');");
  try {
    assert.equal((await backupAccounts(source, destination)).status, 'verified_backup');
    const copy = new DatabaseSync(destination, { readOnly: true });
    try { assert.equal(copy.prepare('SELECT value FROM proof').get().value, 'synthetic fixture'); } finally { copy.close(); }
    await assert.rejects(backupAccounts(source, destination));
    assert.equal(db.prepare('SELECT count(*) AS n FROM proof').get().n, 1);
  } finally { db.close(); }
});
