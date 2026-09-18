const { DatabaseSync } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class AppError extends Error {
  constructor(code, message, status = 400) { super(message); Object.assign(this, { code, status }); }
}
const hash = text => createHash('sha256').update(String(text)).digest('hex');
const uid = () => randomUUID();
const parse = row => row ? JSON.parse(row.body) : null;

class AccountStore {
  constructor(filename, { now = () => Date.now(), proCredits = 20 } = {}) {
    if (!Number.isInteger(proCredits) || proCredits < 1 || proCredits > 10000) throw Error('PRO_MONTHLY_ANALYSES must be an integer from 1 to 10000.');
    if (filename !== ':memory:') {
      if (!path.isAbsolute(filename)) throw Error('ACCOUNT_DB_PATH must be absolute.');
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(filename);
    Object.assign(this, { now, proCredits });
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (this.db.prepare('PRAGMA user_version').get().user_version > 1) throw Error('Database schema is newer than this release.');
    this.transaction(() => this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        verified_at INTEGER, created_at INTEGER NOT NULL, stripe_customer TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS email_tokens (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS credit_grants (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK(amount >= 0), starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions (user_id TEXT PRIMARY KEY REFERENCES users(id), subscription_id TEXT UNIQUE,
        status TEXT NOT NULL, period_end INTEGER NOT NULL, cancel_at_period_end INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
        parent_id TEXT REFERENCES reports(id), created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS reports_video ON reports(video_id,version,created_at);
      CREATE TABLE IF NOT EXISTS library (user_id TEXT NOT NULL REFERENCES users(id), video_id TEXT NOT NULL,
        report_id TEXT NOT NULL REFERENCES reports(id), sequence INTEGER NOT NULL, added_at INTEGER NOT NULL,
        PRIMARY KEY(user_id,video_id), UNIQUE(user_id,sequence));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), video_id TEXT NOT NULL,
        version INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('reserved','complete','failed')), grant_id TEXT NOT NULL REFERENCES credit_grants(id),
        expires_at INTEGER NOT NULL, error_code TEXT, created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_active ON jobs(user_id,video_id) WHERE state='reserved';
      CREATE INDEX IF NOT EXISTS jobs_grant ON jobs(grant_id,state);
      CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, handled_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS checkout_sessions (user_id TEXT PRIMARY KEY REFERENCES users(id), session_id TEXT NOT NULL, url TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_windows (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS youtube_connections (user_id TEXT PRIMARY KEY REFERENCES users(id), encrypted_token TEXT NOT NULL, connected_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS creator_selections (user_id TEXT NOT NULL REFERENCES users(id), channel_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(user_id,channel_id));
      PRAGMA user_version=1;
    `));
    if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
  user(id) { return this.db.prepare('SELECT * FROM users WHERE id=?').get(id); }
  byEmail(email) { return this.db.prepare('SELECT * FROM users WHERE email=?').get(email); }
  createUser(email, passwordHash) {
    const id = uid();
    this.db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(id, email, passwordHash, this.now());
    return this.user(id);
  }
  emailToken(userId, token, kind = 'verify') {
    this.db.prepare('INSERT INTO email_tokens VALUES (?,?,?,?)').run(hash(token), userId, kind, this.now() + 3600000);
  }
  revokeEmailToken(token) { this.db.prepare('DELETE FROM email_tokens WHERE hash=?').run(hash(token)); }
  consumeEmailToken(token, kind, passwordHash = null) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM email_tokens WHERE hash=? AND kind=? AND expires_at>?').get(hash(token), kind, this.now());
      if (!row) throw new AppError('TOKEN_INVALID', 'Link ist abgelaufen oder bereits verwendet.');
      this.db.prepare('DELETE FROM email_tokens WHERE user_id=? AND kind=?').run(row.user_id, kind);
      if (kind === 'verify') {
        this.db.prepare('UPDATE users SET verified_at=COALESCE(verified_at,?) WHERE id=?').run(this.now(), row.user_id);
        this.db.prepare('INSERT OR IGNORE INTO credit_grants VALUES (?,?,?,?,?,?)').run(`free:${row.user_id}`, row.user_id, 'free', 1, this.now(), 8640000000000000);
      } else {
        this.db.prepare('DELETE FROM email_tokens WHERE user_id=?').run(row.user_id);
        this.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, row.user_id);
        this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
      }
      return this.user(row.user_id);
    });
  }
  addSession(userId, token) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(this.now());
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), userId, this.now() + 7 * 86400000);
  }
  session(token) {
    return this.db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>?').get(hash(token), this.now());
  }
  logout(token) { this.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token)); }
  rateLimit(key, max, milliseconds) {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM usage_windows WHERE expires_at<=?').run(this.now());
      const row = this.db.prepare('SELECT * FROM usage_windows WHERE key=?').get(key);
      if (row?.count >= max) throw new AppError('RATE_LIMIT', 'Bitte später erneut versuchen.', 429);
      this.db.prepare('INSERT INTO usage_windows VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, this.now() + milliseconds);
    });
  }
  subscription(userId) { return this.db.prepare('SELECT * FROM subscriptions WHERE user_id=?').get(userId) || null; }
  isPro(userId) {
    const sub = this.subscription(userId);
    return Boolean(sub && sub.status === 'active' && sub.period_end > this.now());
  }
  grants(userId) {
    return this.db.prepare(`SELECT g.*, g.amount-(SELECT count(*) FROM jobs j WHERE j.grant_id=g.id AND j.state IN ('reserved','complete')) AS available
      FROM credit_grants g WHERE g.user_id=? AND g.starts_at<=? AND g.expires_at>? ORDER BY g.expires_at`).all(userId, this.now(), this.now())
      .filter(grant => grant.kind === 'free' || this.isPro(userId));
  }
  account(userId) {
    this.recoverExpired();
    const grants = this.grants(userId), sub = this.subscription(userId);
    return { id: userId, email: this.user(userId).email, plan: this.isPro(userId) ? 'pro' : 'free',
      analyses_available: grants.reduce((n, g) => n + Math.max(0, g.available), 0), pro_monthly_analyses: this.proCredits,
      subscription: sub ? { status: sub.status, period_end: new Date(sub.period_end).toISOString(), cancel_at_period_end: Boolean(sub.cancel_at_period_end) } : null };
  }
  recoverExpired() {
    this.db.prepare("UPDATE jobs SET state='failed',error_code='ANALYSIS_INTERRUPTED' WHERE state='reserved' AND expires_at<=?").run(this.now());
  }
  ownReport(userId, videoId) {
    const row = this.db.prepare('SELECT r.body,l.sequence,l.added_at,l.report_id FROM library l JOIN reports r ON r.id=l.report_id WHERE l.user_id=? AND l.video_id=?').get(userId, videoId);
    if (!row) return null;
    return { ...parse(row), personal_sequence: row.sequence, saved_at: new Date(row.added_at).toISOString(), revision_id: row.report_id };
  }
  library(userId) {
    const { hasVisibilityTable } = require('./localLibraryVisibility');
    const visible = hasVisibilityTable(this.db) ? ' AND NOT EXISTS (SELECT 1 FROM local_hidden_library h WHERE h.user_id=l.user_id AND h.video_id=l.video_id)' : '';
    return this.db.prepare(`SELECT r.body,l.sequence,l.added_at,l.report_id FROM library l JOIN reports r ON r.id=l.report_id WHERE l.user_id=?${visible} ORDER BY l.sequence`).all(userId)
      .map(row => ({ ...parse(row), personal_sequence: row.sequence, saved_at: new Date(row.added_at).toISOString(), revision_id: row.report_id }));
  }
  cachedReport(videoId, version) {
    return parse(this.db.prepare('SELECT body FROM reports WHERE video_id=? AND version=? ORDER BY created_at DESC LIMIT 1').get(videoId, version));
  }
  reserve(userId, videoId, version) {
    return this.transaction(() => {
      this.recoverExpired();
      if (this.ownReport(userId, videoId)) return { state: 'complete', cached: true, videoId };
      const existing = this.db.prepare("SELECT * FROM jobs WHERE user_id=? AND video_id=? AND state='reserved'").get(userId, videoId);
      if (existing) return { ...existing, reused: true };
      const grant = this.grants(userId).find(g => g.available > 0);
      if (!grant) throw new AppError('ANALYSIS_LIMIT', 'Kein Analyse-Credit verfügbar. Gespeicherte Reports bleiben lesbar.', 402);
      const id = uid();
      this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)').run(id, userId, videoId, version, 'reserved', grant.id, this.now() + 240000, null, this.now());
      return this.job(userId, id);
    });
  }
  job(userId, id) { return this.db.prepare('SELECT * FROM jobs WHERE id=? AND user_id=?').get(id, userId); }
  complete(userId, jobId, report) {
    return this.transaction(() => {
      const job = this.job(userId, jobId);
      if (job?.state === 'complete') return this.ownReport(userId, job.video_id);
      if (!job || job.state !== 'reserved' || job.expires_at <= this.now()) throw new AppError('RESERVATION_EXPIRED', 'Reservierung abgelaufen. Credit wird freigegeben.', 409);
      if (report.video.id !== job.video_id || report.analysis_version !== job.version) throw new AppError('REPORT_IDENTITY_MISMATCH', 'Analyseidentität stimmt nicht überein.', 422);
      const body = JSON.stringify(report), id = hash(body);
      this.db.prepare('INSERT OR IGNORE INTO reports VALUES (?,?,?,?,?,?)').run(id, job.video_id, job.version, body, null, this.now());
      const sequence = this.db.prepare('SELECT COALESCE(max(sequence),0)+1 AS next FROM library WHERE user_id=?').get(userId).next;
      this.db.prepare('INSERT INTO library VALUES (?,?,?,?,?)').run(userId, job.video_id, id, sequence, this.now());
      this.db.prepare("UPDATE jobs SET state='complete' WHERE id=?").run(jobId);
      return this.ownReport(userId, job.video_id);
    });
  }
  fail(userId, jobId, code) {
    this.db.prepare("UPDATE jobs SET state='failed',error_code=? WHERE id=? AND user_id=? AND state='reserved'").run(code || 'ANALYSIS_FAILED', jobId, userId);
  }
  customer(userId, customerId) { this.db.prepare('UPDATE users SET stripe_customer=? WHERE id=?').run(customerId, userId); }
  byCustomer(customerId) { return this.db.prepare('SELECT * FROM users WHERE stripe_customer=?').get(customerId); }
  eventHandled(id) { return Boolean(this.db.prepare('SELECT 1 FROM webhook_events WHERE id=?').get(id)); }
  applyBilling(eventId, userId, subscription, grant = null) {
    return this.transaction(() => {
      if (this.eventHandled(eventId)) return false;
      this.db.prepare(`INSERT INTO subscriptions VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
        subscription_id=excluded.subscription_id,status=excluded.status,period_end=excluded.period_end,
        cancel_at_period_end=excluded.cancel_at_period_end,updated_at=excluded.updated_at`).run(userId,
        subscription.id, subscription.status, subscription.periodEnd, Number(subscription.cancelAtPeriodEnd), this.now());
      if (grant) this.db.prepare('INSERT OR IGNORE INTO credit_grants VALUES (?,?,?,?,?,?)').run(grant.id, userId, 'pro', this.proCredits, grant.start, grant.end);
      this.db.prepare('INSERT INTO webhook_events VALUES (?,?)').run(eventId, this.now());
      return true;
    });
  }
}
module.exports = { AccountStore, AppError, hash, uid };
