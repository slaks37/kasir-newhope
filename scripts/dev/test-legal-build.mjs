import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const routing=JSON.parse(await readFile('vercel.json','utf8'));
for(const name of ['privacy','terms','support']){
 const html=await readFile('dist/'+name+'.html','utf8');
 assert.equal((html.match(/<h1\b/g)||[]).length,1);
 assert.ok(html.includes('lang="id"'));
 assert.ok(!html.includes('<script'));
 assert.ok(html.includes('review pemilik'));
 assert.ok(routing.rewrites.some(r=>r.source==='/'+name&&r.destination==='/'+name+'.html'));
 assert.ok(html.includes('href="/support"'));
}
const terms=await readFile('dist/terms.html','utf8');
for(const amount of ['99.000','950.400','299.000','2.978.040','79.200','760.320'])assert.ok(terms.includes(amount));
assert.ok(terms.includes('bukan otomatis Faktur Pajak'));
assert.ok((await readFile('dist/privacy.html','utf8')).includes('Agnes AI dan DeepSeek'));
console.log('PASS: standalone legal routes, readable static content, review placeholders, third-party AI and current subscription/tax distinctions');
