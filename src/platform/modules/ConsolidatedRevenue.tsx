import React, { useEffect, useState } from 'react';
import { useBusinessModule } from './ModuleWorkspaceGate';
import { refreshCoordinator, coalescedRead } from '../../lib/sync/refreshCoordinator';
import { calendarDate } from '../../lib/reports/client';
import { formatRupiah } from '../../utils/formatters';
import { useWorkspaceBusiness } from '../../context/WorkspaceBusinessContext';
type Row = { merchant_id: string; outlet_id: string | null; business_sector: string; transactions: number; net_revenue: string | number; refunds: string | number; total_net_revenue: string | number; total_transactions: number };
type Report = { rows: Row[]; nextOffset: number | null };
export default function ConsolidatedRevenue() {
  const { access, manifest } = useBusinessModule()!;
  const { directory } = useWorkspaceBusiness();
  const [from, setFrom] = useState(() => calendarDate('Asia/Jakarta', -29));
  const [to, setTo] = useState(() => calendarDate());
  const [offset, setOffset] = useState(0);
  const key = JSON.stringify([access.businessId, access.outletId, manifest.id, from, to, offset]);
  const [state, setState] = useState<{ key: string; report?: Report; error?: string }>({ key });
  useEffect(() => {
    const controller = new AbortController();
    const url = '/api/v1/sync/modules/revenue?' + new URLSearchParams({ businessId: access.businessId, outletId: access.outletId, moduleId: manifest.id, page: 'group-reports', from, to, offset: String(offset) });
    const run = async () => {
      try {
        const report = await coalescedRead(url, async () => {
          const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
          const result = await response.json();
          if (!response.ok || !result.ok) throw Error(result.error || 'REPORT_UNAVAILABLE');
          return result as Report;
        }, controller.signal);
        if (!controller.signal.aborted) setState({ key, report });
      } catch (error) { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : 'REPORT_UNAVAILABLE' }); }
    };
    const off = refreshCoordinator.register('group-revenue:' + key, { run, interval: 120000, events: ['financial-updated'] });
    return () => { controller.abort(); off(); };
  }, [key]);
  const current = state.key === key ? state : { key };
  const report = current.report;
  return <section className="flex-1 overflow-auto p-6 space-y-6 bg-slate-50"><header><h1 className="text-2xl font-bold">Laporan semua bisnis</h1><p className="mt-2 text-slate-600">Penjualan bersih setelah refund, menurut tanggal penjualan di Asia/Jakarta. Transaksi historis dikelompokkan menurut sektor asal; penjualan campuran per modul belum dapat dipisahkan.</p></header>
    <div className="flex flex-wrap gap-4"><label>Dari<input type="date" value={from} onChange={e => { setOffset(0); setFrom(e.target.value); }} className="block border rounded-xl p-2"/></label><label>Sampai<input type="date" value={to} onChange={e => { setOffset(0); setTo(e.target.value); }} className="block border rounded-xl p-2"/></label></div>
    {current.error ? <p role="alert">Laporan belum tersedia: {current.error}</p> : !report ? <p role="status">Memuat laporan…</p> : <>
      <p className="text-xl font-semibold">Penjualan bersih: {formatRupiah(Number(report.rows[0]?.total_net_revenue || 0))}</p>
      <div className="overflow-x-auto"><table className="w-full text-left border-separate border-spacing-y-2"><caption className="text-left text-sm text-slate-500 mb-3">Maksimal 50 kelompok bisnis dan outlet per halaman</caption><thead><tr>{['Bisnis','Outlet','Sektor','Transaksi','Bersih','Refund'].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody>{report.rows.map(row => {
        const business = directory.businesses.find(b => b.businessId === row.merchant_id);
        const outlet = business?.outlets.find(o => o.outletId === row.outlet_id);
        return <tr key={JSON.stringify([row.merchant_id,row.outlet_id,row.business_sector])} className="bg-white"><th scope="row" className="p-3">{business?.name || row.merchant_id}</th><td className="p-3">{outlet?.name || row.outlet_id || 'Tanpa outlet'}</td><td className="p-3">{row.business_sector}</td><td className="p-3">{row.transactions}</td><td className="p-3">{formatRupiah(Number(row.net_revenue))}</td><td className="p-3">{formatRupiah(Number(row.refunds))}</td></tr>;
      })}</tbody></table></div>
      {!report.rows.length && <p>Belum ada penjualan selesai pada periode ini.</p>}
      <div className="flex gap-3"><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0,value - 50))} className="border rounded-xl p-3 disabled:opacity-40">Sebelumnya</button><button disabled={report.nextOffset === null} onClick={() => { if (report.nextOffset !== null) setOffset(report.nextOffset); }} className="border rounded-xl p-3 disabled:opacity-40">Berikutnya</button></div>
    </>}
  </section>;
}
