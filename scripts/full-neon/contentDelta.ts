import assert from 'node:assert/strict';

/** Only an explicitly reviewed, monotonic readership delta can change an
 * existing preserved row. Content/identity edits still require separate review. */
export function preservedBlogCounters(existing:Record<string,unknown>,incoming:Record<string,unknown>,columns:string[],allowCounterDelta=false){
 assert.equal(existing.id,incoming.id,'BLOG_ID_CONFLICT');assert.equal(existing.slug,incoming.slug,'BLOG_SLUG_CONFLICT');
 let changed=false;
 const counters:Record<string,number>={};
 for(const column of columns){
  if(column==='view_count'||column==='likes_count'){
   const a=existing[column],b=incoming[column];
   assert(typeof a==='number'&&Number.isSafeInteger(a)&&a>=0&&a<=2147483647,'INVALID_TARGET_BLOG_COUNTER');
   assert(typeof b==='number'&&Number.isSafeInteger(b)&&b>=0&&b<=2147483647,'INVALID_SOURCE_BLOG_COUNTER');
   if(a!==b){assert(allowCounterDelta,'POPULATED_CONTENT_REQUIRES_REVIEWED_DELTA');changed=true;}
   counters[column]=Math.max(a,b);
  }else if(column==='created_at'||column==='updated_at'){
   assert.equal(new Date(String(existing[column])).getTime(),new Date(String(incoming[column])).getTime(),'CONTENT_TIMESTAMP_CONFLICT');
  }else assert.deepEqual(existing[column],incoming[column],'POPULATED_CONTENT_REQUIRES_REVIEWED_DELTA');
 }
 return changed?counters:null;
}
