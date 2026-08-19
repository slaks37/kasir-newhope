/**
 * Paket & Harga — satu-satunya tempat harga dan entitlement diubah.
 *
 * Yang disunting di sini langsung menentukan tiga hal bagi merchant: berapa
 * mereka ditagih, modul apa yang terbuka di aplikasi kasir, dan sampai berapa
 * produk serta outlet mereka boleh bertambah. Karena itu layar ini sengaja
 * menunjukkan JUMLAH PEMAKAI setiap paket sebelum tombol simpan ditekan —
 * menaikkan harga paket yang dipakai 40 merchant adalah keputusan yang berbeda
 * dari menaikkan paket yang belum dipakai siapa-siapa.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  History,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { api, type PlanChangeRow } from '../api';
import { Card, ErrorBox, Loading } from '../ui';
import {
  LEVEL_DASHBOARD,
  MODUL_TERJUAL,
  TANPA_BATAS,
  labelBatas,
  validasiPaket,
  type AdminPlan,
  type DashboardAccessLevel,
} from '../../lib/plans/entitlements';
import type { PermissionFeature } from '../../types';

const rupiah = (n: number | null | undefined) =>
  n == null ? '—' : `Rp ${Number(n).toLocaleString('id-ID')}`;

const PAKET_BARU: AdminPlan = {
  id: '',
  name: '',
  tierLevel: 2,
  billingCycle: 'MONTHLY',
  priceIdr: 0,
  priceYearlyIdr: null,
  extraOutletPriceIdr: null,
  currency: 'IDR',
  features: [],
  productLimit: 100,
  maxOutlets: 1,
  aiQuotaMonthly: 0,
  dashboardAccessLevel: 'BASIC',
  moduleAccess: ['pos', 'customers', 'settings'],
  isActive: true,
  sortOrder: 2,
};

/* -------------------------------------------------------------------------- */
/* BAGIAN FORMULIR                                                             */
/* -------------------------------------------------------------------------- */

function Kolom({
  label,
  catatan,
  children,
}: {
  label: string;
  catatan?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {catatan && <span className="text-[11px] text-slate-500">{catatan}</span>}
    </label>
  );
}

const kelasInput =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-300 dark:focus:ring-slate-300';

/** Angka yang boleh "tanpa batas": -1 ditampilkan sebagai kotak centang, bukan angka ajaib. */
function BatasProduk({
  nilai,
  onChange,
}: {
  nilai: number;
  onChange: (n: number) => void;
}) {
  const takTerbatas = nilai === TANPA_BATAS;
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        className={`${kelasInput} ${takTerbatas ? 'opacity-40' : ''}`}
        value={takTerbatas ? '' : nilai}
        disabled={takTerbatas}
        placeholder="—"
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
      />
      <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={takTerbatas}
          onChange={(e) => onChange(e.target.checked ? TANPA_BATAS : 100)}
          className="h-4 w-4 rounded border-slate-400"
        />
        Tanpa batas
      </label>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* EDITOR SATU PAKET                                                           */
/* -------------------------------------------------------------------------- */

function EditorPaket({
  awal,
  pemakai,
  onSelesai,
  onBatal,
}: {
  awal: AdminPlan;
  pemakai: number;
  onSelesai: (p: AdminPlan) => void;
  onBatal: () => void;
}) {
  const [draf, setDraf] = useState<AdminPlan>(awal);
  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState<string[]>([]);
  const [riwayat, setRiwayat] = useState<PlanChangeRow[] | null>(null);

  const baru = !awal.id;
  const ubah = <K extends keyof AdminPlan>(k: K, v: AdminPlan[K]) =>
    setDraf((d) => ({ ...d, [k]: v }));

  const toggleModul = (m: PermissionFeature) =>
    setDraf((d) => ({
      ...d,
      moduleAccess: d.moduleAccess.includes(m)
        ? d.moduleAccess.filter((x) => x !== m)
        : [...d.moduleAccess, m],
    }));

  // Divalidasi sambil mengetik memakai aturan yang sama dengan server, jadi
  // tidak ada kejutan saat tombol simpan ditekan.
  const masalah = validasiPaket(draf);

  const simpan = async () => {
    if (masalah.length) {
      setGalat(masalah);
      return;
    }
    setMenyimpan(true);
    setGalat([]);
    try {
      const { plan } = await api.savePlan(draf);
      onSelesai(plan);
    } catch (e: any) {
      setGalat([e.message || 'Gagal menyimpan paket.']);
    } finally {
      setMenyimpan(false);
    }
  };

  const bukaRiwayat = async () => {
    if (riwayat) return setRiwayat(null);
    try {
      const { rows } = await api.planHistory(draf.id);
      setRiwayat(rows);
    } catch (e: any) {
      setGalat([e.message]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <header className="flex items-center gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <Tags className="h-5 w-5 text-slate-500" />
          <div className="flex-1">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {baru ? 'Paket Baru' : `Ubah ${awal.name}`}
            </h2>
            {!baru && (
              <p className="text-xs text-slate-500">
                Kode <code className="font-mono">{awal.id}</code>
                {awal.updatedBy && ` · terakhir diubah ${awal.updatedBy}`}
              </p>
            )}
          </div>
          {!baru && (
            <button
              onClick={bukaRiwayat}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <History className="h-3.5 w-3.5" /> Riwayat
            </button>
          )}
          <button
            onClick={onBatal}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {pemakai > 0 && (
          <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-6 py-3 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
            <Users className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs leading-relaxed">
              <b>{pemakai} merchant</b> sedang memakai paket ini. Perubahan batas dan akses berlaku
              bagi mereka pada pemuatan berikutnya; harga baru berlaku pada penagihan periode
              berikutnya, bukan surut ke faktur yang sudah terbit.
            </p>
          </div>
        )}

        <div className="grid gap-6 p-6 md:grid-cols-2">
          {/* ---- Identitas & harga ---- */}
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Identitas & Harga</h3>

            <Kolom label="Nama paket">
              <input
                className={kelasInput}
                value={draf.name}
                placeholder="Tier Plus"
                onChange={(e) => ubah('name', e.target.value)}
              />
            </Kolom>

            <Kolom
              label="Kode paket"
              catatan={baru ? 'Huruf kecil dan tanda hubung. Tidak bisa diubah setelah dibuat.' : 'Tidak bisa diubah — langganan yang berjalan menunjuk kode ini.'}
            >
              <input
                className={`${kelasInput} font-mono ${baru ? '' : 'opacity-50'}`}
                value={draf.id}
                disabled={!baru}
                placeholder="plan-plus-monthly"
                onChange={(e) => ubah('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              />
            </Kolom>

            <div className="grid grid-cols-2 gap-3">
              <Kolom label="Harga / bulan">
                <input
                  type="number"
                  min={0}
                  className={kelasInput}
                  value={draf.priceIdr}
                  onChange={(e) => ubah('priceIdr', Number(e.target.value) || 0)}
                />
              </Kolom>
              <Kolom label="Harga tahunan / bulan" catatan="Kosongkan bila tidak ada opsi tahunan.">
                <input
                  type="number"
                  min={0}
                  className={kelasInput}
                  value={draf.priceYearlyIdr ?? ''}
                  onChange={(e) =>
                    ubah('priceYearlyIdr', e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </Kolom>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Kolom label="Tier level" catatan="Menentukan urutan naik/turun paket.">
                <input
                  type="number"
                  min={1}
                  max={4}
                  className={kelasInput}
                  value={draf.tierLevel}
                  onChange={(e) => ubah('tierLevel', Number(e.target.value) || 1)}
                />
              </Kolom>
              <Kolom label="Urutan tampil">
                <input
                  type="number"
                  min={0}
                  className={kelasInput}
                  value={draf.sortOrder}
                  onChange={(e) => ubah('sortOrder', Number(e.target.value) || 0)}
                />
              </Kolom>
            </div>
          </section>

          {/* ---- Batas ---- */}
          <section className="flex flex-col gap-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Batas Pemakaian</h3>

            <Kolom label="Maksimal produk per outlet">
              <BatasProduk nilai={draf.productLimit} onChange={(n) => ubah('productLimit', n)} />
            </Kolom>

            <div className="grid grid-cols-2 gap-3">
              <Kolom label="Maksimal outlet">
                <input
                  type="number"
                  min={1}
                  className={kelasInput}
                  value={draf.maxOutlets}
                  onChange={(e) => ubah('maxOutlets', Math.max(1, Number(e.target.value) || 1))}
                />
              </Kolom>
              <Kolom label="Harga outlet tambahan" catatan="Per cabang per bulan.">
                <input
                  type="number"
                  min={0}
                  className={kelasInput}
                  value={draf.extraOutletPriceIdr ?? ''}
                  onChange={(e) =>
                    ubah('extraOutletPriceIdr', e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </Kolom>
            </div>

            <Kolom label="Kuota AI Copilot / bulan" catatan="0 berarti paket ini tidak menjual analisa AI.">
              <input
                type="number"
                min={0}
                className={kelasInput}
                value={draf.aiQuotaMonthly}
                onChange={(e) => ubah('aiQuotaMonthly', Math.max(0, Number(e.target.value) || 0))}
              />
            </Kolom>

            <Kolom label="Level dashboard">
              <select
                className={kelasInput}
                value={draf.dashboardAccessLevel}
                onChange={(e) => ubah('dashboardAccessLevel', e.target.value as DashboardAccessLevel)}
              >
                {LEVEL_DASHBOARD.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label} — {l.catatan}
                  </option>
                ))}
              </select>
            </Kolom>
          </section>

          {/* ---- Akses modul ---- */}
          <section className="flex flex-col gap-3 md:col-span-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Akses Modul — apa yang terbuka di aplikasi kasir
            </h3>
            <p className="-mt-1 text-[11px] text-slate-500">
              Halaman Beranda dan Ringkasan selalu terbuka. Akses efektif seorang staf adalah irisan
              paket ini dengan izin perannya — paket menentukan apa yang dibeli merchant, peran
              menentukan siapa yang boleh memakainya.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MODUL_TERJUAL.map((m) => {
                const aktif = draf.moduleAccess.includes(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleModul(m.key)}
                    className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                      aktif
                        ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/40'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950/40'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        aktif
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-400 bg-white dark:bg-slate-900'
                      }`}
                    >
                      {aktif && <Check className="h-3 w-3" />}
                    </span>
                    <span className="leading-tight">
                      <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {m.label}
                      </span>
                      <span className="block text-[11px] text-slate-500">{m.catatan}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---- Benefit ---- */}
          <section className="flex flex-col gap-3 md:col-span-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Benefit di Kartu Harga
            </h3>
            <p className="-mt-1 text-[11px] text-slate-500">
              Kalimat yang dibaca calon pelanggan di halaman depan. Ini teks pemasaran — yang
              benar-benar menegakkan batas adalah kolom di atas, bukan daftar ini.
            </p>
            {draf.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={kelasInput}
                  value={f}
                  onChange={(e) =>
                    ubah(
                      'features',
                      draf.features.map((x, j) => (j === i ? e.target.value : x))
                    )
                  }
                />
                <button
                  onClick={() => ubah('features', draf.features.filter((_, j) => j !== i))}
                  className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Hapus benefit"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {draf.features.length < 20 && (
              <button
                onClick={() => ubah('features', [...draf.features, ''])}
                className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-slate-400 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" /> Tambah benefit
              </button>
            )}
          </section>

          {riwayat && (
            <section className="md:col-span-2">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                Riwayat Perubahan
              </h3>
              {riwayat.length === 0 ? (
                <p className="text-xs text-slate-500">Belum ada perubahan tercatat.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {riwayat.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-950/40"
                    >
                      <span className="font-mono font-semibold">{r.change_kind}</span> oleh{' '}
                      <b>{r.changed_by}</b> · {new Date(r.changed_at).toLocaleString('id-ID')}
                      {r.before_json && r.before_json.priceIdr !== r.after_json.priceIdr && (
                        <span className="ml-1 text-amber-700 dark:text-amber-400">
                          harga {rupiah(r.before_json.priceIdr)} → {rupiah(r.after_json.priceIdr)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {(galat.length > 0 || masalah.length > 0) && (
          <div className="mx-6 mb-4 flex items-start gap-2.5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-800 dark:bg-rose-950/40">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <ul className="flex flex-col gap-0.5 text-xs text-rose-900 dark:text-rose-200">
              {(galat.length ? galat : masalah).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button
            onClick={onBatal}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Batal
          </button>
          <button
            onClick={simpan}
            disabled={menyimpan || masalah.length > 0}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
          >
            {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan Paket
          </button>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DAFTAR PAKET                                                                */
/* -------------------------------------------------------------------------- */

export default function Plans() {
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [pemakai, setPemakai] = useState<Record<string, number>>({});
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<{ code?: string; message: string } | null>(null);
  const [sunting, setSunting] = useState<AdminPlan | null>(null);

  const muat = useCallback(() => {
    setMemuat(true);
    api
      .plans()
      .then((d) => {
        setPlans(d.plans);
        setPemakai(d.subscriberCounts || {});
        setGalat(null);
      })
      .catch((e) => setGalat({ code: e.code, message: e.message }))
      .finally(() => setMemuat(false));
  }, []);

  useEffect(muat, [muat]);

  const toggleAktif = async (p: AdminPlan) => {
    try {
      const { plan } = await api.setPlanActive(p.id, !p.isActive);
      setPlans((xs) => xs.map((x) => (x.id === plan.id ? plan : x)));
    } catch (e: any) {
      setGalat({ code: e.code, message: e.message });
    }
  };

  if (memuat) return <Loading label="Memuat katalog paket..." />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Paket & Harga</h1>
          <p className="text-xs text-slate-500">
            Harga, batas pemakaian, akses modul, dan benefit yang didapat merchant. Tersimpan di
            database dan langsung berlaku di aplikasi kasir.
          </p>
        </div>
        <button
          onClick={muat}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Muat ulang
        </button>
        <button
          onClick={() => setSunting(PAKET_BARU)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900"
        >
          <Plus className="h-3.5 w-3.5" /> Paket Baru
        </button>
      </div>

      {galat && <ErrorBox error={galat} />}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{p.name}</h2>
                  <p className="font-mono text-[11px] text-slate-500">{p.id}</p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    p.isActive
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {p.isActive ? 'DIJUAL' : 'DISEMBUNYIKAN'}
                </span>
              </div>

              <div>
                <p className="text-xl font-black text-slate-900 dark:text-slate-100">
                  {rupiah(p.priceIdr)}
                  <span className="text-xs font-normal text-slate-500"> / bln</span>
                </p>
                {p.priceYearlyIdr != null && (
                  <p className="text-[11px] text-slate-500">
                    {rupiah(p.priceYearlyIdr)}/bln bila tahunan
                  </p>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                {[
                  ['Produk', labelBatas(p.productLimit)],
                  ['Outlet', String(p.maxOutlets)],
                  ['Kuota AI', p.aiQuotaMonthly === 0 ? 'Tidak ada' : `${p.aiQuotaMonthly}×/bln`],
                  ['Dashboard', p.dashboardAccessLevel],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="font-semibold text-slate-900 dark:text-slate-200">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex flex-wrap gap-1">
                {p.moduleAccess.map((m) => (
                  <span
                    key={m}
                    className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                  >
                    {m}
                  </span>
                ))}
              </div>

              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Users className="h-3.5 w-3.5" />
                {pemakai[p.id] ?? 0} merchant memakai paket ini
              </p>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setSunting(p)}
                  className="flex-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900"
                >
                  Ubah
                </button>
                <button
                  onClick={() => toggleAktif(p)}
                  title={
                    p.isActive
                      ? 'Sembunyikan dari kartu harga. Merchant yang sudah berlangganan tidak terpengaruh.'
                      : 'Tampilkan kembali di kartu harga.'
                  }
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {p.isActive ? 'Sembunyikan' : 'Tampilkan'}
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {sunting && (
        <EditorPaket
          awal={sunting}
          pemakai={pemakai[sunting.id] ?? 0}
          onBatal={() => setSunting(null)}
          onSelesai={() => {
            setSunting(null);
            muat();
          }}
        />
      )}
    </div>
  );
}
