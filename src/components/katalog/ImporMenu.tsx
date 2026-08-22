/**
 * Impor katalog dari foto menu (OCR) atau berkas CSV.
 *
 * Mewujudkan janji di halaman depan — "foto menu Anda, 100 produk masuk" —
 * yang selama ini hanya berupa tautan WhatsApp ke tim yang mengetik manual.
 *
 * TINJAUAN WAJIB, BUKAN OPSIONAL.
 *
 * Ini keputusan rancangan yang paling menentukan, jadi ditulis terpisah. OCR
 * foto tidak pernah sempurna: pencahayaan, lipatan kertas, dan huruf berhias
 * membuat "18.000" terbaca "l8.OOO" atau "1.800". Alat yang menyalin hasilnya
 * langsung ke katalog akan sesekali menjual Nasi Goreng seharga Rp 1.800 —
 * dan yang menanggungnya merchant, bukan kami.
 *
 * Karena itu: setiap baris ditampilkan, bisa disunting, dan yang PALING
 * MERAGUKAN ditaruh di ATAS. Bukan supaya orang membaca seratus baris, tapi
 * supaya sepuluh baris yang benar-benar perlu diperiksa tidak tenggelam di
 * antara sembilan puluh yang baik-baik saja.
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  Camera, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2,
  Trash2, Upload, X, Info,
} from 'lucide-react';
import { bacaBeberapaGambar, type KemajuanOcr } from '../../lib/katalog/ocr';
import { bacaMenu, buangDuplikat, urutUntukTinjauan, type BarisMenu } from '../../lib/katalog/ocrMenu';
import { bacaTabel } from '../../lib/katalog/imporTabel';

interface Props {
  /** Batas produk paket ini. -1 = tanpa batas. */
  batasProduk: number;
  /** Produk yang sudah ada di katalog. */
  produkSekarang: number;
  onBatal: () => void;
  onImpor: (produk: Array<{ name: string; price: number; category?: string }>) => Promise<void>;
}

type Tahap = 'pilih' | 'membaca' | 'tinjau' | 'menyimpan';

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

export const ImporMenu: React.FC<Props> = ({ batasProduk, produkSekarang, onBatal, onImpor }) => {
  const [tahap, setTahap] = useState<Tahap>('pilih');
  const [kemajuan, setKemajuan] = useState<KemajuanOcr & { berkasKe?: number; dariBerkas?: number } | null>(null);
  const [baris, setBaris] = useState<BarisMenu[]>([]);
  const [dilewati, setDilewati] = useState<Array<{ asli: string; alasan: string }>>([]);
  const [galat, setGalat] = useState<string | null>(null);
  const [pilih, setPilih] = useState<Set<number>>(new Set());

  const inputFoto = useRef<HTMLInputElement>(null);
  const inputCsv = useRef<HTMLInputElement>(null);

  // Sisa jatah dihitung dari batas paket. Ditampilkan SEBELUM orang menyunting
  // seratus baris, bukan sesudah — menemukan batasnya di akhir proses berarti
  // pekerjaan yang sudah dilakukan terbuang.
  const sisaJatah = batasProduk === -1 ? Infinity : Math.max(0, batasProduk - produkSekarang);
  const terpilih = pilih.size;
  const melebihi = terpilih > sisaJatah;

  const meragukan = useMemo(() => baris.filter((b) => b.keyakinan < 0.7).length, [baris]);

  const mulaiDenganTeks = (teks: string, dariCsv: boolean) => {
    const hasil = dariCsv ? bacaTabel(teks) : bacaMenu(teks);
    const unik = urutUntukTinjauan(buangDuplikat(hasil.baris));
    setBaris(unik);
    setDilewati(hasil.dilewati);
    // Semua tercentang di awal, tapi hanya sampai sisa jatah — mencentang lebih
    // dari yang muat hanya menyiapkan kekecewaan di langkah terakhir.
    setPilih(new Set(unik.slice(0, sisaJatah === Infinity ? unik.length : sisaJatah).map((_, i) => i)));
    setTahap('tinjau');
  };

  const pilihFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const berkas = Array.from(e.target.files ?? []);
    if (!berkas.length) return;
    setTahap('membaca');
    setGalat(null);
    try {
      const teks = await bacaBeberapaGambar(berkas, setKemajuan);
      mulaiDenganTeks(teks, false);
    } catch (err: any) {
      setGalat(err?.message || 'Foto gagal dibaca. Coba foto yang lebih terang dan lurus.');
      setTahap('pilih');
    } finally {
      setKemajuan(null);
    }
  };

  const pilihCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const berkas = e.target.files?.[0];
    if (!berkas) return;
    // .xlsx adalah arsip ZIP berisi XML — ditolak dengan jelas di sini, bukan
    // diterima lalu gagal sebagai deretan karakter aneh di layar tinjauan.
    if (/\.xlsx?$/i.test(berkas.name) && !/\.csv$/i.test(berkas.name)) {
      setGalat(
        'Berkas Excel (.xlsx) belum bisa dibaca langsung. Di Excel: File → Save As → pilih CSV, lalu unggah berkas CSV-nya.'
      );
      return;
    }
    setGalat(null);
    mulaiDenganTeks(await berkas.text(), true);
  };

  const ubah = (i: number, medan: 'nama' | 'harga', nilai: string) => {
    setBaris((prev) => {
      const salin = [...prev];
      salin[i] = medan === 'nama'
        ? { ...salin[i], nama: nilai }
        : { ...salin[i], harga: Number(nilai.replace(/\D/g, '')) || 0 };
      return salin;
    });
  };

  const togel = (i: number) => {
    setPilih((prev) => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });
  };

  const simpan = async () => {
    setTahap('menyimpan');
    setGalat(null);
    try {
      await onImpor(
        [...pilih].sort((a, b) => a - b).map((i) => ({
          name: baris[i].nama,
          price: baris[i].harga,
          category: baris[i].kategori,
        }))
      );
    } catch (err: any) {
      setGalat(err?.message || 'Produk gagal disimpan.');
      setTahap('tinjau');
    }
  };

  /* --- PILIH SUMBER ----------------------------------------------------- */
  if (tahap === 'pilih' || tahap === 'membaca') {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-black text-slate-900">Impor Menu</h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Foto menu Anda atau unggah daftar produk. Semua hasilnya bisa diperiksa
            sebelum masuk katalog.
          </p>
        </div>

        {galat && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-2xl text-xs font-semibold flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{galat}</span>
          </div>
        )}

        {tahap === 'membaca' ? (
          <div className="border-2 border-dashed border-amber-300 bg-amber-50/50 rounded-3xl p-10 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin mx-auto" />
            <p className="text-sm font-bold text-slate-800">
              {kemajuan?.tahap ?? 'Membaca foto…'}
            </p>
            {kemajuan?.dariBerkas && kemajuan.dariBerkas > 1 && (
              <p className="text-[11px] text-slate-500 font-semibold">
                Foto {kemajuan.berkasKe} dari {kemajuan.dariBerkas}
              </p>
            )}
            <div className="w-full max-w-xs mx-auto h-1.5 bg-amber-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${Math.round((kemajuan?.progres ?? 0) * 100)}%` }}
              />
            </div>
            {/* Kejujuran kecil yang menghemat banyak keluhan: pengenalan foto
                memang lambat, dan orang yang tidak diberi tahu akan menutup
                tabnya di detik kelima. */}
            <p className="text-[11px] text-slate-400">
              Foto pertama agak lama karena mesin pengenal diunduh dulu.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => inputFoto.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-amber-400 hover:bg-amber-50/40 rounded-3xl p-8 text-center space-y-2 transition-all cursor-pointer"
            >
              <Camera className="w-7 h-7 text-amber-500 mx-auto" />
              <p className="font-black text-sm text-slate-800">Foto Menu</p>
              <p className="text-[11px] text-slate-500 font-medium">
                JPG/PNG. Beberapa lembar sekaligus boleh.
              </p>
            </button>

            <button
              onClick={() => inputCsv.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/40 rounded-3xl p-8 text-center space-y-2 transition-all cursor-pointer"
            >
              <FileSpreadsheet className="w-7 h-7 text-emerald-500 mx-auto" />
              <p className="font-black text-sm text-slate-800">Berkas CSV</p>
              <p className="text-[11px] text-slate-500 font-medium">
                Dari Excel: File → Save As → CSV.
              </p>
            </button>
          </div>
        )}

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-[11px] text-slate-600 font-medium flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
          <span>
            Foto Anda <b>tidak diunggah ke mana pun</b> — pembacaannya terjadi di
            perangkat ini. {batasProduk === -1
              ? 'Paket Anda tanpa batas produk.'
              : `Paket Anda mencakup ${batasProduk} produk; tersisa ${sisaJatah}.`}
          </span>
        </div>

        <input ref={inputFoto} type="file" accept="image/*" multiple hidden onChange={pilihFoto} />
        <input ref={inputCsv} type="file" accept=".csv,.tsv,.txt" hidden onChange={pilihCsv} />

        <button onClick={onBatal} className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer">
          Batal
        </button>
      </div>
    );
  }

  /* --- TINJAU ----------------------------------------------------------- */
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">Periksa sebelum disimpan</h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            {baris.length} produk terbaca.{' '}
            {meragukan > 0 ? (
              <span className="text-amber-700 font-bold">
                {meragukan} perlu diperiksa — ditaruh paling atas.
              </span>
            ) : (
              <span className="text-emerald-700 font-bold">Semuanya terbaca jelas.</span>
            )}
          </p>
        </div>
        <button onClick={onBatal} className="text-slate-400 hover:text-slate-700 cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>

      {galat && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-2xl text-xs font-semibold">
          {galat}
        </div>
      )}

      {melebihi && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-2xl text-xs font-semibold flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {terpilih} dipilih, tapi paket Anda menyisakan {sisaJatah}. Hapus centang{' '}
            {terpilih - sisaJatah} produk, atau naikkan paket.
          </span>
        </div>
      )}

      <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-[26rem] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr className="text-left text-slate-500 font-black uppercase text-[10px]">
              <th className="p-2 w-8"></th>
              <th className="p-2">Nama</th>
              <th className="p-2 w-32">Harga</th>
              <th className="p-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {baris.map((b, i) => (
              <tr
                key={i}
                className={`border-t border-slate-100 ${b.keyakinan < 0.7 ? 'bg-amber-50/60' : ''}`}
              >
                <td className="p-2 align-top">
                  <input type="checkbox" checked={pilih.has(i)} onChange={() => togel(i)} className="cursor-pointer" />
                </td>
                <td className="p-2">
                  <input
                    value={b.nama}
                    onChange={(e) => ubah(i, 'nama', e.target.value)}
                    className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-amber-500 outline-none font-semibold text-slate-800"
                  />
                  {b.kategori && (
                    <span className="text-[10px] text-slate-400 font-bold uppercase">{b.kategori}</span>
                  )}
                  {/* Catatan ditampilkan APA ADANYA. Skor keyakinan tanpa
                      alasan tidak bisa ditindaklanjuti — "0,4" tidak memberi
                      tahu apa yang harus diperiksa. */}
                  {b.catatan.map((c, k) => (
                    <p key={k} className="text-[10px] text-amber-700 font-semibold mt-0.5">⚠ {c}</p>
                  ))}
                </td>
                <td className="p-2 align-top">
                  <input
                    value={b.harga ? rupiah(b.harga) : ''}
                    placeholder="Isi harga"
                    onChange={(e) => ubah(i, 'harga', e.target.value)}
                    className={`w-full bg-transparent border-b outline-none font-mono font-bold ${
                      b.harga ? 'border-transparent hover:border-slate-300 focus:border-amber-500 text-slate-800'
                              : 'border-rose-300 text-rose-600'
                    }`}
                  />
                </td>
                <td className="p-2 align-top">
                  <button
                    onClick={() => { setBaris((p) => p.filter((_, k) => k !== i)); setPilih(new Set()); }}
                    className="text-slate-300 hover:text-rose-500 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Yang dibuang DITAMPILKAN. Merchant yang memfoto 60 item dan melihat 45
          tanpa penjelasan akan mengira alatnya rusak. */}
      {dilewati.length > 0 && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer font-bold hover:text-slate-800">
            {dilewati.length} baris tidak dijadikan produk — lihat alasannya
          </summary>
          <ul className="mt-2 space-y-1 pl-3">
            {dilewati.slice(0, 30).map((d, i) => (
              <li key={i}>
                <span className="text-slate-400">{d.alasan}:</span> {d.asli}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-xs font-bold text-slate-600">
          {terpilih} dari {baris.length} akan disimpan
        </span>
        <button
          onClick={simpan}
          disabled={tahap === 'menyimpan' || terpilih === 0 || melebihi}
          className="px-6 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-200 disabled:text-slate-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:cursor-not-allowed flex items-center gap-2"
        >
          {tahap === 'menyimpan'
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan…</>
            : <><Upload className="w-4 h-4" /> Simpan {terpilih} Produk</>}
        </button>
      </div>
    </div>
  );
};
