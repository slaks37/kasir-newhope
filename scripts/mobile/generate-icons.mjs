import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const source='public/new-hope-logo-mark.png';
for(const root of ['android/app/src/main/res','ios/App/App/Assets.xcassets'])for(const p of fs.readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.png'))){
 const file=path.join(root,p),meta=await sharp(file).metadata();
 const icon=path.basename(p).includes('launcher')||p.includes('AppIcon');
 const width=meta.width,height=meta.height;
 const size=icon?Math.round(Math.min(width,height)*0.75):Math.round(Math.min(width,height)*0.32);
 const logo=await sharp(source).resize(size,size).png().toBuffer();
 await sharp({create:{width,height,channels:4,background:icon?'#ffffff':'#fffaf0'}}).composite([{input:logo,gravity:'centre'}]).flatten({background:'#ffffff'}).png().toFile(file+'.tmp');fs.renameSync(file+'.tmp',file);
}
