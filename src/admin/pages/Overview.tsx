import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Building2, Layers, Receipt, TriangleAlert, Wallet } from 'lucide-react';
import { api, angka, rupiah, rupiahShort, sejak, SECTORS, SECTOR_LABEL, SECTOR_STYLE, type Sector } from '../api';
import { Card, Empty, ErrorBox, Loading, SectorChip, Table, Td, Th, useAsync } from '../ui';

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'text-slate-400',
}: {
  icon: any;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export default function Overview({ onOpenSector }: { onOpenSector: (s: string) => void }) {
  const { data, loading, error } = useAsync(() => api.overview(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Empty label="Tidak ada data" />;

  const { sectors, totals, daily } = data;
  const maxRevenue = Math.max(...sectors.map((s: any) => Number(s.gross_revenue) || 0), 1);

  // Grafik butuh satu baris per tanggal dengan kolom per sektor; API
  // mengirimkan satu baris per (tanggal, sektor).
  const byDate = new Map<string, any>();
  for (const r of daily as any[]) {
    const key = String(r.sales_date).slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, { date: key });
    byDate.get(key)[r.business_sector] = Number(r.gross_revenue) || 0;
  }
  const chart = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={Building2} label="Merchant" value={angka(totals.merchants)} hint={`${totals.merchants_active} aktif`} />
        <Stat icon={Layers} label="Sektor terpakai" value={`${totals.sectors_in_use} / 5`} />
        <Stat icon={Receipt} label="Transaksi" value={angka(totals.transactions)} />
        <Stat icon={Wallet} label="Omzet kotor" value={rupiahShort(totals.gross_revenue)} hint={rupiah(totals.gross_revenue)} tone="text-emerald-500" />
        <Stat
          icon={TriangleAlert}
          label="Kejadian bermasalah"
          value={angka(totals.activity_problems)}
          hint={`dari ${angka(totals.activity_events)} kejadian`}
          tone={totals.activity_problems > 0 ? 'text-amber-500' : 'text-slate-400'}
        />
      </div>

      <Card
        title="Perbandingan sektor bisnis"
        subtitle="Sektor tanpa transaksi tetap ditampilkan — nol adalah temuan, bukan ketiadaan data."
      >
        <Table>
          <thead>
            <tr>
              <Th>Sektor</Th>
              <Th align="right">Merchant</Th>
              <Th align="right">Unit usaha</Th>
              <Th align="right">Transaksi</Th>
              <Th align="right">Omzet</Th>
              <Th align="right">Rata-rata / struk</Th>
              <Th>Porsi omzet</Th>
              <Th>Transaksi terakhir</Th>
            </tr>
          </thead>
          <tbody>
            {sectors.map((s: any) => {
              const rev = Number(s.gross_revenue) || 0;
              return (
                <tr
                  key={s.business_sector}
                  onClick={() => onOpenSector(s.business_sector)}
                  className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <SectorChip sector={s.business_sector} />
                      <span className="hidden text-xs text-slate-400 lg:inline">
                        {SECTOR_LABEL[s.business_sector as Sector]}
                      </span>
                    </div>
                  </Td>
                  <Td align="right">{angka(s.registered_merchants)}</Td>
                  <Td align="right">{angka(s.business_unit_count)}</Td>
                  <Td align="right">{angka(s.transaction_count)}</Td>
                  <Td align="right" className="font-medium text-slate-900 dark:text-slate-100">
                    {rupiah(rev)}
                  </Td>
                  <Td align="right">{rupiah(s.avg_basket)}</Td>
                  <Td>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full ${SECTOR_STYLE[s.business_sector as Sector]?.bar ?? 'bg-slate-400'}`}
                        style={{ width: `${Math.round((rev / maxRevenue) * 100)}%` }}
                      />
                    </div>
                  </Td>
                  <Td>
                    <span className={rev === 0 ? 'text-slate-400' : ''}>{sejak(s.last_transaction_at)}</span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card title="Omzet harian per sektor" subtitle="30 hari terakhir, waktu Asia/Jakarta">
        {chart.length === 0 ? (
          <Empty label="Belum ada transaksi" />
        ) : (
          <div className="h-72 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-800" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d: string) => d.slice(8) + '/' + d.slice(5, 7)}
                  stroke="currentColor"
                  className="text-slate-400"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(0)}jt` : `${v / 1000}rb`)}
                  stroke="currentColor"
                  className="text-slate-400"
                />
                <Tooltip
                  formatter={(v: any, name: any) => [rupiah(v), SECTOR_LABEL[name as Sector] ?? name]}
                  labelFormatter={(d) => `Tanggal ${d}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend formatter={(v) => SECTOR_LABEL[v as Sector] ?? v} wrapperStyle={{ fontSize: 11 }} />
                {SECTORS.map((s) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    stackId="omzet"
                    fill={
                      { FNB: '#f59e0b', LAUNDRY: '#0ea5e9', RETAIL: '#10b981', CARWASH: '#6366f1', BARBERSHOP: '#d946ef' }[s]
                    }
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Activity className="h-3.5 w-3.5" />
        Semua angka dihitung oleh view di database, bukan di browser — panel dan batch job memakai definisi yang sama.
      </p>
    </div>
  );
}
