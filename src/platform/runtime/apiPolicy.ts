export function httpsOrigin(value:string):string {
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('INVALID_HTTPS_API_ORIGIN');return u.origin;
}
/** Only /api paths on the application origin may be remapped; tokens never follow redirects. */
export function apiTarget(raw:string,appOrigin:string,native:boolean,configured:string):URL|null {
 const base=new URL(appOrigin),u=new URL(raw,base);
 if(u.protocol!==base.protocol||u.host!==base.host||!u.pathname.startsWith('/api/'))return null;
 if(!native)return u;
 const origin=httpsOrigin(configured);return new URL(u.pathname+u.search,origin);
}
export function parseAuthCallback(raw:string,expected:string):string|null {
 let u:URL,e:URL;try{u=new URL(raw);e=new URL(expected);}catch{return null;}
 if(u.protocol!==e.protocol||u.host!==e.host||u.pathname!==e.pathname||u.username||u.password||u.hash)return null;
 if([...u.searchParams.keys()].some(k=>!['code','state'].includes(k))||u.searchParams.getAll('code').length!==1)return null;
 const code=u.searchParams.get('code');return code&&code.length<4096?code:null;
}
