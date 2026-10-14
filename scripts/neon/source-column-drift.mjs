import fs from 'node:fs';
import pg from 'pg';
import {loadBackup} from './backup-common.mjs';
import {stagingTarget} from './better-target.mjs';
const {snapshot:s,ciphertextSha256}=await loadBackup();
// Compare the original source catalog to the already-populated repository-schema
// synthetic pilot, read only. This never bootstraps/resets either branch.
const {env,...transport}=stagingTarget(),c=new pg.Client(transport);
await c.connect();try{
 await c.query('BEGIN READ ONLY');
 const columns=(await c.query("SELECT table_schema schema,table_name name,column_name column,data_type type FROM information_schema.columns WHERE table_schema IN('public','pos','internal','billing','ai','contract','mcp_private','blog_mcp_private') ORDER BY 1,2,ordinal_position")).rows;
 const missing=[];for(const t of s.tables){const expected=columns.filter(x=>x.schema===t.schema&&x.name===t.name);for(const x of expected)if(!t.columns.some(a=>a.name===x.column))missing.push({schema:x.schema,table:x.name,column:x.column,type:x.type});}
 const sourceNames=new Set([...s.tables,...s.views,...s.sequences].map(t=>t.schema+'.'+t.name));
 const additionalRelations=[...new Set(columns.map(x=>x.schema+'.'+x.name))].filter(n=>!sourceNames.has(n));
 const evidence={status:'AUDITED',scope:'Metadata-only source capture vs already-populated synthetic repository-schema pilot; not a blanket migration plan',sourceCiphertextSha256:ciphertextSha256,pilotBranch:env.NEON_BRANCH_ID,missingSourceColumns:missing,additionalPilotRelations:additionalRelations};
 fs.writeFileSync('build/neon/source-column-drift-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:'AUDITED',missingSourceColumns:missing,additionalPilotRelations:additionalRelations}));
}finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}
