/** Auth tokens may return only to an auth page on an explicitly trusted host.
 * Same-origin marketing/blog pages can still initialize third-party trackers. */
export function authReturnUrl(kind:'RESET'|'VERIFY',value:unknown,baseUrl:string,allowedOrigins:readonly string[]=[baseUrl]) {
  const path=kind==='RESET'?'/reset-password':'/login';
  if(value===undefined||value===null||value==='')return baseUrl+path;
  if(typeof value!=='string')throw Error('AUTH_CALLBACK_REJECTED');
  let url:URL;try{url=new URL(value);}catch{throw Error('AUTH_CALLBACK_REJECTED');}
  if(url.username||url.password||url.search||url.hash||url.pathname!==path||
    !allowedOrigins.includes(url.origin)||url.href!==url.origin+path)throw Error('AUTH_CALLBACK_REJECTED');
  return url.href;
}
