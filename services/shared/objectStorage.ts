import {fullNeonConfig} from './fullNeon';
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';

export const BLOG_MEDIA_BUCKET='blog-media';
export interface ObjectStorageConfig {endpoint:string;region:string;accessKeyId:string;secretAccessKey:string;branchId:string}
/** Credential/endpoint binding is checked before signing. No browser env vars. */
export function neonStorageConfig(env=process.env):ObjectStorageConfig {
  if(env.FULL_NEON_CLEAN_START==='1')fullNeonConfig(env);
  if(env.NEON_PROJECT_ID!=='steep-sea-66546931'||!/^br-[a-z0-9-]+$/.test(env.NEON_BRANCH_ID||''))throw Error('NEON_STORAGE_BRANCH_REQUIRED');
  const endpoint=new URL(env.AWS_ENDPOINT_URL_S3||'');
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.port||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||
    !endpoint.hostname.startsWith(env.NEON_BRANCH_ID+'.storage.')||!endpoint.hostname.endsWith('.ap-southeast-1.aws.neon.tech')||env.AWS_REGION!=='ap-southeast-1')throw Error('NEON_STORAGE_ENDPOINT_MISMATCH');
  if(!env.AWS_ACCESS_KEY_ID||!env.AWS_SECRET_ACCESS_KEY)throw Error('NEON_STORAGE_CREDENTIAL_REQUIRED');
  return {endpoint:endpoint.origin,region:env.AWS_REGION,accessKeyId:env.AWS_ACCESS_KEY_ID,secretAccessKey:env.AWS_SECRET_ACCESS_KEY,branchId:env.NEON_BRANCH_ID!};
}
export function objectKey(key:string):string {
  if(!key||key.length>1024||/^[/.]|[\\\u0000-\u001f\u007f]/.test(key)||key.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('INVALID_OBJECT_KEY');
  return key;
}
export function publicObjectUrl(config:Pick<ObjectStorageConfig,'endpoint'>,bucket:string,key:string):string {
  if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))throw Error('INVALID_OBJECT_BUCKET');
  return config.endpoint+'/'+bucket+'/'+objectKey(key).split('/').map(encodeURIComponent).join('/');
}
export function createNeonObjectStorage(config=neonStorageConfig()) {
  const client=new S3Client({endpoint:config.endpoint,region:config.region,credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},
    forcePathStyle:true,maxAttempts:3,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  return {
    client,config,
    async upload(bytes:Uint8Array,key:string,bucket=BLOG_MEDIA_BUCKET,contentType='image/jpeg') {
      objectKey(key);
      // Unique UUID keys for runtime uploads; migration never overwrites a key
      // without comparing its existing full bytes first.
      await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:contentType,CacheControl:'public, max-age=31536000, immutable'}),{abortSignal:AbortSignal.timeout(18000)});
      return publicObjectUrl(config,bucket,key);
    },
    async download(key:string,bucket=BLOG_MEDIA_BUCKET) {
      const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:objectKey(key)}),{abortSignal:AbortSignal.timeout(18000)});
      if(!result.Body)throw Error('NEON_STORAGE_EMPTY_BODY');
      return new Uint8Array(await result.Body.transformToByteArray());
    },
    async exists(key:string,bucket=BLOG_MEDIA_BUCKET) {
      try{await client.send(new HeadObjectCommand({Bucket:bucket,Key:objectKey(key)}),{abortSignal:AbortSignal.timeout(18000)});return true;}
      catch(e){if((e as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return false;throw e;}
    },
    close(){client.destroy();},
  };
}
