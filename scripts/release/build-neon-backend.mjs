// Separate candidate release; never overwrites the production-compatible api/.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const apiEntries=[...pkg.scripts['build:api'].matchAll(/esbuild (\S+) .*?--outfile=api\/(\S+)/g)];
if(apiEntries.length!==11)throw Error('API_ENTRY_INVENTORY_CHANGED');
const serviceEntries=['gateway','pos','ai','billing','backoffice'].map(s=>[`services/${s}/index.ts`,`services/${s}.js`]);
const root='build/neon-backend';
await fs.rm(root,{recursive:true,force:true});
const evidence={target:'neon',productionCutover:false,entries:[],externalPackages:[]};
const external=new Set();
const forbidden=/@supabase\/|SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)|VITE_SUPABASE_|\/auth\/v1\/|GoTrueClient|SupabaseClient|pooler\\?\.supabase/;
for(const [source,output] of [...apiEntries.map(m=>[m[1],`api/${m[2]}`]),...serviceEntries]){
 const result=await build({entryPoints:[source],outfile:path.join(root,output),bundle:true,platform:'node',format:'esm',packages:'external',minifySyntax:true,metafile:true,write:false,define:{'process.env.NEWHOPE_BUILD_TARGET':'"neon"'}});
 for(const input of Object.keys(result.metafile.inputs))if(/legacy(?:Bearer|AuthOperations|BlogMedia)|node_modules\/@supabase\//.test(input))throw Error('LEGACY_INPUT_IN_NEON_RELEASE: '+input);
 for(const out of Object.values(result.metafile.outputs))for(const imp of out.imports){
  if(!imp.external)continue;
  if(forbidden.test(imp.path))throw Error('LEGACY_EXTERNAL_IN_NEON_RELEASE');
  if(!imp.path.startsWith('node:'))external.add(imp.path.startsWith('@')?imp.path.split('/').slice(0,2).join('/'):imp.path.split('/')[0]);
 }
 for(const file of result.outputFiles){
  if(forbidden.test(file.text))throw Error('LEGACY_RUNTIME_IN_NEON_RELEASE: '+source);
  await fs.mkdir(path.dirname(file.path),{recursive:true});await fs.writeFile(file.path,file.contents);
  evidence.entries.push({source,output,sha256:crypto.createHash('sha256').update(file.contents).digest('hex'),inputs:Object.keys(result.metafile.inputs).length});
 }
}
const dependencies={};
for(const name of [...external].sort()){
 if(!pkg.dependencies[name])continue; // Node built-ins have no package entry.
 const installed=JSON.parse(await fs.readFile(`node_modules/${name}/package.json`,'utf8'));
 dependencies[name]=installed.version;
}
// Walk installed transitive production dependencies, including optional ones
// when present. The source manifest retains legacy compatibility separately.
const visited=new Set();
async function walk(dir){
 const resolved=await fs.realpath(dir);if(visited.has(resolved))return;visited.add(resolved);
 const p=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));
 if(p.name?.startsWith('@supabase/'))throw Error('TRANSITIVE_LEGACY_PACKAGE: '+p.name);
 for(const dep of Object.keys({...p.dependencies,...p.optionalDependencies})){
  let base=dir,found=false;
  while(base!==path.dirname(base)){
   const candidate=path.join(base,'node_modules',dep);
   try{await fs.access(path.join(candidate,'package.json'));found=true;await walk(candidate);break;}catch(e){if(e.code!=='ENOENT')throw e;}
   base=path.dirname(base);
  }
  if(!found&&!p.optionalDependencies?.[dep])throw Error('MISSING_RELEASE_DEPENDENCY: '+dep);
 }
}
for(const name of Object.keys(dependencies))await walk(path.resolve('node_modules',name));
evidence.externalPackages=Object.keys(dependencies);evidence.transitivePackageCount=visited.size;
await fs.writeFile(`${root}/package.json`,JSON.stringify({private:true,type:'module',dependencies},null,2)+'\n');
await fs.writeFile(`${root}/evidence.json`,JSON.stringify(evidence,null,2)+'\n');
console.log(`PASS Neon backend: ${evidence.entries.length} entries, ${visited.size} dependency directories; no legacy Auth/Storage runtime. Candidate only, not deployed.`);
