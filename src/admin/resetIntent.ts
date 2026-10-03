/** Nonsensitive intent ID only. Never store email, password or recovery URL. */
export function pendingResetKey(storage:Pick<Storage,'getItem'|'setItem'>,tenantId:string):string {
  const key='nhpos_admin_reset_intent_'+tenantId;
  const old=storage.getItem(key);
  if(old&&/^[0-9a-f-]{36}$/i.test(old))return old;
  const id=crypto.randomUUID();storage.setItem(key,id);return id;
}
export function acknowledgeReset(storage:Pick<Storage,'removeItem'>,tenantId:string){storage.removeItem('nhpos_admin_reset_intent_'+tenantId);}
