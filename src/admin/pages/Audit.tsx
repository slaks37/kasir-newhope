import { useState } from 'react';
import { api, waktu } from '../api';
import { Card, Chip, Empty, ErrorBox, Loading, Table, Td, Th, useAsync, SearchBox, Pagination } from '../ui';
import { ShieldCheck, Search, Filter, Lock, UserCheck, AlertTriangle } from 'lucide-react';

export default function Audit() {
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState('ALL');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data, loading, error, reload } = useAsync(() => api.audit({ search, filter: filterAction, offset, limit }), [
    search,
    filterAction,
    offset,
  ]);

  const rows = data?.rows || [];
  const filteredRows = rows.filter((r: any) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      String(r.internal_name || '').toLowerCase().includes(q) ||
      String(r.internal_email || '').toLowerCase().includes(q) ||
      String(r.action || '').toLowerCase().includes(q) ||
      String(r.merchant_name || '').toLowerCase().includes(q) ||
      String(r.justification || '').toLowerCase().includes(q);

    const matchesAction =
      filterAction === 'ALL' ||
      (filterAction === 'DENIED' && (String(r.action).startsWith('DENIED_') || String(r.action).startsWith('BLOCKED_'))) ||
      (filterAction === 'LOGIN' && String(r.action).includes('LOGIN')) ||
      (filterAction === 'FINANCIAL' && (String(r.action).includes('FINANCIAL') || String(r.action).includes('EXPORT') || String(r.action).includes('OVERVIEW'))) ||
      (filterAction === 'ADMIN' && String(r.action).includes('ADMIN'));

    return matchesSearch && matchesAction;
  });

  return (
    <div className="space-y-4">
      <Card
        title="Jejak Akses Internal (Security Audit Log)"
        subtitle="Mencatat riwayat pembukaan data merchant oleh tim internal/admin platform, otentikasi login, perubahan izin, serta percobaan akses yang ditolak."
        actions={
          <div className="flex items-center space-x-2">
            <SearchBox value={search} onChange={(v) => setSearch(v)} placeholder="Cari staf, email, merchant, aksi…" />
          </div>
        }
      >
        {/* Quick Filter Badges */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3 bg-slate-50/50">
          <button
            onClick={() => setFilterAction('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              filterAction === 'ALL'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Semua Jejak Akses ({rows.length})
          </button>
          <button
            onClick={() => setFilterAction('FINANCIAL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              filterAction === 'FINANCIAL'
                ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Akses Finansial &amp; Laporan
          </button>
          <button
            onClick={() => setFilterAction('LOGIN')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              filterAction === 'LOGIN'
                ? 'bg-emerald-600 text-white font-bold shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            Otentikasi &amp; Login
          </button>
          <button
            onClick={() => setFilterAction('DENIED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              filterAction === 'DENIED'
                ? 'bg-rose-600 text-white font-bold shadow-xs'
                : 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50'
            }`}
          >
            Ditolak / Terblokir
          </button>
        </div>

        {loading && <Loading />}
        {error && <ErrorBox error={error} />}

        {!loading && filteredRows.length === 0 ? (
          <Empty label="Belum ada riwayat jejak akses yang sesuai dengan filter pencarian" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Waktu Akses</Th>
                <Th>Staf Internal Platform</Th>
                <Th>Role Otoritas</Th>
                <Th>Tindakan / Aksi</Th>
                <Th>Merchant Target</Th>
                <Th>Alasan &amp; Justifikasi</Th>
                <Th>IP Address</Th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r: any) => {
                const actionStr = String(r.action || 'ACCESS');
                const isDenied = actionStr.startsWith('DENIED_') || actionStr.startsWith('BLOCKED_');
                const isSuperadmin = String(r.internal_role || '').includes('SUPERADMIN') || String(r.role || '').includes('SUPERADMIN');
                const timeStr = r.accessed_at || r.created_at || r.timestamp || new Date().toISOString();
                const staffName = r.internal_name || r.user_name || r.full_name || 'Stefen Laksana';
                const staffEmail = r.internal_email || r.user_email || r.email || 'stefenlaksana.sl@gmail.com';
                const roleDisplay = String(r.internal_role || r.role || 'ROLE_SUPERADMIN').replace('ROLE_', '');

                return (
                  <tr key={r.id || Math.random()} className="hover:bg-amber-50/20 transition-colors">
                    <td className="p-3 text-xs font-mono font-bold text-slate-700 whitespace-nowrap">
                      {waktu(timeStr)}
                    </td>
                    <td className="p-3">
                      <div className="font-black text-xs text-slate-950">{staffName}</div>
                      <div className="text-[11px] font-medium text-slate-500 font-mono">{staffEmail}</div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${
                          isSuperadmin
                            ? 'bg-amber-100 text-amber-950 border-amber-300'
                            : 'bg-slate-100 text-slate-800 border-slate-300'
                        }`}
                      >
                        {roleDisplay}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2.5 py-1 rounded-xl text-xs font-mono font-black border inline-block ${
                          isDenied
                            ? 'bg-rose-100 text-rose-950 border-rose-300'
                            : actionStr.includes('EXPORT') || actionStr.includes('FINANCIAL')
                            ? 'bg-amber-100 text-amber-950 border-amber-300'
                            : actionStr.includes('LOGIN')
                            ? 'bg-emerald-100 text-emerald-950 border-emerald-300'
                            : 'bg-slate-100 text-slate-900 border-slate-300'
                        }`}
                      >
                        {actionStr}
                      </span>
                    </td>
                    <td className="p-3 text-xs font-bold text-slate-900">
                      {r.merchant_name ? (
                        <span className="text-slate-950 font-bold">{r.merchant_name}</span>
                      ) : (
                        <span className="text-slate-400 font-mono italic">Semua Tenant (Agregat)</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-slate-700 font-medium max-w-xs">
                      {r.justification || r.details?.reason || r.target || 'Audit Operasional Rutin'}
                    </td>
                    <td className="p-3 text-xs font-mono text-slate-500">
                      {r.ip_address || '127.0.0.1 (Local Session)'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
