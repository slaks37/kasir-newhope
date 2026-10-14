import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'dotenv';
import pg from 'pg';
import {relocatePublicMedia} from './storage-reference';
const target=JSON.parse(fs.readFileSync('neon/targets/full-restore.json','utf8'));
const env=parse(fs.readFileSync('.env.neon-data-restore.local'));
const rollback=JSON.parse(fs.readFileSync('build/neon/storage-reference-rollback.json','utf8'));
const copy=JSON.parse(fs.readFileSync('build/neon/storage-copy-evidence.json','utf8'));
assert.equal(target.projectId,'steep-sea-66546931');assert.equal(target.default,false);assert.equal(env.NEON_BRANCH_ID,target.branchId);assert.equal(rollback.branchId,target.branchId);
const url=new URL(env.NEON_RESTORE_DATABASE_URL||'');assert.equal(url.hostname.replace('-pooler',''),target.host);assert.equal(url.pathname,'/'+target.database);
url.hostname=url.hostname.replace('-pooler','');
for(const k of ['sslmode','channel_binding'])url.searchParams.delete(k);assert.equal(url.search,'');
const client=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true}});await client.connect();
try{
  await client.query('BEGIN');for(const p of rollback.rows) {
    const current=(await client.query('SELECT id,cover_image,author_avatar,content,seo,media_embeds FROM public.blog_posts WHERE id=$1 FOR UPDATE',[p.id])).rows[0];
    assert.deepEqual(current,relocatePublicMedia(p,copy.objects),'Target editorial fields changed; rollback requires review');
    await client.query('UPDATE public.blog_posts SET cover_image=$1,author_avatar=$2,content=$3,seo=$4::jsonb,media_embeds=$5::jsonb WHERE id=$6',
      [p.cover_image,p.author_avatar,p.content,JSON.stringify(p.seo),JSON.stringify(p.media_embeds),p.id]);
  }
  await client.query('COMMIT');console.log(JSON.stringify({status:'PASS',branchId:target.branchId,restoredPostReferences:rollback.rows.length,sourceUnchanged:true}));
}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{await client.end();}
