import assert from 'node:assert/strict';
import {planBusinessDelta} from '../neon/business-delta.mjs';
const table=(name,rows)=>({schema:'internal',name,columns:[{name:'id'},{name:'parent_id'},{name:'value'}],rows:rows.map(JSON.stringify)});
const a=table('tenants',[{id:'t0',value:'baseline'}]),b=table('memberships',[]),c=table('ledger',[]);
const constraints=[...['tenants','memberships','ledger'].map(table=>({schema:'internal',table,type:'p',definition:'PRIMARY KEY (id)'})),{schema:'internal',table:'memberships',type:'f',definition:'FOREIGN KEY (parent_id) REFERENCES internal.tenants(id)'},{schema:'internal',table:'ledger',type:'f',definition:'FOREIGN KEY (parent_id) REFERENCES internal.memberships(id)'}];
const before={tables:[c,b,a],constraints};
const after={tables:[table('ledger',[{id:'l1',parent_id:'m1',value:'100.00'}]),table('memberships',[{id:'m1',parent_id:'t1'}]),table('tenants',[{id:'t0',value:'updated'},{id:'t1',value:'new owner'}])],constraints};
const forward=planBusinessDelta(before,after,before);
assert.deepEqual(forward.map(t=>t.name),['tenants','memberships','ledger']);
assert.equal(forward[0].updates.length,1);assert.equal(forward.reduce((n,t)=>n+t.inserts.length,0),3);
// Reconstruct source after new Neon writes: full dependent closure, original keys.
const recovered=structuredClone(before);for(const p of forward){const t=recovered.tables.find(t=>t.name===p.name);for(const row of [...p.updates,...p.inserts]){const i=t.rows.findIndex(r=>JSON.parse(r).id===JSON.parse(row).id);if(i<0)t.rows.push(row);else t.rows[i]=row;}}
assert.deepEqual(planBusinessDelta(after,after,recovered),[]);
assert.throws(()=>planBusinessDelta(before,after,after),/TARGET_DRIFT/);
assert.throws(()=>planBusinessDelta(after,before,after),/SOURCE_DELETE/);
const catalog=structuredClone(after);catalog.constraints.push({schema:'internal',table:'ledger',type:'u',definition:'UNIQUE(value)'});assert.throws(()=>planBusinessDelta(before,catalog,before),/CATALOG_CHANGED/);
const schema=structuredClone(after);schema.tables[0].columns.push({name:'unreviewed'});assert.throws(()=>planBusinessDelta(before,schema,before),/SCHEMA_CHANGED/);
console.log('PASS reviewed business delta: parent/member/ledger ordering, updates, dependency closure, target conflict, source deletion and schema/catalog drift rejection');
