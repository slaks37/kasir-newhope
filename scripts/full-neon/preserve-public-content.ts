import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import pg from 'pg';
import {createNeonObjectStorage,publicObjectUrl} from '../../services/shared/objectStorage';
import {fullNeonConfig} from '../../services/shared/fullNeon';
import {preservedBlogCounters} from './contentDelta';

const target=process.argv[2];assert(['staging','production'].includes(target),'EXPLICIT_CONTENT_TARGET_REQUIRED');
if(target==='production')assert.equal(process.env.FULL_NEON_CONTENT_PRODUCTION_APPROVED,'OWNER_CLEAN_START_2026_10_22');
Object.assign(process.env,parse(fs.readFileSync('.env.full-neon-'+target+'.local')),parse(fs.readFileSync('.env.full-neon-'+target+'-storage.local')));
const config=fullNeonConfig(),source=JSON.parse(fs.readFileSync('build/full-neon/private-public-content.json','utf8'));
assert.equal(source.length,1);assert.equal(source[0].schema,'public');assert.equal(source[0].name,'blog_posts');
const rows=source[0].rows.map((r:unknown)=>typeof r==='string'?JSON.parse(r):r);
const columns=source[0].columns.map((c:any)=>c.name);assert(columns.every((c:string)=>/^[a-z_]+$/.test(c)));
const sourceOrigin='https://fqxrhumsgigcgjtlbfuo.supabase.co';
const urls=[...new Set<string>(JSON.stringify(rows).match(/https:\/\/fqxrhumsgigcgjtlbfuo\.supabase\.co\/storage\/v1\/object\/public\/blog-media\/[^\s"<>\\)]+/g)||[])];
const s=createNeonObjectStorage(),mapping=new Map<string,string>(),objects:any[]=[];
const reuseMedia=process.argv.includes('--reuse-verified-media'),allowCounterDelta=process.argv.includes('--reviewed-counter-delta');
const evidenceFile='build/full-neon/public-content-'+target+'.json';
const previous=reuseMedia?JSON.parse(fs.readFileSync(evidenceFile,'utf8')):null;
if(previous)assert(previous.status==='PASS'&&previous.target===target&&Array.isArray(previous.objects),'VERIFIED_MEDIA_EVIDENCE_REQUIRED');
const previousObjects=new Map<string,any>((previous?.objects||[]).map((o:any)=>[o.sourceUrl,o]));
let reusedMedia=0,newMedia=0,counterRows=0;
const cache='build/full-neon/public-media-cache';fs.mkdirSync(cache,{recursive:true,mode:0o700});
try{
 let next=0,completed=0;
 await Promise.all(Array.from({length:6},async()=>{while(next<urls.length){const from=urls[next++];
  const url=new URL(from);assert.equal(url.origin,sourceOrigin);assert(!url.search&&!url.hash);
  const prior=previousObjects.get(from);
  if(prior){
   assert(/^[0-9a-f]{64}$/.test(prior.sha256)&&Number.isSafeInteger(prior.bytes)&&prior.bytes>=100&&prior.bytes<=500000,'INVALID_PRIOR_MEDIA_EVIDENCE');
   const key='preserved/'+prior.sha256+'.jpg';assert.equal(prior.targetUrl,publicObjectUrl(s.config,config.publicBucket,key),'PRIOR_MEDIA_TARGET_MISMATCH');
   assert(await s.exists(key,config.publicBucket),'PREVIOUSLY_VERIFIED_MEDIA_MISSING');
   mapping.set(from,prior.targetUrl);objects.push(prior);reusedMedia++;continue;
  }
  const file=cache+'/'+createHash('sha256').update(from).digest('hex');let bytes:Buffer;
  if(fs.existsSync(file))bytes=fs.readFileSync(file);else{
   const r=await fetch(from,{redirect:'error',signal:AbortSignal.timeout(18000)});assert.equal(r.status,200,'PUBLIC_MEDIA_SOURCE_UNAVAILABLE');
   assert((r.headers.get('content-type')||'').startsWith('image/'),'PUBLIC_IMAGE_REQUIRED');bytes=Buffer.from(await r.arrayBuffer());
   assert(bytes.length>=100&&bytes.length<=500000,'PUBLIC_IMAGE_SIZE_MISMATCH');fs.writeFileSync(file,bytes,{mode:0o600});
  }
  const sha=createHash('sha256').update(bytes).digest('hex'),key='preserved/'+sha+'.jpg';
  const to=publicObjectUrl(s.config,config.publicBucket,key);
  if(!await s.exists(key,config.publicBucket))await s.upload(bytes,key,config.publicBucket);
  assert.equal(createHash('sha256').update(await s.download(key,config.publicBucket)).digest('hex'),sha,'TARGET_MEDIA_BYTES_MISMATCH');
  // Anonymous visibility is checked independently of authenticated S3 download.
  const publicRead=await fetch(to,{signal:AbortSignal.timeout(15000)});assert.equal(publicRead.status,200,'PUBLIC_MEDIA_NOT_PUBLIC');
  assert.equal(createHash('sha256').update(Buffer.from(await publicRead.arrayBuffer())).digest('hex'),sha);
  mapping.set(from,to);objects.push({sourceUrl:from,targetUrl:to,sha256:sha,bytes:bytes.length});
  newMedia++;
  if(++completed%20===0)console.log(JSON.stringify({verifiedMedia:completed,total:urls.length}));
 }}));
 const relocate=(v:any):any=>typeof v==='string'?[...mapping].reduce((s,[a,b])=>s.split(a).join(b),v):Array.isArray(v)?v.map(relocate):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,relocate(x)])):v;
 const moved=rows.map(relocate);assert(!JSON.stringify(moved).includes(sourceOrigin+'/storage/'),'UNMAPPED_SUPABASE_MEDIA');
 const env=parse(fs.readFileSync('.env.full-neon-owner.local')),u=new URL(env[target==='staging'?'FULL_NEON_STAGING_OWNER_URL':'FULL_NEON_PRODUCTION_OWNER_URL']);
 assert.equal(u.hostname.replace('-pooler',''),config.host);assert.equal(u.pathname,'/'+config.database);u.hostname=config.host;for(const k of ['sslmode','channel_binding'])u.searchParams.delete(k);
 const c=new pg.Client({connectionString:u.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});await c.connect();
 try{
  await c.query('BEGIN');
  const types=source[0].columns.map((c:any)=>c.type);
  for(const row of moved){
   const existing=(await c.query('SELECT to_jsonb(p) row FROM public.blog_posts p WHERE id=$1 OR slug=$2 FOR UPDATE',[row.id,row.slug])).rows;
   if(existing.length){assert.equal(existing.length,1,'BLOG_ID_SLUG_CONFLICT');
    // Never overwrite a newer writer, even when rerunning the copy.
    const old=existing[0].row;assert.equal(old.id,row.id);assert.equal(old.slug,row.slug);
    if(new Date(old.updated_at)>new Date(row.updated_at))throw Error('TARGET_HAS_NEWER_PUBLIC_CONTENT');
    const counters=preservedBlogCounters(old,row,columns,allowCounterDelta);
    if(counters){await c.query('UPDATE public.blog_posts SET view_count=$2,likes_count=$3 WHERE id=$1',[row.id,counters.view_count,counters.likes_count]);counterRows++;}continue;
   }
   await c.query(`INSERT INTO public.blog_posts(${columns.map((x:string)=>'"'+x+'"').join(',')}) VALUES(${columns.map((_:string,i:number)=>'$'+(i+1)+(types[i]==='jsonb'?'::jsonb':'')).join(',')})`,columns.map((k:string,i:number)=>types[i]==='jsonb'?JSON.stringify(row[k]):row[k]));
  }
  const count=(await c.query('SELECT count(*)::int n FROM public.blog_posts')).rows[0].n;assert.equal(count,rows.length);
  await c.query('COMMIT');
  fs.writeFileSync(evidenceFile,JSON.stringify({status:'PASS',target,posts:rows.length,objects,sourceContentSha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),transferredOnly:'public.blog_posts and referenced public images',businessAccountsImported:0,reusedMediaEvidence:reusedMedia,newMediaHashesVerified:newMedia,reviewedCounterRows:counterRows},null,2));
  console.log(JSON.stringify({status:'PASS',target,posts:rows.length,objects:objects.length,reusedMediaEvidence:reusedMedia,newMediaHashesVerified:newMedia,reviewedCounterRows:counterRows,authenticatedAndAnonymousHashesVerified:true}));
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
}finally{s.close();}
