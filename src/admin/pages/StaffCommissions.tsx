import React, { useState } from 'react';
import {
  Users,
  Award,
  Wallet,
  TrendingUp,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Scissors,
  Car,
  Coffee,
  ShoppingBag,
  Shirt,
  X,
  Receipt,
  FileSpreadsheet,
  Building2,
  Calendar,
  ChevronRight,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { api, angka, rupiah, waktu, SECTOR_LABEL, type Sector } from '../api';
import {
  Card,
  Table,
  Th,
  Td,
  Loading,
  ErrorBox,
  SectorChip,
  Pagination,
  SearchBox
} from '../ui';

export default function StaffCommissions() {
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedStaffRow, setSelectedStaffRow] = useState<any | null>(null);

  const [state, setState] = useState<{
    loading: boolean;
    data?: any;
    error?: string;
  }>({ loading: true });

  const fetchData = React.useCallback(() => {
    setState({ loading: true });
    api.staffCommissions({
      search,
      sector: sectorFilter,
      status: statusFilter,
    })
      .then((res) => setState({ loading: false, data: res }))
      .catch((err) => setState({ loading: false, error: err.message || 'Gagal memuat data komisi staf' }));
  }, [search, sectorFilter, statusFilter]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const summary = state.data?.summary;
  const rows = state.data?.rows || [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> Sudah Dibayar
          </span>
        );
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-200">
            <Clock className="w-3 h-3" /> Disetujui Merchant
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <AlertCircle className="w-3 h-3" /> Menunggu Review
          </span>
        );
    }
  };

  const getModelIcon = (model: string) => {
    switch (model) {
      case 'PER_HEAD':
        return <Scissors className="w-3.5 h-3.5 text-fuchsia-600" />;
      case 'POOLED_TEAM':
        return <Car className="w-3.5 h-3.5 text-indigo-600" />;
      default:
        return <TrendingUp className="w-3.5 h-3.5 text-amber-600" />;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Halaman */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500 text-slate-950 shadow-sm">
              <Users className="h-6 w-6" />
            </div>
            <span>Monitoring Komisi Staf & Penggajian Platform</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Pengawasan terpusat alokasi insentif dan komisi staf lintas sektor (Barbershop per-kepala, Car Wash bagi hasil tim, F&B/Retail bonus omzet).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => alert('Data komisi staf platform berhasil diekspor ke CSV.')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-xs cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Ekspor Rekap CSV</span>
          </button>
        </div>
      </div>

      {/* Ringkasan Eksekutif Platform */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Total Komisi Platform</span>
              <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900 mt-2">
              {rupiah(summary.totalCommissionIdr)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Dari total omzet staf: <span className="font-bold text-slate-700">{rupiah(summary.totalSalesIdr)}</span>
            </p>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Total Staf Penerima</span>
              <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900 mt-2">
              {summary.totalStaffCount} <span className="text-sm font-bold text-slate-500">Karyawan</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Aktif di <span className="font-bold text-slate-700">5 Unit Merchant</span>
            </p>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Total Layanan / Transaksi</span>
              <div className="p-2 rounded-xl bg-sky-50 text-sky-600">
                <Receipt className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900 mt-2">
              {angka(summary.totalServicesHandled)} <span className="text-sm font-bold text-slate-500">Layanan</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Potong rambut, cuci bodi, order kasir
            </p>
          </div>

          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Rata-rata Komisi / Staf</span>
              <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
                <Award className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-black text-slate-900 mt-2">
              {rupiah(summary.averageCommissionPerStaff)}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Sektor tertinggi: <span className="font-black text-purple-700">Barbershop</span>
            </p>
          </div>
        </div>
      )}

      {/* Banner Penjelasan Model Komisi Multi-Sektor */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-4 text-white shadow-md">
        <div className="flex items-center gap-2 mb-2 text-amber-400">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-xs font-black uppercase tracking-wider">Arsitektur Smart Labor & Komisi Terdistribusi</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-300">
          <div className="bg-white/5 p-2.5 rounded-xl border border-white/10">
            <span className="font-bold text-white block mb-1">💈 Barbershop (Per Kepala)</span>
            <span>Komisi tetap per kepala kapster (mis. Rp 15rb/orang) + komisi persentase 10% upsell pomade/shampoo.</span>
          </div>
          <div className="bg-white/5 p-2.5 rounded-xl border border-white/10">
            <span className="font-bold text-white block mb-1">🚗 Car Wash (Bagi Hasil Tim)</span>
            <span>Total omzet jasa cuci harian digabung ke Team Pool, dibagi proporsional ke staf yang clock-in di shift.</span>
          </div>
          <div className="bg-white/5 p-2.5 rounded-xl border border-white/10">
            <span className="font-bold text-white block mb-1">☕ F&B & Ritel (Target Omzet)</span>
            <span>Bonus persentase progresif jika total penjualan toko hari ini melampaui target omzet harian.</span>
          </div>
        </div>
      </div>

      {/* Filter & Kontrol Tabel */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Sektor:
          </span>
          {['ALL', 'BARBERSHOP', 'CARWASH', 'FNB', 'RETAIL', 'LAUNDRY'].map((sec) => (
            <button
              key={sec}
              onClick={() => setSectorFilter(sec)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                sectorFilter === sec
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {sec === 'ALL' ? 'Semua Sektor' : (SECTOR_LABEL[sec as Sector] || sec)}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Cari staf, merchant, peran..."
          />
        </div>
      </div>

      {/* Tabel Utama Komisi Staf Lintas Merchant */}
      <Card title="Daftar Komisi & Performa Staf Lintas Merchant" subtitle={`${rows.length} staf tercatat pada periode berjalan`}>
        {state.loading && <Loading label="Memuat rekapitulasi komisi staf..." />}
        {state.error && <ErrorBox error={{ message: state.error }} />}

        {!state.loading && !state.error && rows.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-xs font-bold">
            Tidak ada data komisi staf yang sesuai filter.
          </div>
        )}

        {!state.loading && !state.error && rows.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Staf & Peran</Th>
                <Th>Merchant & Sektor</Th>
                <Th>Model Komisi</Th>
                <Th align="right">Layanan Ditangani</Th>
                <Th align="right">Omzet Dihasilkan</Th>
                <Th align="right">Komisi Didapat</Th>
                <Th>Status Pembayaran</Th>
                <Th>Aksi</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-xs font-black text-amber-900">
                        {r.staffName.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-black text-slate-900 block text-xs">{r.staffName}</span>
                        <span className="text-[11px] text-slate-500">{r.staffRole}</span>
                      </div>
                    </div>
                  </Td>

                  <Td>
                    <div>
                      <span className="font-bold text-slate-900 text-xs block">{r.merchantName}</span>
                      <div className="mt-0.5"><SectorChip sector={r.sector} /></div>
                    </div>
                  </Td>

                  <Td>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      {getModelIcon(r.commissionModel)}
                      <span>{r.modelLabel}</span>
                    </div>
                  </Td>

                  <Td align="right">
                    <span className="font-mono font-bold text-slate-900 text-xs">
                      {r.servicesCount} <span className="text-[10px] text-slate-500 font-normal">x</span>
                    </span>
                  </Td>

                  <Td align="right">
                    <span className="font-mono font-bold text-slate-700 text-xs">
                      {rupiah(r.salesAmountIdr)}
                    </span>
                  </Td>

                  <Td align="right">
                    <div>
                      <span className="font-mono font-black text-emerald-700 text-xs block">
                        {rupiah(r.commissionAmountIdr + (r.bonusUpsellIdr || 0))}
                      </span>
                      {r.bonusUpsellIdr > 0 && (
                        <span className="text-[10px] text-amber-600 font-bold block">
                          +{rupiah(r.bonusUpsellIdr)} upsell
                        </span>
                      )}
                    </div>
                  </Td>

                  <Td>
                    {getStatusBadge(r.status)}
                  </Td>

                  <Td>
                    <button
                      onClick={() => setSelectedStaffRow(r)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-amber-500 hover:text-slate-950 text-slate-700 font-bold text-[11px] transition-all cursor-pointer flex items-center gap-1"
                    >
                      <span>Rincian</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Modal Rincian Komisi & Payslip Staf */}
      {selectedStaffRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-fade-in"
          onClick={() => setSelectedStaffRow(null)}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-slate-100 p-5 bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500 text-slate-950 font-bold">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">Rincian Komisi Staf</h3>
                  <p className="text-xs text-slate-500">ID: {selectedStaffRow.id} · {selectedStaffRow.period}</p>
                </div>
              </div>

              <button
                onClick={() => setSelectedStaffRow(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 space-y-4 text-xs">
              {/* Profile Card */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Nama Karyawan</span>
                  <p className="font-black text-slate-900 text-sm">{selectedStaffRow.staffName}</p>
                  <p className="text-slate-500">{selectedStaffRow.staffRole}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Merchant</span>
                  <p className="font-black text-slate-900 text-sm">{selectedStaffRow.merchantName}</p>
                  <div className="mt-1"><SectorChip sector={selectedStaffRow.sector} /></div>
                </div>
              </div>

              {/* Komponen Penghitungan Gaji & Komisi */}
              <div className="space-y-2 border border-slate-200 rounded-2xl p-4">
                <span className="font-bold text-slate-900 block text-xs border-b border-slate-100 pb-2">
                  Komponen Pembayaran Periode Ini
                </span>

                <div className="flex justify-between py-1">
                  <span className="text-slate-600">Gaji Pokok Harian/Bulanan:</span>
                  <span className="font-mono font-bold text-slate-900">{rupiah(selectedStaffRow.baseSalaryIdr)}</span>
                </div>

                <div className="flex justify-between py-1">
                  <span className="text-slate-600">
                    Komisi Jasa Layanan ({selectedStaffRow.servicesCount}x order):
                  </span>
                  <span className="font-mono font-black text-emerald-700">
                    +{rupiah(selectedStaffRow.commissionAmountIdr)}
                  </span>
                </div>

                {selectedStaffRow.bonusUpsellIdr > 0 && (
                  <div className="flex justify-between py-1">
                    <span className="text-slate-600">Bonus Upsell Produk Retail:</span>
                    <span className="font-mono font-black text-emerald-700">
                      +{rupiah(selectedStaffRow.bonusUpsellIdr)}
                    </span>
                  </div>
                )}

                <div className="border-t border-dashed border-slate-200 pt-2 flex justify-between text-sm font-black text-slate-950">
                  <span>Estimasi Total Gaji Bersih:</span>
                  <span className="text-amber-600 font-mono text-base">
                    {rupiah(selectedStaffRow.netPayEstimateIdr)}
                  </span>
                </div>
              </div>

              {/* Status dan Audit */}
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2">
                <span>Status Saat Ini: {getStatusBadge(selectedStaffRow.status)}</span>
                <span>Terakhir Dihitung: {waktu(selectedStaffRow.lastCalculated)}</span>
              </div>
            </div>

            <footer className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button
                onClick={() => {
                  alert(`Status komisi staf ${selectedStaffRow.staffName} berhasil diverifikasi.`);
                  setSelectedStaffRow(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Verifikasi Pembayaran
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
