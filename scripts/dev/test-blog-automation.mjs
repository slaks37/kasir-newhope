import assert from 'node:assert/strict';
import fs from 'node:fs';
const w=JSON.parse(fs.readFileSync('docs/blog/n8n-r2-review.json','utf8'));
const code=name=>w.nodes.find(n=>n.name===name).parameters.jsCode;
const source={source_url:'https://news.example/business/prices',source_title:'Harga bahan usaha meningkat',source_published_at:new Date(Math.floor(Date.now()/1000)*1000).toISOString(),source_feed_evidence:'<rss><item><title>Harga bahan usaha meningkat</title><link>https://news.example/business/prices</link></item></rss>'};
const opportunity={...source,category:'Tips Bisnis & Strategi',score_problem_relevance:24,score_newhope_fit:24,score_umkm_relevance:18,score_business_impact:14,score_content_potential:13,total_score:93};
const article={title:'Langkah Mengelola Biaya Bahan Usaha Harian',excerpt:'Pemilik usaha dapat mencatat biaya bahan setiap hari untuk meninjau pengeluaran dan menentukan tindakan yang sesuai dengan kondisi usaha.',content:['Pembukaan usaha.',...['Catat biaya','Periksa stok','Tinjau hasil'].map(h=>'## '+h+'\n\n'+('Catat bahan usaha dan periksa jumlah pengeluaran secara rutin untuk membantu pemilik memahami perubahan biaya harian. '.repeat(14)))].join('\n\n'),seo:{metaDescription:'Panduan pencatatan biaya bahan dan pemeriksaan stok harian bagi pemilik usaha kecil.'}};
function parse(a=article,o=opportunity,market={marketSignals:[source],publishedTitles:[]}) {
 const input={choices:[{message:{content:JSON.stringify({qualified:true,article:a,opportunity:o})},finish_reason:'stop'}]};
 return new Function('$input','$',code('Parse Agnes - Validate VPC'))({first:()=>({json:input})},()=>({first:()=>({json:market})}))[0].json;
}
const good=parse();assert.equal(good.qualified,true,good.reason);assert.equal(good.article.category,opportunity.category);
for(const cat of [undefined,null,'','   '])assert.equal(parse({...article,category:cat}).qualified,true);
assert.equal(parse({...article,category:'Kuliner & F&B'}).article.category,'Kuliner & F&B');
for(const cat of ['Gosip','tips bisnis & strategi',42,{}])assert.equal(parse({...article,category:cat}).qualified,false);
assert.equal(parse(article,{...opportunity,category:'Gosip'}).qualified,false);
assert.equal(parse({...article,content:'## Hanya pendek'}).qualified,false);
assert.equal(parse({...article,content:article.content+' Dijamin untung.'}).qualified,false);
assert.equal(parse(article,opportunity,{marketSignals:[{...source,source_published_at:new Date(Date.now()-49*3600000).toISOString()}]}).qualified,false);
assert.equal(parse(article,opportunity,{marketSignals:[{...source,source_feed_evidence:''}]}).qualified,false);
assert.equal(parse(article,{...opportunity,total_score:69,score_problem_relevance:0}).qualified,false);
assert.equal(parse(article,opportunity,{marketSignals:[source],publishedTitles:[article.title]}).duplicate,true);
function audit(name,response,src=good) {
 const lookup=n=>({first:()=>({json:n==='Parse Agnes - Validate VPC'?src:n==='Prepare Cover Jobs'?{article:src.article}:{article:{...src.article,coverImage:'https://media.example/unique.jpg'}}})});
 return new Function('$input','$','$execution',code(name))({first:()=>({json:response})},lookup,{id:'synthetic-test'})[0].json;
}
for(const [name,expected] of [['Normalize Cover Generation Failure','cover_generation_failed'],['Normalize Cover Upload Failure','cover_upload_failed'],['Normalize Validation Error','validation_failed'],['Normalize Publish Result','publish_failed']]) {
 const row=audit(name,{error:{message:'sensitive-header-value'},statusCode:401,body:{error:'INVALID_API_KEY'}});
 assert.equal(row.status,expected);assert.ok(!JSON.stringify(row).includes('sensitive-header-value'));assert.equal(JSON.parse(row.raw_analysis).execution_id,'synthetic-test');
}
assert.equal(audit('Normalize Publish Result',{statusCode:201,body:{ok:true,post:{isPublished:true,url:'https://blog.example/blog/article'}}}).status,'published');
for(const response of [{},{statusCode:200,body:{ok:true}},{statusCode:201,body:{ok:true,post:{isPublished:false,url:'https://example.com'}}}])assert.equal(audit('Normalize Publish Result',response).status,'publish_failed');
assert.equal(audit('Normalize Publish Result',{statusCode:409,body:{error:'SLUG_ALREADY_EXISTS'}}).status,'duplicate_skipped');
assert.equal(audit('Normalize Validation Error',{}, {...good,qualified:false,generationStatus:'rejected_quality'}).status,'rejected_quality');
assert.equal(w.active,false);assert.equal(w.settings.timezone,'Asia/Jakarta');
assert.equal(w.nodes.find(n=>n.name==='Schedule Hourly WIB').parameters.rule.interval[0].expression,'0 0 * * * *');
for(const name of ['Agnes AI - Generate Cover','Publish - New Hope API','Store Cover - New Hope API'])assert.equal(w.nodes.find(n=>n.name===name).retryOnFail,false);
for(const n of w.nodes.filter(n=>n.type==='n8n-nodes-base.code'))new Function('$input','$','$execution',n.parameters.jsCode);
for(const c of Object.values(w.connections))for(const output of c.main||[])for(const e of output)assert.ok(w.nodes.some(n=>n.name===e.node),e.node);
const retry=(response,index)=>new Function('$input','$runIndex',code('Classify Validation Retry'))({first:()=>({json:response})},index)[0].json;
for(const status of [401,403,422,200])assert.equal(retry({statusCode:status},0)._retryValidation,false);
for(const status of [429,500,502,503,504]){assert.equal(retry({statusCode:status},0)._retryValidation,true);assert.equal(retry({statusCode:status},1)._retryDelay,4);assert.equal(retry({statusCode:status},2)._retryValidation,false);}
assert.equal(retry({error:{code:'ETIMEDOUT'}},0)._retryValidation,true);
console.log('PASS: actual n8n parser category recovery, rejection gates, sanitized audit statuses, failure routing, no blind paid/publish retries, hourly WIB schedule, graph integrity');
export { good as qualifiedFixture };
