const { randomBytes, createHash, createCipheriv, createDecipheriv } = require('node:crypto');
const { AppError, hash } = require('../accounts/store');
const { token } = require('../accounts/auth');
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

class YouTubeSync {
  constructor({ store, clientId, clientSecret, encryptionKey, publicUrl, fetchImpl = fetch }) {
    Object.assign(this, { store, clientId, clientSecret, publicUrl, fetchImpl });
    this.key = encryptionKey ? Buffer.from(encryptionKey, 'base64') : null;
    if (this.key && this.key.length !== 32) throw Error('APP_ENCRYPTION_KEY must encode 32 random bytes.');
    this.cache = new Map(); this.locks = new Map();
  }
  isConfigured() { return Boolean(this.clientId && this.clientSecret && this.key); }
  encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    return [iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()].map(x => x.toString('base64')).join('.');
  }
  decrypt(value) {
    const [iv, body, final, tag] = value.split('.').map(x => Buffer.from(x, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.update(final), decipher.final()]).toString());
  }
  begin(userId) {
    if (!this.isConfigured()) throw new AppError('YOUTUBE_SYNC_NOT_CONFIGURED', 'YouTube-Sync ist noch nicht verfügbar. Creator bitte manuell auswählen.', 503);
    const state = token(), verifier = token();
    this.store.db.prepare('DELETE FROM oauth_states WHERE user_id=? OR expires_at<=?').run(userId, this.store.now());
    this.store.db.prepare('INSERT INTO oauth_states VALUES (?,?,?,?)').run(hash(state), userId, verifier, this.store.now() + 600000);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key, value] of Object.entries({ client_id: this.clientId, redirect_uri: `${this.publicUrl}/youtube/callback`,
      response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })) url.searchParams.set(key, value);
    return { url: url.href, scope: SCOPE, scans_only: true, automatic_analyses: false };
  }
  async tokenRequest(values) {
    const response = await this.fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...values, client_id: this.clientId, client_secret: this.clientSecret }), signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new AppError('YOUTUBE_RECONNECT_REQUIRED', 'YouTube-Verbindung erneuern oder Creator manuell auswählen.', 503);
    if (data.scope && !data.scope.split(' ').includes(SCOPE)) throw new AppError('YOUTUBE_SCOPE_MISSING', 'Leseberechtigung wurde nicht erteilt.', 403);
    return data;
  }
  async callback(state, code, denied = false) {
    if (!this.isConfigured()) throw new AppError('YOUTUBE_SYNC_NOT_CONFIGURED', 'YouTube-Sync nicht konfiguriert.', 503);
    const pending = this.store.transaction(() => {
      const row = this.store.db.prepare("SELECT * FROM oauth_states WHERE hash=? AND expires_at>? AND verifier<>''").get(hash(state), this.store.now());
      if (!row) throw new AppError('OAUTH_STATE_INVALID', 'OAuth-Anfrage abgelaufen oder bereits verwendet.');
      this.store.db.prepare("UPDATE oauth_states SET verifier='' WHERE hash=?").run(hash(state)); return row;
    });
    if (denied || !code) throw new AppError('YOUTUBE_CONSENT_DENIED', 'Keine Verbindung hergestellt. Manuelle Auswahl bleibt verfügbar.');
    const data = await this.tokenRequest({ grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: `${this.publicUrl}/youtube/callback` });
    if (!data.refresh_token) throw new AppError('YOUTUBE_RECONNECT_REQUIRED', 'Erneute Zustimmung für die YouTube-Verbindung erforderlich.', 409);
    this.store.transaction(() => {
      const active = this.store.db.prepare('SELECT 1 FROM oauth_states WHERE hash=? AND expires_at>?').get(hash(state), this.store.now());
      if (!active) throw new AppError('OAUTH_STATE_INVALID', 'Die Verbindung wurde inzwischen getrennt.');
      this.store.db.prepare('DELETE FROM oauth_states WHERE hash=?').run(hash(state));
      this.store.db.prepare('INSERT OR REPLACE INTO youtube_connections VALUES (?,?,?)').run(pending.user_id, this.encrypt({
        access_token: data.access_token, refresh_token: data.refresh_token, expires_at: this.store.now() + Number(data.expires_in || 3600) * 1000
      }), this.store.now());
    });
    this.cache.delete(pending.user_id);
    return { connected: true };
  }
  connected(userId) { return Boolean(this.store.db.prepare('SELECT user_id FROM youtube_connections WHERE user_id=?').get(userId)); }
  async accessToken(userId) {
    const connection = this.store.db.prepare('SELECT * FROM youtube_connections WHERE user_id=?').get(userId);
    if (!connection || !this.isConfigured()) throw new AppError('YOUTUBE_NOT_CONNECTED', 'YouTube ist nicht verbunden.', 409);
    let data = this.decrypt(connection.encrypted_token);
    if (data.expires_at <= this.store.now() + 30000) {
      const refreshed = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: data.refresh_token });
      data = { ...data, access_token: refreshed.access_token, expires_at: this.store.now() + Number(refreshed.expires_in || 3600) * 1000 };
      // Disconnect during a refresh must never recreate the connection.
      this.store.db.prepare('UPDATE youtube_connections SET encrypted_token=? WHERE user_id=?').run(this.encrypt(data), userId);
      if (!this.connected(userId)) throw new AppError('YOUTUBE_NOT_CONNECTED', 'YouTube wurde getrennt.', 409);
    }
    return data.access_token;
  }
  async subscriptions(userId) {
    if (this.locks.has(userId)) return this.locks.get(userId);
    const promise = this.readSubscriptions(userId); this.locks.set(userId, promise);
    try { return await promise; } finally { this.locks.delete(userId); }
  }
  async readSubscriptions(userId) {
    if (!this.connected(userId)) throw new AppError('YOUTUBE_NOT_CONNECTED', 'YouTube ist nicht verbunden.', 409);
    const cached = this.cache.get(userId);
    if (cached && cached.expires_at > this.store.now()) return cached.result;
    const access = await this.accessToken(userId), channels = [];
    let next = null;
    for (let page = 0; page < 4; page++) {
      const url = new URL('https://www.googleapis.com/youtube/v3/subscriptions');
      url.search = new URLSearchParams({ part: 'snippet', mine: 'true', maxResults: '50', ...(next ? { pageToken: next } : {}) }).toString();
      const response = await this.fetchImpl(url, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new AppError('YOUTUBE_SYNC_UNAVAILABLE', 'Abos konnten nicht geladen werden. Manuelle Auswahl bleibt verfügbar.', 503);
      const data = await response.json();
      for (const item of data.items || []) {
        const id = item.snippet?.resourceId?.channelId;
        if (/^UC[\w-]{22}$/u.test(id || '')) channels.push({ id, name: String(item.snippet.title || '').slice(0, 200), url: `https://www.youtube.com/channel/${id}` });
      }
      next = data.nextPageToken || null; if (!next) break;
    }
    if (!this.connected(userId)) throw new AppError('YOUTUBE_NOT_CONNECTED', 'YouTube wurde getrennt.', 409);
    const result = { channels, truncated: Boolean(next), automatic_analyses: false, max_channels: 200 };
    this.cache.set(userId, { result, expires_at: this.store.now() + 300000 }); return result;
  }
  async select(userId, ids) {
    if (!Array.isArray(ids) || ids.length > 100) throw new AppError('CHANNEL_SELECTION_INVALID', 'Maximal 100 Creator auswählen.');
    const { channels } = await this.subscriptions(userId);
    const chosen = [...new Set(ids)].map(id => channels.find(channel => channel.id === id));
    if (chosen.some(channel => !channel)) throw new AppError('CHANNEL_SELECTION_INVALID', 'Nur geladene Abos auswählen.');
    this.store.transaction(() => {
      for (const channel of chosen) this.store.db.prepare('INSERT OR REPLACE INTO creator_selections VALUES (?,?,?)').run(userId, channel.id, JSON.stringify(channel));
    });
    return { selected: chosen.length, analyses_started: 0 };
  }
  async disconnect(userId) {
    const row = this.store.db.prepare('SELECT * FROM youtube_connections WHERE user_id=?').get(userId);
    this.store.db.prepare('DELETE FROM youtube_connections WHERE user_id=?').run(userId);
    this.store.db.prepare('DELETE FROM oauth_states WHERE user_id=?').run(userId);
    this.cache.delete(userId);
    let revoked = !row;
    if (row && this.key) {
      try {
        const data = this.decrypt(row.encrypted_token);
        const response = await this.fetchImpl('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: data.refresh_token }), signal: AbortSignal.timeout(10000) });
        revoked = response.ok;
      } catch { revoked = false; }
    }
    return { connected: false, google_revocation_confirmed: revoked,
      action_required: revoked ? null : 'Berechtigung zusätzlich unter myaccount.google.com/permissions entfernen.' };
  }
}
module.exports = { YouTubeSync, SCOPE };
