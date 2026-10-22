import type {User} from '@supabase/auth-js';
import {readOfflineBootstrap} from '../workspace/offlineBootstrap';
const key='nh-managed-neon-offline-profile-v1';
/** Local UI hint only. Contains no token, session, role, password or MFA proof.
 * A fresh online login and server ownership check are mandatory before sync. */
export function saveManagedOfflineProfile(user:User,storage:Pick<Storage,'setItem'>=localStorage,now=Date.now()){
 if(!user.email_confirmed_at)return;
 storage.setItem(key,JSON.stringify({id:user.id,email:user.email,createdAt:user.created_at,fullName:String(user.user_metadata?.full_name||user.user_metadata?.displayName||'Pemilik Toko'),verifiedAt:now}));
}
export function clearManagedOfflineProfile(storage:Pick<Storage,'removeItem'>=localStorage){storage.removeItem(key);}
export function readManagedOfflineProfile(storage:Pick<Storage,'getItem'>=localStorage,now=Date.now()):User|null{
 try{
  const row=JSON.parse(storage.getItem(key)||'null');
  if(!row||! /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.id)||typeof row.email!=='string'||!Number.isFinite(row.verifiedAt)||row.verifiedAt>now||now-row.verifiedAt>=86400000||!readOfflineBootstrap(row.id,now))return null;
  return {id:row.id,email:row.email,aud:'authenticated',created_at:row.createdAt,email_confirmed_at:new Date(row.verifiedAt).toISOString(),app_metadata:{},user_metadata:{full_name:row.fullName}};
 }catch{return null;}
}
