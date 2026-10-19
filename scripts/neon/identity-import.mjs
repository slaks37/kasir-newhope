import fs from 'node:fs';
import pg from 'pg';
import {planIdentityImport,applyIdentityImport,revokeIdentityImport} from './identity-core.mjs';

const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
if(option('--env'))process.env.NEON_STAGING_ENV_FILE=option('--env');
const {stagingTarget}=await import('./better-target.mjs');
const readPrivate=file=>{
  if(!file)throw Error('IDENTITY_PRIVATE_INPUT_REQUIRED');
  const stat=fs.statSync(file);if(!stat.isFile()||(stat.mode&0o077))throw Error('IDENTITY_INPUT_MODE_600_REQUIRED');
  return JSON.parse(fs.readFileSync(file,'utf8'));
};
const {env,...transport}=stagingTarget(option('--env')||'.env.better-auth-staging.local');
const client=new pg.Client(transport);
try {
  await client.connect();
  if(!client.connection.stream.encrypted||!client.connection.stream.authorized)throw Error('IDENTITY_TLS_REQUIRED');
  let result;
  if(option('--revoke-batch')) {
    if(!process.argv.includes('--apply'))throw Error('IDENTITY_REVOCATION_EXPLICIT_APPLY_REQUIRED');
    result=await revokeIdentityImport(client,option('--revoke-batch'),option('--reviewer'),option('--reason'));
  }else {
    const input=readPrivate(option('--input'));
    if(process.argv.includes('--apply'))result=await applyIdentityImport(client,input,readPrivate(option('--review')));
    else {
      if(!option('--out'))throw Error('IDENTITY_PLAN_OUTPUT_REQUIRED');
      result=await planIdentityImport(client,input,option('--issuer')||env.BETTER_AUTH_URL);
      fs.writeFileSync(option('--out'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
      // Output excludes names, addresses, hashes of credentials and auth links.
      result={status:'PLAN_ONLY',rowCount:result.rowCount,sourceDigest:result.sourceDigest,output:option('--out')};
    }
  }
  console.log(JSON.stringify(result));
}catch(e){console.error(JSON.stringify({status:'FAILED',code:/^IDENTITY_/.test(e.message)?e.message:'IDENTITY_OPERATION_FAILED'}));process.exitCode=1;}
finally {await client.end();}
