import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parse} from 'dotenv';
import {privateFile,sha} from './backup-common.mjs';
// No database connection, container start, dump, key generation or source mutation.
const checks={},expected=JSON.parse(fs.readFileSync('build/neon/recovery-archive-summary.json'));
checks.existingDriveReadbackChecksum=sha(privateFile('build/neon/source-recovery-drive-readback.pgp.b64'))===expected.ciphertextSha256;
const docker=spawnSync('docker',['info','--format','{{.ServerVersion}}'],{encoding:'utf8',timeout:10000});
checks.dockerRunning=docker.status===0;
checks.sourceNativeConnectionFile=false;
try {const env=parse(privateFile('.env.supabase-source.local'));const u=new URL(env.SUPABASE_SOURCE_DATABASE_URL||'');checks.sourceNativeConnectionFile=env.SUPABASE_SOURCE_PROJECT_ID==='fqxrhumsgigcgjtlbfuo'&&['postgresql:','postgres:'].includes(u.protocol)&&!!u.password&&!/PASSWORD|READ_ONLY_USER|REPLACE/.test(u.href)&&(u.hostname==='db.fqxrhumsgigcgjtlbfuo.supabase.co'||u.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(u.username).endsWith('.fqxrhumsgigcgjtlbfuo'))&&(!u.port||u.port==='5432');} catch {}
checks.escrowRecoveredKeyDrill=false;try{const e=JSON.parse(fs.readFileSync('build/neon/escrow-recovery-evidence.json'));checks.escrowRecoveredKeyDrill=e.status==='RECOVERED_KEY_DECRYPTION_PASSED_OWNER_ACCEPTANCE_REQUIRED'&&e.ciphertextSha256===expected.ciphertextSha256;}catch{}
checks.independentRecoveryAcceptance=false;
const blockers=Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
const receipt={status:blockers.length?'BLOCKED':'PREREQUISITES_ONLY_NOT_FULL_RESTORE',checkedAt:new Date().toISOString(),checks,blockers,backupRecreated:false,productionWrites:0,fullSupabaseGoTrueRestore:false};
fs.writeFileSync('build/neon/recovery-prerequisites.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));process.exitCode=blockers.length?2:0;
