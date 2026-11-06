import fs from 'node:fs';
import path from 'node:path';
import {forbiddenMerchantAsset} from './asset-policy.mjs';
const root='dist-mobile';
const files=fs.readdirSync(root,{recursive:true}).filter(p=>fs.statSync(path.join(root,p)).isFile());
for(const file of files){
 if(forbiddenMerchantAsset(file))throw Error('NON_MERCHANT_ASSET: '+file);
 if(/\.(js|html)$/.test(file)){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  if(/postgres(?:ql)?:\/\/|sb_secret_|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(source))throw Error('PRIVILEGED_SECRET_IN_MOBILE');
 }
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'.vite/manifest.json'),'utf8'));
if(Object.values(manifest).some(v=>/src\/admin\/|landing\.html|admin\.html|HomePage\.tsx/.test(v.src||'')))throw Error('NON_MERCHANT_ENTRY');
// Exact public asset allowlist; never copy public/ wholesale.
for(const p of ['favicon.svg','new-hope-logo-mark.png','images/products/kopi-susu.webp','images/products/matcha-latte.webp','images/products/nasi-goreng.webp','images/products/croissant.webp']){
 const to=path.join(root,p);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join('public',p),to);
}
console.log('PASS mobile: merchant-only entry, no admin/landing/SW/private keys, explicit asset allowlist');
