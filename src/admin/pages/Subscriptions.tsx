import React, { useState } from 'react';
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  RefreshCcw,
  ArrowRight
} from 'lucide-react';
import { api, tanggal, sejak } from '../api';
import { Card, Table, Th, Td, Loading, ErrorBox, Pagination, SearchBox } from '../ui';

function SubscriptionStatusBadge({ status }: { status: string }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3" /> Aktif
      </span>
    );
  }
  if (status === 'TRIAL') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
        <Clock className="w-3 h-3" /> Masa Percobaan
      </span>
    );
  }
  if (status === 'PAST_DUE') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
        <AlertTriangle className="w-3 h-3" /> Menunggak
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
      <XCircle className="w-3 h-3" /> Kedaluwarsa
    </span>
  );
}

export default function Subscriptions() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  // Minta list merchant (merchants membawa data subscription_status dsb)
  const [state, setState] = useState<{
    loading: boolean;
    data?: any;
    error?: string;
  }>({ loading: true });

  React.useEffect(() => {
    let active = true;
    setState({ loading: true });
    api.merchants({ search, status: filter === 'ALL' ? undefined : filter, limit: 15, offset: (page - 1) * 15 })
      .then(res => {
        if (active) setState({ loading: false, data: res });
      })
      .catch(err => {
        if (active) setState({ loading: false, error: err.message });
      });
    return () => { active = false };
  }, [search, filter, page]);

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center gap-3 p-1">
            <div className="p-3 bg-emerald-100 text-emerald-600 rounded-2xl">
              <CreditCard className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">Tier Aktif & Berbayar</div>
              <div className="text-2xl font-black text-slate-800">421</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3 p-1">
            <div className="p-3 bg-sky-100 text-sky-600 rounded-2xl">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">Masa Trial (45 Hari)</div>
              <div className="text-2xl font-black text-slate-800">89</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3 p-1">
            <div className="p-3 bg-rose-100 text-rose-600 rounded-2xl">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">Menunggak & Kedaluwarsa</div>
              <div className="text-2xl font-black text-slate-800">12</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3 p-1">
            <div className="p-3 bg-indigo-100 text-indigo-600 rounded-2xl">
              <RefreshCcw className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">Konversi Trial -{'>'} Berbayar</div>
              <div className="text-2xl font-black text-slate-800">68%</div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Daftar Langganan Klien (Tenant)">
        <div className="p-5 border-b border-slate-100 flex flex-wrap gap-4 items-center justify-between">
          <SearchBox value={search} onChange={setSearch} placeholder="Cari nama toko atau email..." />
          <div className="flex gap-2">
            {['ALL', 'ACTIVE', 'TRIAL', 'EXPIRED'].map(f => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(1); }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  filter === f
                    ? 'bg-amber-500 text-amber-950 shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f === 'ALL' ? 'Semua' : f === 'ACTIVE' ? 'Aktif' : f === 'TRIAL' ? 'Trial' : 'Expired'}
              </button>
            ))}
          </div>
        </div>

        {state.loading && <Loading />}
        {state.error && <ErrorBox error={{ message: state.error }} />}
        
        {!state.loading && !state.error && state.data && (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Tenant & Email</Th>
                  <Th>Status Langganan</Th>
                  <Th>Mulai Bergabung</Th>
                  <Th align="right">Aksi Manual</Th>
                </tr>
              </thead>
              <tbody>
                {state.data.rows.map((m: any) => (
                  <tr key={m.id} className="hover:bg-slate-50/50 transition-colors group">
                    <Td>
                      <div className="font-bold text-slate-800">{m.name}</div>
                      <div className="text-xs text-slate-500 font-medium">{m.email}</div>
                    </Td>
                    <Td>
                      <SubscriptionStatusBadge status={m.subscription_status || 'TRIAL'} />
                    </Td>
                    <Td>
                      <div className="text-sm font-medium text-slate-700">{tanggal(m.created_at)}</div>
                      <div className="text-[10px] text-slate-400">{sejak(m.created_at)}</div>
                    </Td>
                    <Td align="right">
                      <button className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 shadow-sm">
                        Ubah Tier <ArrowRight className="w-3 h-3" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            
            {state.data.rows.length === 0 && (
              <div className="py-12 text-center text-slate-500 text-sm font-medium">
                Tidak ada data langganan yang ditemukan.
              </div>
            )}
            
            <div className="p-4 border-t border-slate-100">
              <Pagination
                offset={(page - 1) * 15}
                total={state.data.total}
                limit={state.data.limit}
                onChange={(offset) => setPage(Math.floor(offset / 15) + 1)}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
