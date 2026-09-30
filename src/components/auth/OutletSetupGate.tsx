import React, { useEffect, useState } from 'react';
import { Building2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePOS } from '../../context/POSContext';
import { prepareOutletBusiness } from '../../lib/sync/outlets';

type OutletRow = { id: string; name: string; business_sector: string; is_active: boolean };

/** An outlet is counted only when the owner explicitly activates it. */
export function OutletSetupGate({ onManagePlan }: { onManagePlan: () => void }) {
  const { user, configured } = useAuth();
  const { settings, syncStatus } = usePOS();
  const sector = settings.businessSector || 'FNB';
  const [rows, setRows] = useState<OutletRow[]>([]);
  const [limit, setLimit] = useState(2);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [openSecond, setOpenSecond] = useState(false);
  const [secondName, setSecondName] = useState('');

  useEffect(() => {
    setFirstName(String(user?.user_metadata?.first_outlet_name || `${settings.storeName} — Cabang Utama`));
    const next = String(user?.user_metadata?.second_outlet_name || '');
    setSecondName(next);
    setOpenSecond(Boolean(next));
  }, [user?.id, sector]);

  const refresh = async () => {
    if (!user?.id) return;
    try {
      const [outlets, subscription] = await Promise.all([
        fetch('/api/v1/subscription/outlets').then(r => r.json()),
        fetch('/api/v1/subscription/status').then(r => r.json()),
      ]);
      if (!outlets.ok || !subscription.ok) throw new Error('OUTLETS_UNAVAILABLE');
      setRows(outlets.rows || []);
      setLimit(Number(subscription.outlets?.limit || 2));
      setLoaded(true);
      setError('');
    } catch {
      // Cashier can still run offline; queued sales remain visible in the sync badge.
      setError('Belum dapat memeriksa kapasitas outlet. Sambungkan internet lalu coba lagi.');
    }
  };
  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('outlets-updated', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('outlets-updated', refresh); };
  }, [user?.id, sector]);

  const active = rows.filter(row => row.is_active);
  const current = active.filter(row => row.business_sector === sector);
  const selectedIsActive = current.some(row => row.id === settings.activeBranchId);
  if (!user?.id || !configured || (loaded && selectedIsActive && !error)) return null;

  if (!loaded || current.length) return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="outlet-check-title">
    <div className="w-full max-w-md rounded-3xl bg-white p-6 text-slate-900 shadow-2xl space-y-4">
      <h2 id="outlet-check-title" className="text-xl font-black">Verifikasi outlet cloud</h2>
      <p role={error?'alert':undefined} className="text-sm text-slate-700">{error || (loaded ? 'Menyiapkan outlet aktif di perangkat ini…' : 'Memeriksa outlet aktif dan kapasitas paket…')}</p>
      {(error || loaded) && <button type="button" onClick={()=>{void refresh();window.dispatchEvent(new Event('outlets-updated'));}} className="rounded-xl bg-amber-500 px-4 py-2 font-bold">Coba lagi</button>}
      <p className="text-xs text-slate-600">Kasir belum dibuka agar transaksi tidak hanya tersimpan di perangkat saat status cloud belum terverifikasi.</p>
    </div>
  </div>;

  const save = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/v1/subscription/outlets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'OUTLET_SAVE_FAILED');
    return data.outlet;
  };
  const create = async () => {
    if (!firstName.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await prepareOutletBusiness(sector,settings.storeName);
      await save({ name: firstName.trim(), storeName: settings.storeName, businessSector: sector, isActive: true });
      if (openSecond && secondName.trim() && active.length + 2 <= limit) {
        await save({ name: secondName.trim(), storeName: settings.storeName, businessSector: sector, isActive: true });
      }
      await refresh();
      window.dispatchEvent(new Event('outlets-updated'));
    } catch (cause) {
      await refresh();
      setError(cause instanceof Error ? cause.message : 'Outlet belum dapat dibuka.');
    } finally { setBusy(false); }
  };
  const setOutletActive = async (row: OutletRow, isActive: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await save({ id: row.id, name: row.name, businessSector: row.business_sector, isActive });
      await refresh();
      window.dispatchEvent(new Event('outlets-updated'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Cabang belum dapat ditunda.');
    } finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[95] overflow-y-auto bg-slate-950/55 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="outlet-setup-title">
    <div className="w-full max-w-xl rounded-3xl bg-white p-6 sm:p-8 shadow-2xl space-y-5 text-slate-900">
      <div className="flex items-center gap-3"><Building2 className="text-amber-600" /><h2 id="outlet-setup-title" className="text-xl font-black">Pilih outlet yang dibuka</h2></div>
      <p className="text-sm text-slate-600">Unit usaha {sector} belum memiliki outlet aktif. Paket ini memakai {active.length} dari {limit} slot outlet. Riwayat transaksi dan cabang yang ditunda tetap tersimpan.</p>
      {syncStatus.pending > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="inline h-4 w-4 mr-1" />{syncStatus.pending} transaksi menunggu outlet aktif sebelum masuk ke laporan admin.</p>}
      {active.length >= limit ? <div className="space-y-3">
        <p className="text-sm font-semibold">Semua slot terpakai. Pilih cabang yang ditunda agar slot dapat dipakai untuk {sector}, atau tingkatkan paket.</p>
        {active.map(row => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm">
          <span>{row.name} <span className="text-slate-500">({row.business_sector})</span></span>
          <button disabled={busy} onClick={() => void setOutletActive(row, false)} className="rounded-lg border border-amber-300 px-3 py-1.5 font-bold text-amber-900 disabled:opacity-50">Tunda cabang ini</button>
        </div>)}
        <button onClick={onManagePlan} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">Lihat paket & add-on outlet</button>
      </div> : <div className="space-y-3">
        {rows.filter(row => !row.is_active && row.business_sector === sector).map(row => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm">
          <span>{row.name} · ditunda</span>
          <button disabled={busy} onClick={() => void setOutletActive(row, true)} className="rounded-lg bg-amber-100 px-3 py-2 font-bold disabled:opacity-50">Aktifkan kembali</button>
        </div>)}
        <label className="block text-sm font-bold">Outlet {active.length + 1} — buka sekarang
          <input value={firstName} maxLength={150} onChange={e=>setFirstName(e.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 p-3" />
        </label>
        {active.length + 1 < limit && <label className="block text-sm text-slate-700">
          <input type="checkbox" checked={openSecond} onChange={e=>setOpenSecond(e.target.checked)} className="mr-2" />Buka outlet berikutnya sekarang (boleh ditunda)
        </label>}
        {openSecond && active.length + 1 < limit && <input aria-label="Nama outlet berikutnya" value={secondName} maxLength={150} onChange={e=>setSecondName(e.target.value)} placeholder="Nama outlet berikutnya" className="block w-full rounded-xl border border-slate-300 p-3" />}
        <button disabled={busy || !firstName.trim() || (openSecond && active.length + 1 < limit && !secondName.trim())} onClick={() => void create()} className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50">{busy ? 'Membuka outlet…' : 'Aktifkan outlet'}</button>
        {!openSecond && <p className="text-xs text-slate-500">Cabang berikutnya dapat dibuka nanti di Pengaturan → Cabang.</p>}
      </div>}
      {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
    </div>
  </div>;
}
