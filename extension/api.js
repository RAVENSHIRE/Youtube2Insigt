globalThis.AppApi = (() => {
  const base = AppConfig.apiBase.replace(/\/$/u, '');
  let accessToken = null, config = null, account = null, scope = 'personal', epoch = 0;
  function apiError(data, status) {
    const id = chrome.runtime?.id;
    const detail = data?.code === 'ORIGIN_DENIED' && /^[a-p]{32}$/u.test(id || '')
      ? `Diese Erweiterung ist am Server noch nicht freigegeben. Trage EXTENSION_ORIGINS=chrome-extension://${id} in die Server-.env ein und starte den Server neu. Danach die Erweiterung neu laden.`
      : data?.error || 'Serveranfrage fehlgeschlagen.';
    return Object.assign(new Error(detail), { status, code: data?.code });
  }
  const ready = (async () => {
    try { accessToken = (await chrome.storage.session.get('accountToken')).accountToken || null; }
    catch { accessToken = null; }
    const response = await fetch(`${base}/config`);
    if (response.status === 404) config = { accountRequired: false, legacy: true, marketDataAvailable: true };
    else if (response.ok) config = await response.json();
    else throw apiError(await response.json().catch(() => ({})), response.status);
  })();
  async function apiFetch(url, options = {}) {
    await ready;
    const requestEpoch = epoch;
    const target = new URL(url, base);
    if (target.origin !== new URL(base).origin) throw Error('Unerwartete API-Adresse.');
    if (scope === 'examples' && !options.method && /^\/(creators|videos|dashboard|companies)(\/|$)/u.test(target.pathname)) target.pathname = `/examples${target.pathname}`;
    const response = await fetch(target, { ...options, credentials: 'omit', headers: { ...options.headers, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) } });
    if (requestEpoch !== epoch) throw new DOMException('Bibliothek wurde gewechselt.', 'AbortError');
    return response;
  }
  async function json(endpoint, body) {
    const response = await apiFetch(`${base}${endpoint}`, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw apiError(data, response.status);
    return data;
  }
  async function currentAccount() {
    await ready;
    if (!config.accountRequired) return null;
    if (!accessToken) { account = null; return null; }
    try { account = await json('/me'); return account; }
    catch (error) { if (error.status === 401) { await clearSession(); return null; } throw error; }
  }
  async function login(email, password) {
    const response = await json('/auth/login', { email, password });
    await chrome.storage.session.set({ accountToken: response.token });
    epoch++; accessToken = response.token; account = response.account; scope = 'personal'; return account;
  }
  async function clearSession() {
    epoch++; accessToken = null; account = null;
    await chrome.storage.session.remove('accountToken').catch(() => {});
  }
  async function logout() { try { if (accessToken) await json('/auth/logout', {}); } finally { await clearSession(); } }
  return { base, ready, fetch: apiFetch, json, login, logout, currentAccount,
    get config() { return config; }, get account() { return account; },
    get scope() { return scope; }, set scope(value) { epoch++; scope = value === 'examples' ? 'examples' : 'personal'; } };
})();
