import assert from 'node:assert/strict';
import { createSyncHandler } from '../../src/server/syncHandler';
let connections=0;
const handler=createSyncHandler(async()=>null,async()=>{connections++;throw new Error('Unexpected database connection');});
for(const [url,method,status] of [
  ['/api/v1/sync/catalog','POST',401],
  ['/api/v1/sync/transactions','POST',401],
  ['/api/v1/sync/activity','POST',401],
  ['/api/v1/sync/catalog','GET',405],
  ['/api/admin/merchants','POST',404],
  ['/api/v1/sync/../admin','POST',404],
] as const){
  let actual=0;
  const response={setHeader(){},status(n:number){actual=n;return this;},json(){return this;}};
  await handler({url,method,headers:{'x-auth-sub':'forged-owner','x-internal-user':'admin','x-newhope-gateway-token':'forged'}},response);
  assert.equal(actual,status,url);
}
assert.equal(connections,0);
console.log('PASS: POS boundary rejects anonymous/forged identity, wrong method and admin paths before DB access');
