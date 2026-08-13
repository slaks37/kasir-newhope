import { useState } from 'react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { api, angka, rupiah, sejak, tanggal, SECTOR_LABEL, type Sector } from '../api';
import {
  Card, Chip, Empty, ErrorBox, Loading, Pagination, SearchBox, SectorChip, SectorFilter,
  Table, Td, Th, useAsync,
} from '../ui';

function riskTone(score: number) {
  if (score >= 0.7) return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800';
  if (score >= 0.4) return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800';
}

function MerchantDetail({ id, onBack }: { id: string; onBack: () => void }) {
  // Role support wajib menyertakan alasan. Kotak ini bukan formalitas: isinya
  // masuk ke internal_access_log dan menjadi jawaban atas "kenapa kamu membuka
  // pembukuan merchant ini?".
  const [justification, setJustification] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, loading, error } = useAsync(() => api.merchant(id, submitted || undefined), [id, submitted]);

  const needsJustification = error?.code === 'JUSTIFICATION_REQUIRED';

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Kembali ke daftar merchant
      </button>

      {needsJustification && (
        <Card title="Alasan akses wajib diisi">
          <div className="space-y-3 p-4">
            <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              Role support membaca data pembukuan satu merchant. Alasannya dicatat permanen di jejak audit.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="cth: tiket #4821 — omzet tidak cocok dengan laporan"
                className="min-w-64 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
              <button
                disabled={justification.trim().length < 8}
                onClick={() => setSubmitted(justification.trim())}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
              >
                Lanjutkan
              </button>
            </div>
          </div>
        </Card>
      )}

      {loading && <Loading />}
      {error && !needsJustification && <ErrorBox error={error} />}

      {data && (
        <>
          <Card title={data.profile.merchant_name} subtitle={`Bergabung ${tanggal(data.profile.joined_at)}`}>
            <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">Sektor utama</p>
                <div className="mt-1"><SectorChip sector={data.profile.business_sector} /></div>
              </div>
              <div>
                <p className="text-xs text-slate-500">Total omzet</p>
                <p className="mt-1 font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  {rupiah(data.profile.gross_revenue)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Transaksi</p>
                <p className="mt-1 font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  {angka(data.profile.transaction_count)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Aktivitas terakhir</p>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                  {sejak(data.profile.last_transaction_at)}
                </p>
              </div>
            </div>
          </Card>

          <Card
            title="Rincian per sektor"
            subtitle="Satu pemilik bisa menjalankan lebih dari satu sektor. Angkanya tidak pernah dijumlahkan lintas sektor."
          >
            {data.sectors.length === 0 ? (
              <Empty label="Belum ada transaksi" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Sektor</Th>
                    <Th align="right">Transaksi</Th>
                    <Th align="right">Omzet</Th>
                    <Th align="right">Rata-rata</Th>
                    <Th>Terakhir</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.sectors.map((s: any) => (
                    <tr key={s.business_sector}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <SectorChip sector={s.business_sector} />
                          <span className="hidden text-xs text-slate-400 sm:inline">
                            {SECTOR_LABEL[s.business_sector as Sector]}
                          </span>
                        </div>
                      </Td>
                      <Td align="right">{angka(s.transaction_count)}</Td>
                      <Td align="right">{rupiah(s.gross_revenue)}</Td>
                      <Td align="right">{rupiah(s.avg_basket)}</Td>
                      <Td>{sejak(s.last_transaction_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title="Produk terlaris" subtitle="15 teratas berdasarkan omzet, dipisah per sektor">
            {data.topProducts.length === 0 ? (
              <Empty label="Belum ada produk terjual" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Sektor</Th>
                    <Th>Produk</Th>
                    <Th>Kategori</Th>
                    <Th align="right">Unit</Th>
                    <Th align="right">Omzet</Th>
                    <Th align="right">Laba kotor</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p: any, i: number) => (
                    <tr key={i}>
                      <Td><SectorChip sector={p.business_sector} /></Td>
                      <Td className="font-medium text-slate-900 dark:text-slate-100">{p.product_name}</Td>
                      <Td>{p.category_name ?? '—'}</Td>
                      <Td align="right">{angka(p.units_sold)}</Td>
                      <Td align="right">{rupiah(p.revenue)}</Td>
                      <Td align="right">{rupiah(p.gross_profit)}</Td>
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
      title="Merchant"
      subtitle="Klik satu baris untuk membuka rinciannya. Pembukaan itu tercatat di jejak audit."
      actions={<SearchBox value={search} onChange={(v) => { setSearch(v); setOffset(0); }} placeholder="Cari nama merchant…" />}
    >
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <SectorFilter value={sector} onChange={(v) => { onSector(v); setOffset(0); }} />
      </div>

      {loading && <Loading />}
      {error && <ErrorBox error={error} />}

      {data && (data.rows.length === 0 ? (
        <Empty label="Tidak ada merchant yang cocok" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Merchant</Th>
                <Th>Sektor</Th>
                <Th align="right">Unit usaha</Th>
                <Th align="right">Transaksi</Th>
                <Th align="right">Omzet</Th>
                <Th>Aktivitas terakhir</Th>
                <Th>Risiko churn</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((m: any) => {
                const risk = Number(m.churn_risk_score ?? 0);
                return (
                  <tr
                    key={m.merchant_id}
                    onClick={() => setOpenId(m.merchant_id)}
                    className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <Td className="font-medium text-slate-900 dark:text-slate-100">
                      {m.merchant_name}
                      {!m.is_active && <Chip>nonaktif</Chip>}
                    </Td>
                    <Td><SectorChip sector={m.business_sector} /></Td>
                    <Td align="right">{angka(m.business_unit_count)}</Td>
                    <Td align="right">{angka(m.transaction_count)}</Td>
                    <Td align="right" className="font-medium">{rupiah(m.gross_revenue)}</Td>
                    <Td>
                      <span className={!m.last_transaction_at ? 'text-slate-400' : ''}>
                        {sejak(m.last_transaction_at)}
                      </span>
                    </Td>
                    <Td>
                      {m.churn_risk_score == null ? (
                        <span className="text-xs text-slate-400">belum dihitung</span>
                      ) : (
                        <Chip tone={riskTone(risk)}>{risk.toFixed(2)}</Chip>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination offset={data.offset} limit={data.limit} total={data.total} onChange={setOffset} />
        </>
      ))}
    </Card>
  );
}
