// Explicit hosted staging test; newly created credentials arrive via stdin, never logs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { qualifiedFixture } from './test-blog-automation.mjs';
const rl=createInterface({input:process.stdin});
const cfg=JSON.parse(await new Promise(resolve=>rl.once('line',resolve)));rl.close();
const base=new URL(cfg.shareUrl).origin;
assert.ok(base.includes('kasir-newhope-')&&base.endsWith('.vercel.app'));
const cookies=new Map();let next=cfg.shareUrl;
for(let i=0;i<6;i++){
 const r=await fetch(next,{redirect:'manual',headers:{cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},signal:AbortSignal.timeout(30000)});
 for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0];const at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
 const location=r.headers.get('location');if(!location)break;
 next=new URL(location,next).href;
 assert.equal(new URL(next).origin,base,'Share access redirected outside staging origin');
}
const call=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',redirect:'manual',headers:{cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'x-api-key':cfg.key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});let result;try{result=await r.json();}catch{result={error:'NON_JSON_RESPONSE'};}return {status:r.status,body:result};};
const report={testedAt:new Date().toISOString(),base,checks:[]};
try{
 const guide=await call('/api/v1/blog-automation/guide');assert.equal(guide.status,200,JSON.stringify(guide));report.checks.push('authenticated Preview guide');
 const article=structuredClone(qualifiedFixture.article);article.title+=' Staging PR31';article.slug='fixture-biaya-bahan-pr31-'+Date.now();
 const s=article.sources[0];article.sourceFeed=`<rss><item><title>${s.title}</title><link>${s.url}</link><pubDate>${new Date(s.publishedAt).toUTCString()}</pubDate></item></rss>`;
 const valid=await call('/api/v1/blog-automation/validate',article);assert.equal(valid.body.ok,true,JSON.stringify(valid));report.checks.push('recovered-category fixture validates');
 const invalid=await call('/api/v1/blog-automation/validate',{...article,category:'Gosip'});assert.equal(invalid.body.ok,false);report.checks.push('invalid category rejected');
 const short=await call('/api/v1/blog-automation/validate',{...article,content:'Pendek'});assert.equal(short.body.ok,false);report.checks.push('short content rejected');
 // Fixture publication verifies Neon concurrency separately from paid Agnes E2E.
 article.coverImage=cfg.imageUrl;
 const results=await Promise.all([call('/api/v1/blog-automation/posts',article),call('/api/v1/blog-automation/posts',article)]);
 assert.deepEqual(results.map(x=>x.status).sort(),[201,409],JSON.stringify(results));
 report.checks.push('concurrent duplicate: one 201 and one 409');
 report.articleUrl=results.find(x=>x.status===201).body.post.url;
 report.status='PASS';
}catch(e){report.status='FAIL';report.error={name:e.name,message:e.message};process.exitCode=1;}
fs.writeFileSync('../../outputs/newhope-preview-fixture-test.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
