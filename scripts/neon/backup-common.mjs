import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
export const sourceProject='fqxrhumsgigcgjtlbfuo';
export const projectId='steep-sea-66546931';
export const appSchemas=['public','pos','internal','billing','ai','contract','mcp_private','blog_mcp_private'];
export const credentialColumns=['password_hash','pin','pin_hash','token_hash'];
export const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
export const relation=row=>quote(row.schema)+'.'+quote(row.name||row.table);
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function privateFile(file){if((fs.statSync(file).mode&0o077)!==0)throw Error('PRIVATE_FILE_PERMISSIONS_REQUIRED');return fs.readFileSync(file);}
export async function loadBackup(file,key='.env.neon-backup-keys.local/private.asc'){
 const fresh=process.env.NEON_RESTORE_TARGET==='fresh-candidate';
 const reviewed=fresh?JSON.parse(fs.readFileSync('neon/targets/fresh-candidate.json','utf8')):null;
 file=file||(reviewed?.capture||'build/neon/source-2026-10-13-v3.pgp.b64');
 const openpgp=await import('../../build/neon-tools/node_modules/openpgp/dist/node/openpgp.mjs');
 const ciphertext=privateFile(file),privateKey=await openpgp.readPrivateKey({armoredKey:privateFile(key).toString('utf8')});
 if(reviewed&&(file!==reviewed.capture||sha(ciphertext)!==reviewed.ciphertextSha256))throw Error('FRESH_CAPTURE_REVIEW_MISMATCH');
 const message=await openpgp.readMessage({binaryMessage:Buffer.from(ciphertext.toString('utf8'),'base64')});
 const decrypted=await openpgp.decrypt({message,decryptionKeys:privateKey});
 const snapshot=JSON.parse(decrypted.data);
 if(snapshot.format!=='newhope-pg-catalog-v1'||snapshot.sourceProject!==sourceProject||snapshot.schemas.join(',')!==appSchemas.join(',')||!snapshot.dataPolicy.startsWith('credential-free'))throw Error('UNTRUSTED_BACKUP_SCOPE');
 return {snapshot,ciphertextSha256:sha(ciphertext),file:path.resolve(file)};
}
export function restoreTarget(file){
 const selection=process.env.NEON_RESTORE_TARGET||'full-restore';
 if(!['full-restore','clean-rehearsal','fresh-candidate'].includes(selection))throw Error('RESTORE_TARGET_NOT_REVIEWED');
 const clean=selection==='clean-rehearsal',fresh=selection==='fresh-candidate';
 file=file||(fresh?'.env.neon-fresh-candidate.local':clean?'.env.neon-clean-restore.local':'.env.neon-data-restore.local');
 const env=parse(privateFile(file));
 const manifest=JSON.parse(fs.readFileSync('neon/targets/'+selection+'.json','utf8'));
 const allowedBranch=manifest.branchId||manifest.branch_id;
 if(manifest.default!==false||env.NEON_PROJECT_ID!==projectId||env.NEON_BRANCH_ID!==allowedBranch||allowedBranch==='br-icy-dust-azqi5vlc'||allowedBranch==='br-falling-butterfly-az989m86')throw Error('RESTORE_CHILD_BRANCH_MISMATCH');
 const url=new URL(env.NEON_RESTORE_DATABASE_URL||'');
 url.hostname=url.hostname.replace('-pooler','');
 if(url.protocol!=='postgresql:'||url.hostname!==env.NEON_RESTORE_HOST||url.hostname!==manifest.host||url.hostname.includes('-pooler')||url.pathname!=='/neondb'||!url.hostname.endsWith('.ap-southeast-1.aws.neon.tech')||
   url.hash||(url.port&&url.port!=='5432')||[...url.searchParams.keys()].some(k=>!['sslmode','channel_binding','application_name'].includes(k)))throw Error('RESTORE_ENDPOINT_MISMATCH');
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(key);
 return {env,manifest,connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000};
}
export function publicSummary(snapshot,ciphertextSha256){
 return {format:snapshot.format,sourceProject:snapshot.sourceProject,capturedAt:snapshot.capturedAt,postgresVersion:snapshot.postgresVersion,ciphertextSha256,
 dataPolicy:snapshot.dataPolicy,redactedColumns:snapshot.redactedColumns,omittedTables:snapshot.omittedTables,redactedNestedPaths:snapshot.redactedNestedPaths||[],
 schemas:snapshot.schemas,tables:snapshot.tables.map(t=>({schema:t.schema,name:t.name,rows:t.rows.length,rls:t.rls,columns:t.columns.length})),
 objectCounts:{tables:snapshot.tables.length,enums:snapshot.enums?.length||0,sequences:snapshot.sequences?.length||0,functions:snapshot.functions?.length||0,views:snapshot.views?.length||0,constraints:snapshot.constraints?.length||0,indexes:snapshot.indexes?.length||0,triggers:snapshot.triggers?.length||0,policies:snapshot.policies?.length||0},
 auth:{users:snapshot.authMetadata.length,verified:snapshot.authMetadata.filter(a=>a.email_confirmed_at).length},
 restrictions:['Catalog-derived logical snapshot, not native pg_dump or independent full-source rollback backup','No auth password hashes, MFA factors, sessions, tokens or storage bytes','Credential and MCP-connection reset required before cutover','No source freeze; snapshot is rehearsal only']};
}
