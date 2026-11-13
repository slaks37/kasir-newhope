interface SecureSession {get(options:{key:string}):Promise<{value:string|null}>;set(options:{key:string,value:string}):Promise<void>;remove(options:{key:string}):Promise<void>}
let vault:Promise<SecureSession>|undefined;
const getVault=()=>vault??=import('@capacitor/core').then(({registerPlugin})=>registerPlugin<SecureSession>('SecureSession'));
/** No localStorage fallback: unavailable native vault must fail closed. */
export const secureSessionStorage={getItem:async(key:string)=>(await (await getVault()).get({key})).value,setItem:async(key:string,value:string)=> (await getVault()).set({key,value}),removeItem:async(key:string)=> (await getVault()).remove({key})};
