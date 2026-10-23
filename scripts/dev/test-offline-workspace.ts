import {saveManagedOfflineProfile,readManagedOfflineProfile,clearManagedOfflineProfile} from '../../src/lib/auth/neonOffline';
import type {User as AuthUser} from '@supabase/auth-js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {SharedStateSync} from '../../src/lib/sync/sharedState';
import {saveVerifiedBootstrap,readOfflineBootstrap,saveVerifiedFinancialScope,hasVerifiedFinancialScope} from '../../src/lib/workspace/offlineBootstrap';
import type {Directory} from '../../src/lib/workspace/businessDirectory';
import type {SaaSSubscription} from '../../src/types';
import {readReceiptLogo,saveReceiptLogo} from '../../src/lib/workspace/receiptLogo';

const disk=new Map<string,string>(),network={onLine:true};
Object.defineProperty(globalThis,'localStorage',{value:{getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>disk.set(key,value),removeItem:(key:string)=>disk.delete(key)},configurable:true});
Object.defineProperty(globalThis,'navigator',{value:network,configurable:true});
const owner=randomUUID(),tenant=randomUUID(),businessId=randomUUID(),otherBusiness=randomUUID(),outlet=randomUUID(),now=Date.now();
saveReceiptLogo(owner,businessId,'data:image/png;base64,iVBORw0KGgo=');
assert.equal(readReceiptLogo(owner,businessId),'data:image/png;base64,iVBORw0KGgo=');
assert.equal(readReceiptLogo(owner,otherBusiness),undefined,'Another same-sector business cannot inherit the receipt logo');
assert.equal(readReceiptLogo(randomUUID(),businessId),undefined,'Nor another owner');
assert.throws(()=>saveReceiptLogo(owner,businessId,'data:image/svg+xml;base64,AAAA'),/INVALID_RECEIPT_LOGO/);
saveReceiptLogo(owner,businessId,null);assert.equal(readReceiptLogo(owner,businessId),undefined,'Confirmed cloud removal clears the asset without touching financial data');
const directory:Directory={tenantId:tenant,capabilities:{multiBusiness:true},businesses:[{tenantId:tenant,businessId,name:'Laundry',sector:'LAUNDRY',status:'ACTIVE',legacyAlias:null,
  transportRef:owner+'_business_'+businessId,outlets:[{outletId:outlet,businessId,name:'Laundry branch',address:'',status:'ACTIVE'}]}]};
const subscription:SaaSSubscription={id:randomUUID(),tenantId:tenant,planId:'plan-free',status:'TRIAL',currentPeriodStart:new Date(now).toISOString(),currentPeriodEnd:new Date(now+2*86400000).toISOString(),cancelAtPeriodEnd:false};
saveVerifiedBootstrap(owner,directory,subscription,now);
saveManagedOfflineProfile({id:owner,email:'synthetic@example.invalid',email_confirmed_at:new Date(now).toISOString(),created_at:new Date(now).toISOString(),aud:'authenticated',app_metadata:{role:'SUPERADMIN'},user_metadata:{full_name:'Synthetic owner',role:'SUPERADMIN',password:'MUST_NOT_PERSIST'}} as AuthUser,localStorage,now);
const profileBytes=disk.get('nh-managed-neon-offline-profile-v1')!;
assert(!profileBytes.includes('SUPERADMIN')&&!profileBytes.includes('MUST_NOT_PERSIST')&&!profileBytes.includes('access_token'));
assert.equal(readManagedOfflineProfile(localStorage,now)?.id,owner);
assert.equal(readManagedOfflineProfile(localStorage,now+86400001),null);
clearManagedOfflineProfile();assert.equal(readManagedOfflineProfile(localStorage,now),null);
const cached=readOfflineBootstrap(owner,now)!;assert(cached);assert.equal(cached.directory.businesses[0].businessId,businessId);
assert.equal(readOfflineBootstrap(randomUUID(),now),null,'Another account cannot restore the cache');
assert.equal(readOfflineBootstrap(owner,now+86400001),null,'Offline UI cache expires within 24 hours');
saveVerifiedFinancialScope(owner,businessId,outlet,now);
assert(hasVerifiedFinancialScope(owner,businessId,outlet,cached.expiresAt,now));
assert.equal(hasVerifiedFinancialScope(owner,otherBusiness,outlet,cached.expiresAt,now),false,'A financial preflight cannot be reused for another business');
assert.equal(hasVerifiedFinancialScope(owner,businessId,randomUUID(),cached.expiresAt,now),false,'Or another outlet');
disk.set('newhope_transaction_outbox_financial-proof','EXACT FINANCIAL QUEUE');
disk.set('newhope_legacy_financial_v1_proof','EXACT RECOVERY SNAPSHOT');
const identity={businessId,transportRef:directory.businesses[0].transportRef!,namespace:businessId};
let rows:any[]=[],status:any,requests=0,revision=5,price=100,lostAck=true;
Object.defineProperty(globalThis,'fetch',{value:async(_url:string,options?:any)=>{
  requests++;
  if(options?.method==='POST'){
    const op=JSON.parse(options.body).operations[0];assert.equal(op.baseRevision,5,'Offline edits retain the last server revision, never base zero');
    revision=6;price=op.value.price;
    if(lostAck){lostAck=false;throw Error('ACK_CONNECTION_LOST');}
    return {ok:true,json:async()=>({ok:true,versions:[{kind:'products',recordId:'same-product',revision}]})};
  }
  return {ok:true,json:async()=>({ok:true,ready:true,business:{businessId,sector:'LAUNDRY'},kinds:['products'],records:[{scope:'LAUNDRY',kind:'products',recordId:'same-product',revision,deleted:false,value:{id:'same-product',name:'Laundry product',price,costPrice:10}}]})};
},configurable:true});
const make=()=>{
  const state=new SharedStateSync(owner,'LAUNDRY',value=>{rows=value;state.prime('products',value.filter(r=>!r.deleted).map(r=>r.value) as object[]);},value=>{status=value;},identity);
  state.setKinds(['products']);return state;
};
const first=make();await first.refresh(true);assert.equal(status.ready,true);first.stop();
network.onLine=false;
const offline=make();assert(offline.restoreOffline(cached.expiresAt));
assert.equal(rows[0].value.price,100);
offline.track('products',[{...rows[0].value,price:200}]);assert.equal(status.pending,1);
const beforeOffline=requests;await offline.refresh(false);await offline.flush();assert.equal(requests,beforeOffline,'Offline hydration/delivery makes no network request');offline.stop();
const reloaded=make();assert(reloaded.restoreOffline(cached.expiresAt));assert.equal(rows[0].value.price,200,'Pending edit overlays the cached baseline after reload');
network.onLine=true;await reloaded.refresh(false);assert.equal(status.pending,1,'Lost ACK retains the durable operation');reloaded.stop();
const afterLostAck=make();await afterLostAck.refresh(false);assert.equal(status.pending,0,'A matching server revision acknowledges an already committed offline edit');afterLostAck.stop();
network.onLine=false;
const expired=make();assert.equal(expired.restoreOffline(now-1),false);assert.equal(status.ready,false);expired.stop();
const other=new SharedStateSync(owner,'LAUNDRY',()=>{},value=>{status=value;},{...identity,businessId:otherBusiness,namespace:otherBusiness});
other.setKinds(['products']);assert.equal(other.restoreOffline(cached.expiresAt),false,'Another same-sector business has no cached baseline');other.stop();
assert.equal(disk.get('newhope_transaction_outbox_financial-proof'),'EXACT FINANCIAL QUEUE');
assert.equal(disk.get('newhope_legacy_financial_v1_proof'),'EXACT RECOVERY SNAPSHOT');
console.log('PASS: offline bootstrap expiry and owner/business/outlet isolation, cached revisions, reload with pending, lost ACK replay and untouched financial bytes');
