/** A stored signed bearer is a transport credential, never client authority.
 * Every protected API still validates the live server session and ownership. */
export function betterBearerToken(storage: Pick<Storage,'getItem'>, origin: string): string {
  return storage.getItem('nh-better-auth:'+origin+':token') || '';
}

export function authenticatedTransport(nativeFetch: typeof fetch, origin: string, accessToken: () => Promise<string> | string): typeof fetch {
  return async(input: RequestInfo | URL, init?: RequestInit) => {
    const url=new URL(input instanceof Request?input.url:String(input),origin);
    if(url.origin!==origin||!url.pathname.startsWith('/api/')||url.pathname==='/api/auth'||url.pathname.startsWith('/api/auth/'))
      return nativeFetch(input,init);
    const headers=new Headers(init?.headers ?? (input instanceof Request?input.headers:undefined));
    if(!headers.has('authorization')){
      const token=await accessToken();
      if(token)headers.set('authorization','Bearer '+token);
    }
    return nativeFetch(input,{...init,headers});
  };
}
