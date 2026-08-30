#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'services', 'api', 'scripts'];
const exts = ['.ts', '.tsx', '.mjs'];
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.includes(path.extname(e.name))) files.push(p);
  }
}
for (const r of ROOTS) if (fs.existsSync(r)) walk(r);

const IMPORT_RE = /(?:^|\n)\s*(?:import\s[^'"]*?from\s*|import\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]/g;

function resolve(from, spec) {
  if (!spec.startsWith('.')) return null; // external
  const base = path.resolve(path.dirname(from), spec);
  const cands = [base, ...exts.map(e => base + e), ...exts.map(e => path.join(base, 'index' + e))];
  for (const c of cands) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.relative(process.cwd(), c);
  }
  return null;
}

const edges = [];
const externals = new Map();
const fanIn = new Map();
const fanOut = new Map();

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[1];
    const target = resolve(f, spec);
    if (target) {
      edges.push([f, target]);
      fanOut.set(f, (fanOut.get(f) || 0) + 1);
      fanIn.set(target, (fanIn.get(target) || 0) + 1);
    } else if (!spec.startsWith('.')) {
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0,2).join('/') : spec.split('/')[0];
      externals.set(pkg, (externals.get(pkg) || 0) + 1);
    }
  }
}

// layer of a file
const layer = (f) =>
  f.startsWith('services/gateway') ? 'gateway' :
  f.startsWith('services/pos') ? 'svc:pos' :
  f.startsWith('services/ai') ? 'svc:ai' :
  f.startsWith('services/billing') ? 'svc:billing' :
  f.startsWith('services/backoffice') ? 'svc:backoffice' :
  f.startsWith('services/db-server') ? 'svc:db-server' :
  f.startsWith('services/shared') ? 'shared' :
  f.startsWith('src/lib/assistant') ? 'lib:assistant' :
  f.startsWith('src/server') ? 'src:server' :
  f.startsWith('src/admin') ? 'ui:admin' :
  f.startsWith('src/components') ? 'ui:components' :
  f.startsWith('src/context') ? 'ui:context' :
  f.startsWith('src/lib') ? 'lib' :
  f.startsWith('src/data') ? 'data' :
  f.startsWith('src/utils') ? 'utils' :
  f.startsWith('src/') ? 'src:root' :
  f.startsWith('api/') ? 'vercel-api' :
  f.startsWith('scripts/') ? 'scripts' : 'other';

const cross = new Map();
for (const [a, b] of edges) {
  const k = layer(a) + ' -> ' + layer(b);
  cross.set(k, (cross.get(k) || 0) + 1);
}

console.log('FILES ANALYZED:', files.length, ' INTERNAL EDGES:', edges.length);
console.log('\n=== CROSS-LAYER EDGES (count) ===');
[...cross.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
  const [from,to] = k.split(' -> ');
  if (from !== to) console.log(String(v).padStart(4), k);
});

console.log('\n=== TOP FAN-IN (most depended upon) ===');
[...fanIn.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([f,v]) => console.log(String(v).padStart(4), f));

console.log('\n=== TOP FAN-OUT (most dependencies) ===');
[...fanOut.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([f,v]) => console.log(String(v).padStart(4), f));

console.log('\n=== TOP EXTERNAL PACKAGES ===');
[...externals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([f,v]) => console.log(String(v).padStart(4), f));

// orphans: no fan-in and not an entrypoint
const ENTRY = /(?:index|main|dev)\.(ts|tsx|mjs)$|^scripts\/|^api\//;
const orphans = files.filter(f => !fanIn.has(f) && !ENTRY.test(f));
console.log('\n=== FILES WITH ZERO INTERNAL IMPORTERS (non-entrypoint) ===');
orphans.forEach(f => console.log('   ', f));


