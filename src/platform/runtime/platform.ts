const capacitor=()=> (globalThis as typeof globalThis & {Capacitor?:{isNativePlatform?:()=>boolean;getPlatform?:()=>string}}).Capacitor;
export type Platform = 'web'|'pwa'|'android'|'ios';
export const isNative = () => capacitor()?.isNativePlatform?.()===true;
export function platform():Platform {
 const p=capacitor()?.getPlatform?.()||'web';
 return p==='android'||p==='ios'?p:typeof matchMedia!=='undefined'&&matchMedia('(display-mode: standalone)').matches?'pwa':'web';
}
/** Release gate: native storage/physical-device financial acceptance is not yet approved. */
export function assertNativeFinancialReady(){if(isNative())throw new Error('Operasi keuangan native belum tersedia. Gunakan aplikasi web untuk transaksi.');}

export const authRedirect=()=>isNative()?'space.newhope.kasir://auth/callback':window.location.origin;
