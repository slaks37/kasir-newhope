import assert from 'node:assert/strict';
import adminHandler from '../../src/server/adminHandler';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { discoverEditorial, normalizeEditorial } from '../../src/server/editorialDiscovery';
import { registerBlogRoutes } from '../../src/server/blogRoutes';
import { renderBlogPost, renderRss, renderSitemap, type PublicPost } from '../../src/server/blogPages';
import type { Db } from '../../services/shared/db';
import { execFileSync } from 'node:child_process';
for (const [method,url,expected] of [['GET','/blog/','/blog'],['HEAD','/blog/article/?utm_source=test','/blog/article?utm_source=test']]) {
 let redirected='';const res={setHeader(){},redirect(code:number,target:string){assert.equal(code,308);redirected=target;}};
 await adminHandler({method,url,headers:{}},res);assert.equal(redirected,expected);
}
const home=fs.readFileSync('src/components/home/HomePage.tsx','utf8');
for(const category of ['kuliner-fnb','laundry-jasa','fintech-qris'])assert.ok(home.includes('/blog?kategori='+category));
for(const slug of ['cara-membuka-kafe-modal-10-juta-sukses','rahasia-sukses-bisnis-laundry-kiloan-omset-puluhan-juta','revolusi-qris-dinamis-pos-umkm-tanpa-biaya-admin'])assert.ok(!home.includes('href="/blog/'+slug+'"'));
const pg = new PGlite();
const db = { query: async (sql: string, args?: unknown[]) => { const r = await pg.query(sql,args); return {rows:r.rows,rowCount:r.rows.length}; } } as Db;
try {
 await pg.exec('CREATE TABLE public.blog_posts(id text,slug text,title text,category text,seo jsonb,is_published boolean,created_at timestamptz)');
 for(let i=0;i<237;i++) await db.query(`INSERT INTO public.blog_posts VALUES($1,$1,$2,'Kuliner & F&B',$3,true,'2026-10-19')`,['article-'+i, 'Cara menghitung HPP kopi susu kedai '+i,JSON.stringify({focusKeyword:'HPP kopi susu',sources:[{url:'https://media.example/news/hpp'}]})]);
 await db.query(`INSERT INTO public.blog_posts VALUES('secret','secret','Rahasia draft laundry','Laundry & Jasa','{}',false,now())`);
 assert.equal(normalizeEditorial('HPP—KOPI & Susu!'),'hpp kopi susu');
 const check=(title:string,extra={})=>discoverEditorial(db,{title,...extra});
 let result=await check('CARA MENGHITUNG HPP KOPI SUSU KEDAI 236!!!');
 assert.equal(result.classification,'EXACT_DUPLICATE');assert.deepEqual(result.archive,{complete:true,count:237});
 assert.equal((await check('Berbeda sekali',{slug:'ARTICLE-236'})).classification,'EXACT_DUPLICATE');
 assert.equal((await check('Menghitung HPP kopi susu kedai terbaru')).classification,'TOPIC_OVERLAP');
 assert.equal((await check('Biaya minuman', {keyword:'HPP kopi susu',category:'Kuliner & F&B'})).classification,'TOPIC_OVERLAP');
 assert.equal((await check('Berita berbeda',{sourceUrls:['https://media.example/news/hpp?utm_source=test#news']})).classification,'TOPIC_OVERLAP');
 assert.equal((await check('Manajemen jadwal karyawan laundry')).classification,'UNIQUE');
 assert.equal((await check('Rahasia draft laundry')).classification,'UNIQUE','Draft metadata never enters published archive');
 assert.equal((await check('Semua judul',{category:'Kuliner & F&B'})).classification,'UNIQUE','Category alone cannot establish overlap');
 assert.equal((await check('')).classification,'INCONCLUSIVE');
 assert.equal((await discoverEditorial({query:async()=>{throw Error('synthetic outage');}} as unknown as Db,{title:'Unik'})).classification,'INCONCLUSIVE');
 // Registered authenticated REST and MCP routes, no listener, synthetic database only.
 const handlers=new Map<string,Function>();const app={get(){},post(path:string,handler:Function){handlers.set(path,handler);},put(){},delete(){}};
 registerBlogRoutes(app as any,async()=>db,async()=>{throw Error('NO_COVER_NETWORK');});
 process.env.BLOG_API_KEYS='synthetic-editorial-key-0123456789';
 const request=async(path:string,body:any,authorized=true)=>{let status=200,data:any;const res={setHeader(){},status(n:number){status=n;return this;},json(v:any){data=v;return this;}};await handlers.get(path)!({method:'POST',path,headers:authorized?{'x-api-key':process.env.BLOG_API_KEYS}:{},body},res);return {status,data};};
 assert.equal((await request('/api/v1/blog-automation/duplicate-check',{title:'Manajemen jadwal karyawan laundry'},false)).status,401);
 assert.equal((await request('/api/v1/blog-automation/duplicate-check',{title:'Manajemen jadwal karyawan laundry'})).data.classification,'UNIQUE');
 result=(await request('/api/v1/blog-automation/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'check_duplicate',arguments:{title:'HPP',slug:'article-236'}}})).data.result.structuredContent;
 assert.equal(result.classification,'EXACT_DUPLICATE');
 assert.equal((await db.query('SELECT count(*) FROM public.blog_posts')).rows[0].count,238,'Read-only checks preserve archive');
 const post={id:'xml',slug:'special-article',title:'HPP <kopi> & "susu"',excerpt:'Harga < laba & biaya',content:'## Bagian satu\n\nArtikel lengkap.\n\n### Penjelasan\n\nIsi detail.',category:'Kuliner & F&B',coverImage:'https://images.example/cover.jpg?a=1&b=2',author:{name:'Editor',role:'Penulis',avatar:''},readingTimeMinutes:2,tags:[],isFeatured:false,mediaEmbeds:[],seo:{},createdAt:'2026-10-12T00:00:00.000Z',updatedAt:'2026-10-19T00:00:00.000Z'} satisfies PublicPost;
 const rss=renderRss([post]),sitemap=renderSitemap([post]);
 // Real XML parser, not regex-only validation. Also verify dates, stable GUID and URL uniqueness.
 execFileSync('python3',['-c',`import sys,json,xml.etree.ElementTree as E,email.utils,datetime
rss,sm=json.load(sys.stdin)
r=E.fromstring(rss); assert r.tag=='rss' and r.attrib['version']=='2.0'
i=r.find('channel/item'); assert i.findtext('title')=='HPP <kopi> & "susu"'
assert i.findtext('guid')==i.findtext('link')
assert email.utils.parsedate_to_datetime(i.findtext('pubDate')).isoformat()=='2026-10-12T00:00:00+00:00'
s=E.fromstring(sm); ns={'s':'http://www.sitemaps.org/schemas/sitemap/0.9'}
locs=[e.text for e in s.findall('s:url/s:loc',ns)]; assert len(locs)==len(set(locs))
assert [e.text for e in s.findall('s:url/s:lastmod',ns)]==['2026-10-19T00:00:00.000Z']
`],{input:JSON.stringify([rss,sitemap])});
 assert.equal(renderRss([post]),rss,'Dates and GUID do not change on regeneration');
 const html=renderBlogPost(post,[]);
 assert.equal((html.match(/<h1[ >]/g)||[]).length,1);assert.ok(html.includes('Artikel lengkap.'));
 assert.match(html,/<link rel="canonical" href="https:\/\/kasir.newhope.space\/blog\/special-article">/);
 for(const name of ['description','twitter:title','twitter:description','twitter:image'])assert.ok(html.includes(`name="${name}"`));
 const ld=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
 assert.ok(ld.some(v=>v['@type']==='BlogPosting'&&v.datePublished===post.createdAt&&v.dateModified===post.updatedAt));assert.ok(ld.some(v=>v['@type']==='BreadcrumbList'));
 console.log('PASS editorial: 237-record archive, exact/near/topic/keywords/sources, draft exclusion, outage/invalid INCONCLUSIVE, REST auth and MCP, no writes; parsed RSS/sitemap XML, dates, metadata, SSR and JSON-LD');
} finally { await pg.close(); }
