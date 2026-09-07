// Only extension assets enter the distributable. Never copy server/.env/data.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const project = path.resolve(__dirname, '../..');

function validateApiBase(value, development = false) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:')) || (!development && local)) {
    throw Error('Use a public HTTPS backend origin, or --development with localhost.');
  }
  return url.origin;
}
function build({ apiBase, output, development = false }) {
  const origin = validateApiBase(apiBase, development);
  const destination = path.resolve(output);
  const buildRoot = path.join(project, 'build');
  if (!destination.startsWith(buildRoot + path.sep) || fs.existsSync(destination)) throw Error('Output must be a NEW directory beneath build/. Nothing was overwritten.');
  const source = path.join(project, 'extension');
  const files = fs.readdirSync(source).filter(file => !/^popup\./u.test(file) && /\.(?:js|css|html|json|png|svg)$/u.test(file) && fs.statSync(path.join(source, file)).isFile());
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  manifest.version = '0.6.0'; manifest.version_name = '0.6.0-rc1';
  manifest.host_permissions = ['https://www.youtube.com/*', 'https://yt3.ggpht.com/*', 'https://yt3.googleusercontent.com/*', `${origin}/*`];
  for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, ...manifest.content_scripts.flatMap(script => script.js)]) {
    if (!files.includes(file)) throw Error(`Missing manifest asset: ${file}`);
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(source, file), path.join(destination, file));
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'config.js'), `globalThis.AppConfig = Object.freeze({ apiBase: ${JSON.stringify(origin)} });\n`);
  const sha256 = createHash('sha256');
  for (const file of files.sort()) sha256.update(file).update(fs.readFileSync(path.join(destination, file)));
  return { status: 'built_not_store_approved', output: destination, api_origin: origin, files: files.length, sha256: sha256.digest('hex') };
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
    if (!args.includes('--api-base') || !args.includes('--output')) throw Error('Required: --api-base https://your-backend --output build/extension-rc1 [--development]');
    console.log(JSON.stringify(build({ apiBase: value('--api-base'), output: path.resolve(project, value('--output')), development: args.includes('--development') }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateApiBase, build };
