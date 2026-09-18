const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../web/account.js'), 'utf8');

// DOM contract fixture: tests the real page event handlers, not an installed browser.
async function page({ hash = '', registerStatus = 202 } = {}) {
  const nodes = new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/gu)].map(([tag, id]) => [id, {
    value: '', textContent: '', hidden: /\bhidden\b/u.test(tag), disabled: false, events: {},
    classList: { toggle() {} }, focus() {}, reportValidity: () => true,
    addEventListener(name, callback) { this.events[name] = callback; }
  }]));
  const requests = [], history = [];
  vm.runInNewContext(script, {
    document: { getElementById: id => nodes.get(id) }, URL, URLSearchParams, setTimeout,
    location: { hash, pathname: '/account/' }, history: { replaceState: (...args) => history.push(args) },
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ url, body });
      if (url === '/me') return Response.json({ error: 'Bitte anmelden.' }, { status: 401 });
      if (url === '/auth/verify') return Response.json({ error: 'Link ist abgelaufen oder bereits verwendet.' }, { status: 400 });
      if (url === '/auth/register' && registerStatus !== 202) return Response.json({ error: 'E-Mail-Versand nicht eingerichtet.' }, { status: registerStatus });
      return Response.json({ message: 'An den Anbieter übergeben; Zustellung nicht bestätigt.' }, { status: 202 });
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  const event = async (id, type = 'click') => nodes.get(id).events[type]({ preventDefault() {} });
  const fill = () => {
    nodes.get('registerEmail').value = nodes.get('confirmEmail').value = 'alice@example.test';
    nodes.get('registerPassword').value = nodes.get('confirmPassword').value = 'Synthetic password 123!';
  };
  return { nodes, requests, event, fill, history };
}

test('account page separates four-field registration from two-field sign-in', async () => {
  const login = html.match(/<form id="authForm">([\s\S]*?)<\/form>/u)[1];
  const register = html.match(/<form id="registerForm" hidden>([\s\S]*?)<\/form>/u)[1];
  assert.equal((login.match(/<input /gu) || []).length, 2);
  assert.equal((register.match(/<input /gu) || []).length, 4);
  assert.equal((register.match(/\brequired\b/gu) || []).length, 4);
  assert.equal((register.match(/autocomplete="new-password"/gu) || []).length, 2);
  const p = await page(); await p.event('register');
  assert.equal(p.nodes.get('registerForm').hidden, false); assert.equal(p.nodes.get('authForm').hidden, true);
  p.fill(); await p.event('registerForm', 'submit');
  assert.deepEqual(p.requests.find(r => r.url === '/auth/register').body, {
    email: 'alice@example.test', confirmEmail: 'alice@example.test', password: 'Synthetic password 123!', confirmPassword: 'Synthetic password 123!'
  });
  assert.equal(p.nodes.get('authForm').hidden, false);
  assert.equal(p.nodes.get('registerPassword').value, ''); assert.equal(p.nodes.get('confirmPassword').value, '');
  p.nodes.get('password').value = 'Synthetic password 123!';
  await p.event('authForm', 'submit');
  assert.deepEqual(Object.keys(p.requests.find(r => r.url === '/auth/login').body).sort(), ['email', 'password']);
});

test('account page blocks mismatched confirmations before contacting server', async () => {
  const p = await page(); p.fill(); p.nodes.get('confirmEmail').value = 'other@example.test';
  await p.event('registerForm', 'submit');
  assert.match(p.nodes.get('message').textContent, /E-Mail-Adressen stimmen nicht/u);
  p.fill(); p.nodes.get('confirmPassword').value = 'Other password 456!';
  await p.event('registerForm', 'submit');
  assert.match(p.nodes.get('message').textContent, /Passwörter stimmen nicht/u);
  assert.equal(p.requests.some(r => r.url === '/auth/register'), false);
});

test('account page displays provider failure and permits retry without a false sent message', async () => {
  const p = await page({ registerStatus: 503 }); await p.event('register'); p.fill();
  await p.event('registerForm', 'submit');
  assert.equal(p.nodes.get('message').textContent, 'E-Mail-Versand nicht eingerichtet.');
  assert.equal(p.nodes.get('submitRegistration').disabled, false);
  assert.equal(p.nodes.get('registerForm').hidden, false);
});

test('account page consumes verification fragment and displays invalid-link errors without claiming success', async () => {
  const p = await page({ hash: '#verify=synthetic-invalid-token' });
  assert.deepEqual(p.requests.find(r => r.url === '/auth/verify').body, { token: 'synthetic-invalid-token' });
  assert.equal(p.history[0][2], '/account/'); // Remove the token from visible URL/history before the request.
  assert.match(p.nodes.get('message').textContent, /abgelaufen/u);
  assert.equal(p.nodes.get('auth').hidden, false);
});
