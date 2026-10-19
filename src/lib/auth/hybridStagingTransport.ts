/** Preview Auth may log in/refresh/log out and verify existing MFA factors.
 * Signup, reset, enrollment and foreign destinations never reach the source. */
export function hybridStagingTransport(nativeFetch:typeof fetch=fetch):typeof fetch {
 return async(input,init)=>{
  const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url),method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  const allowed=u.origin==='https://fqxrhumsgigcgjtlbfuo.supabase.co'&&(method==='GET'||/\/auth\/v1\/(token|logout)$/.test(u.pathname)||/\/auth\/v1\/factors\/[^/]+\/(challenge|verify)$/.test(u.pathname));
  if(!allowed)return new Response(JSON.stringify({msg:'HYBRID_STAGING_AUTH_MUTATION_BLOCKED'}),{status:403,headers:{'content-type':'application/json'}});
  return nativeFetch(input,init);
 };
}
