const byId = id => document.getElementById(id);
const message = (text, error = false) => { byId('message').textContent = text; byId('message').classList.toggle('error', error); };
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let resetToken = null;
async function request(url, body) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Anfrage fehlgeschlagen.'), { status: response.status });
  return data;
}
const run = callback => async event => { event?.preventDefault(); try { await callback(); } catch (error) { message(error.message, true); } };
async function refresh() {
  let account;
  try { account = await request('/me'); } catch (error) {
    if (error.status !== 401) throw error;
    byId('auth').hidden = false; byId('accountPanel').hidden = true; return;
  }
  byId('auth').hidden = true; byId('accountPanel').hidden = false;
  byId('identity').textContent = account.email;
  byId('plan').textContent = account.plan === 'pro' ? 'Pro' : 'Free';
  byId('credits').textContent = account.analyses_available;
  byId('subscription').textContent = account.subscription ? `Status: ${account.subscription.status} · Laufzeit bis ${new Date(account.subscription.period_end).toLocaleDateString('de-CH')}${account.subscription.cancel_at_period_end ? ' · Kündigung vorgemerkt' : ''}` : 'Kein laufendes Abo.';
  byId('proDescription').textContent = `Pro: ${account.pro_monthly_analyses} Analysen pro bezahltem Monat. Preis und Abrechnung werden vor dem Kauf in Stripe Checkout bestätigt.`;
  const data = await request('/dashboard');
  byId('libraryCount').textContent = `· ${data.videos.length}`;
  byId('personalLibrary').innerHTML = data.videos.length ? data.videos.map(video => `<article class="library-entry"><small>Report ${video.analysisSequence}</small><h3><a target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}">${safe(video.title)}</a></h3><p>${safe(video.summary)}</p></article>`).join('') : '<p>Deine persönliche Bibliothek startet leer. Nur bewusst gespeicherte Analysen erscheinen hier.</p>';
}
byId('authForm').addEventListener('submit', run(async () => { await request('/auth/login', { email: byId('email').value, password: byId('password').value }); byId('password').value = ''; message('Angemeldet.'); await refresh(); }));
function registrationMode(enabled) {
  byId('authForm').hidden = enabled; byId('registerForm').hidden = !enabled;
  for (const id of ['password', 'registerPassword', 'confirmPassword']) byId(id).value = '';
  byId(enabled ? 'registerEmail' : 'email').focus();
}
byId('register').addEventListener('click', () => {
  byId('registerEmail').value = byId('email').value;
  registrationMode(true); message('');
});
byId('backToLogin').addEventListener('click', () => { registrationMode(false); message(''); });
byId('registerForm').addEventListener('submit', run(async () => {
  if (byId('submitRegistration').disabled || !byId('registerForm').reportValidity()) return;
  const email = byId('registerEmail').value.trim().toLowerCase();
  const confirmEmail = byId('confirmEmail').value.trim().toLowerCase();
  const password = byId('registerPassword').value, confirmPassword = byId('confirmPassword').value;
  if (email !== confirmEmail) throw Error('Die E-Mail-Adressen stimmen nicht überein.');
  if (password !== confirmPassword) throw Error('Die Passwörter stimmen nicht überein.');
  byId('submitRegistration').disabled = true;
  try {
    const result = await request('/auth/register', { email, confirmEmail, password, confirmPassword });
    byId('email').value = email; registrationMode(false); message(result.message);
  } finally { byId('submitRegistration').disabled = false; }
}));
byId('resendVerification').addEventListener('click', run(async () => {
  if (byId('resendVerification').disabled || !byId('authForm').reportValidity()) return;
  byId('resendVerification').disabled = true;
  try { message((await request('/auth/resend-verification', { email: byId('email').value, password: byId('password').value })).message); }
  finally { byId('resendVerification').disabled = false; }
}));
byId('reset').addEventListener('click', run(async () => { message((await request('/auth/password-reset', { email: byId('email').value })).message); }));
byId('resetForm').addEventListener('submit', run(async () => { await request('/auth/password-reset/confirm', { token: resetToken, password: byId('newPassword').value }); resetToken = null; byId('newPassword').value = ''; byId('resetPanel').hidden = true; message('Passwort geändert. Bitte anmelden.'); await refresh(); }));
byId('logout').addEventListener('click', run(async () => { await request('/auth/logout', {}); message('Abgemeldet.'); await refresh(); }));
function redirectBilling(url) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(target.hostname)) throw Error('Unerwartete Zahlungsadresse.');
  location.assign(target.href);
}
byId('checkout').addEventListener('click', run(async () => redirectBilling((await request('/billing/checkout', {})).url)));
byId('portal').addEventListener('click', run(async () => redirectBilling((await request('/billing/portal', {})).url)));
byId('analysisForm').addEventListener('submit', run(async () => {
  const url = new URL(byId('videoUrl').value), videoId = url.searchParams.get('v');
  if (!['www.youtube.com', 'youtube.com'].includes(url.hostname) || !/^[\w-]{11}$/.test(videoId || '')) throw Error('Eine vollständige YouTube-Video-URL eingeben.');
  byId('analyze').disabled = true;
  try {
    let job = await request('/analyze', { videoId, confirmCredit: true });
    const deadline = Date.now() + 250000;
    while (job.state === 'reserved' && Date.now() < deadline) {
      message('Analyse läuft. Eine Analyse reserviert; bei Fehler erfolgt die Freigabe.');
      await new Promise(resolve => setTimeout(resolve, 1500)); job = await request(`/analysis-jobs/${encodeURIComponent(job.jobId)}`);
    }
    message(job.state === 'complete' ? 'Report gespeichert.' : job.error || 'Auftrag läuft noch. Später aktualisieren.', job.state === 'failed');
    await refresh();
  } finally { byId('analyze').disabled = false; }
}));
(async () => {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const verification = fragment.get('verify'); resetToken = fragment.get('reset');
  if (verification || resetToken) history.replaceState(null, '', location.pathname);
  if (verification) { await request('/auth/verify', { token: verification }); message('E-Mail bestätigt. Deine kostenlose Analyse ist verfügbar.'); }
  if (resetToken) byId('resetPanel').hidden = false;
  await refresh();
})().catch(error => message(error.message, true));
