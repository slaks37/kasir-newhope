import React, { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Activity,
  Building2,
  Layers,
  Receipt,
  TriangleAlert,
  Wallet,
  TrendingUp,
  TrendingDown,
  Flame,
  Star,
  Award,
  AlertCircle,
  Zap,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  DollarSign,
  ArrowRight,
  Store,
} from 'lucide-react';
import { api, angka, rupiah, rupiahShort, sejak, SECTORS, SECTOR_LABEL, SECTOR_STYLE, type Sector } from '../api';
import { Card, Empty, ErrorBox, Loading, SectorChip, Table, Td, Th, useAsync } from '../ui';

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'text-slate-500',
  badge,
  bgTone = 'bg-white',
}: {
  icon: any;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  badge?: string;
  bgTone?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-200/90 ${bgTone} p-5 shadow-xs transition-all hover:shadow-md`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-xl bg-slate-100 ${tone}`}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-xs font-bold text-slate-600">{label}</span>
        </div>
        {badge && (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-black tracking-tight text-slate-950 tabular-nums">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500 font-medium">{hint}</p>}
    </div>
  );
}

export default function Overview({ onOpenSector, onNavigateMerchants }: { onOpenSector: (s: string) => void; onNavigateMerchants?: () => void }) {
  const { data, loading, error } = useAsync(() => api.overview(), []);

  if (loading) return <Loading label="Memuat metrik analitik ekosistem merchant..." />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Empty label="Tidak ada data analitik" />;

  const { sectors, totals, daily } = data;
  const maxRevenue = Math.max(...sectors.map((s: any) => Number(s.gross_revenue) || 0), 1);

  // Formatting chart data
  const byDate = new Map<string, any>();
  for (const r of daily as any[]) {
    const key = String(r.sales_date).slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, { date: key });
    byDate.get(key)[r.business_sector] = Number(r.gross_revenue) || 0;
  }
  const chart = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Platform Analytics Calculations
  const platformGMV = Number(totals.gross_revenue) || 0;
  const platformProfit = Number(totals.gross_profit) || 0;
  const platformMargin = platformGMV > 0 ? Math.round((platformProfit / platformGMV) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* 1. TOP PLATFORM KPI STATS */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-950 flex items-center gap-2">
              <span>Ringkasan platform</span>
              <span className="text-xs px-2.5 py-0.5 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 font-extrabold">
                Multi-usaha
              </span>
            </h1>
            <p className="text-xs text-slate-600 font-medium mt-0.5">
              Konsol pemantauan performa seluruh merchant/klien, laba ekosistem, throughput transaksi, dan mitigasi churn.
            </p>
          </div>
        </div>

        <div className="nh-admin-metrics grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            icon={Wallet}
            label="Total GMV Platform"
            value={rupiahShort(platformGMV)}
            hint={rupiah(platformGMV)}
            tone="text-amber-600"
            badge="All Clients"
          />
          <StatCard
            icon={TrendingUp}
            label="Laba kotor merchant"
            value={rupiahShort(platformProfit)}
            hint={`Margin rata-rata ${platformMargin}%`}
            tone="text-emerald-600"
            badge="Sebelum biaya operasional"
            bgTone="bg-emerald-50/30"
          />
          <StatCard
            icon={Receipt}
            label="Total Transaksi Masuk"
            value={angka(totals.transactions ?? 0)}
            hint="Dari 5 sektor usaha terintegrasi"
            tone="text-blue-600"
          />
          <StatCard
            icon={Building2}
            label="Total Merchant Aktif"
            value={`${totals.merchants_active ?? 0} Tenant`}
            hint={`Tersebar di ${totals.sectors_in_use ?? 0} sektor bisnis`}
            tone="text-purple-600"
          />
          <StatCard
            icon={ShieldCheck}
            label="Anomali tercatat"
            value={angka(totals.activity_problems)}
            hint={`${totals.activity_problems || 0} anomali terdeteksi`}
            tone="text-emerald-700"
            bgTone="bg-emerald-50/20"
          />
        </div>
      </div>

      {/* 3. SECTOR COMPARISON TABLE */}
      <Card
        title="Perbandingan Kinerja Finansial 5 Sektor Bisnis"
        subtitle="Analisis per sektor usaha: volume transaksi, total perputaran omzet, dan nilai rata-rata per struk belanja (AOV)."
      >
        <Table>
          <thead>
            <tr>
              <Th>Sektor Usaha</Th>
              <Th align="right">Merchant Terdaftar</Th>
              <Th align="right">Unit Usaha</Th>
              <Th align="right">Total Transaksi</Th>
              <Th align="right">Total Omzet</Th>
              <Th align="right">Rata-Rata / Struk (AOV)</Th>
              <Th>Porsi Terhadap GMV Platform</Th>
              <Th>Aktivitas Terakhir</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sectors.map((s: any) => {
              const rev = Number(s.gross_revenue) || 0;
              return (
                <tr
                  key={s.business_sector}
                  onClick={() => onOpenSector(s.business_sector)}
                  className="cursor-pointer transition-colors hover:bg-amber-50/40"
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <SectorChip sector={s.business_sector} />
                      <span className="hidden text-xs font-bold text-slate-800 lg:inline">
                        {SECTOR_LABEL[s.business_sector as Sector]}
                      </span>
                    </div>
                  </Td>
                  <Td align="right" className="font-bold">{angka(s.registered_merchants)}</Td>
                  <Td align="right">{angka(s.business_unit_count)}</Td>
                  <Td align="right" className="font-mono font-bold text-slate-900">{angka(s.transaction_count)}</Td>
                  <Td align="right" className="font-mono font-black text-slate-950">
                    {rupiah(rev)}
                  </Td>
                  <Td align="right" className="font-mono font-semibold text-slate-700">{rupiah(s.avg_basket)}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${SECTOR_STYLE[s.business_sector as Sector]?.bar ?? 'bg-slate-400'}`}
                          style={{ width: `${Math.round((rev / maxRevenue) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono font-bold text-slate-600">
                        {platformGMV > 0 ? Math.round((rev / platformGMV) * 100) : 0}%
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <span className={`text-xs font-semibold ${rev === 0 ? 'text-slate-400' : 'text-slate-700'}`}>
                      {sejak(s.last_transaction_at)}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {/* 4. DAILY REVENUE TREND CHART */}
      <Card
        title="Tren Omzet Harian Multi-Sektor (30 Hari Terakhir)"
        subtitle="Agregasi transaksi penjualan harian dari seluruh kasir merchant di waktu Asia/Jakarta"
      >
        {chart.length === 0 ? (
          <Empty label="Belum ada data transaksi tersimpan di database" />
        ) : (
          <div className="h-72 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fontWeight: 600, fill: '#475569' }}
                  tickFormatter={(d: string) => d.slice(8) + '/' + d.slice(5, 7)}
                  stroke="#cbd5e1"
                />
                <YAxis
                  tick={{ fontSize: 11, fontWeight: 600, fill: '#475569' }}
                  tickFormatter={(v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}jt` : `${v / 1000}rb`)}
                  stroke="#cbd5e1"
                />
                <Tooltip
                  formatter={(v: any, name: any) => [rupiah(v), SECTOR_LABEL[name as Sector] ?? name]}
                  labelFormatter={(d: any) => `Tanggal: ${d}`}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '12px',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                />
                <Legend
                  formatter={(value: any) => (
                    <span className="text-xs font-bold text-slate-700">
                      {SECTOR_LABEL[value as Sector] ?? value}
                    </span>
                  )}
                />
                {SECTORS.map((s) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    stackId="a"
                    fill={
                      s === 'FNB'
                        ? '#f59e0b'
                        : s === 'RETAIL'
                        ? '#10b981'
                        : s === 'LAUNDRY'
                        ? '#0284c7'
                        : s === 'CARWASH'
                        ? '#6366f1'
                        : '#d946ef'
                    }
                    radius={s === 'BARBERSHOP' ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
