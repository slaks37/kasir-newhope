import {httpsOrigin} from './apiPolicy';
/** The system-browser OAuth origin remains canonical. Only exact native auth
 * HTTP calls use the separately approved API origin, with no redirects/cookies. */
export function nativeAuthTarget(raw:string,canonicalBase:string,apiOrigin:string){
 const base=new URL(canonicalBase),url=new URL(raw);
 if(base.pathname.replace(/\/$/,'')!=='/api/auth'||base.username||base.password||base.search||base.hash||base.protocol!=='https:')throw Error('UNTRUSTED_AUTH_URL');
 if(url.origin!==base.origin||!url.pathname.startsWith('/api/auth/')||url.username||url.password||url.hash)throw Error('UNTRUSTED_NATIVE_AUTH_TARGET');
 return new URL(url.pathname+url.search,httpsOrigin(apiOrigin)).href;
}
