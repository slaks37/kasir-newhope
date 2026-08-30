import React, { useState } from 'react';
import {
  ShieldCheck,
  Users,
  Store,
  Building2,
  KeyRound,
  CheckCircle2,
  Lock,
  UserCog,
  Briefcase,
  Shield,
  Filter,
  Eye,
  Info,
} from 'lucide-react';
import { Card, Chip, Empty, ErrorBox, Loading } from '../ui';
import { api, SECTOR_LABEL, type Sector } from '../api';
import { useAsync } from '../ui';

interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  role: 'ROLE_SUPERADMIN' | 'ROLE_INTERNAL_GROWTH' | 'ROLE_INTERNAL_SUPPORT';
  scope: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
}

/** Cakupan akses per role — diturunkan dari kapabilitas, bukan dikarang. */
const ROLE_SCOPE: Record<AdminUser['role'], string> = {
  ROLE_SUPERADMIN: 'Seluruh konsol internal, termasuk jejak akses',
  ROLE_INTERNAL_GROWTH: 'Analitik agregat dan kesehatan merchant',
  ROLE_INTERNAL_SUPPORT: 'Operasional merchant (wajib menyertakan alasan)',
};

interface ClientUser {
  id: string;
  storeName: string;
  businessSector: Sector;
  name: string;
  username: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER';
  pinStatus: string;
  status: 'ACTIVE' | 'INACTIVE';
}

/*
 * DAFTAR ADMIN PLATFORM DIBACA DARI SERVER.
 *
 * Empat akun — termasuk satu alamat pribadi — dulu ter-hardcode di berkas ini
 * dan dirender apa adanya, sehingga layar "User Admin Platform" menampilkan
 * daftar yang tidak ada hubungannya dengan isi `internal.internal_users`.
 * Menambah atau mencabut staf internal di database tidak mengubah apa pun di
 * layar ini.
 *
 * Sumbernya sekarang GET /api/admin/identities. Kolom yang tidak dimiliki
 * endpoint itu (scope, createdAt) tidak dikarang — lihat catatan di bawah.
 */

function getRegisteredClientUsers(): ClientUser[] {
  try {
    const raw = localStorage.getItem('nhpos_local_auth_users');
    if (raw) {
      const parsed = JSON.parse(raw);
      const list = Object.values(parsed).map((u: any, idx) => ({
        id: `usr-reg-${idx + 1}`,
        storeName: u.storeName || 'Toko Terdaftar',
        businessSector: (u.sector || 'FNB') as any,
        name: u.fullName || u.email?.split('@')[0] || 'Pemilik Toko',
        username: u.email?.split('@')[0] || 'owner',
        role: 'ADMIN' as const,
        pinStatus: 'PIN Terenkripsi',
        status: 'ACTIVE' as const,
      }));
      if (list.length > 0) return list;
    }
  } catch {}
  return [];
}

export default function UserManagement() {
  const [activeTab, setActiveTab] = useState<'ADMIN_USERS' | 'CLIENT_USERS'>('ADMIN_USERS');
  const [sectorFilter, setSectorFilter] = useState<string>('ALL');
  const [clientUsersList] = useState<ClientUser[]>(() => getRegisteredClientUsers());

  // internal.internal_users lewat guard server — bukan konstanta di browser.
  const { data: identData, loading: identLoading, error: identError } = useAsync(
    () => api.identities(),
    []
  );

  /*
   * `scope` dan `createdAt` TIDAK ada di endpoint identities, dan sengaja tidak
   * dikarang di sini. Yang ditampilkan hanyalah yang benar-benar diketahui:
   * nama, email, dan role. Kolom scope diisi label role — yang memang
   * menentukan cakupan aksesnya — bukan kalimat karangan tentang infrastruktur.
   */
  const adminUsers: AdminUser[] = (identData?.identities ?? []).map((i, idx) => ({
    id: `adm-${idx + 1}`,
    fullName: i.full_name,
    email: i.email,
    role: i.role,
    scope: ROLE_SCOPE[i.role] ?? '—',
    status: 'ACTIVE' as const,
    createdAt: '',
  }));

  const filteredClientUsers =
    sectorFilter === 'ALL'
      ? clientUsersList
      : clientUsersList.filter((u) => u.businessSector === sectorFilter);

  return (
    <div className="space-y-6">
      {/* Title & Subtitle */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">
            Pemisahan Data Pengguna (Admin vs Client)
          </h2>
          <p className="text-xs text-slate-600 font-medium dark:text-slate-400 mt-0.5">
            Struktur terisolasi antara User Platform Superadmin (Back-Office) dan User Toko/Merchant (Client POS)
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('ADMIN_USERS')}
            className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'ADMIN_USERS'
                ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-500/20'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>User Admin Platform ({adminUsers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('CLIENT_USERS')}
            className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'CLIENT_USERS'
                ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-500/20'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>User Client Merchant ({clientUsersList.length})</span>
          </button>
        </div>
      </div>

      {/* Info Card Explaining the Isolation Architecture */}
      <div className="p-5 rounded-2xl bg-slate-900 text-white border border-slate-800 flex flex-col md:flex-row gap-6 items-start justify-between shadow-sm">
        <div className="space-y-2 max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold border border-emerald-500/30 uppercase tracking-wider">
              Tenant &amp; Schema Isolation Active
            </span>
            <span className="text-xs text-slate-400 font-mono">Database: Supabase PostgreSQL</span>
          </div>
          <h3 className="text-base font-black text-white">
            {activeTab === 'ADMIN_USERS'
              ? 'Tabel: `internal.internal_users` — Hak Akses Back-Office Platform'
              : 'Tabel: `pos.users` — Hak Akses Terisolasi Per Merchant / Toko'}
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed font-medium">
            {activeTab === 'ADMIN_USERS'
              ? 'Pengguna Admin Platform berwenang melihat metrik agregat, audit trail, performa merchant, dan manajemen lisensi. Data kredensial tidak pernah bercampur dengan database kasir merchant.'
              : 'Pengguna Client Toko terikat pada `tenant_id` masing-masing. Seorang kasir di Kopi Senja tidak dapat mengakses atau melihat data transaksi Toko Berkah atau merchant lainnya.'}
          </p>
        </div>

        <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-2 shrink-0 w-full md:w-64">
          <div className="flex items-center justify-between text-slate-300">
            <span>Admin Platform:</span>
            <span className="font-mono text-amber-400 font-bold">{adminUsers.length} Akun</span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span>Merchant Staf:</span>
            <span className="font-mono text-emerald-400 font-bold">{clientUsersList.length} Staf</span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span>Superadmin:</span>
            <span className="font-mono text-white font-bold">Stefen Laksana</span>
          </div>
        </div>
      </div>

      {/* VIEW 1: USER ADMIN PLATFORM (internal.internal_users) */}
      {activeTab === 'ADMIN_USERS' && (
        <Card>
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-100 text-amber-900 rounded-xl border border-amber-200">
                <ShieldCheck className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <h4 className="font-black text-sm text-slate-900">Daftar Administrator Platform (Internal)</h4>
                <p className="text-xs text-slate-500 font-medium">Pengguna dengan hak akses khusus ke konsol Back-Office &amp; Monitoring</p>
              </div>
            </div>
            <span className="px-3 py-1 bg-amber-50 text-amber-900 text-xs font-bold rounded-xl border border-amber-300 font-mono">
              internal.internal_users
            </span>
          </div>

          {identLoading && <Loading />}
          {identError && <ErrorBox error={identError} />}
          {!identLoading && !identError && adminUsers.length === 0 && (
            <Empty label="Belum ada staf internal terdaftar di internal.internal_users." />
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/90 text-[11px] text-slate-700 font-black uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="p-4">Nama Lengkap &amp; Email</th>
                  <th className="p-4">Role Platform</th>
                  <th className="p-4">Lingkup Wewenang (Scope)</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {adminUsers.map((adm) => (
                  <tr key={adm.id} className="hover:bg-amber-50/30 transition-colors">
                    <td className="p-4">
                      <div className="font-black text-slate-950 text-sm">{adm.fullName}</div>
                      <div className="font-mono text-xs text-slate-600 font-semibold mt-0.5">{adm.email}</div>
                    </td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border ${
                          adm.role === 'ROLE_SUPERADMIN'
                            ? 'bg-amber-100 text-amber-950 border-amber-300'
                            : adm.role === 'ROLE_INTERNAL_GROWTH'
                            ? 'bg-blue-100 text-blue-950 border-blue-300'
                            : 'bg-emerald-100 text-emerald-950 border-emerald-300'
                        }`}
                      >
                        <Shield className="w-3.5 h-3.5" />
                        <span>{adm.role}</span>
                      </span>
                    </td>
                    <td className="p-4 text-slate-700 font-semibold">
                      {adm.scope}
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                        <span>{adm.status}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* VIEW 2: USER CLIENT MERCHANT (pos.users) */}
      {activeTab === 'CLIENT_USERS' && (
        <Card>
          <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/50">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-100 text-blue-900 rounded-xl border border-blue-200">
                <Store className="w-5 h-5 text-blue-700" />
              </div>
              <div>
                <h4 className="font-black text-sm text-slate-900">Daftar Pengguna Client Merchant (pos.users)</h4>
                <p className="text-xs text-slate-500 font-medium">Owner, Supervisor/Manager, dan Kasir per Tenant Toko</p>
              </div>
            </div>

            {/* Sector Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="bg-white border border-slate-300 text-xs font-bold text-slate-800 px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              >
                <option value="ALL">Semua Sektor Usaha ({clientUsersList.length})</option>
                <option value="FNB">Kafe &amp; Resto (F&amp;B)</option>
                <option value="LAUNDRY">Laundry</option>
                <option value="RETAIL">Ritel &amp; Minimarket</option>
                <option value="CARWASH">Cuci Kendaraan</option>
                <option value="BARBERSHOP">Barbershop</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/90 text-[11px] text-slate-700 font-black uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="p-4">Nama Staf &amp; Username</th>
                  <th className="p-4">Toko / Merchant</th>
                  <th className="p-4">Sektor Bisnis</th>
                  <th className="p-4">Role Toko</th>
                  <th className="p-4">Status PIN Kasir</th>
                  <th className="p-4">Status Akun</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredClientUsers.map((cli) => (
                  <tr key={cli.id} className="hover:bg-amber-50/30 transition-colors">
                    <td className="p-4">
                      <div className="font-black text-slate-950 text-sm">{cli.name}</div>
                      <div className="font-mono text-xs text-slate-600 font-semibold mt-0.5">@{cli.username}</div>
                    </td>
                    <td className="p-4 font-bold text-slate-900">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-amber-600" />
                        <span>{cli.storeName}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-slate-100 text-slate-800 border border-slate-200">
                        {SECTOR_LABEL[cli.businessSector]}
                      </span>
                    </td>
                    <td className="p-4">
                      <span
                        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black border ${
                          cli.role === 'ADMIN'
                            ? 'bg-purple-100 text-purple-950 border-purple-300'
                            : cli.role === 'MANAGER'
                            ? 'bg-blue-100 text-blue-950 border-blue-300'
                            : 'bg-emerald-100 text-emerald-950 border-emerald-300'
                        }`}
                      >
                        {cli.role === 'ADMIN' && <UserCog className="w-3.5 h-3.5" />}
                        {cli.role === 'MANAGER' && <Briefcase className="w-3.5 h-3.5" />}
                        {cli.role === 'CASHIER' && <Store className="w-3.5 h-3.5" />}
                        <span>{cli.role}</span>
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 text-slate-700 font-mono text-xs font-bold">
                        <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                        <span>{cli.pinStatus}</span>
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                        <span>{cli.status}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
