import assert from 'node:assert/strict';
import {createAuthClient} from '@neondatabase/auth';
import {BetterAuthVanillaAdapter} from '@neondatabase/auth/vanilla/adapters';
import {revokeManagedSessions,clearRevokedManagedProfile} from '../../src/lib/auth/managedSessions';

const base='https://ep-flat-recipe-azti3hh0.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth';
const native=globalThis.fetch;let calls=0,status=200,body:unknown={status:true};
try{
 globalThis.fetch=async(input,options)=>{
  assert.equal(String(input),base+'/revoke-sessions');assert.equal(options?.method,'POST');assert.equal(options.credentials,'include');
  assert.deepEqual(options.body?JSON.parse(String(options.body)):{},{} ,'No user, tenant, email or token selector may be supplied');
  calls++;return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 };
 const client=createAuthClient(base,{adapter:BetterAuthVanillaAdapter({fetchOptions:{credentials:'include',retry:0}})});
 await revokeManagedSessions(client);assert.equal(calls,1);
 body={status:false};await assert.rejects(revokeManagedSessions(client));assert.equal(calls,2);
 body={};await assert.rejects(revokeManagedSessions(client));assert.equal(calls,3);
 status=401;body={code:'UNAUTHORIZED',message:'synthetic denied'};await assert.rejects(revokeManagedSessions(client));assert.equal(calls,4);
 status=503;body={code:'UNAVAILABLE',message:'synthetic unavailable'};await assert.rejects(revokeManagedSessions(client));assert.equal(calls,5,'No retry storm on provider failure');
 globalThis.fetch=async()=>{calls++;throw Error('synthetic timeout');};await assert.rejects(revokeManagedSessions(client));assert.equal(calls,6);
 const local=new Map([['nh-managed-neon-offline-profile-v1','old profile'],['nhpos_local_session','old hint'],['nhpos_internal_identity','old admin hint'],['newhope_pos_guest_mode','1'],['pos-outbox','unsynced synthetic sale'],['business-cache','preserve']]);
 const session=new Map([['nh-neon-admin-mfa','old proof'],['nhpos_internal_identity','old admin hint'],['pos-draft','preserve']]);
 clearRevokedManagedProfile({removeItem:k=>{local.delete(k);}},{removeItem:k=>{session.delete(k);}});
 assert.deepEqual([...local],[['pos-outbox','unsynced synthetic sale'],['business-cache','preserve']]);assert.deepEqual([...session],[['pos-draft','preserve']]);
 console.log('PASS managed self-service revocation: installed SDK exact authenticated POST, no target identity, explicit provider confirmation, unauthorized/malformed/timeout/5xx fail closed without retry, local Auth/MFA hints cleared while POS outbox/drafts persist; no real provider request');
}finally{globalThis.fetch=native;}
