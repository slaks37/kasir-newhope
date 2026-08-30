#!/usr/bin/env node
import { execSync } from 'node:child_process';

const sh = (c) => { try { return execSync(c, {encoding:'utf8'}); } catch { return ''; } };

// Backend routes registered in services/ and src/server/
const backendRaw = sh(`grep -rhoE "app\\.(get|post|put|patch|delete)\\('[^']+'" services/ src/server/`);
const backend = new Set();
for (const line of backendRaw.split('\n')) {
  const m = /app\.(\w+)\('([^']+)'/.exec(line);
  if (m) backend.add(`${m[1].toUpperCase()} ${m[2]}`);
}

// Vercel serverless file-based routes
const vercelRaw = sh(`find api -name '*.ts' -not -name '_*'`);
const vercel = vercelRaw.split('\n').filter(Boolean).map(f => '/' + f.replace(/\.ts$/,''));

// Frontend calls
const feRaw = sh(`grep -rnoE "fetch\\('/api/[^']+'" src/`);
const fe = [];
for (const line of feRaw.split('\n').filter(Boolean)) {
  const m = /^([^:]+):(\d+):fetch\('([^']+)'/.exec(line);
  if (m) fe.push({ file: m[1], line: m[2], path: m[3] });
}

// Gateway route prefixes
const gwRaw = sh(`grep -oE "prefix: '[^']+', target: SERVICE_URL\\.[a-z]+" services/gateway/index.ts`);
const gw = gwRaw.split('\n').filter(Boolean).map(l => {
  const m = /prefix: '([^']+)', target: SERVICE_URL\.(\w+)/.exec(l);
  return m ? { prefix: m[1], svc: m[2] } : null;
}).filter(Boolean);

const pickGw = (p) => {
  let best = null;
  for (const r of gw) if (p === r.prefix || p.startsWith(r.prefix + '/')) if (!best || r.prefix.length > best.prefix.length) best = r;
  return best;
};

console.log('=== BACKEND ROUTES (' + backend.size + ') ===');
[...backend].sort().forEach(r => console.log('  ' + r));

console.log('\n=== VERCEL SERVERLESS ROUTES (' + vercel.length + ') ===');
vercel.sort().forEach(r => console.log('  ' + r));

console.log('\n=== FRONTEND CALLS -> RESOLUTION ===');
const backendPaths = new Set([...backend].map(r => r.split(' ')[1]));
for (const c of fe) {
  const g = pickGw(c.path);
  const exists = backendPaths.has(c.path);
  const flag = !g ? 'NO-GATEWAY-ROUTE' : exists ? 'ok' : 'NO-BACKEND-HANDLER';
  console.log(`  [${flag.padEnd(18)}] ${c.path.padEnd(38)} svc=${g?g.svc:'-'}   ${c.file}:${c.line}`);
}

console.log('\n=== BACKEND ROUTES NEVER CALLED BY FRONTEND ===');
const fePaths = new Set(fe.map(c=>c.path));
[...backend].sort().forEach(r => {
  const p = r.split(' ')[1];
  if (!p.startsWith('/api/')) return;
  if (!fePaths.has(p) && !p.includes(':') && p !== '/api') console.log('  ' + r);
});
