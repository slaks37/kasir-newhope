import assert from 'node:assert/strict';
import {normalizeVercelUrl} from '../../src/server/vercelUrl';
for(const url of ['/api/blog-mcp/token','/api/v1/subscription/verify?invoiceId=test&tag=a&tag=b&__proto__=safe','/api/v1/sync/[...slug]?__path=%2Fapi%2Fv1%2Fsync%2Freports&outletId=one']){
 const req:any={url,headers:{}};
 Object.defineProperty(req,'query',{get(){throw Error('DEPRECATED_RUNTIME_GETTER_MUST_NOT_RUN');},configurable:true});
 normalizeVercelUrl(req);
 assert.equal(Object.getPrototypeOf(req.query),null);
 if(url.includes('invoiceId')){assert.equal(req.query.invoiceId,'test');assert.deepEqual(req.query.tag,['a','b']);assert.equal(req.query.__proto__,'safe');}
 if(url.includes('__path')){assert.equal(req.url,'/api/v1/sync/reports?outletId=one');assert.equal(req.query.outletId,'one');assert.equal(req.query.__path,undefined);}
}
const nested:any={url:'/api/[...slug]?__path=%2Fapi%2Fverify%3FinvoiceId%3Done&tag=two',headers:{}};
normalizeVercelUrl(nested);assert.equal(nested.query.invoiceId,'one');assert.equal(nested.query.tag,'two');
console.log('PASS: WHATWG query parsing bypasses deprecated platform getter, preserves duplicate/encoded parameters and wildcard routing, rejects prototype pollution');
