import React, { useEffect, useState } from 'react';
import { Building2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePOSFields } from '../../context/POSDomains';
import { prepareOutletBusiness } from '../../lib/sync/outlets';
import {useWorkspaceBusiness} from '../../context/WorkspaceBusinessContext';
import {directoryOutletRows} from '../../lib/workspace/businessIdentity';
import {isFreePlan} from '../../config/freePlanPolicy';

type OutletRow = { id: string; name: string;merchant_id:string; business_sector: string; is_active: boolean };

/** An outlet is counted only when the owner explicitly activates it. */
export function OutletSetupGate({ onManagePlan }: { onManagePlan: (intent?:'add-outlet'|'upgrade') => void }) {
  const workspace=useWorkspaceBusiness();
  const { user, configured } = useAuth();
  const { settings, syncStatus, cloudReady, cloudError, openSyncCenter } = usePOSFields(["settings","syncStatus","cloudReady","cloudError","openSyncCenter"]);
  const sector = settings.businessSector || 'FNB';
  const rows:OutletRow[]=directoryOutletRows(workspace.directory.businesses);
  const limit=isFreePlan(workspace.subscription)?1:(workspace.subscription.plan?.maxOutlets||2)+(workspace.subscription.extraOutlets||0);
  const loaded=true; // Parent mounts only after verified account bootstrap.
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

  const refresh=async()=>{window.dispatchEvent(new Event('outlets-updated'));};

  const active = rows.filter(row => row.is_active);
  const current = active.filter(row => row.merchant_id===workspace.business.businessId);
  const selectedIsActive = current.some(row => row.id === settings.activeBranchId);
  if (!user?.id || !configured || (loaded && selectedIsActive && cloudReady)) return null;

  if (!loaded || current.length) return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="outlet-check-title">
    <div className="w-full max-w-md rounded-3xl bg-white p-6 text-slate-900 shadow-2xl space-y-4">
      <h2 id="outlet-check-title" className="text-xl font-black">Verifikasi outlet cloud</h2>
      <p role={error||cloudError?'alert':undefined} className="text-sm text-slate-700">{error || cloudError || (loaded ? 'Menyiapkan outlet aktif di perangkat ini…' : 'Memeriksa outlet aktif dan kapasitas paket…')}</p>
      {(error || loaded) && <button type="button" onClick={()=>{void refresh();window.dispatchEvent(new Event('outlets-updated'));}} className="rounded-xl bg-amber-500 px-4 py-2 font-bold">Coba lagi</button>}
      <p className="text-xs text-slate-600">Kasir belum dibuka agar transaksi tidak hanya tersimpan di perangkat saat status cloud belum terverifikasi.</p>
      <button onClick={openSyncCenter} className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-bold">Buka Sync Center</button>
    </div>
  </div>;

  const save = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/v1/subscription/outlets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({...body,businessId:body.businessId||workspace.business.businessId}),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'OUTLET_SAVE_FAILED');
    return data.outlet;
  };
  const create = async () => {
    if (!firstName.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await prepareOutletBusiness(sector,settings.storeName,workspace.business.businessId);
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
      await save({ id: row.id, name: row.name,businessId:row.merchant_id, businessSector: row.business_sector, isActive });
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
        <p className="text-sm font-semibold">{active.length} / {limit} outlet aktif. Tambah kapasitas untuk membuka outlet baru tanpa menutup cabang yang sudah berjalan.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=>onManagePlan('add-outlet')} className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-slate-950">Beli tambahan outlet</button>
          <button onClick={()=>onManagePlan('upgrade')} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">Upgrade paket</button>
        </div>
        <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Kelola outlet aktif — opsi sekunder</summary>
        <p className="py-2 text-xs text-slate-600">Menonaktifkan outlet tidak menghapus riwayatnya.</p>
        {active.map(row => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm">
          <span>{row.name} <span className="text-slate-500">({row.business_sector})</span></span>
          <button disabled={busy} onClick={() => void setOutletActive(row, false)} className="rounded-lg border border-amber-300 px-3 py-1.5 font-bold text-amber-900 disabled:opacity-50">Tunda cabang ini</button>
        </div>)}
        </details>
      </div> : <div className="space-y-3">
        {rows.filter(row => !row.is_active && row.merchant_id===workspace.business.businessId).map(row => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm">
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
