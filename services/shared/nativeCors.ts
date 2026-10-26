/** Native webview origins are opt-in transport origins, never authentication. */
export function nativeCors(req:any,res:any,methods:readonly string[]):boolean {
 const origin=String(req.headers.origin||'');
 const native=['capacitor://localhost','https://localhost'].includes(origin);
 if(!native)return false;
 const enabled=(process.env.NEW_HOPE_NATIVE_ORIGINS||'').split(',').map(v=>v.trim()).includes(origin);
 if(!enabled){res.status(403).json({ok:false,error:'NATIVE_ORIGIN_DISABLED'});return true;}
 const requested=String(req.headers['access-control-request-method']||req.method).toUpperCase();
 const requestedHeaders=String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(v=>v.trim()).filter(Boolean);
 if(!methods.includes(requested)||requestedHeaders.some(h=>!['authorization','content-type'].includes(h))){res.status(403).json({ok:false,error:'NATIVE_CORS_DENIED'});return true;}
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
 res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods',methods.join(', '));
 if(req.method==='OPTIONS'){res.status(204).end();return true;}return false;
}
