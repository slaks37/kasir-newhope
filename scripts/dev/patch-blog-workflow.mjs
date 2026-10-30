// Build a reviewable import from the actual exported graph; never call live n8n.
import fs from 'node:fs';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node scripts/dev/patch-blog-workflow.mjs input.json output.json');
const w = JSON.parse(fs.readFileSync(input, 'utf8'));
const node = name => { const n=w.nodes.find(n=>n.name===name); if(!n)throw Error('Missing '+name);return n; };
const parser=node('Parse Agnes - Validate VPC');
const anchor="const normalizedText = v =>";
if(!parser.parameters.jsCode.includes(anchor))throw Error('Parser version mismatch');
parser.parameters.jsCode=parser.parameters.jsCode.replace(anchor, `// Recover only absent/blank categories from an exact approved opportunity value.
if (a && typeof a === 'object' && !Array.isArray(a)
    && (a.category === undefined || a.category === null || (typeof a.category === 'string' && !a.category.trim()))
    && cats.includes(op.category)) {
  a.category = op.category;
  metadataRepairs.push('category recovered from approved opportunity.category');
}
${anchor}`);
const addCode=(name,jsCode)=>{w.nodes.push({id:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name,type:'n8n-nodes-base.code',typeVersion:2,position:[3500,2200],parameters:{jsCode}});};
const edge=name=>({node:name,type:'main',index:0});
const auditCode=(stage)=>`let src={};try{src=$('Parse Agnes - Validate VPC').first().json;}catch{}
const r=$input.first().json, body=r.body||{}, o=src.opportunity||{};
const http=Number(r.statusCode||0);
const stage=${JSON.stringify(stage)};
const quality=stage==='quality_validation' && src.qualified===false;
const published=stage==='publication' && http===201 && body.ok===true && body.post?.isPublished===true && /^https:\\/\\//.test(body.post?.url||'');
const duplicate=quality?src.duplicate===true:(stage==='publication' && http===409 && ['SLUG_ALREADY_EXISTS','TITLE_ALREADY_EXISTS'].includes(body.error));
const status=stage==='discovery'?'discovered':published?'published':duplicate?'duplicate_skipped':quality?'rejected_quality':stage==='cover_generation'?'cover_generation_failed':stage==='cover_upload'?'cover_upload_failed':stage==='publication'?'publish_failed':'validation_failed';
const providerCode=body.error||r.error?.description||r.error?.message;
const errorCode=stage==='discovery'||published?'':typeof providerCode==='string' && /^[A-Z0-9_]{1,80}$/.test(providerCode)?providerCode:quality?'QUALITY_GATE_REJECTED':http?'HTTP_'+http:'TRANSPORT_OR_AMBIGUOUS_FAILURE';
const timestamp=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Jakarta'})+' +07:00';
// Existing Sheets columns are retained; additional structured fields live in raw_analysis.
// Never serialize the HTTP error: it can contain authenticated request headers.
let job={};try{job=$('Prepare Cover Jobs').first().json;}catch{}
let stored={};try{stored=$('Attach Unique Cover').first().json;}catch{}
const recovery=stage==='discovery'||published||quality?undefined:{execution_id:$execution.id,article_node:'Parse Agnes - Validate VPC',cover_job_node:'Prepare Cover Jobs',stored_cover_node:'Attach Unique Cover',resume_stage:stage,automatic_replay:false};
// A provider output URL may bear a temporary access token. Keep it only in saved node execution data.
return [{json:{discovered_at:timestamp,source_title:o.source_title||'',source_url:o.source_url||'',source_published_at:o.source_published_at||'',radar:o.radar||'',customer_segment:o.customer_segment||'',customer_job:o.customer_job||'',pain:o.pain||'',business_impact:o.business_impact||'',desired_gain:o.desired_gain||'',newhope_capability:o.newhope_capability||'',pain_reliever:o.pain_reliever||'',gain_creator:o.gain_creator||'',score_problem_relevance:o.score_problem_relevance||0,score_newhope_fit:o.score_newhope_fit||0,score_umkm_relevance:o.score_umkm_relevance||0,score_business_impact:o.score_business_impact||0,score_content_potential:o.score_content_potential||0,total_score:src.totalScore||0,content_angle:o.content_angle||'',focus_keyword:o.focus_keyword||'',category:src.article?.category||o.category||'',status,blog_url:published?body.post.url:'',reason:errorCode,raw_analysis:JSON.stringify({opportunity:o,execution_id:$execution.id,timestamp_wib:timestamp,article_title:src.article?.title||'',vpc_score:src.totalScore||0,validation:stage==='discovery'?'pending':quality?'rejected':stage==='quality_validation'?'failed':'passed',cover_upload:stage==='publication'?'passed':stage==='cover_upload'?'failed':'not_completed',publication:published?'published':stage==='publication'?'failed_or_ambiguous':'not_attempted',published_url:published?body.post.url:'',error_code:errorCode,failure_stage:stage==='discovery'||published?'':stage,generation_status:src.generationStatus,quality_reason:quality?String(src.reason||'').slice(0,1800):undefined,recovery})}}];`;
addCode('Normalize Discovered',auditCode('discovery'));
w.connections['Parse Agnes - Validate VPC'].main[0].push(edge('Normalize Discovered'));
w.connections['Normalize Discovered']={main:[[edge('Append Opportunities Audit')]]};
node('Normalize Publish Result').parameters.jsCode=auditCode('publication');
node('Normalize Validation Error').parameters.jsCode=auditCode('quality_validation');
addCode('Normalize Cover Generation Failure',auditCode('cover_generation'));
addCode('Normalize Cover Upload Failure',auditCode('cover_upload'));
for(const name of ['Normalize Cover Generation Failure','Normalize Cover Upload Failure']) w.connections[name]={main:[[edge('Append Opportunities Audit')]]};
for(const [name,failure] of [['Agnes AI - Generate Cover','Normalize Cover Generation Failure'],['Store Cover - New Hope API','Normalize Cover Upload Failure'],['Attach Unique Cover','Normalize Cover Upload Failure'],['Publish - New Hope API','Normalize Publish Result'],['Validate Draft - New Hope API','Normalize Validation Error'],['Agnes AI - Chat Completions','Normalize Validation Error']]) {
 const n=node(name); n.onError='continueErrorOutput'; n.retryOnFail=false;delete n.maxTries;delete n.waitBetweenTries;
 const success=w.connections[name]?.main?.[0]||[];
 w.connections[name]={main:[success,[edge(failure)]]};
}
// Successful HTTP transport alone is not a successful stored cover.
const store=node('Store Cover - New Hope API');
store.parameters.options.response={response:{fullResponse:true,neverError:true,responseFormat:'json'}};
const coverIf=structuredClone(node('Publish Enabled?'));
coverIf.id='cover-stored-if';coverIf.name='Cover Stored?';coverIf.position=[1800,1900];
coverIf.parameters.conditions.conditions[0].leftValue='={{ $json.statusCode === 201 && $json.body?.ok === true && $json.body?.coverGenerated === true && /^https:\\/\\//.test($json.body?.coverImage || "") }}';
w.nodes.push(coverIf);
w.connections['Store Cover - New Hope API'].main[0]=[edge('Cover Stored?')];
w.connections['Cover Stored?']={main:[[edge('Attach Unique Cover')],[edge('Normalize Cover Upload Failure')]]};
node('Attach Unique Cover').parameters.jsCode=node('Attach Unique Cover').parameters.jsCode.replace('const r=item.json;', 'const r=item.json.body||item.json;');
addCode('Check Generated Cover', `return $input.all().map(item=>{if(!Array.isArray(item.json.data)||typeof item.json.data[0]?.url!=='string'||!item.json.data[0].url.startsWith('https://'))throw Error('INVALID_COVER_GENERATION_RESPONSE');return item;});`);
node('Check Generated Cover').onError='continueErrorOutput';
w.connections['Agnes AI - Generate Cover'].main[0]=[edge('Check Generated Cover')];
w.connections['Check Generated Cover']={main:[[edge('Store Cover - New Hope API')],[edge('Normalize Cover Generation Failure')]]};
// Retry only validation (side-effect-free), at 2s then 4s; never auth or arbitrary errors.
addCode('Classify Validation Retry', `const r=$input.first().json;
const status=Number(r.statusCode||0);
const transport=String(r.error?.code||r.error?.name||r.error?.message||'');
const transient=[429,500,502,503,504].includes(status)||(!status&&/ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|TimeoutError/.test(transport));
const attempt=$runIndex;
return [{json:{...r,_retryValidation:transient&&attempt<2,_retryDelay:2**(attempt+1)}}];`);
const retryIf=structuredClone(node('Publish Enabled?'));
retryIf.id='validation-retry-if';retryIf.name='Retry Validation?';retryIf.position=[3100,1800];
retryIf.parameters.conditions.conditions[0].leftValue='={{ $json._retryValidation }}';
w.nodes.push(retryIf);
w.nodes.push({id:'validation-retry-wait',name:'Validation Backoff',type:'n8n-nodes-base.wait',typeVersion:1.1,position:[3300,1800],parameters:{resume:'timeInterval',amount:'={{ $json._retryDelay }}',unit:'seconds'}});
w.connections['Validate Draft - New Hope API']={main:[[edge('Classify Validation Retry')],[edge('Classify Validation Retry')]]};
w.connections['Classify Validation Retry']={main:[[edge('Retry Validation?')]]};
w.connections['Retry Validation?']={main:[[edge('Validation Backoff')],[edge('Validation 2xx?')]]};
w.connections['Validation Backoff']={main:[[edge('Validate Draft - New Hope API')]]};
// Remove paid regeneration retry chains: preserve content and resume the failed stage after review.
const removed=['Wait Before Cover Retry 1','Wait Before Cover Retry 2','Agnes AI - Cover Retry 1','Agnes AI - Cover Retry 2'];
w.nodes=w.nodes.filter(n=>!removed.includes(n.name));for(const name of removed)delete w.connections[name];
// No notification destination/credential is configured in the source graph. Do not invent one.
// A separate error workflow can be attached after the owner selects an authorized destination.
w.name+=' — R2 REVIEW CANDIDATE';w.active=false;
fs.writeFileSync(output,JSON.stringify(w,null,2)+'\n');
