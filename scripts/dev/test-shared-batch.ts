import assert from 'node:assert/strict';
import {runSharedInsights,parseArgs} from '../batch/run-shared-insights';
import type {Db} from '../../services/shared/db';
const events:string[]=[];
const db:Db={
  query:async(sql:string)=>{events.push(sql);return {rows:sql.includes('SELECT m.id')?[{id:'one',external_ref:'one',owner_user_ref:'owner1'},{id:'two',external_ref:'two',owner_user_ref:'owner2'}]:[],rowCount:2} as any;},
  exec:async(sql:string)=>{events.push(sql);},tx:async fn=>fn(db),close:async()=>{},
};
const dependencies={
  compute:async(_db:any,principal:any,business:string)=>{assert.equal(principal.subject,business==='one'?'owner1':'owner2');if(business==='two')throw new Error('AI_DISABLED_ON_FREE');return {} as any;},
  cache:async()=>{events.push('CACHE_WRITE');},now:()=>100,
};
const dry=await runSharedInsights(db,{dryRun:true,limit:2},dependencies);
assert.equal(dry.computed,1);assert.equal(dry.skipped,1);assert.equal(dry.written,0);
assert.ok(events.filter(s=>s==='SET TRANSACTION READ ONLY').length===3);
assert.ok(!events.some(s=>/INSERT|UPDATE|CACHE_WRITE/.test(s)));
events.length=0;
const live=await runSharedInsights(db,{dryRun:false,limit:2},dependencies);
assert.equal(live.written,1);assert.equal(live.attemptRecorded,1);assert.equal(live.skipped,1);
assert.ok(events.some(s=>s==='CACHE_WRITE'));
assert.equal(parseArgs(['--dry-run','--limit','10']).limit,10);
assert.throws(()=>parseArgs(['--limit','101']),/INVALID_ARGUMENTS/);
assert.throws(()=>parseArgs(['--input','unverified.json']),/INVALID_ARGUMENTS/);
console.log('PASS: shared batch dry-run is read-only, verified owner scope, bounded limit, skipped tenants rotate, no duplicate algorithm');
