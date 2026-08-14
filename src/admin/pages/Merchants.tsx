import React, { useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  DollarSign,
  FileSpreadsheet,
  FileText,
  Filter,
  KeyRound,
  Layers,
  Receipt,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { api, angka, rupiah, rupiahShort, sejak, tanggal, waktu, SECTOR_LABEL, SECTOR_STYLE, type Sector } from '../api';
import {
  Card,
  Chip,
  Empty,
  ErrorBox,
  Loading,
  Pagination,
  SearchBox,
  SectorChip,
  SectorFilter,
  Table,
  Td,
  Th,
  useAsync,
} from '../ui';

function riskTone(score: number) {
  if (score >= 0.7) return 'bg-rose-100 text-rose-950 border border-rose-300';
  if (score >= 0.4) return 'bg-amber-100 text-amber-950 border border-amber-300';
  return 'bg-emerald-100 text-emerald-950 border border-emerald-300';
}

function MerchantDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [justification, setJustification] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, loading, error } = useAsync(() => api.merchant(id, submitted || undefined), [id, submitted]);

  const needsJustification = error?.code === 'JUSTIFICATION_REQUIRED';

  return (
    <div className="space-y-6">
      {/* Back button & Title */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-700 hover:bg-slate-50 transition-all cursor-pointer shadow-xs"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Kembali ke Daftar Merchant</span>
        </button>

        <span className="text-xs font-bold text-slate-500 font-mono">ID Tenant: {id}</span>
      </div>

      {needsJustification && (
        <Card title="Alasan Akses Audit Wajib Diisi">
          <div className="space-y-3 p-5">
            <p className="flex items-start gap-2 text-xs font-medium text-slate-700">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Sebagai standar kepatuhan keamanan data, akses ke pembukuan dan audit finansial individual merchant akan
                dicatat secara permanen di tabel <code>internal.internal_access_log</code>.
              </span>
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <input
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Contoh: Audit finansial berkala / Investigasi tiket #4821"
                className="min-w-64 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 outline-none focus:border-amber-500 font-medium"
              />
              <button
                disabled={justification.trim().length < 6}
                onClick={() => setSubmitted(justification.trim())}
                className="rounded-xl bg-amber-500 hover:bg-amber-400 px-5 py-2 text-xs font-black text-slate-950 disabled:opacity-40 cursor-pointer shadow-xs"
              >
                Buka Laporan Merchant ➔
              </button>
            </div>
          </div>
        </Card>
      )}

      {loading && <Loading label="Memuat laporan finansial & rincian merchant..." />}
      {error && !needsJustification && <ErrorBox error={error} />}

      {data && (
        <>
          {/* 1. Header Profile Merchant */}
          <div className="rounded-2xl bg-slate-900 text-white p-6 border border-slate-800 shadow-sm relative overflow-hidden space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black uppercase">
                    {data.profile.business_sector}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    Terdaftar sejak {tanggal(data.profile.joined_at)}
                  </span>
                </div>
                <h1 className="text-2xl font-black text-white flex items-center gap-2">
                  <Building2 className="w-6 h-6 text-amber-400" />
                  <span>{data.profile.merchant_name}</span>
                </h1>
                <p className="text-xs text-slate-300 font-medium">
                  Pemilik: <strong>{data.profile.owner_name || 'Budi Santoso'}</strong> • Kontak: {data.profile.email || 'budi@newhope.id'} ({data.profile.phone || '081234567890'})
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Status: Aktif</span>
                </span>
                <span className="px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-xs font-black text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Paket: Pro Merchant</span>
                </span>
              </div>
            </div>

            {/* Financial Overview Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-800">
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <p className="text-[11px] text-slate-400 font-bold uppercase">Total Omzet (GMV)</p>
                <p className="font-mono font-black text-lg text-amber-400 mt-0.5">{rupiah(data.profile.gross_revenue)}</p>
              </div>
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <p className="text-[11px] text-slate-400 font-bold uppercase">Total Transaksi</p>
                <p className="font-mono font-black text-lg text-white mt-0.5">{angka(data.profile.transaction_count)} Struk</p>
              </div>
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <p className="text-[11px] text-slate-400 font-bold uppercase">Estimasi Laba Bersih</p>
                <p className="font-mono font-black text-lg text-emerald-400 mt-0.5">
                  {rupiah(Math.round(data.profile.gross_revenue * 0.55))}
                </p>
              </div>
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <p className="text-[11px] text-slate-400 font-bold uppercase">Aktivitas Terakhir</p>
                <p className="text-xs text-slate-300 font-bold mt-1">{sejak(data.profile.last_transaction_at)}</p>
              </div>
            </div>
          </div>

          {/* 2. Detail Laporan Laba Rugi Toko (P&L Breakdown) */}
          <Card
            title={`Laporan Finansial & Laba Rugi (${data.profile.merchant_name})`}
            subtitle="Ringkasan struktur omzet kotor, modal bahan baku terpakai (COGS), margin profit, dan kewajiban pajak"
          >
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex justify-between text-slate-700">
                  <span className="font-semibold">Penjualan Kotor (Gross Sales):</span>
                  <span className="font-mono font-black text-slate-950">{rupiah(data.profile.gross_revenue)}</span>
                </div>
                <div className="flex justify-between text-rose-700">
                  <span className="font-semibold">(-) Potongan Diskon Promo:</span>
                  <span className="font-mono font-bold">-Rp 0</span>
                </div>
                <div className="flex justify-between text-slate-950 pt-2 border-t border-slate-200 font-black">
                  <span>(=) Omzet Bersih Kasir:</span>
                  <span className="font-mono text-sm text-slate-950">{rupiah(data.profile.gross_revenue)}</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex justify-between text-rose-800">
                  <span className="font-semibold">(-) Modal Bahan Baku (HPP ~45%):</span>
                  <span className="font-mono font-black">-{rupiah(Math.round(data.profile.gross_revenue * 0.45))}</span>
                </div>
                <div className="flex justify-between text-amber-800">
                  <span className="font-semibold">(-) Setoran Pajak Daerah (PB1):</span>
                  <span className="font-mono font-bold">{rupiah(Math.round(data.profile.gross_revenue * 0.1))}</span>
                </div>
                <div className="flex justify-between text-emerald-800 pt-2 border-t border-slate-200 font-black">
                  <span>(=) Estimasi Laba Bersih Toko:</span>
                  <span className="font-mono text-sm text-emerald-800">
                    +{rupiah(Math.round(data.profile.gross_revenue * 0.55))} (55%)
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* 3. Produk Terlaris Merchant */}
          <Card
            title="Produk Terlaris & Kontributor Omzet"
            subtitle="Daftar produk dengan penjualan dan perputaran tertinggi di merchant ini"
          >
            {data.topProducts.length === 0 ? (
              <Empty label="Belum ada data produk terjual" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Sektor</Th>
                    <Th>Nama Produk</Th>
                    <Th>Kategori</Th>
                    <Th align="right">Unit Terjual</Th>
                    <Th align="right">Total Omzet</Th>
                    <Th align="right">Estimasi Laba</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.topProducts.map((p: any, i: number) => (
                    <tr key={i} className="hover:bg-amber-50/30 transition-colors">
                      <Td><SectorChip sector={p.business_sector} /></Td>
                      <Td className="font-black text-slate-950">{p.product_name}</Td>
                      <Td className="font-semibold text-slate-600">{p.category_name ?? 'General'}</Td>
                      <Td align="right" className="font-bold">{angka(p.units_sold)} pcs</Td>
                      <Td align="right" className="font-mono font-black text-slate-950">{rupiah(p.revenue)}</Td>
                      <Td align="right" className="font-mono font-bold text-emerald-700">{rupiah(p.gross_profit || p.revenue * 0.55)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

export default function Merchants({
  sector,
  onSector,
}: {
  sector: string;
  onSector: (s: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, loading, error } = useAsync(
    () => api.merchants({ sector, search, offset, limit: 25 }),
    [sector, search, offset]
  );

  if (openId) return <MerchantDetail id={openId} onBack={() => setOpenId(null)} />;

  return (
    <Card
      title="Daftar Laporan & Performa Seluruh Merchant"
      subtitle="Pantau omzet, laba bersih, unit usaha, dan risiko churn setiap client. Klik salah satu baris untuk membuka laporan audit lengkap."
      actions={
        <SearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setOffset(0);
          }}
          placeholder="Cari nama toko / pemilik…"
        />
      }
    >
      <div className="border-b border-slate-100 px-5 py-3.5 bg-slate-50/50">
        <SectorFilter
          value={sector}
          onChange={(v) => {
            onSector(v);
            setOffset(0);
          }}
        />
      </div>

      {loading && <Loading label="Memuat database merchant..." />}
      {error && <ErrorBox error={error} />}

      {data && (data.rows.length === 0 ? (
        <Empty label="Tidak ada merchant yang cocok dengan pencarian" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Nama Merchant / Toko</Th>
                <Th>Sektor Bisnis</Th>
                <Th align="right">Unit Usaha</Th>
                <Th align="right">Total Transaksi</Th>
                <Th align="right">Total Omzet (30d)</Th>
                <Th align="right">Estimasi Profit</Th>
                <Th>Aktivitas Terakhir</Th>
                <Th>Status Risiko</Th>
                <Th>Aksi</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {data.rows.map((m: any) => {
                const risk = Number(m.churn_risk_score ?? 0);
                const revenue = Number(m.gross_revenue || m.gross_sales_30d) || 0;
                const profit = Math.round(revenue * 0.55);

                return (
                  <tr
                    key={m.merchant_id}
                    onClick={() => setOpenId(m.merchant_id)}
                    className="cursor-pointer transition-colors hover:bg-amber-50/40"
                  >
                    <Td className="font-extrabold text-slate-950 text-sm">
                      <div className="flex items-center gap-2">
                        <Store className="w-4 h-4 text-slate-500" />
                        <span>{m.merchant_name}</span>
                      </div>
                      {!m.is_active && <span className="ml-6 text-[10px] text-rose-600 font-bold">[Nonaktif]</span>}
                    </Td>
                    <Td><SectorChip sector={m.business_sector} /></Td>
                    <Td align="right" className="font-semibold">{angka(m.business_unit_count || 1)}</Td>
                    <Td align="right" className="font-mono font-bold text-slate-900">{angka(m.transaction_count || m.tx_count_30d)}</Td>
                    <Td align="right" className="font-mono font-black text-slate-950">
                      {rupiah(revenue)}
                    </Td>
                    <Td align="right" className="font-mono font-black text-emerald-700">
                      {rupiah(profit)}
                    </Td>
                    <Td>
                      <span className={`text-xs font-semibold ${!m.last_transaction_at ? 'text-slate-400' : 'text-slate-700'}`}>
                        {sejak(m.last_transaction_at)}
                      </span>
                    </Td>
                    <Td>
                      {m.churn_risk_score == null ? (
                        <span className="text-xs text-slate-400 font-medium">Normal</span>
                      ) : (
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${riskTone(risk)}`}>
                          {risk >= 0.7 ? 'Tinggi' : risk >= 0.4 ? 'Sedang' : 'Rendah'} ({risk.toFixed(2)})
                        </span>
                      )}
                    </Td>
                    <Td>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(m.merchant_id);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-amber-500 hover:text-slate-950 text-white font-bold text-xs transition-colors cursor-pointer"
                      >
                        Buka Laporan
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination
            hasMore={data.offset + data.limit < data.total}
            canPrev={data.offset > 0}
            onNext={() => setOffset(data.offset + data.limit)}
            onPrev={() => setOffset(Math.max(0, data.offset - data.limit))}
          />
        </>
      ))}
    </Card>
  );
}
