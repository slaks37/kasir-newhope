// Isolated real API/database/cover normalization. AI and object transport are mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { qualifiedFixture } from './test-blog-automation.mjs';
import { createR2BlogMediaProvider } from '../../src/server/blogStorage.ts';
import { createCoverImporter } from '../../src/server/blogCover.ts';
import { registerBlogRoutes } from '../../src/server/blogRoutes.ts';
const pg=new PGlite();
await pg.exec(`CREATE TABLE public.blog_posts (
 id text PRIMARY KEY,slug text NOT NULL UNIQUE,title text NOT NULL,excerpt text,content text,category text,cover_image text,
 author_name text,author_role text,author_avatar text,reading_time_minutes integer,tags text[],seo jsonb,
 is_published boolean DEFAULT false,is_featured boolean DEFAULT false,media_embeds jsonb,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
const wrap=runner=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},exec:sql=>runner.exec(sql),tx:fn=>pg.transaction(c=>fn(wrap(c))),close:()=>pg.close()});
const db=wrap(pg),objects=new Map();
const env={R2_ACCOUNT_ID:'a'.repeat(32),R2_ACCESS_KEY_ID:'synthetic-access',R2_SECRET_ACCESS_KEY:'synthetic-secret',R2_BUCKET_NAME:'isolated-test',R2_PUBLIC_BASE_URL:'https://media.example'};
const provider=createR2BlogMediaProvider(env,async(_config,input)=>{if(objects.has(input.Key))throw {$metadata:{httpStatusCode:412}};objects.set(input.Key,input.Body);});
const importer=createCoverImporter(provider,async()=>new Response(fs.readFileSync('public/blog/covers/hpp-ingredients-ai.jpg'),{headers:{'content-type':'image/jpeg'}}));
process.env.BLOG_API_KEYS='synthetic-e2e-blog-key-01234567890';process.env.PUBLIC_SITE_URL='https://preview.example';
const app=express();app.use(express.json({limit:'1mb'}));registerBlogRoutes(app,async()=>db,importer);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const call=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-api-key':process.env.BLOG_API_KEYS},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
try {
 const article=structuredClone(qualifiedFixture.article),s=article.sources[0];
 article.sourceFeed=`<rss><item><title>${s.title}</title><link>${s.url}</link><pubDate>${new Date(s.publishedAt).toUTCString()}</pubDate></item></rss>`;
 const validation=await call('/api/v1/blog-automation/validate',article);assert.equal(validation.status,200);assert.equal(validation.body.ok,true,JSON.stringify(validation.body));
 const cover=await call('/api/v1/blog-automation/covers',{imageUrl:'https://storage.googleapis.com/agnes-aigc/fixture.png',alt:'Ilustrasi AI biaya usaha'});
 assert.equal(cover.status,201);assert.equal(objects.size,1);assert.match(cover.body.coverImage,/^https:\/\/media\.example\/automation\/generated\//);
 Object.assign(article,cover.body);
 const results=await Promise.all([call('/api/v1/blog-automation/posts',article),call('/api/v1/blog-automation/posts',article)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const success=results.find(r=>r.status===201);assert.equal(success.body.post.isPublished,true);
 const page=await fetch(base+new URL(success.body.post.url).pathname);assert.equal(page.status,200);
 const html=await page.text();assert.ok(html.includes(cover.body.coverImage));assert.ok(html.includes('property="og:image" content="'+cover.body.coverImage+'"'));
 assert.equal((await db.query('SELECT count(*) AS count FROM public.blog_posts')).rows[0].count,1);
 console.log('PASS: synthetic Agnes parser → real API validation → JPEG normalization → mock R2 conditional write → concurrent publication once in isolated PGlite → page and OG cover verified. No real AI/R2/HTTPS hosting or production writes.');
} finally {await new Promise(r=>server.close(r));await pg.close();}
