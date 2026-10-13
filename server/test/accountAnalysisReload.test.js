const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../web/account.js'), 'utf8');
const videoId = 'JYF40KTxQpA';

async function fixture(states) {
  const nodes = new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/gu)].map(([, id]) =>
    [id, { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
      classList: { toggle() {} }, events: {},
      addEventListener(name, fn) { this.events[name] = fn; } }]));
  const calls = [];
  let reloaded = 0;
  let poll = 0;
  const storage = new Map();
  vm.runInNewContext(script, {
    document: { getElementById: id => nodes.get(id) },
    sessionStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) || null, removeItem: key => storage.delete(key) },
    URL, URLSearchParams,
    setTimeout: fn => { queueMicrotask(fn); },
    location: { hash: '', pathname: '/account/', reload() { reloaded++; } },
    history: { replaceState() {} },
    ResearchDashboard: require('../web/research-dashboard'),
    ResearchLibrary: require('../../extension/research-library'),
    fetch: async (url, options) => {
      calls.push(url);
      if (url === '/me') return Response.json({ email: 'test@example.invalid', plan: 'pro', analyses_available: 49 });
      if (url === '/creators') return Response.json({ creators: [] });
      if (url === '/analyze') {
        assert.equal(JSON.parse(options.body).videoId, videoId);
        return Response.json({ jobId: 'fixture-job', ...states[0] });
      }
      if (url === '/analysis-jobs/fixture-job') return Response.json({ jobId: 'fixture-job', ...states[++poll] });
      throw Error('Unexpected URL: ' + url);
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  nodes.get('videoUrl').value = 'https://www.youtube.com/watch?v=' + videoId;
  await nodes.get('analysisForm').events.submit({ preventDefault() {} });
  return { nodes, calls, reloaded };
}

test('account reloads once after confirmed analysis completion, including a polled job', async () => {
  const result = await fixture([{ state: 'reserved' }, { state: 'complete' }]);
  assert.equal(result.reloaded, 1);
  assert.equal(result.calls.filter(x => x === '/analyze').length, 1);
  assert.equal(result.calls.filter(x => x === '/analysis-jobs/fixture-job').length, 1);
  assert.equal(result.calls.filter(x => x === '/creators').length, 1);
  assert.equal(result.nodes.get('analyze').disabled, false);
});

test('account does not reload on provider failure; preserves error and credit refresh', async () => {
  const result = await fixture([{ state: 'failed', error: 'Provider nicht verfügbar.', code: 'MODEL_UNAVAILABLE', jobId: 'fixture-job' }]);
  assert.equal(result.reloaded, 0);
  assert.equal(result.calls.filter(x => x === '/creators').length, 2);
  assert.match(result.nodes.get('message').textContent, /MODEL_UNAVAILABLE/u);
  assert.equal(result.nodes.get('analyze').disabled, false);
});
