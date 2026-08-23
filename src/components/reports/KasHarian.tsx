import React, { useMemo, useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah } from '../../utils/formatters';
import { KATEGORI_KAS_KELUAR, KATEGORI_KAS_MASUK, type JenisKas } from '../../types';
import { hariIni as kunciHariIni } from '../../lib/kas/buku';
import {
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  PiggyBank,
  Plus,
  Trash2,
  TrendingUp,
  AlertTriangle,
  Banknote,
  X,
} from 'lucide-react';

/**
 * KAS & OMZET HARI INI.
 *
 * MENJAWAB SATU PERTANYAAN YANG SEBELUM INI TIDAK BISA DIJAWAB APLIKASI INI:
 * "hari ini masuk berapa, keluar berapa, dan di laci seharusnya ada berapa?"
 *
 * Bagian yang hilang adalah UANG KELUAR. Aplikasi hanya mengenal penjualan,
 * sehingga isi laci dihitung sebagai `modal awal + penjualan tunai`. Di warung
 * yang sesungguhnya, laci dipakai sepanjang hari untuk belanja bahan mendadak,
 * bayar ojek, kasbon, dan setoran ke bank — tak satu pun punya tempat untuk
 * dicatat. Akibatnya setiap tutup kas melaporkan selisih atas uang yang jelas
 * ke mana perginya, dan karena selisih kas dipakai untuk menilai kejujuran
 * orang, kekeliruan itu tidak sekadar salah hitung.
 *
 * TIGA ANGKA YANG SENGAJA DIPISAH DI LAYAR INI, karena menyatukannya adalah
 * kekeliruan yang paling sering terjadi:
 *
 *   OMZET          seluruh penjualan, apa pun cara bayarnya.
 *   OMZET TUNAI    bagian omzet yang benar-benar masuk laci.
 *   SALDO LACI     yang seharusnya ada sekarang, setelah belanja dikurangi.
 *
 * QRIS Rp 1 juta menambah omzet dan TIDAK menambah satu rupiah pun isi laci.
 * Pemilik yang membandingkan omzet dengan isi laci akan selalu mengira uangnya
 * hilang.
 */
export const KasHarian: React.FC = () => {
  const {
    shift,
    catatKas,
    hapusEntriKas,
    ringkasanOmzetHari,
    ringkasanKasHari,
    entriKasHari,
  } = usePOS();

  const hari = kunciHariIni();
  const omzet = useMemo(() => ringkasanOmzetHari(hari), [ringkasanOmzetHari, hari]);
  const kas = useMemo(() => ringkasanKasHari(hari), [ringkasanKasHari, hari]);
  const entri = useMemo(() => entriKasHari(hari), [entriKasHari, hari]);

  const [formTerbuka, setFormTerbuka] = useState(false);
  const [jenis, setJenis] = useState<JenisKas>('KELUAR');
  const [jumlah, setJumlah] = useState('');
  const [kategori, setKategori] = useState<string>(KATEGORI_KAS_KELUAR[0]);
  const [keterangan, setKeterangan] = useState('');
  const [galat, setGalat] = useState<string | null>(null);

  const daftarKategori =
    jenis === 'KELUAR' ? KATEGORI_KAS_KELUAR
    : jenis === 'MASUK' ? KATEGORI_KAS_MASUK
    : (['Modal Awal Laci', 'Tambahan Modal'] as const);

  const gantiJenis = (j: JenisKas) => {
    setJenis(j);
    // Kategori ikut berganti daftar. Tanpa ini, "Belanja Bahan Baku" bisa
    // tertinggal terpilih pada entri UANG MASUK — dan rincian per kategori
    // akan melaporkan pemasukan di kategori belanja, yang membuat rekapnya
    // tidak bisa dibaca siapa pun.
    setKategori(
      j === 'KELUAR' ? KATEGORI_KAS_KELUAR[0]
      : j === 'MASUK' ? KATEGORI_KAS_MASUK[0]
      : 'Tambahan Modal'
    );
  };

  const simpan = (e: React.FormEvent) => {
    e.preventDefault();
    setGalat(null);

    const nilai = Number(String(jumlah).replace(/[^\d]/g, ''));
    if (!(nilai > 0)) {
      setGalat('Jumlah harus lebih dari nol.');
      return;
    }
    if (jenis === 'KELUAR' && !keterangan.trim()) {
      // Pengeluaran WAJIB berketerangan, pemasukan tidak. Baris "Lainnya
      // Rp 300.000" tanpa penjelasan adalah persis bentuk catatan yang
      // membuat orang dicurigai tanpa bisa membela diri, dan ia muncul justru
      // saat kas tidak cocok — ketika sudah tidak ada yang ingat.
      setGalat('Tulis keterangan pengeluaran — tanpa itu, selisih kas tidak bisa ditelusuri.');
      return;
    }

    const hasil = catatKas({ jenis, jumlah: nilai, kategori, keterangan });
    if (!hasil) {
      setGalat('Jumlah tidak valid.');
      return;
    }

    setJumlah('');
    setKeterangan('');
    setFormTerbuka(false);
  };

  const kartu = [
    {
      label: 'Omzet Hari Ini',
      nilai: omzet.omzet,
      catatan: `${omzet.jumlahTransaksi} transaksi · rata-rata ${formatRupiah(omzet.rataRata)}`,
      Icon: TrendingUp,
      warna: 'text-amber-600 bg-amber-50 border-amber-200',
    },
    {
      label: 'Modal Awal',
      nilai: kas.modalAwal,
      catatan: kas.modalAwal > 0 ? 'Uang pemilik untuk kembalian' : 'Belum ada modal dicatat',
      Icon: PiggyBank,
      warna: 'text-slate-600 bg-slate-100 border-slate-200',
    },
    {
      label: 'Uang Masuk',
      nilai: kas.penjualanTunai + kas.masukLain,
      catatan: `Tunai dari penjualan ${formatRupiah(kas.penjualanTunai)}${
        kas.masukLain > 0 ? ` · lain-lain ${formatRupiah(kas.masukLain)}` : ''
      }`,
      Icon: ArrowDownCircle,
      warna: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    },
    {
      label: 'Uang Keluar (Belanja)',
      nilai: kas.keluar,
      catatan:
        kas.keluarPerKategori.length > 0
          ? `Terbesar: ${kas.keluarPerKategori[0].kategori}`
          : 'Belum ada pengeluaran dicatat',
      Icon: ArrowUpCircle,
      warna: 'text-rose-600 bg-rose-50 border-rose-200',
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-black text-lg lg:text-xl text-slate-900 flex items-center space-x-2.5">
            <Wallet className="w-6 h-6 text-emerald-600" />
            <span>Kas &amp; Omzet Hari Ini</span>
          </h3>
          <p className="text-[11px] lg:text-xs text-slate-500 mt-1 font-medium">
            Omzet adalah seluruh penjualan apa pun cara bayarnya. Saldo laci hanya
            menghitung uang tunai — pembayaran QRIS dan kartu tidak menambah isi laci.
          </p>
        </div>

        <button
          onClick={() => setFormTerbuka((v) => !v)}
          className="bg-slate-900 hover:bg-slate-800 text-white font-black px-4 py-2.5 rounded-2xl flex items-center space-x-2 text-xs transition-all shadow-md active:scale-95 cursor-pointer"
        >
          {formTerbuka ? <X className="w-4 h-4 text-amber-400" /> : <Plus className="w-4 h-4 text-amber-400" />}
          <span>{formTerbuka ? 'Tutup Form' : 'Catat Uang Masuk / Keluar'}</span>
        </button>
      </div>

      {/* FORM PENCATATAN */}
      {formTerbuka && (
        <form
          onSubmit={simpan}
          className="bg-white border border-slate-200 rounded-3xl p-5 space-y-4 shadow-xs"
        >
          <div className="flex flex-wrap gap-2">
            {([
              ['KELUAR', 'Uang Keluar / Belanja', 'bg-rose-600'],
              ['MASUK', 'Uang Masuk', 'bg-emerald-600'],
              ['MODAL_AWAL', 'Tambah Modal', 'bg-slate-700'],
            ] as Array<[JenisKas, string, string]>).map(([j, teks, aktifWarna]) => (
              <button
                type="button"
                key={j}
                onClick={() => gantiJenis(j)}
                className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                  jenis === j
                    ? `${aktifWarna} text-white shadow-xs`
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {teks}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider">
                Jumlah (Rp)
              </label>
              <input
                inputMode="numeric"
                value={jumlah}
                onChange={(e) => setJumlah(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider">
                Kategori
              </label>
              <select
                value={kategori}
                onChange={(e) => setKategori(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-bold bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {daftarKategori.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider">
                Keterangan {jenis === 'KELUAR' && <span className="text-rose-600">(wajib)</span>}
              </label>
              <input
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder={
                  jenis === 'KELUAR'
                    ? 'misal: beli telur 3 kg di Pasar Baru'
                    : 'misal: setoran tambahan dari pemilik'
                }
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {galat && (
            <p className="text-xs font-bold text-rose-600 flex items-center space-x-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{galat}</span>
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-500 font-medium">
              {shift.status === 'OPEN'
                ? `Dicatat pada shift yang sedang berjalan (${shift.cashierName || 'tanpa nama'}).`
                : 'Belum ada shift terbuka. Entri tetap tercatat di buku kas hari ini.'}
            </p>
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black px-5 py-2.5 rounded-2xl text-xs shadow-md transition-all active:scale-95 cursor-pointer"
            >
              Simpan Catatan
            </button>
          </div>
        </form>
      )}

      {/* KARTU RINGKASAN */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kartu.map(({ label, nilai, catatan, Icon, warna }) => (
          <div key={label} className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wider">
                {label}
              </span>
              <div className={`p-2.5 rounded-2xl border ${warna}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
            <span className="text-2xl font-black text-slate-900 font-mono block">
              {formatRupiah(nilai)}
            </span>
            <span className="text-[11px] text-slate-500 font-bold block">{catatan}</span>
          </div>
        ))}
      </div>

      {/* SALDO LACI — dipisah dari kartu lain karena inilah angka yang
          dibandingkan dengan hitungan fisik saat tutup kas. */}
      <div
        className={`rounded-3xl p-5 border-2 flex flex-wrap items-center justify-between gap-4 ${
          kas.saldoSeharusnya < 0
            ? 'bg-rose-50 border-rose-300'
            : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className="space-y-1">
          <div
            className={`flex items-center space-x-2 text-[11px] font-black uppercase tracking-wider ${
              kas.saldoSeharusnya < 0 ? 'text-rose-700' : 'text-amber-400'
            }`}
          >
            <Banknote className="w-4 h-4" />
            <span>Saldo Laci Seharusnya</span>
          </div>
          <p
            className={`text-3xl font-black font-mono ${
              kas.saldoSeharusnya < 0 ? 'text-rose-700' : 'text-white'
            }`}
          >
            {formatRupiah(kas.saldoSeharusnya)}
          </p>
          <p className={`text-[11px] font-bold ${kas.saldoSeharusnya < 0 ? 'text-rose-700' : 'text-slate-400'}`}>
            {formatRupiah(kas.modalAwal)} modal + {formatRupiah(kas.penjualanTunai)} tunai
            {kas.masukLain > 0 ? ` + ${formatRupiah(kas.masukLain)} masuk lain` : ''}
            {' − '}{formatRupiah(kas.keluar)} keluar
          </p>
        </div>

        <div className={`text-right space-y-1 ${kas.saldoSeharusnya < 0 ? 'text-rose-700' : 'text-slate-400'}`}>
          <p className="text-[11px] font-bold uppercase tracking-wider">Non-tunai hari ini</p>
          <p className={`text-lg font-black font-mono ${kas.saldoSeharusnya < 0 ? 'text-rose-800' : 'text-white'}`}>
            {formatRupiah(omzet.omzetNonTunai)}
          </p>
          <p className="text-[10px] font-medium max-w-[16rem]">
            QRIS, kartu, dan e-wallet. Masuk ke rekening, bukan ke laci — jadi tidak
            ikut dihitung di saldo di samping.
          </p>
        </div>
      </div>

      {kas.saldoSeharusnya < 0 && (
        <p className="text-xs font-bold text-rose-700 flex items-start space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Saldo negatif: pengeluaran yang tercatat melebihi uang yang pernah masuk laci.
            Biasanya karena modal awal belum dicatat, atau ada pengeluaran yang sebenarnya
            dibayar dari kantong pribadi.
          </span>
        </p>
      )}

      {/* LOG TRANSAKSI KAS */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h4 className="font-black text-sm text-slate-900">Log Kas Hari Ini</h4>
          <span className="text-[11px] font-bold text-slate-500">
            {entri.length} catatan
          </span>
        </div>

        {entri.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs text-slate-500 font-medium">
            Belum ada catatan kas hari ini. Penjualan tercatat otomatis dari struk —
            yang perlu dicatat di sini hanya uang yang masuk atau keluar di luar penjualan.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-5 py-3 font-black">Waktu</th>
                  <th className="px-5 py-3 font-black">Jenis</th>
                  <th className="px-5 py-3 font-black">Kategori</th>
                  <th className="px-5 py-3 font-black">Keterangan</th>
                  <th className="px-5 py-3 font-black">Dicatat</th>
                  <th className="px-5 py-3 font-black text-right">Jumlah</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entri.map((e) => {
                  const keluar = e.jenis === 'KELUAR';
                  return (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-slate-500 whitespace-nowrap">
                        {new Date(e.waktu).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2 py-1 rounded-lg text-[10px] font-black ${
                            keluar
                              ? 'bg-rose-100 text-rose-700'
                              : e.jenis === 'MODAL_AWAL'
                                ? 'bg-slate-200 text-slate-700'
                                : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {keluar ? 'KELUAR' : e.jenis === 'MODAL_AWAL' ? 'MODAL' : 'MASUK'}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-bold text-slate-700">{e.kategori}</td>
                      <td className="px-5 py-3 text-slate-600 max-w-xs truncate">
                        {e.keterangan || '—'}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{e.dicatatOleh || '—'}</td>
                      <td
                        className={`px-5 py-3 text-right font-mono font-black whitespace-nowrap ${
                          keluar ? 'text-rose-600' : 'text-emerald-600'
                        }`}
                      >
                        {keluar ? '−' : '+'} {formatRupiah(e.jumlah)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => hapusEntriKas(e.id)}
                          title="Hapus catatan ini"
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* RINCIAN PER KATEGORI. Menjawab "uangnya habis untuk apa" — pertanyaan
            yang selalu menyusul begitu angka pengeluaran terlihat. */}
        {kas.keluarPerKategori.length > 0 && (
          <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 space-y-2">
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">
              Pengeluaran per Kategori
            </p>
            <div className="flex flex-wrap gap-2">
              {kas.keluarPerKategori.map((k) => (
                <span
                  key={k.kategori}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700"
                >
                  {k.kategori}:{' '}
                  <span className="font-mono text-rose-600">{formatRupiah(k.jumlah)}</span>
                  <span className="text-slate-400"> ({k.banyak}×)</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
