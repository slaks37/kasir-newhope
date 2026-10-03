import type {BusinessIdentity} from './businessIdentity';
export const sectorLabel=(sector:string)=>({FNB:'Kafe & Resto',LAUNDRY:'Laundry',RETAIL:'Ritel',CARWASH:'Carwash',BARBERSHOP:'Barbershop'}[sector]||sector);
/** Registered/enabled merchant is not proof that any branch can trade. */
export function businessAvailability(business:BusinessIdentity){
  const active=business.outlets.filter(outlet=>outlet.status==='ACTIVE');
  const inactive=business.outlets.filter(outlet=>outlet.status!=='ACTIVE');
  return {active,inactive,label:business.status!=='ACTIVE'?'Bisnis dinonaktifkan':active.length?'Siap beroperasi':'Belum ada outlet aktif'};
}
