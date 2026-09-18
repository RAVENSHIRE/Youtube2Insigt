const { randomBytes, scrypt: derive, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { AppError } = require('./store');
const scrypt = promisify(derive);
const token = () => randomBytes(32).toString('base64url');
function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const [local, domain] = email.split('@');
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/u.test(email) ||
    local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
    domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
    throw new AppError('EMAIL_INVALID', 'Gültige E-Mail-Adresse erforderlich.');
  }
  return email;
}
function registrationInput(body = {}) {
  if (!body || typeof body !== 'object') throw new AppError('EMAIL_INVALID', 'Gültige E-Mail-Adresse erforderlich.');
  const email = emailAddress(body.email);
  if (emailAddress(body.confirmEmail) !== email) throw new AppError('EMAIL_MISMATCH', 'Die E-Mail-Adressen stimmen nicht überein.');
  if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
    throw new AppError('PASSWORD_INVALID', 'Passwort: 12 bis 128 Zeichen.');
  }
  if (body.password !== body.confirmPassword) throw new AppError('PASSWORD_MISMATCH', 'Die Passwörter stimmen nicht überein.');
  return { email, password: body.password };
}
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new AppError('PASSWORD_INVALID', 'Passwort: 12 bis 128 Zeichen.');
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${key.toString('hex')}`;
}
async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) return false;
  const [salt, expected] = (stored || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const candidate = (await passwordHash(password, salt)).split(':')[1];
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'));
}
function bearer(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('yt_session='));
  return cookie ? cookie.slice('yt_session='.length) : '';
}
function authMiddleware(store) {
  return (req, res, next) => {
    const user = store.session(bearer(req));
    if (!user?.verified_at) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Bitte anmelden.' });
    req.user = user; next();
  };
}
class Mailer {
  constructor({ apiKey, from, publicUrl, fetchImpl = fetch } = {}) { Object.assign(this, { apiKey, from, publicUrl, fetchImpl }); }
  isConfigured() {
    try {
      const url = new URL(this.publicUrl);
      const sender = String(this.from || '').trim();
      emailAddress(sender.match(/^[^<>\r\n]+<([^<>]+)>$/u)?.[1] || sender);
      return Boolean(typeof this.apiKey === 'string' && this.apiKey.trim() && !/[\r\n]/u.test(sender) &&
        (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
        !url.username && !url.password && !url.search && !url.hash && url.pathname === '/');
    } catch { return false; }
  }
  async send(email, code, kind) {
    if (!this.isConfigured()) throw new AppError('EMAIL_NOT_CONFIGURED', 'E-Mail-Versand nicht eingerichtet. Betreiber: RESEND_API_KEY, MAIL_FROM und PUBLIC_BASE_URL prüfen.', 503);
    const link = `${new URL(this.publicUrl).origin}/account/#${kind}=${encodeURIComponent(code)}`;
    let response;
    try { response = await this.fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: {
      authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json'
    }, body: JSON.stringify({ from: this.from, to: [email], subject: kind === 'verify' ? 'Research-Konto bestätigen' : 'Passwort zurücksetzen',
      text: `Öffne diesen Link nur, wenn du diese Aktion angefordert hast. Er ist eine Stunde gültig:\n${link}` }), signal: AbortSignal.timeout(15000) });
    } catch {
      throw new AppError('EMAIL_UNAVAILABLE', 'E-Mail-Versand nicht bestätigt: Anbieter nicht erreichbar. Bitte später einen neuen Link anfordern.', 503);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError('EMAIL_PROVIDER_REJECTED', 'E-Mail-Anbieter lehnt den Versand ab. Betreiber: Resend-Schlüssel, Versandberechtigung und verifizierte Absenderdomain prüfen; Test-Absender erlauben nicht jeden Empfänger.', 503);
    }
    if (response.status === 429) throw new AppError('EMAIL_RATE_LIMIT', 'Versandlimit erreicht. Bitte später einen neuen Link anfordern.', 503);
    if (!response.ok) throw new AppError('EMAIL_UNAVAILABLE', 'E-Mail-Versand nicht bestätigt. Betreiber: Versandfehler im Resend-Dashboard prüfen.', 503);
    const result = await response.json().catch(() => null);
    if (typeof result?.id !== 'string' || !result.id.trim() || result.error) {
      throw new AppError('EMAIL_UNAVAILABLE', 'E-Mail-Anbieter hat den Versand nicht bestätigt. Bitte später einen neuen Link anfordern.', 503);
    }
    // Acceptance by the provider is not proof of inbox delivery.
    return { status: 'accepted', id: result.id };
  }
}
module.exports = { token, emailAddress, registrationInput, passwordHash, passwordMatches, bearer, authMiddleware, Mailer };
