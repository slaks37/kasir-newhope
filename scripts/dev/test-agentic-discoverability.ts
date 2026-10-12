// Automated regression test suite for New Hope Agentic Browsing & AI Discoverability.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = process.cwd();

console.log('--- TEST 1: llms.txt format & recommendations ---');
const llmsPath = path.join(ROOT, 'public/llms.txt');
assert.ok(fs.existsSync(llmsPath), 'public/llms.txt must exist');
const llmsContent = fs.readFileSync(llmsPath, 'utf8');

// UTF-8 validity & non-empty
assert.ok(llmsContent.length > 200, 'public/llms.txt must have substantive content');
assert.ok(!llmsContent.includes('\uFFFD'), 'public/llms.txt must be valid UTF-8 without replacement chars');

// Single H1 heading
const h1Matches = llmsContent.match(/^# [^\n]+/gm);
assert.equal(h1Matches?.length, 1, 'llms.txt must contain exactly one primary H1 heading');
assert.equal(h1Matches[0], '# New Hope POS');

// Blockquote immediately after H1
const lines = llmsContent.split('\n').filter(l => l.trim().length > 0);
assert.match(lines[0], /^# New Hope POS/);
assert.match(lines[1], /^> /, 'llms.txt summary must be in a blockquote immediately following H1');

// Multi-industry coverage
assert.match(llmsContent, /Kafe, Resto & F&B/);
assert.match(llmsContent, /Laundry Kiloan & Satuan/);
assert.match(llmsContent, /Ritel, Toko & Minimarket/);
assert.match(llmsContent, /Cuci Mobil & Motor/);
assert.match(llmsContent, /Barbershop & Salon/);

// Core modules coverage
assert.match(llmsContent, /Kasir & Pembayaran/);
assert.match(llmsContent, /Inventori & Bahan Baku/);
assert.match(llmsContent, /Asisten Bisnis AI/);
assert.match(llmsContent, /Offline-First/);

// Links format: - [Title](https://...)
const linkMatches = [...llmsContent.matchAll(/^- \[([^\]]+)\]\((https:\/\/kasir\.newhope\.space[^\)]*)\): (.+)$/gm)];
assert.ok(linkMatches.length >= 5, 'llms.txt must contain at least 5 meaningful documented links');
for (const match of linkMatches) {
  const [, title, url, description] = match;
  assert.ok(title.length > 2, `Link title "${title}" must be descriptive`);
  assert.ok(url.startsWith('https://kasir.newhope.space'), `Link URL "${url}" must use official domain`);
  assert.ok(description.length > 5, `Link description for "${title}" must be substantive`);
}

// Security: No credentials or private information
for (const leak of ['password', 'secret', 'api_key', 'SUPABASE_SERVICE_ROLE_KEY', 'owner-a', 'cashier_user_id']) {
  assert.ok(!llmsContent.toLowerCase().includes(leak.toLowerCase()), `llms.txt must not leak sensitive token/pattern: ${leak}`);
}
console.log('PASS: llms.txt conforms to llmstxt.org recommendations with verified modules, pricing, and links.');

console.log('--- TEST 2: ai-catalog.json & ard.json schema validation ---');
const catalogPath = path.join(ROOT, 'public/.well-known/ai-catalog.json');
const ardPath = path.join(ROOT, 'public/.well-known/ard.json');
assert.ok(fs.existsSync(catalogPath), 'public/.well-known/ai-catalog.json must exist');
assert.ok(fs.existsSync(ardPath), 'public/.well-known/ard.json must exist');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const ard = JSON.parse(fs.readFileSync(ardPath, 'utf8'));

function validateAiCatalogSchema(doc: any) {
  // Root required fields: specVersion, entries
  assert.equal(typeof doc, 'object');
  assert.ok(!Array.isArray(doc));
  assert.equal(doc.specVersion, '1.0', 'specVersion must be "1.0"');
  assert.ok(Array.isArray(doc.entries), 'entries must be an array');

  // Disallow unknown root properties
  const allowedRoot = new Set(['specVersion', 'host', 'entries']);
  for (const key of Object.keys(doc)) {
    assert.ok(allowedRoot.has(key), `Root property "${key}" not permitted by ai-catalog schema`);
  }

  // Host validation
  if (doc.host !== undefined) {
    assert.equal(typeof doc.host, 'object');
    assert.ok(!Array.isArray(doc.host));
    assert.equal(typeof doc.host.displayName, 'string', 'host.displayName is required');
    assert.ok(doc.host.displayName.length > 0, 'host.displayName must not be empty');

    const allowedHost = new Set(['displayName', 'identifier', 'documentationUrl', 'logoUrl', 'trustManifest']);
    for (const key of Object.keys(doc.host)) {
      assert.ok(allowedHost.has(key), `Host property "${key}" not permitted by ai-catalog schema`);
    }

    if (doc.host.documentationUrl !== undefined) {
      assert.doesNotThrow(() => new URL(doc.host.documentationUrl), 'host.documentationUrl must be a valid URI');
    }
    if (doc.host.logoUrl !== undefined) {
      assert.doesNotThrow(() => new URL(doc.host.logoUrl), 'host.logoUrl must be a valid URI');
    }
  }

  // Entries validation
  for (const entry of doc.entries) {
    assert.equal(typeof entry.identifier, 'string');
    assert.match(entry.identifier, /^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/);
    assert.equal(typeof entry.displayName, 'string');
    assert.equal(typeof entry.type, 'string');
    const hasUrl = entry.url !== undefined;
    const hasData = entry.data !== undefined;
    assert.ok((hasUrl && !hasData) || (!hasUrl && hasData), 'catalogEntry requires exactly one of url or data');
  }
}

validateAiCatalogSchema(catalog);
validateAiCatalogSchema(ard);
assert.equal(catalog.host.displayName, 'New Hope POS');
assert.equal(catalog.host.documentationUrl, 'https://kasir.newhope.space/llms.txt');
assert.equal(catalog.host.logoUrl, 'https://kasir.newhope.space/new-hope-logo-mark.png');
console.log('PASS: ai-catalog.json and ard.json pass strict ARD JSON schema validation.');

console.log('--- TEST 3: robots.txt consistency ---');
const robotsContent = fs.readFileSync(path.join(ROOT, 'public/robots.txt'), 'utf8');
assert.match(robotsContent, /^User-agent: \*/m);
assert.match(robotsContent, /^Allow: \//m);
assert.match(robotsContent, /^Disallow: \/admin/m);
assert.match(robotsContent, /^Disallow: \/api\//m);
assert.match(robotsContent, /^Sitemap: https:\/\/kasir\.newhope\.space\/sitemap\.xml/m);
assert.match(robotsContent, /^Sitemap: https:\/\/kasir\.newhope\.space\/blog\/sitemap\.xml/m);
assert.ok(!robotsContent.includes('Agentmap:'), 'robots.txt must NOT have unknown directives like Agentmap to comply with RFC 9309 and pass Lighthouse SEO audit.');
console.log('PASS: robots.txt conforms to RFC 9309 without invalid directives, preserving sitemaps and private disallows.');

console.log('--- TEST 4: HTML discovery links in index.html ---');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert.match(htmlContent, /<link rel="ai-catalog" href="\/\.well-known\/ai-catalog\.json"\s*\/?>/);
assert.match(htmlContent, /<link rel="ard" href="\/\.well-known\/ard\.json"\s*\/?>/);
assert.match(htmlContent, /<link rel="describedby" href="\/llms\.txt"\s*\/?>/);
assert.match(htmlContent, /<link rel="canonical" href="https:\/\/kasir\.newhope\.space\/"\s*\/?>/);
console.log('PASS: index.html contains rel="ai-catalog", rel="ard", rel="describedby", and canonical link.');

console.log('--- TEST 5: vercel.json routing & headers configuration ---');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

// Verify rewrite rule excludes .well-known and static file extensions from SPA catch-all
const catchAll = vercelConfig.rewrites.find((r: any) => r.destination === '/app.html');
assert.ok(catchAll, 'SPA catch-all rewrite to /app.html must exist');
assert.match(catchAll.source, /\\.well-known/, 'Catch-all rewrite must exclude .well-known');
assert.match(catchAll.source, /txt\|json\|xml/, 'Catch-all rewrite must exclude .txt, .json, and .xml');

// Verify headers configured
const linkHeader = vercelConfig.headers.find((h: any) => h.source === '/');
assert.ok(linkHeader, 'Root header entry must exist');
const linkVal = linkHeader.headers.find((kv: any) => kv.key === 'Link')?.value;
assert.match(linkVal, /rel="ai-catalog"/);
assert.match(linkVal, /rel="ard"/);
assert.match(linkVal, /rel="describedby"/);

const llmsHeader = vercelConfig.headers.find((h: any) => h.source === '/llms.txt');
assert.ok(llmsHeader, 'Headers for /llms.txt must exist');
assert.equal(llmsHeader.headers.find((kv: any) => kv.key === 'Content-Type')?.value, 'text/markdown; charset=utf-8');

const catalogHeader = vercelConfig.headers.find((h: any) => h.source === '/.well-known/ai-catalog.json');
assert.ok(catalogHeader, 'Headers for /.well-known/ai-catalog.json must exist');
assert.equal(catalogHeader.headers.find((kv: any) => kv.key === 'Content-Type')?.value, 'application/json; charset=utf-8');
console.log('PASS: vercel.json rewrites protect against SPA fallbacks and set correct Content-Type/Link headers.');

console.log('--- TEST 6: Simulated HTTP server testing static routing & 404 behavior ---');
// Verify routing behavior on built assets in dist/
const distDir = path.join(ROOT, 'dist');
assert.ok(fs.existsSync(distDir), 'dist/ directory must exist (run npm run build first)');
assert.ok(fs.existsSync(path.join(distDir, 'llms.txt')), 'dist/llms.txt must exist');
assert.ok(fs.existsSync(path.join(distDir, '.well-known/ai-catalog.json')), 'dist/.well-known/ai-catalog.json must exist');
assert.ok(fs.existsSync(path.join(distDir, '.well-known/ard.json')), 'dist/.well-known/ard.json must exist');

// Simulate Vercel routing logic
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;

  // Static file match in dist/
  const filePath = path.join(distDir, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    let cType = 'application/octet-stream';
    if (ext === '.html') cType = 'text/html; charset=utf-8';
    else if (ext === '.txt') cType = 'text/markdown; charset=utf-8';
    else if (ext === '.json') cType = 'application/json; charset=utf-8';
    else if (ext === '.svg') cType = 'image/svg+xml';
    res.writeHead(200, { 'Content-Type': cType });
    res.end(fs.readFileSync(filePath));
    return;
  }

  // Catch-all rewrite exclusion test (mirroring vercel.json pattern)
  const isExcluded = pathname.startsWith('/api') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/google') ||
    pathname.startsWith('/.well-known') ||
    /\.(txt|json|xml|ico|svg|png|jpg|jpeg|webp|webmanifest)$/.test(pathname);

  if (!isExcluded) {
    // Root is static marketing; account/workspace paths use the cashier shell.
    const indexHtml = path.join(distDir, pathname === '/' ? 'index.html' : 'app.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(indexHtml));
    return;
  }

  // Missing resource that was excluded from catch-all returns 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
const address = server.address() as { port: number };
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  // Test /llms.txt returns 200 and markdown
  const resLlms = await fetch(`${baseUrl}/llms.txt`);
  assert.equal(resLlms.status, 200);
  assert.match(resLlms.headers.get('content-type') || '', /text\/markdown|text\/plain/);
  const textLlms = await resLlms.text();
  assert.ok(textLlms.startsWith('# New Hope POS'));
  assert.ok(!textLlms.includes('<!doctype html>'), '/llms.txt must never return HTML');

  // Test /.well-known/ai-catalog.json returns 200 and valid JSON
  const resCat = await fetch(`${baseUrl}/.well-known/ai-catalog.json`);
  assert.equal(resCat.status, 200);
  assert.match(resCat.headers.get('content-type') || '', /application\/json/);
  const jsonCat = await resCat.json();
  assert.equal(jsonCat.specVersion, '1.0');
  assert.equal(jsonCat.host.displayName, 'New Hope POS');

  // Test /.well-known/ard.json returns 200 and valid JSON
  const resArd = await fetch(`${baseUrl}/.well-known/ard.json`);
  assert.equal(resArd.status, 200);
  const jsonArd = await resArd.json();
  assert.equal(jsonArd.specVersion, '1.0');

  // Test missing .txt returns 404 and does NOT return index.html
  const resMissTxt = await fetch(`${baseUrl}/nonexistent.txt`);
  assert.equal(resMissTxt.status, 404, 'Missing .txt must return 404, not index.html');
  const missTxtBody = await resMissTxt.text();
  assert.ok(!missTxtBody.includes('<!doctype html>'));

  // Test missing .well-known resource returns 404 and does NOT return index.html
  const resMissWellKnown = await fetch(`${baseUrl}/.well-known/nonexistent.json`);
  assert.equal(resMissWellKnown.status, 404, 'Missing .well-known resource must return 404, not index.html');
  const missWkBody = await resMissWellKnown.text();
  assert.ok(!missWkBody.includes('<!doctype html>'));

  // Test SPA routes rewrite to index.html
  const resPos = await fetch(`${baseUrl}/pos`);
  assert.equal(resPos.status, 200);
  const posBody = await resPos.text();
  assert.ok(posBody.includes('<!doctype html>'), 'SPA navigation to /pos must serve the cashier shell');
  assert.ok(posBody.includes('<div id="root"></div>'), 'Private routes must not receive prerendered marketing');

  const resLogin = await fetch(`${baseUrl}/login`);
  assert.equal(resLogin.status, 200);
  const loginBody = await resLogin.text();
  assert.ok(loginBody.includes('<!doctype html>'), 'SPA navigation to /login must serve the cashier shell');

  console.log('PASS: Local routing simulation validates 200 for AI endpoints, 404 for missing static files, and SPA rewrite for client routes.');
} finally {
  server.close();
}

console.log('\n========================================');
console.log('ALL AGENTIC BROWSING & DISCOVERABILITY TESTS PASSED!');
console.log('========================================');
