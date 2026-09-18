const byId = id => document.getElementById(id);
const message = (text, error = false) => { byId('message').textContent = text; byId('message').classList.toggle('error', error); };
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let resetToken = null;
let libraryEpoch = 0;
let creators = [], selectedCreator = null, researchVideos = [], mixPath = [], companyVideos = null;
function clearResearch() {
  creators = []; selectedCreator = null; researchVideos = []; mixPath = []; companyVideos = null;
  byId('creatorGrid').innerHTML = ''; byId('reportMix').innerHTML = ''; byId('channelOverview').innerHTML = '';
  byId('personalLibrary').innerHTML = ''; byId('creatorResearch').hidden = true;
}
function renderLibrary() {
  libraryEpoch++;
  const scoped = companyVideos ? researchVideos.filter(v=>companyVideos.ids.includes(v.id)) : researchVideos;
  const visible = ResearchLibrary.sortResearchVideos(ResearchLibrary.filterResearchVideos(scoped, byId('librarySearch').value), byId('librarySort').value);
  byId('libraryCount').textContent = visible.length === researchVideos.length ? `${visible.length} ${visible.length === 1 ? 'Video' : 'Videos'}` : `${visible.length} / ${researchVideos.length} Videos`;
  byId('personalLibrary').innerHTML = ResearchDashboard.videos(visible, SavedReportView);
  byId('companySelection').innerHTML = companyVideos ? `<span>${safe(companyVideos.label)}</span><button type="button" data-clear-company>Alle Kanalvideos</button>` : '';
}
async function selectCreator(id) {
  const creator = creators.find(c=>c.creatorId === id);
  if (!creator) return;
  const epoch = ++libraryEpoch;
  selectedCreator = id; researchVideos = []; mixPath = []; companyVideos = null;
  byId('creatorResearch').hidden = true; byId('personalLibrary').innerHTML = '';
  byId('creatorGrid').innerHTML = ResearchDashboard.creators(creators,id);
  byId('librarySearch').value = ''; byId('librarySort').value = 'analyzed-desc';
  try {
    const data = await request(`/creators/${encodeURIComponent(id)}/dashboard`);
    if (epoch !== libraryEpoch) return;
    researchVideos = data.videos || [];
    byId('channelOverview').innerHTML = ResearchDashboard.channel(data.creator || creator,researchVideos);
    byId('reportMix').innerHTML = ResearchDashboard.mix(researchVideos,mixPath);
    byId('creatorResearch').hidden = false;
    renderLibrary();
  } catch(error) { if(epoch === libraryEpoch) message(error.message,true); }
}
byId('creatorGrid').addEventListener('click',event=>{
  const button = event.target.closest('[data-creator]');
  if(button) selectCreator(button.dataset.creator);
});
byId('librarySearch').addEventListener('input',renderLibrary);
byId('librarySort').addEventListener('change',renderLibrary);
byId('companySelection').addEventListener('click',event=>{if(event.target.closest('[data-clear-company]')){companyVideos=null;renderLibrary();}});
byId('reportMix').addEventListener('click',event=>{
  const back = event.target.closest('[data-mix-back]'), item = event.target.closest('[data-mix-index]');
  if(back){event.preventDefault();mixPath=mixPath.slice(0,Number(back.dataset.mixBack));companyVideos=null;renderLibrary();}
  else if(item){
    event.preventDefault();
    const group=ResearchDashboard.groups(researchVideos,mixPath)[Number(item.dataset.mixIndex)];
    if(!group)return;
    if(mixPath.length<2)mixPath.push(group.label);
    else {companyVideos={label:group.label,ids:[...group.videoIds]};renderLibrary();}
  } else return;
  byId('reportMix').innerHTML = ResearchDashboard.mix(researchVideos,mixPath);
});
async function request(url, body) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Anfrage fehlgeschlagen.'), { status: response.status });
  return data;
}
const run = callback => async event => { event?.preventDefault(); try { await callback(); } catch (error) { message(error.message, true); } };
async function refresh() {
  const epoch = ++libraryEpoch;
  let account;
  try { account = await request('/me'); } catch (error) {
    if (epoch !== libraryEpoch) return;
    if (error.status !== 401) throw error;
    byId('auth').hidden = false; byId('accountIntro').hidden = false; byId('accountPanel').hidden = true; clearResearch(); return;
  }
  if (epoch !== libraryEpoch) return;
  byId('auth').hidden = true; byId('accountIntro').hidden = true; byId('accountPanel').hidden = false;
  byId('identity').textContent = account.email;
  byId('plan').textContent = account.plan === 'pro' ? 'Pro' : 'Free';
  byId('credits').textContent = account.analyses_available;
  byId('subscription').textContent = account.subscription ? `Status: ${account.subscription.status} · Laufzeit bis ${new Date(account.subscription.period_end).toLocaleDateString('de-CH')}${account.subscription.cancel_at_period_end ? ' · Kündigung vorgemerkt' : ''}` : 'Kein laufendes Abo.';
  byId('proDescription').textContent = 'Pro · Coming soon. In dieser Beta ist kein Abschluss möglich. Deine gespeicherten Reports bleiben ohne erneuten Analyseverbrauch lesbar.';
  const data = await request('/creators');
  if (epoch !== libraryEpoch) return;
  creators = data.creators || [];
  byId('creatorCount').textContent = `${creators.length} ${creators.length === 1 ? 'Creator' : 'Creators'}`;
  byId('creatorGrid').innerHTML = ResearchDashboard.creators(creators,selectedCreator);
  const next = creators.find(c=>c.creatorId === selectedCreator) || (creators.length === 1 ? creators[0] : null);
  byId('creatorResearch').hidden = !next;
  if(next) await selectCreator(next.creatorId);
  else { researchVideos=[];byId('personalLibrary').innerHTML=''; }

}
function setReportButtons(button, open) {
  const entry = button.closest('.library-entry');
  for(const control of entry.querySelectorAll?.('[data-report-video]') || [button]) {
    control.setAttribute('aria-expanded', String(open));
    if(control.dataset.reportLabel) control.textContent = open ? 'Report schließen' : 'Vollständigen Report öffnen';
  }
}
byId('personalLibrary').addEventListener('click', async event => {
  const button = event.target.closest('[data-report-video]');
  if (!button || button.disabled) return;
  event.preventDefault();
  const panel = button.closest('.library-entry').querySelector('.saved-report');
  if (!panel.hidden) { panel.hidden = true; setReportButtons(button, false); return; }
  const epoch = libraryEpoch, videoId = button.dataset.reportVideo;
  button.disabled = true;
  try {
    if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId)) throw Error('Ungültige Video-ID.');
    if (!panel.dataset.loaded) {
      if(button.dataset.reportLabel) button.textContent = 'Report wird geladen …';
      const report = await request(`/videos/${encodeURIComponent(videoId)}`);
      if (epoch !== libraryEpoch || !button.isConnected) return;
      if (report.video?.id !== videoId) throw Error('Gespeicherter Report passt nicht zum Video.');
      panel.innerHTML = SavedReportView.render(report);
      panel.dataset.loaded = 'true';
    }
    panel.hidden = false; setReportButtons(button, true);
  } catch (error) {
    if (epoch === libraryEpoch) { if(button.dataset.reportLabel)button.textContent = 'Vollständigen Report öffnen'; message(error.message, true); }
  } finally { button.disabled = false; }
});
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
byId('logout').addEventListener('click', run(async () => { libraryEpoch++; clearResearch(); await request('/auth/logout', {}); message('Abgemeldet.'); await refresh(); }));
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
    const failure = job.state === 'failed' ? `${job.error} Code: ${job.code || 'ANALYSIS_FAILED'} · Auftrag: ${job.jobId}` : null;
    await refresh();
    message(job.state === 'complete' ? 'Report gespeichert.' : failure || 'Auftrag läuft noch. Später aktualisieren.', job.state === 'failed');
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
