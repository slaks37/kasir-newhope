import {clearManagedOfflineProfile} from './neonOffline';

type Revoker={revokeSessions:()=>Promise<{data:unknown;error:unknown}>};
/** The managed provider derives the user from its authenticated cookie. No
 * tenant, email, session token or target user is accepted from this caller. */
export async function revokeManagedSessions(client:Revoker){
 const result=await client.revokeSessions();
 if(result.error||!result.data||typeof result.data!=='object'||!('status' in result.data)||result.data.status!==true){
  throw Error('SESSION_REVOCATION_NOT_CONFIRMED');
 }
}

/** Keep POS drafts/outboxes and business caches. Never use storage.clear(). */
export function clearRevokedManagedProfile(local:Pick<Storage,'removeItem'>=localStorage,session:Pick<Storage,'removeItem'>=sessionStorage){
 clearManagedOfflineProfile(local);
 for(const key of ['nhpos_local_session','newhope_pos_guest_mode','nhpos_internal_identity'])local.removeItem(key);
 for(const key of ['nh-neon-admin-mfa','nhpos_internal_identity'])session.removeItem(key);
}
