import {createHash,randomUUID} from 'node:crypto';
import {GetObjectCommand,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import type {Express} from 'express';
import type {Db} from '../shared/db';
import {trustedPrincipal} from '../shared/auth';
import {createNeonObjectStorage} from '../shared/objectStorage';
import {fullNeonConfig} from '../shared/fullNeon';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types=new Set(['image/jpeg','image/png','image/webp','application/pdf','text/csv']);
export interface BusinessFileProvider {
 put(key:string,bytes:Buffer,type:string):Promise<void>;
 signedGet(key:string):Promise<string>;
 remove(key:string):Promise<void>;
}
export function createBusinessFileProvider():BusinessFileProvider {
 const t=fullNeonConfig(),s=createNeonObjectStorage();
 return {
  async put(key,bytes,type){await s.client.send(new PutObjectCommand({Bucket:t.privateBucket,Key:key,Body:bytes,ContentType:type,CacheControl:'private, no-store',ContentDisposition:'attachment'}),{abortSignal:AbortSignal.timeout(8000)});},
  signedGet(key){return getSignedUrl(s.client,new GetObjectCommand({Bucket:t.privateBucket,Key:key,ResponseContentDisposition:'attachment'}),{expiresIn:300});},
  async remove(key){await s.client.send(new DeleteObjectCommand({Bucket:t.privateBucket,Key:key}),{abortSignal:AbortSignal.timeout(8000)});},
 };
}
export function registerBusinessFiles(app:Express,db:Db,provider?:BusinessFileProvider){
 if(!provider&&process.env.FULL_NEON_CLEAN_START!=='1')return;
 let storage=provider;
 const run=(fn:(req:any,res:any,tenant:string,subject:string)=>Promise<unknown>)=>async(req:any,res:any)=>{
  res.setHeader('Cache-Control','no-store');
  const p=trustedPrincipal(req);if(!p?.isEmailVerified)return res.status(401).json({ok:false,error:'VERIFIED_ACCOUNT_REQUIRED'});
  // Explicit active owner lookup. A guessed tenant or merchant never selects a bucket prefix.
  try{const rows=(await db.query('SELECT id FROM internal.tenants WHERE owner_user_ref=$1 AND is_active AND merged_into IS NULL',[p.subject])).rows;
  if(rows.length!==1)return res.status(403).json({ok:false,error:'ACTIVE_OWNER_REQUIRED'});
  return await fn(req,res,rows[0].id,p.subject);}catch(e){return res.status((e as any).status||503).json({ok:false,error:(e as any).status?(e as Error).message:'FILE_STORAGE_UNAVAILABLE'});}
 };
 const error=(status:number,message:string)=>Object.assign(Error(message),{status});
 const audit=(c:Db,tenant:string,subject:string,id:string,action:string)=>c.query('INSERT INTO internal.business_file_events(id,tenant_id,file_id,actor_subject,action) VALUES($1,$2,$3,$4,$5)',[randomUUID(),tenant,id,subject,action]);
 app.get('/api/v1/sync/files',run(async(req,res,tenant,subject)=>{
  if(req.query.id){if(typeof req.query.id!=='string'||!uuid.test(req.query.id))throw error(400,'INVALID_FILE_ID');
   const row=(await db.query('SELECT object_key FROM internal.business_files WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',[req.query.id,tenant])).rows[0];
   if(!row)throw error(404,'FILE_NOT_FOUND');storage??=createBusinessFileProvider();
   const url=await storage.signedGet(row.object_key);await audit(db,tenant,subject,req.query.id,'DOWNLOAD_AUTHORIZED');
   return res.json({ok:true,url,expiresIn:300});
  }
  const files=(await db.query('SELECT id,content_type,size_bytes,created_at FROM internal.business_files WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id LIMIT 101',[tenant])).rows;
  return res.json({ok:true,files:files.slice(0,100),hasMore:files.length>100});
 }));
 app.post('/api/v1/sync/files',run(async(req,res,tenant,subject)=>{
  const {id:rawId,contentType,data}=req.body||{};const id=typeof rawId==='string'?rawId.toLowerCase():'';
  if(!uuid.test(String(id))||!types.has(contentType)||typeof data!=='string'||data.length>7000000||data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw error(400,'INVALID_FILE');
  const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>5000000||bytes.toString('base64')!==data)throw error(400,'INVALID_FILE');
  const digest=createHash('sha256').update(bytes).digest('hex'),key='tenants/'+tenant+'/'+id+'/'+digest;
  const replayed=await db.tx(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['file:'+id]);
   const old=(await c.query('SELECT tenant_id,sha256,content_type,deleted_at FROM internal.business_files WHERE id=$1',[id])).rows[0];
   if(old){if(old.tenant_id!==tenant||old.sha256!==digest||old.content_type!==contentType||old.deleted_at)throw error(409,'FILE_REQUEST_CONFLICT');return true;}
   storage??=createBusinessFileProvider();await storage.put(key,bytes,contentType);
   await c.query('INSERT INTO internal.business_files(id,tenant_id,object_key,content_type,size_bytes,created_by,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,tenant,key,contentType,bytes.length,subject,digest]);
   await audit(c,tenant,subject,id,'UPLOADED');return false;
  });
  return res.status(replayed?200:201).json({ok:true,id,replayed});
 }));
 app.delete('/api/v1/sync/files',run(async(req,res,tenant,subject)=>{
  const id=req.body?.id;if(typeof id!=='string'||!uuid.test(id))throw error(400,'INVALID_FILE_ID');
  const row=await db.tx(async c=>{
   const old=(await c.query('SELECT object_key,deleted_at FROM internal.business_files WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,tenant])).rows[0];
   if(!old)throw error(404,'FILE_NOT_FOUND');
   if(!old.deleted_at){await c.query('UPDATE internal.business_files SET deleted_at=clock_timestamp() WHERE id=$1 AND tenant_id=$2',[id,tenant]);await audit(c,tenant,subject,id,'DELETED');}
   return old;
  });
  storage??=createBusinessFileProvider();await storage.remove(row.object_key);
  return res.json({ok:true,id});
 }));
}
