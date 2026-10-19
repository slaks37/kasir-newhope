import assert from 'node:assert/strict';
// Rows must be PostgreSQL jsonb::text, not JS-number round-tripped records.
// Fail closed on deletions, schema changes, target drift or unknown dependencies.
export function planBusinessDelta(baseline,next,current){
 const key=t=>`${t.schema}.${t.name}`, map=ts=>new Map(ts.map(t=>[key(t),t]));
 const old=map(baseline.tables), fresh=map(next.tables), target=map(current.tables);
 assert.equal(fresh.size,old.size,'TABLE_SCOPE_CHANGED');
 const plans=[];
 for(const [name,a] of old){
  const b=fresh.get(name),c=target.get(name);assert(b&&c,'TABLE_SCOPE_CHANGED');
  assert.deepEqual(b.columns,a.columns,'SOURCE_SCHEMA_CHANGED');
  assert.deepEqual([...c.rows].sort(),[...a.rows].sort(),'TARGET_DRIFT:'+name);
  if(JSON.stringify([...a.rows].sort())===JSON.stringify([...b.rows].sort()))continue;
  const pk=(baseline.constraints||[]).find(v=>v.schema===a.schema&&v.table===a.name&&v.type==='p');
  const match=pk?.definition.match(/^PRIMARY KEY \(([^)]+)\)$/);assert(match,'CHANGED_TABLE_PRIMARY_KEY_REQUIRED:'+name);
  const columns=match[1].split(',').map(v=>v.trim().replace(/^"|"$/g,''));
  assert(columns.every(k=>/^[a-z_][a-z0-9_]*$/.test(k)),'UNSUPPORTED_PRIMARY_KEY');
  const id=row=>{const value=JSON.parse(row);return JSON.stringify(columns.map(k=>{assert(['string','number'].includes(typeof value[k]),'UNSUPPORTED_KEY');if(typeof value[k]==='number')assert(Number.isSafeInteger(value[k]),'UNSAFE_NUMERIC_KEY');return value[k];}));};
  const before=new Map(a.rows.map(r=>[id(r),r])),after=new Map(b.rows.map(r=>[id(r),r]));
  assert.equal(before.size,a.rows.length,'DUPLICATE_BASELINE_KEY');assert.equal(after.size,b.rows.length,'DUPLICATE_SOURCE_KEY');
  for(const k of before.keys())assert(after.has(k),'SOURCE_DELETE_REQUIRES_REVIEW:'+name);
  plans.push({...b,primaryKey:columns,inserts:b.rows.filter(r=>!before.has(id(r))),updates:b.rows.filter(r=>before.has(id(r))&&before.get(id(r))!==r)});
 }
 // Catalog changes need an independently reviewed schema migration, never auto-DDL.
 for(const field of ['constraints','enums','indexes','triggers','policies','functions','sequences']){
  const clean=v=>JSON.stringify((v||[]).map(x=>{const {state,...rest}=x;return rest;}).map(x=>JSON.stringify(x)).sort());
  assert.equal(clean(next[field]),clean(baseline[field]),'SOURCE_CATALOG_CHANGED:'+field);
 }
 const pending=new Map(plans.map(t=>[key(t),t])),ordered=[];
 while(pending.size){let advanced=false;for(const [name,t] of pending){
  const deps=(next.constraints||[]).filter(c=>c.schema===t.schema&&c.table===t.name&&c.type==='f').map(c=>c.definition.match(/REFERENCES ([a-z_]+)\.([a-z_]+)\(/)).filter(Boolean).map(m=>m[1]+'.'+m[2]);
  // Unknown reference syntax is rejected below by live catalog dependency validation.
  if(deps.some(d=>d!==name&&pending.has(d)))continue;
  ordered.push(t);pending.delete(name);advanced=true;
 }assert(advanced,'CYCLIC_CHANGED_TABLE_DEPENDENCIES');}
 return ordered;
}
