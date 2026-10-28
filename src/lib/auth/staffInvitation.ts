const key='newhope-pending-staff-invitation-v1';
export function pendingStaffInvitation():string|null{
 try{const v=JSON.parse(sessionStorage.getItem(key)||'null');if(v&&/^[\w-]{43}$/.test(v.token)&&Number.isFinite(v.savedAt)&&v.savedAt<=Date.now()&&Date.now()-v.savedAt<86400000)return v.token;sessionStorage.removeItem(key);}catch{/* Unavailable storage requires reopening the private invitation. */}return null;
}
export function rememberStaffInvitation(hash:string){
 if(!/^#token=[\w-]{43}$/.test(hash))return false;
 sessionStorage.setItem(key,JSON.stringify({token:hash.slice(7),savedAt:Date.now()}));return true;
}
export function forgetStaffInvitation(){sessionStorage.removeItem(key);}
