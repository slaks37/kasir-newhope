import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {betaAccessError,checkoutPilotAllowed} from '../../services/shared/releaseGates';
import {createNativeApiHandler} from '../../api/_runtime';
import {createServerlessBoundary} from '../../src/server/serverlessBoundary';
const saved={...process.env},keys=['BETA_ACCESS_MODE','BETA_ALLOWED_SUBJECTS','DOKU_CHECKOUT_PILOT_TENANTS'];
const owner=randomUUID(),stranger=randomUUID();let builds=0;
const response=()=>({code:200,body:undefined as any,setHeader(){},status(n:number){this.code=n;return this;},json(b:any){this.body=b;return this;}});
try{
 process.env.BETA_ACCESS_MODE='invite_only';process.env.BETA_ALLOWED_SUBJECTS=owner;
 assert.equal(betaAccessError(owner),undefined);assert.equal(betaAccessError(stranger),'BETA_INVITE_REQUIRED');
 const native=createNativeApiHandler(async req=>({subject:req.headers.authorization===owner?owner:stranger}),async()=>{builds++;throw Error('SYNTHETIC_NO_DB');});
 const boundary=createServerlessBoundary({name:'beta-test',routes:{'/api/v1/subscription/status':['GET']},bodyLimit:'1kb',register(){},unavailableError:'SYNTHETIC_NO_DB',invalidRequestError:'BAD'},async req=>({subject:req.headers.authorization===owner?owner:stranger}),async()=>{builds++;throw Error('SYNTHETIC_NO_DB');});
 for(const handler of [native,boundary]){
  const denied=response();await handler({url:'/api/v1/subscription/status',method:'GET',headers:{authorization:stranger,'x-auth-sub':owner}},denied);assert.equal(denied.code,403);assert.equal(denied.body.error,'BETA_INVITE_REQUIRED');
  assert.equal(builds,0,'Non-invited principal never connects or writes');
 }
 for(const mode of ['invite_only','typo']){
  process.env.BETA_ACCESS_MODE=mode;process.env.BETA_ALLOWED_SUBJECTS='*';const res=response();await native({url:'/api/v1/subscription/status',method:'GET',headers:{authorization:owner}},res);assert.equal(res.code,503);assert.equal(builds,0);
 }
 process.env.BETA_ACCESS_MODE='invite_only';process.env.BETA_ALLOWED_SUBJECTS=owner;
 const invited=response();await native({url:'/api/v1/subscription/status',method:'GET',headers:{authorization:owner}},invited);assert.equal(invited.code,503);assert.equal(invited.body.error,'DATABASE_UNAVAILABLE');assert.equal(builds,1,'Invited UUID crosses gate but no fake DB success');
 for(const raw of ['',stranger,'*',owner+',*']){process.env.DOKU_CHECKOUT_PILOT_TENANTS=raw;assert.equal(checkoutPilotAllowed(owner),false);}
 process.env.DOKU_CHECKOUT_PILOT_TENANTS=owner;assert.equal(checkoutPilotAllowed(owner),true);assert.equal(checkoutPilotAllowed(stranger),false);
 console.log('PASS release gates: verified principal UUID only; forged headers/unknown subject denied before DB, malformed config fails closed, distinct pilot allowlist has no wildcard');
}finally{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
