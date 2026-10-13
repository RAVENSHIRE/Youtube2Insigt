const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../web/account.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const target = 'JYF40KTxQpA';

test('completed video restores creator and opens saved report after reload, without another analysis', async () => {
  const nodes = new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/gu)].map(([, id]) =>
    [id, { value: '', innerHTML: '', textContent: '', hidden: false, events: {}, disabled: false,
      classList: {toggle() {}}, addEventListener(name, fn) { this.events[name] = fn; } }]));
  const panel = { hidden: true, dataset: {}, innerHTML: '' };
  let expanded = false, scrolled = false;
  const entry = { querySelector: () => panel, querySelectorAll: () => [button],
    scrollIntoView() { scrolled = true; } };
  const button = { dataset: { reportVideo: target, reportLabel: 'true' }, disabled: false,
    isConnected: true, closest: () => entry, setAttribute(name, value) { if (name === 'aria-expanded') expanded = value === 'true'; } };
  nodes.get('personalLibrary').querySelectorAll = () => [button];
  const values = new Map([['signaltube:completed-video', target]]);
  const calls = [];
  const fixtureVideo = { id: target, title: 'New report', companies: [], summary: 'Saved' };
  vm.runInNewContext(source, {
    document: { getElementById: id => nodes.get(id) },
    URL, URLSearchParams, setTimeout,
    sessionStorage: { getItem: key => values.get(key) || null, setItem: (key, val) => values.set(key, val), removeItem: key => values.delete(key) },
    location: { hash: '', pathname: '/account/' }, history: {replaceState() {}},
    ResearchLibrary: require('../../extension/research-library'),
    ResearchDashboard: require('../web/research-dashboard'),
    SavedReportView: { render: () => '<p>Saved report body</p>', publicationDate: () => '-', tickerLink: () => '' },
    fetch: async url => {
      calls.push(url);
      if (url === '/me') return Response.json({ email: 'fixture@example.test', plan: 'pro', analyses_available: 49 });
      if (url === '/creators') return Response.json({ creators: [
        { creatorId: 'other', name: 'Other Creator' }, { creatorId: 'target', name: 'New Creator' }] });
      if (url === '/creators/other/dashboard') return Response.json({ videos: [] });
      if (url === '/creators/target/dashboard') return Response.json({ videos: [fixtureVideo] });
      if (url === '/videos/' + target) return Response.json({video: {id: target}, companies: []});
      throw Error('Unexpected endpoint: ' + url);
    }
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(values.has('signaltube:completed-video'), false);
  assert.equal(expanded, true);
  assert.equal(panel.hidden, false);
  assert.equal(scrolled, true);
  assert.match(nodes.get('message').textContent, /Analyse erfolgreich!/u);
  assert.match(nodes.get('creatorGrid').innerHTML, /aria-pressed="true"/u);
  assert.equal(calls.filter(url => url === '/videos/' + target).length, 1);
  assert.equal(calls.some(url => url === '/analyze'), false);
});
