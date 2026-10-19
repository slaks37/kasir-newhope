import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const dir='build/neon/private-supabase-recovery',args=['compose','--project-name','pr21-isolated-recovery','--env-file',dir+'/.env','-f',dir+'/compose.json'];
function run(extra){const r=spawnSync('docker',[...args,...extra],{encoding:'utf8',timeout:120000});if(r.status!==0)throw Error(r.error?.code==='ENOENT'?'DOCKER_REQUIRED':'DOCKER_OPERATION_FAILED_PRIVATE_LOG_REQUIRED');return r.stdout;}
try{
 const mode=process.argv[2];if(!['validate','start','health'].includes(mode))throw Error('USE_VALIDATE_START_OR_HEALTH');
 const compose=JSON.parse(run(['config','--format','json']));
 if(Object.keys(compose.services).sort().join(',')!=='auth,db'||!compose.networks.default.internal)throw Error('RECOVERY_ISOLATION_REQUIRED');
 for(const s of Object.values(compose.services)){
  if(s.network_mode||s.privileged||s.networks&&Object.keys(s.networks).some(n=>n!=='default')||(s.ports||[]).some(p=>p.host_ip!=='127.0.0.1'))throw Error('PUBLIC_EXPOSURE_REFUSED');
 }
 if(compose.services.auth.environment.GOTRUE_SMTP_HOST!=='127.0.0.1'||compose.services.auth.environment.GOTRUE_EXTERNAL_PHONE_ENABLED!=='false'||!(compose.services.db.tmpfs||[]).some(v=>(typeof v==='string'?v:v.target).startsWith('/var/lib/postgresql/data')))throw Error('RECOVERY_OUTBOUND_OR_PERSISTENCE_REFUSED');
 if(mode==='start'){run(['pull','db','auth']);run(['up','-d','db','auth']);}
 let health=null;if(mode==='health'){const r=await fetch('http://127.0.0.1:59999/health',{signal:AbortSignal.timeout(5000),redirect:'error'});if(!r.ok)throw Error('LOCAL_GOTRUE_NOT_HEALTHY');health=true;}
 const receipt={checkedAt:new Date().toISOString(),status:mode==='start'?'ISOLATED_RUNTIME_STARTED_RESTORE_NOT_RUN':mode==='health'?'LOCAL_AUTH_HEALTH_ONLY_NOT_RECOVERY_ACCEPTANCE':'COMPOSE_ISOLATION_VALIDATED',loopbackOnly:true,internalNetwork:true,noExternalSmtp:true,databaseTmpfs:true,health,fullRestoreVerified:false};
 fs.writeFileSync('build/neon/recovery-runtime-status.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(e){console.error(JSON.stringify({status:'BLOCKED',code:e.message,secretsOmitted:true,fullRestoreVerified:false}));process.exitCode=2;}
