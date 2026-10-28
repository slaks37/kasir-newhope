/** An offline UI receipt, never an API credential or proof of current membership.
 * Verification keys come from the application build, never from local storage. */
export const OFFLINE_IDENTITY_KEY='newhope-offline-identity-v1';
export const OFFLINE_DEVICE_KEY='newhope-offline-device-v1';
export const OFFLINE_MAX_SECONDS=3600;
export type OfflinePublicKey={kty:'EC';crv:'P-256';x:string;y:string;kid:string};
export type OfflineIdentityClaims={v:1;aud:'newhope-offline-ui';iss:string;sub:string;sid:string;device:string;iat:number;exp:number;sessionExp:number;user:{id:string;email?:string;twoFactorEnabled:boolean;passwordCredential:boolean;providers:string[];user_metadata:Record<string,string>}};
export interface IdentityStorage{getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;removeItem(key:string):Promise<void>}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const b64=/^[A-Za-z0-9_-]+$/;
function decode(value:string){if(!b64.test(value))throw Error('OFFLINE_RECEIPT_INVALID');const raw=atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'='));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
export function offlinePublicKey(value:string):OfflinePublicKey{
 const k=JSON.parse(value);if(k.kty!=='EC'||k.crv!=='P-256'||typeof k.x!=='string'||typeof k.y!=='string'||decode(k.x).length!==32||decode(k.y).length!==32||typeof k.kid!=='string'||!/^[-_A-Za-z0-9]{16}$/.test(k.kid)||Object.keys(k).some(x=>!['kty','crv','x','y','kid'].includes(x)))throw Error('OFFLINE_KEY_INVALID');return k;
}
export async function verifyOfflineIdentity(token:string,key:OfflinePublicKey,issuer:string,device:string,now=Date.now()):Promise<OfflineIdentityClaims>{
 if(token.length>8192||!uuid.test(device))throw Error('OFFLINE_RECEIPT_INVALID');const parts=token.split('.');if(parts.length!==3)throw Error('OFFLINE_RECEIPT_INVALID');
 const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));if(header.alg!=='ES256'||header.typ!=='NH-OFFLINE-UI'||header.kid!==key.kid||Object.keys(header).some(k=>!['alg','typ','kid'].includes(k)))throw Error('OFFLINE_RECEIPT_INVALID');
 const publicKey=await crypto.subtle.importKey('jwk',{kty:key.kty,crv:key.crv,x:key.x,y:key.y},{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error('OFFLINE_SIGNATURE_INVALID');
 const p=JSON.parse(new TextDecoder().decode(decode(parts[1]))) as OfflineIdentityClaims,t=Math.floor(now/1000);
 if(Object.keys(p).some(k=>!['v','aud','iss','sub','sid','device','iat','exp','sessionExp','user'].includes(k))||p.v!==1||p.aud!=='newhope-offline-ui'||p.iss!==issuer||p.device!==device||!uuid.test(p.sub)||typeof p.sid!=='string'||!p.sid||p.sid.length>255||
  !Number.isInteger(p.iat)||!Number.isInteger(p.exp)||!Number.isInteger(p.sessionExp)||p.iat>t+30||p.exp<=t||p.exp<=p.iat||p.exp-p.iat>OFFLINE_MAX_SECONDS||p.exp>p.sessionExp||
  p.user?.id!==p.sub||Object.keys(p.user).some(k=>!['id','email','twoFactorEnabled','passwordCredential','providers','user_metadata'].includes(k))||typeof p.user.twoFactorEnabled!=='boolean'||typeof p.user.passwordCredential!=='boolean'||!Array.isArray(p.user.providers)||p.user.providers.some(v=>typeof v!=='string'||v.length>30)||
  p.user.email!==undefined&&(typeof p.user.email!=='string'||p.user.email.length>320)||!p.user.user_metadata||Array.isArray(p.user.user_metadata)||Object.entries(p.user.user_metadata).some(([k,v])=>!['full_name','store_name','business_sector'].includes(k)||typeof v!=='string'||v.length>150))throw Error('OFFLINE_RECEIPT_INVALID');
 return p;
}
export function createOfflineIdentityStore(input:{key:string;issuer:string;storage:IdentityStorage;online:()=>boolean;now?:()=>number}){
 const key=offlinePublicKey(input.key),now=input.now||Date.now;let changes:Promise<unknown>=Promise.resolve();
 const change=<T>(fn:()=>Promise<T>)=>{const next=changes.then(fn,fn);changes=next.catch(()=>{});return next;};
 let devicePromise:Promise<string>|undefined;
 const device=()=>devicePromise??=(async()=>{const previous=await input.storage.getItem(OFFLINE_DEVICE_KEY);if(previous){if(!uuid.test(previous))throw Error('OFFLINE_DEVICE_INVALID');return previous;}const id=crypto.randomUUID();await input.storage.setItem(OFFLINE_DEVICE_KEY,id);return id;})();
 return {device,online:input.online,
  save(token:string,subject:string,sessionId:string){return change(async()=>{const p=await verifyOfflineIdentity(token,key,input.issuer,await device(),now());if(p.sub!==subject||p.sid!==sessionId)throw Error('OFFLINE_PRINCIPAL_MISMATCH');await input.storage.setItem(OFFLINE_IDENTITY_KEY,token);});},
  async read(){if(input.online())return null;const token=await input.storage.getItem(OFFLINE_IDENTITY_KEY);if(!token)return null;try{return await verifyOfflineIdentity(token,key,input.issuer,await device(),now());}catch(error){await change(()=>input.storage.removeItem(OFFLINE_IDENTITY_KEY));throw error;}},
  clear:()=>change(()=>input.storage.removeItem(OFFLINE_IDENTITY_KEY)),
 };
}
