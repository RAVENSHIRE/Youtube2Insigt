const { randomBytes, scrypt: derive, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { AppError } = require('./store');
const scrypt = promisify(derive);
const token = () => randomBytes(32).toString('base64url');
function emailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new AppError('EMAIL_INVALID', 'Gültige E-Mail-Adresse erforderlich.');
  return email;
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
  isConfigured() { return Boolean(this.apiKey && this.from && this.publicUrl); }
  async send(email, code, kind) {
    if (!this.isConfigured()) throw new AppError('EMAIL_NOT_CONFIGURED', 'E-Mail-Versand ist noch nicht eingerichtet.', 503);
    const link = `${this.publicUrl}/account/#${kind}=${encodeURIComponent(code)}`;
    const response = await this.fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: {
      authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json'
    }, body: JSON.stringify({ from: this.from, to: [email], subject: kind === 'verify' ? 'Research-Konto bestätigen' : 'Passwort zurücksetzen',
      text: `Öffne diesen Link nur, wenn du diese Aktion angefordert hast. Er ist eine Stunde gültig:\n${link}` }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new AppError('EMAIL_UNAVAILABLE', 'E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.', 503);
  }
}
module.exports = { token, emailAddress, passwordHash, passwordMatches, bearer, authMiddleware, Mailer };
