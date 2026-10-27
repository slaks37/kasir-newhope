import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
/** Purpose-bound sealed native challenge state. Tokens never travel in callback URLs. */
export function sealAuthState(value:unknown,secret:string,purpose:string,ttl=300,now=Date.now()){
 const iv=randomBytes(12),key=createHash('sha256').update(secret).digest(),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(purpose));
 const bytes=Buffer.concat([cipher.update(JSON.stringify({value,expires:now+ttl*1000})),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');
}
export function openAuthState(value:string,secret:string,purpose:string,now=Date.now()):unknown{
 if(value.length>16384)throw Error('AUTH_STATE_REJECTED');const bytes=Buffer.from(value,'base64url');if(bytes.length<29)throw Error('AUTH_STATE_REJECTED');
 const decipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),bytes.subarray(0,12));decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(bytes.subarray(12,28));
 const parsed=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());if(!Number.isFinite(parsed.expires)||parsed.expires<=now)throw Error('AUTH_STATE_EXPIRED');return parsed.value;
}
