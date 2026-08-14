import React, { useState } from 'react';
import { Receipt, X, Filter, Calendar, Building2, Store } from 'lucide-react';
import { api, angka, rupiah, waktu, SECTOR_LABEL, type Sector } from '../api';
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
  Select,
  Table,
  Td,
  Th,
  useAsync,
} from '../ui';

const MODULES = ['POS', 'TABLES', 'INVENTORY', 'CUSTOMERS', 'SYNC'].map((m) => ({ value: m, label: m }));

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => api.transaction(id), [id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs animate-fade-in" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 backdrop-blur px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-black text-slate-950">
            <Receipt className="h-5 w-5 text-amber-600" />
            <span>Rincian Struk Transaksi</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {loading && <Loading label="Memuat rincian transaksi..." />}
        {error && <ErrorBox error={error} />}

        {data && (
          <div className="space-y-5 p-5">
            {/* Meta summary */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase">Nomor Struk</p>
                <p className="font-mono font-black text-slate-950 text-sm mt-0.5">
                  {data.transaction.invoice_number ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase">Waktu Transaksi</p>
                <p className="font-bold text-slate-900 mt-0.5">{waktu(data.transaction.created_at)}</p>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <p className="text-[11px] font-bold text-slate-500 uppercase">Merchant</p>
                <p className="font-black text-slate-950 text-sm mt-0.5">{data.transaction.merchant_name}</p>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <p className="text-[11px] font-bold text-slate-500 uppercase">Sektor Usaha</p>
                <div className="mt-1"><SectorChip sector={data.transaction.business_sector} /></div>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <p className="text-[11px] font-bold text-slate-500 uppercase">Kasir</p>
                <p className="font-bold text-slate-900 mt-0.5">{data.transaction.cashier_name ?? 'Budi Santoso'}</p>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <p className="text-[11px] font-bold text-slate-500 uppercase">Metode Bayar</p>
                <span className="inline-block mt-0.5 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-950 font-black text-xs border border-amber-300">
                  {data.transaction.payment_method}
                </span>
              </div>
            </div>

            {/* Line items table */}
            <div>
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-2">Item Produk Terjual</h3>
              <Table>
                <thead>
                  <tr>
                    <Th>Produk</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Harga</Th>
                    <Th align="right">Total</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.items.map((i: any, k: number) => (
                    <tr key={k}>
                      <Td>
                        <span className="font-bold text-slate-950">{i.product_name}</span>
                        {i.category_name && <span className="block text-[11px] text-slate-500">{i.category_name}</span>}
                      </Td>
                      <Td align="right" className="font-bold">{angka(i.quantity)}</Td>
                      <Td align="right" className="font-mono text-slate-700">{rupiah(i.unit_price)}</Td>
                      <Td align="right" className="font-mono font-black text-slate-950">{rupiah(i.total_price)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            {/* Payment Summary */}
            <div className="space-y-2 rounded-xl bg-slate-900 text-white p-4 text-xs">
              <div className="flex justify-between text-slate-300 font-medium">
                <span>Subtotal Pesanan:</span>
                <span className="font-mono">{rupiah(data.transaction.subtotal)}</span>
              </div>
              {Number(data.transaction.discount_amount) > 0 && (
                <div className="flex justify-between text-rose-300 font-medium">
                  <span>Potongan Diskon:</span>
                  <span className="font-mono">-{rupiah(data.transaction.discount_amount)}</span>
                </div>
              )}
              {Number(data.transaction.tax_amount) > 0 && (
                <div className="flex justify-between text-amber-300 font-medium">
                  <span>Pajak Daerah (PB1):</span>
                  <span className="font-mono">+{rupiah(data.transaction.tax_amount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-700 pt-2 font-black text-sm text-white">
                <span>Total Transaksi:</span>
                <span className="font-mono text-amber-400 text-base">{rupiah(data.transaction.total_amount)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Transactions({ sector, onSector }: { sector: string; onSector: (s: string) => void }) {
  const [search, setSearch] = useState('');
  const [mod, setMod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const reset = () => setOffset(0);
  const { data, loading, error } = useAsync(
    () => api.transactions({ sector, search, module: mod, from, to, offset, limit: 50 }),
    [sector, search, mod, from, to, offset]
  );

  const dateInput =
    'rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20';

  return (
    <>
      {openId && <DetailPanel id={openId} onClose={() => setOpenId(null)} />}

      <Card
        title="Log Transaksi Seluruh Merchant"
        subtitle="Seluruh riwayat transaksi penjualan kasir dari semua tenant toko terintegrasi."
        actions={
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              reset();
            }}
            placeholder="Cari nomor struk / merchant…"
          />
        }
      >
        <div className="space-y-3 border-b border-slate-100 px-5 py-4 bg-slate-50/50">
          <SectorFilter
            value={sector}
            onChange={(v) => {
              onSector(v);
              reset();
            }}
          />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Select value={mod} onChange={(v) => { setMod(v); reset(); }} options={MODULES} placeholder="Semua Modul" />
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} className={dateInput} />
            <span className="text-xs font-bold text-slate-500">s/d</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} className={dateInput} />
            {(mod || from || to) && (
              <button
                onClick={() => { setMod(''); setFrom(''); setTo(''); reset(); }}
                className="text-xs font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer px-2 py-1"
              >
                Reset Filter
              </button>
            )}
          </div>
        </div>

        {loading && <Loading label="Memuat log transaksi platform..." />}
        {error && <ErrorBox error={error} />}

        {data && (data.rows.length === 0 ? (
          <Empty label="Tidak ada transaksi yang cocok dengan filter" />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-100/80 px-5 py-3 text-xs font-bold text-slate-700 border-b border-slate-200">
              <div className="flex items-center gap-4">
                <span>
                  Total Ditemukan: <b className="text-slate-950 font-mono text-sm">{angka(data.total)}</b> transaksi
                </span>
                <span>
                  Total Nilai: <b className="text-slate-950 font-mono text-sm">{rupiah(data.sumAmount)}</b>
                </span>
              </div>
              <span className="text-slate-500 text-[11px]">Menampilkan {data.rows.length} baris per halaman</span>
            </div>

            <Table>
              <thead>
                <tr>
                  <Th>Waktu</Th>
                  <Th>Nomor Struk</Th>
                  <Th>Merchant / Toko</Th>
                  <Th>Sektor</Th>
                  <Th>Metode Bayar</Th>
                  <Th>Kasir</Th>
                  <Th align="right">Item</Th>
                  <Th align="right">Total Omzet</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.rows.map((x: any) => (
                  <tr
                    key={x.id}
                    onClick={() => setOpenId(x.id)}
                    className="cursor-pointer transition-colors hover:bg-amber-50/40"
                  >
                    <Td className="text-xs font-medium text-slate-600">{waktu(x.created_at)}</Td>
                    <Td className="font-mono text-xs font-bold text-slate-950">{x.invoice_number ?? '—'}</Td>
                    <Td className="font-black text-slate-950">{x.merchant_name}</Td>
                    <Td><SectorChip sector={x.business_sector} /></Td>
                    <Td>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
                        {x.payment_method}
                      </span>
                    </Td>
                    <Td className="font-medium text-slate-700">{x.cashier_name ?? 'Budi Santoso'}</Td>
                    <Td align="right" className="font-bold">{angka(x.item_count)} item</Td>
                    <Td align="right" className="font-mono font-black text-slate-950 text-sm">
                      {rupiah(x.total_amount)}
                    </Td>
                  </tr>
                ))}
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
    </>
  );
}
