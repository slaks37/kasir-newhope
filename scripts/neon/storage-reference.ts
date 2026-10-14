export interface MediaMap {sourceUrl:string;targetUrl:string;sha256:string;bytes:number}
/** Exact URLs from a verified object manifest only. No domain-wide rewrite,
 * regexp replacement or arbitrary recursive data mutation. */
export function relocatePublicMedia<T>(value:T,objects:MediaMap[]):T {
  if(typeof value==='string') {
    let result:string=value;
    for(const o of objects) {
      if(!/^[a-f0-9]{64}$/.test(o.sha256)||o.bytes<100||o.bytes>500000)throw Error('UNVERIFIED_MEDIA_MAPPING');
      const from=new URL(o.sourceUrl),to=new URL(o.targetUrl);
      if(from.origin!=='https://fqxrhumsgigcgjtlbfuo.supabase.co'||!from.pathname.startsWith('/storage/v1/object/public/blog-media/')||from.search||from.hash||
        to.protocol!=='https:'||!to.hostname.endsWith('.ap-southeast-1.aws.neon.tech')||!to.pathname.startsWith('/blog-media/')||to.search||to.hash)throw Error('INVALID_MEDIA_MAPPING');
      result=result.split(o.sourceUrl).join(o.targetUrl);
    }
    return result as T;
  }
  if(Array.isArray(value))return value.map(v=>relocatePublicMedia(v,objects)) as T;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,relocatePublicMedia(v,objects)])) as T;
  return value;
}
