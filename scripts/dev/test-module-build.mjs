import assert from 'node:assert/strict';
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync('dist/.vite/manifest.json', 'utf8'));
const staticGraph = start => {
  const seen = new Set();
  function walk(key) { if (seen.has(key)) return; seen.add(key); for (const next of manifest[key]?.imports || []) walk(next); }
  walk(start); return seen;
};
const workspace = Object.keys(manifest).find(key => manifest[key].name === 'Workspace');
assert(workspace, 'Built workspace chunk must exist');
const entry = staticGraph('index.html'), shell = staticGraph(workspace);
for (const source of [
  ...['fnb','retail','laundry','carwash','barber'].map(id => `src/modules/${id}/Dashboard.tsx`),
  ...['KitchenDisplaySystem','LaundryPipelineView','CarwashPipelineView','BarbershopBookingView'].map(name => `src/components/tables/${name}.tsx`),
  'src/components/inventory/InventoryManager.tsx',
]) {
  assert(manifest[source]?.isDynamicEntry, source + ' must be a lazy entry');
  assert(!entry.has(source) && !shell.has(source), source + ' must not be eagerly imported');
}
console.log('PASS: all five dashboards, four sector workflows and retail inventory are separate dynamic entries outside initial app/workspace static graphs');
