import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import path from 'node:path';

const page = await readFile('dist/landing.html', 'utf8');
const app = await readFile('dist/app.html', 'utf8');
assert.equal(await readFile('dist/index.html', 'utf8'), page, 'Filesystem root must serve the prerendered landing');
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const routes = JSON.parse(await readFile('vercel.json', 'utf8')).rewrites;
assert.equal(routes.find(route => route.source === '/')?.destination, '/landing.html');
assert.ok(routes.some(route => route.destination === '/app.html'), 'Private navigation must use the cashier shell');
assert.ok(page.includes('id="nh-hero-title"') && page.includes('id="pricing"'), 'Public copy and prices exist before JavaScript');
assert.equal(/<link[^>]+rel="stylesheet"/.test(page), false, 'Landing has no render-blocking stylesheet requests');
assert.equal(/<link[^>]+rel="modulepreload"/.test(page), false, 'Reading marketing must not preload React');
assert.equal(/<script[^>]+type="module"[^>]+src=/.test(page), false, 'Inline bootstrap removes the initial script request chain');
const bootstrap = /<script type="module" data-landing-bootstrap>([\s\S]*?)<\/script>/.exec(page)?.[1];
assert.ok(bootstrap && bootstrap.includes('import('), 'Interactive features remain available on demand');
assert.ok(Buffer.byteLength(bootstrap) < 12000, 'Initial bootstrap stays small');
assert.equal(/react-dom|react\.production|hydrateRoot/.test(bootstrap), false, 'React runtime stays out of initial execution');
assert.equal(/gtm\.js\?id=/.test(page), false, 'Empty GTM container has no runtime download');
assert.equal(/fonts\.(googleapis|gstatic)\.com/.test(page), false, 'Public font is local');
assert.ok(page.includes('google-site-verification') && page.includes('ai-catalog') && page.includes('rel="canonical"'), 'Search and AI discovery metadata preserved');
assert.ok(app.includes('<div id="root"></div>'), 'Cashier keeps its independent session-aware shell');
const seen = new Set();
async function inspect(key) {
  if (seen.has(key)) return;
  seen.add(key);
  const entry = manifest[key];
  assert.ok(entry, `Missing public bundle ${key}`);
  const script = await readFile(path.join('dist', entry.file), 'utf8');
  assert.equal(/\/auth\/v1|SIGNED_OUT|\/api\/v1\/sync/.test(script), false, 'Landing must not bootstrap auth or tenant synchronization');
  for (const imported of [...(entry.imports || []), ...(entry.dynamicImports || [])]) await inspect(imported);
}
await inspect('landing.html');
await access('dist/fonts/plus-jakarta-sans-latin.woff2');
await assert.rejects(access('dist/.landing-renderer.mjs'), 'Build-time renderer must not ship');
console.log('PASS: static public content, independent cashier shell, metadata, local fonts and auth-free public bundle.');
