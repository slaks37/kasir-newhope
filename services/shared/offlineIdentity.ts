import {createECDH,createHmac,createPrivateKey,createPublicKey,createHash,sign} from 'node:crypto';
import type {OfflineIdentityClaims,OfflinePublicKey} from '../../src/lib/auth/offlineIdentity';
import {OFFLINE_MAX_SECONDS} from '../../src/lib/auth/offlineIdentity';
/** Separate deterministic signing purpose; only the public key enters a build.
 * Receipts are not accepted by any server principal resolver. */
export function offlineIdentityKeys(secret:string,issuer:string){
 if(secret.length<48||new URL(issuer).origin!==issuer)throw Error('OFFLINE_SIGNER_CONFIG_INVALID');
 const seed=createHmac('sha256',secret).update('newhope-offline-ui-signing-v1\0'+issuer).digest();
 const order=BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
 const d=Buffer.from((BigInt('0x'+seed.toString('hex'))%(order-1n)+1n).toString(16).padStart(64,'0'),'hex');
 const ecdh=createECDH('prime256v1');ecdh.setPrivateKey(d);const publicBytes=ecdh.getPublicKey(undefined,'uncompressed');
 const jwk={kty:'EC',crv:'P-256',x:publicBytes.subarray(1,33).toString('base64url'),y:publicBytes.subarray(33).toString('base64url'),d:d.toString('base64url')};
 const privateKey=createPrivateKey({key:jwk,format:'jwk'}),pub=createPublicKey(privateKey).export({format:'jwk'});
 const publicKey:OfflinePublicKey={kty:'EC',crv:'P-256',x:pub.x!,y:pub.y!,kid:createHash('sha256').update(pub.x!+'.'+pub.y!).digest('base64url').slice(0,16)};
 return {privateKey,publicKey};
}
export function issueOfflineIdentity(input:{secret:string;issuer:string;device:string;sessionId:string;expiresAt:Date|string;user:OfflineIdentityClaims['user']},now=Date.now()){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.device)||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.user.id)||!input.sessionId||input.sessionId.length>255)throw Error('OFFLINE_RECEIPT_INPUT_INVALID');
 const iat=Math.floor(now/1000),sessionExp=Math.floor(new Date(input.expiresAt).getTime()/1000),exp=Math.min(iat+OFFLINE_MAX_SECONDS,sessionExp);if(!Number.isFinite(exp)||exp<=iat)throw Error('OFFLINE_SESSION_EXPIRED');
 const {privateKey,publicKey}=offlineIdentityKeys(input.secret,input.issuer),claims:OfflineIdentityClaims={v:1,aud:'newhope-offline-ui',iss:input.issuer,sub:input.user.id,sid:input.sessionId,device:input.device,iat,exp,sessionExp,user:{id:input.user.id,email:input.user.email,twoFactorEnabled:input.user.twoFactorEnabled,passwordCredential:input.user.passwordCredential,providers:input.user.providers,user_metadata:Object.fromEntries(Object.entries(input.user.user_metadata).filter(([k,v])=>['full_name','store_name','business_sector'].includes(k)&&typeof v==='string'&&v.length<=150))}};
 const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url'),body=encode({alg:'ES256',typ:'NH-OFFLINE-UI',kid:publicKey.kid})+'.'+encode(claims);
 return body+'.'+sign('sha256',Buffer.from(body),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
