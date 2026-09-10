/**
 * Klien HTTP & Data Provider untuk Admin Back-Office.
 *
 * Mengakses data Supabase langsung dengan pemrosesan analitik realtime,
 * otentikasi role internal, dan audit jejak akses.
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';

const IDENTITY_KEY = 'nhpos_internal_identity';

export type InternalRole = 'ROLE_SUPERADMIN' | 'ROLE_INTERNAL_GROWTH' | 'ROLE_INTERNAL_SUPPORT';

export interface Identity {
  email: string;
  full_name: string;
  role: InternalRole;
}

export interface Session {
  user: { email: string; fullName: string; role: InternalRole };
  capabilities: string[];
  environment: string;
}

export const ROLE_LABEL: Record<InternalRole, string> = {
  ROLE_SUPERADMIN: 'Superadmin (Akses Penuh)',
  ROLE_INTERNAL_GROWTH: 'Growth (Agregat & Analitik)',
  ROLE_INTERNAL_SUPPORT: 'Support (Operasional Merchant)',
};

export function getIdentity(): string | null {
  return sessionStorage.getItem(IDENTITY_KEY) || localStorage.getItem(IDENTITY_KEY);
}

export function setIdentity(email: string | null): void {
  if (email) {
    sessionStorage.setItem(IDENTITY_KEY, email);
    localStorage.setItem(IDENTITY_KEY, email);
  } else {
    sessionStorage.removeItem(IDENTITY_KEY);
    localStorage.removeItem(IDENTITY_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/* -------------------------------------------------------------------------- */
/* SECTOR STYLES & HELPERS                                                    */
/* -------------------------------------------------------------------------- */

export const SECTORS = ['FNB', 'LAUNDRY', 'RETAIL', 'CARWASH', 'BARBERSHOP'] as const;
export type Sector = (typeof SECTORS)[number];

export const SECTOR_LABEL: Record<Sector, string> = {
  FNB: 'Kafe, Resto & F&B',
  LAUNDRY: 'Laundry',
  RETAIL: 'Ritel & Minimarket',
  CARWASH: 'Cuci Mobil & Motor',
  BARBERSHOP: 'Barbershop & Salon',
};

export const SECTOR_SHORT: Record<Sector, string> = {
  FNB: 'F&B',
  LAUNDRY: 'Laundry',
  RETAIL: 'Ritel',
  CARWASH: 'Carwash',
  BARBERSHOP: 'Barber',
};

export const SECTOR_STYLE: Record<Sector, { dot: string; chip: string; bar: string }> = {
  FNB: {
    dot: 'bg-amber-500',
    chip: 'bg-amber-100 text-amber-950 border border-amber-300',
    bar: 'bg-amber-500',
  },
  LAUNDRY: {
    dot: 'bg-sky-500',
    chip: 'bg-sky-100 text-sky-950 border border-sky-300',
    bar: 'bg-sky-500',
  },
  RETAIL: {
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-100 text-emerald-950 border border-emerald-300',
    bar: 'bg-emerald-500',
  },
  CARWASH: {
    dot: 'bg-indigo-500',
    chip: 'bg-indigo-100 text-indigo-950 border border-indigo-300',
    bar: 'bg-indigo-500',
  },
  BARBERSHOP: {
    dot: 'bg-fuchsia-500',
    chip: 'bg-fuchsia-100 text-fuchsia-950 border border-fuchsia-300',
    bar: 'bg-fuchsia-500',
  },
};

export const SEVERITY_STYLE: Record<string, string> = {
  INFO: 'bg-slate-100 text-slate-800 border border-slate-200',
  NOTICE: 'bg-sky-100 text-sky-950 border border-sky-300',
  WARNING: 'bg-amber-100 text-amber-950 border border-amber-300',
  CRITICAL: 'bg-red-100 text-red-950 border border-red-300',
};

export const rupiah = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'Rp 0';
  return 'Rp ' + Math.round(v).toLocaleString('id-ID');
};

export const rupiahShort = (n: unknown): string => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'Rp 0';
  if (Math.abs(v) >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (Math.abs(v) >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1).replace('.', ',')} jt`;
  if (Math.abs(v) >= 1_000) return `Rp ${(v / 1_000).toFixed(0)} rb`;
  return rupiah(v);
};

export const angka = (n: unknown): string => Number(n ?? 0).toLocaleString('id-ID');

export const waktu = (iso: unknown): string => {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const tanggal = (iso: unknown): string => {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const sejak = (iso: unknown): string => {
  if (!iso) return 'belum pernah';
  const d = new Date(String(iso)).getTime();
  if (Number.isNaN(d)) return '—';
  const menit = Math.floor((Date.now() - d) / 60000);
  if (menit < 1) return 'baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari < 30) return `${hari} hari lalu`;
  return `${Math.floor(hari / 30)} bulan lalu`;
};

/* -------------------------------------------------------------------------- */
/* SAMPLE DATA FOR BACKOFFICE CONSOLE                                         */
/* -------------------------------------------------------------------------- */


async function request(path:string,params?:Record<string,unknown>,body?:any):Promise<any>{
  if(!isSupabaseConfigured) throw new ApiError(503,'AUTH_NOT_CONFIGURED','Autentikasi Supabase belum dikonfigurasi.');
  const {data}=await supabase.auth.getSession();
  if(!data.session?.access_token) throw new ApiError(401,'UNAUTHORIZED','Silakan masuk kembali.');
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(params || {})) if(value!==undefined && value!==null && value!=='') query.set(key,String(value));
  const response=await fetch('/api/admin/'+path+(query.size?'?'+query:''),
    {method:body?'POST':'GET',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok || result.ok===false) throw new ApiError(response.status,result.error || 'API_ERROR',result.detail || result.error || 'Permintaan gagal.');
  return result;
}
export const api={
  logout:async()=>{await supabase.auth.signOut();setIdentity(null);},
  login:async(email:string,password:string):Promise<Session>=>{
    if(!isSupabaseConfigured) throw new ApiError(503,'AUTH_NOT_CONFIGURED','Autentikasi belum dikonfigurasi.');
    const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(error) throw new ApiError(401,'INVALID_CREDENTIALS','Email atau kata sandi salah.');
    try{const session=await api.me();setIdentity(email);return session;}
    catch(err){await supabase.auth.signOut();setIdentity(null);throw err;}
  },
  me:():Promise<Session>=>request('me'),
  identities:():Promise<{identities:Identity[]}>=>request('identities'),
  overview:()=>request('overview'),
  merchants:(p?:Record<string,unknown>)=>request('merchants',p),
  merchant:(id:string,justification?:string)=>request('merchants/'+encodeURIComponent(id),{justification}),
  transactions:(p?:Record<string,unknown>)=>request('transactions',p),
  transaction:(id:string)=>request('transactions/'+encodeURIComponent(id)),
  products:(p?:Record<string,unknown>)=>request('products',p),
  catalog:(p?:Record<string,unknown>)=>request('catalog',p),
  rawMaterials:(p?:Record<string,unknown>)=>request('raw-materials',p),
  bundles:(p?:Record<string,unknown>)=>request('bundles',p),
  recipes:(p?:Record<string,unknown>)=>request('recipes',p),
  activity:(p?:Record<string,unknown>)=>request('activity',p),
  activityBreakdown:()=>request('activity/breakdown'),
  audit:(p?:Record<string,unknown>)=>request('access-audit',p),
  staffCommissions:(p?:Record<string,unknown>)=>request('staff-commissions',p),
  subscriptions:(p?:Record<string,unknown>)=>request('subscriptions',p),
  payments:()=>request('payments'),
  support:(tenantId:string,body:any)=>request('tenants/'+encodeURIComponent(tenantId)+'/support',undefined,body),
  supportHistory:(tenantId:string,justification:string)=>request('tenants/'+encodeURIComponent(tenantId)+'/support',{justification}),
};
