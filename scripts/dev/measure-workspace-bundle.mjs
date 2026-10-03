import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

// Manifest closure, not the size of a renamed entry chunk. No browser timing,
// image/font cost, runtime fetches or CPU savings are inferred from these bytes.
const root=path.resolve(process.argv[2]||'dist');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'.vite/manifest.json'),'utf8'));
const entry=Object.keys(manifest).find(key=>manifest[key].isEntry&&manifest[key].name==='main');
if(!entry)throw Error('Main Vite entry not found');
function measure(roots){
  const visited=new Set(),js=new Set(),css=new Set();
  function visit(key){
    if(visited.has(key))return;visited.add(key);
    const chunk=manifest[key];if(!chunk)throw Error('Missing manifest dependency: '+key);
    if(chunk.file.endsWith('.js'))js.add(chunk.file);
    for(const file of chunk.css||[])css.add(file);
    for(const dependency of chunk.imports||[])visit(dependency);
  }
  for(const key of roots)visit(key);
  const size=files=>{let bytes=0,gzipBytes=0;for(const file of files){const data=fs.readFileSync(path.join(root,file));bytes+=data.length;gzipBytes+=gzipSync(data).length;}return {bytes,gzipBytes,files:[...files].sort()};};
  return {js:size(js),css:size(css)};
}
const entryStatic=measure([entry]);
const routeChunks={};
const chunkFor=source=>manifest[source]?source:Object.keys(manifest).find(key=>manifest[key].isDynamicEntry&&manifest[key].name===path.basename(source,'.tsx'));
for(const [name,source] of Object.entries({landing:'src/components/home/HomePage.tsx',login:'src/components/auth/LoginPage.tsx',workspace:'src/Workspace.tsx',businesses:'src/components/businesses/MyBusinesses.tsx',reports:'src/components/reports/ReportsDashboard.tsx'})){
  const selected=chunkFor(source);if(!selected)continue; // Older builds may embed a screen in the entry.
  const workspace=name==='businesses'||name==='reports'?chunkFor('src/Workspace.tsx'):null;
  routeChunks[name]=measure([entry,...(workspace?[workspace]:[]),selected]);
}
console.log(JSON.stringify({root,entry,entryStatic,routeChunks,
  limits:'Static JS/CSS plus selected lazy roots only; no dynamic descendants unless selected. No runtime/latency claim.'},null,2));
