import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'dotenv';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {relocatePublicMedia} from './storage-reference';

const target=JSON.parse(fs.readFileSync('neon/targets/full-restore.json','utf8'));
const env=parse(fs.readFileSync('.env.neon-data-restore.local'));
const evidence=JSON.parse(fs.readFileSync('build/neon/storage-copy-evidence.json','utf8'));
const prior=fs.existsSync('build/neon/storage-reference-rollback.json')?JSON.parse(fs.readFileSync('build/neon/storage-reference-rollback.json','utf8')):null;
assert(!prior||process.argv.includes('--reuse-reviewed-rollback'),'Existing rollback snapshot must be retained; review before repeating URL substitution');
if(prior)assert.equal(prior.branchId,target.branchId);
assert.equal(target.projectId,'steep-sea-66546931');assert.equal(target.default,false);
assert.equal(env.NEON_BRANCH_ID,target.branchId);assert.equal(evidence.branchId,target.branchId);assert.equal(evidence.status,'PASS');assert(evidence.anonymousWriteDenied);
const url=new URL(env.NEON_RESTORE_DATABASE_URL||'');assert.equal(url.hostname.replace('-pooler',''),target.host);assert.equal(url.pathname,'/'+target.database);
url.hostname=url.hostname.replace('-pooler','');
for(const k of ['sslmode','channel_binding'])url.searchParams.delete(k);
assert.equal(url.search,'');
const client=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});
const rollback:any={scope:'Only blog media references in isolated restored Neon child',branchId:target.branchId,createdAt:new Date().toISOString(),rows:[]};
await client.connect();
try {
  await client.query('BEGIN');
  const posts=(await client.query('SELECT id,cover_image,author_avatar,content,seo,media_embeds FROM public.blog_posts FOR UPDATE')).rows;
  for(const post of posts) {
    const next=relocatePublicMedia(post,evidence.objects);
    if(JSON.stringify(next)===JSON.stringify(post))continue;
    rollback.rows.push(post);
    await client.query('UPDATE public.blog_posts SET cover_image=$1,author_avatar=$2,content=$3,seo=$4::jsonb,media_embeds=$5::jsonb WHERE id=$6',
      [next.cover_image,next.author_avatar,next.content,JSON.stringify(next.seo),JSON.stringify(next.media_embeds),post.id]);
  }
  // Preserve editorial timestamps/order. Only the copied media URL fields
  // change; data verification can account for this deterministic substitution.
  const remaining=(await client.query("SELECT count(*)::int n FROM public.blog_posts WHERE to_jsonb(blog_posts)::text LIKE '%fqxrhumsgigcgjtlbfuo.supabase.co/storage/%'")).rows[0].n;
  assert.equal(remaining,0,'Uncopied Supabase blog image references remain');
  // PII-free file is not guaranteed for editorial bodies; rollback snapshots
  // stay ignored/private rather than in the PR.
  fs.mkdirSync('build/neon',{recursive:true});
  if(prior) {
    const sort=(rows:any[])=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(sort(rollback.rows),sort(prior.rows),'Reviewed rollback source rows have changed');
  } else fs.writeFileSync('build/neon/storage-reference-rollback.json',JSON.stringify(rollback,null,2)+'\n',{mode:0o600});
  await client.query('COMMIT');
  const summary={status:'PASS',branchId:target.branchId,rewrittenPosts:rollback.rows.length,remainingSupabaseBlogReferences:remaining,
    manifestSha256:createHash('sha256').update(JSON.stringify(evidence.objects)).digest('hex'),editorialTimestampsPreserved:true,sourceUnchanged:true};
  fs.writeFileSync('build/neon/storage-reference-evidence.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{await client.end();}
