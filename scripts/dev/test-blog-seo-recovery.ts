import assert from 'node:assert/strict';
import {registerBlogRoutes} from '../../src/server/blogRoutes';
import {renderSitemap,type PublicPost} from '../../src/server/blogPages';
// Exercise registered routes without localhost/network or a production database.
const handlers=new Map<string,Function>();
const app={get(paths:string|string[],handler:Function){for(const path of Array.isArray(paths)?paths:[paths])handlers.set(path,handler);},post(){},put(){},delete(){}};
let fault:string|null=null;
const db={async query(sql:string){if(fault)throw Object.assign(new Error('synthetic unavailable store'),{code:fault});return {rows:sql.includes('count(*)')?[{n:0}]:[]};}};
registerBlogRoutes(app as any,async()=>db as any,async()=>{throw Error('NO_EXTERNAL_COVER_REQUEST');});
const log=console.error;console.error=()=>{};
try{
 for(const code of ['42P01','42501','08006'])for(const path of ['/blog','/sitemap.xml','/blog/sitemap.xml','/rss.xml','/blog/:slug']){
  fault=code;let status=200,body='';const headers:Record<string,string>={};const res={setHeader(k:string,v:string){headers[k]=v;},status(n:number){status=n;return this;},type(){return this;},send(v:string){body=v;return this;}};
  await handlers.get(path)!({method:'GET',path,query:{},params:{slug:'synthetic-post'}},res);
  assert.equal(status,503,`${path}: database failure must not advertise an empty successful index`);
  assert.equal(headers['Cache-Control'],'no-store');assert.equal(headers['Retry-After'],'300');assert(!body.includes('<urlset'));
 }
 fault=null;
 for(const [path,expected] of [['/blog',200],['/rss.xml',200],['/blog/:slug',404]] as const){
  let status=200,body='';const res={setHeader(){},status(n:number){status=n;return this;},type(){return this;},send(s:string){body=s;return this;}};
  await handlers.get(path)!({method:'GET',path,query:{},params:{slug:'synthetic-post'}},res);assert.equal(status,expected);assert(body);
 }
 let result='';const ok={setHeader(){},type(){return this;},send(s:string){result=s;return this;}};
 await handlers.get('/sitemap.xml')!({method:'GET',path:'/sitemap.xml'},ok);assert(result.includes('<urlset'),'A genuinely empty database is different from a failed query');
 const saved=process.env.PUBLIC_SITE_URL;process.env.PUBLIC_SITE_URL='https://seo.example';
 try{
  const posts=[{slug:'laundry-guide',category:'Tips Bisnis',updatedAt:'2026-10-12T00:00:00.000Z',coverImage:''},{slug:'hpp-guide',category:'Kuliner & F&B',updatedAt:'2026-10-19T00:00:00.000Z',coverImage:''}] as PublicPost[];
  const xml=renderSitemap(posts),entries=xml.match(/<url>.*?<\/url>/g)||[];
  assert.equal((xml.match(/<lastmod>/g)||[]).length,2,'Only tracked article modifications become lastmod');
  assert(entries.find(e=>e.includes('<loc>https://seo.example/</loc>'))&&!entries.find(e=>e.includes('<loc>https://seo.example/</loc>'))!.includes('lastmod'));
  assert(entries.find(e=>e.includes('/blog/laundry-guide'))!.includes('2026-10-12T00:00:00.000Z'));
  assert(entries.find(e=>e.includes('/blog/hpp-guide'))!.includes('2026-10-19T00:00:00.000Z'));
  assert(!xml.includes('<loc>https://seo.example/sitemap.xml</loc>'));assert(!xml.includes('/admin'));assert(!xml.includes('/api/'));
  assert(!renderSitemap([]).includes('lastmod'),'No fabricated fallback date');
 }finally{if(saved===undefined)delete process.env.PUBLIC_SITE_URL;else process.env.PUBLIC_SITE_URL=saved;}
 console.log('PASS SEO recovery: database failures return503+retry/no-store, real empty sitemap works, accurate article-only lastmod, no sitemap/admin/API URLs submitted');
}finally{console.error=log;}
