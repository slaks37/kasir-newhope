import fs from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import express from 'express';
import {createServer as createViteServer} from 'vite';
import {stagingTarget} from './better-target.mjs';
const {env,...transport}=stagingTarget();
Object.assign(process.env,env,{DATABASE_URL:transport.connectionString});
const {createBetterAuthRuntime}=await import('../../services/shared/betterAuth.ts');
const {createBetterAuthHandler}=await import('../../src/server/betterAuthHandler.ts');
const {createSyncHandler}=await import('../../src/server/syncHandler.ts');
const {createNativeApiHandler}=await import('../../api/_runtime.ts');
const mails=[];
const runtime=createBetterAuthRuntime(undefined,async mail=>{mails.push(mail);});
const app=express();app.use((req,res,next)=>req.path.startsWith('/api/auth/')?void createBetterAuthHandler(()=>runtime)(req,res):next());
const sync=createSyncHandler();const native=createNativeApiHandler();
app.use((req,res,next)=>req.path.startsWith('/api/v1/sync/')?void sync(req,res):req.path.startsWith('/api/')?void native(req,res):next());
app.use((req,res,next)=>{if(req.path==='/login'||req.path==='/reset-password'||req.path.startsWith('/app'))req.url='/app.html';else if(req.path.startsWith('/admin'))req.url='/admin.html';next();});
const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);
const server=app.listen(5173,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
if(!process.argv.includes('--reuse-fixture')) {
const email='browser-pilot-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url');
const signup=await fetch(env.BETTER_AUTH_URL+'/api/auth/sign-up/email',{method:'POST',headers:{'content-type':'application/json',origin:env.BETTER_AUTH_URL},body:JSON.stringify({email,password,name:'Browser Pilot'})});
if(!signup.ok)throw Error('FIXTURE_SIGNUP_FAILED:'+signup.status);
const mail=mails.find(m=>m.email===email&&m.kind==='VERIFY');if(!mail)throw Error('FIXTURE_EMAIL_NOT_CAPTURED');
const verified=await fetch(mail.url,{redirect:'manual'});if(![200,302].includes(verified.status))throw Error('FIXTURE_VERIFICATION_FAILED');
fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/browser-fixture.json',JSON.stringify({email,password}),{mode:0o600});
}else{const f=JSON.parse(fs.readFileSync('build/neon/browser-fixture.json'));if(!/^browser-pilot-.+@example\.invalid$/.test(f.email))throw Error('REFUSE_NON_FIXTURE');}
console.log('Browser pilot ready at '+env.BETTER_AUTH_URL+'/login; synthetic credentials saved privately; no external emails');
process.once('SIGINT',()=>{server.close();void vite.close();void runtime.close();});
