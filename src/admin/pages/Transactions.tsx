import { useState } from 'react';
import { Receipt, X } from 'lucide-react';
import { api, angka, rupiah, waktu } from '../api';
import {
  Card, Chip, Empty, ErrorBox, Loading, Pagination, SearchBox, SectorChip, SectorFilter,
  Select, Table, Td, Th, useAsync,
} from '../ui';

const MODULES = ['POS', 'TABLES', 'INVENTORY', 'CUSTOMERS', 'SYNC'].map((m) => ({ value: m, label: m }));

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useAsync(() => api.transaction(id), [id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Receipt className="h-4 w-4" /> Rincian transaksi
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </header>

        {loading && <Loading />}
        {error && <ErrorBox error={error} />}

        {data && (
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">Nomor struk</p>
                <p className="font-mono text-slate-900 dark:text-slate-100">
                  {data.transaction.invoice_number ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Waktu</p>
                <p className="text-slate-900 dark:text-slate-100">{waktu(data.transaction.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Merchant</p>
                <p className="text-slate-900 dark:text-slate-100">{data.transaction.merchant_name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Sektor</p>
                <div className="mt-0.5"><SectorChip sector={data.transaction.business_sector} /></div>
              </div>
              <div>
                <p className="text-xs text-slate-500">Kasir</p>
                <p className="text-slate-900 dark:text-slate-100">{data.transaction.cashier_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Metode bayar</p>
                <p className="text-slate-900 dark:text-slate-100">{data.transaction.payment_method}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500">Unit usaha (partition key)</p>
                <p className="font-mono text-xs text-slate-600 dark:text-slate-400">
                  {data.transaction.business_id ?? '—'}
                </p>
              </div>
            </div>

            <Table>
              <thead>
                <tr>
                  <Th>Produk</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Harga</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i: any, k: number) => (
                  <tr key={k}>
                    <Td>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{i.product_name}</span>
                      {i.category_name && <span className="ml-1.5 text-xs text-slate-400">{i.category_name}</span>}
                    </Td>
                    <Td align="right">{angka(i.quantity)}</Td>
                    <Td align="right">{rupiah(i.unit_price)}</Td>
                    <Td align="right">{rupiah(i.total_price)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
              {[
                ['Subtotal', data.transaction.subtotal],
                ['Diskon', -Number(data.transaction.discount_amount ?? 0)],
                ['Pajak', data.transaction.tax_amount],
              ].map(([label, v]) => (
                <div key={String(label)} className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>{label}</span>
                  <span className="tabular-nums">{rupiah(v)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
                <span>Total</span>
                <span className="tabular-nums">{rupiah(data.transaction.total_amount)}</span>
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
    'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';

  return (
    <>
      {openId && <DetailPanel id={openId} onClose={() => setOpenId(null)} />}

      <Card
        title="Log transaksi"
        subtitle="Seluruh transaksi seluruh merchant, diklasifikasikan per sektor bisnis."
        actions={
          <SearchBox
            value={search}
            onChange={(v) => { setSearch(v); reset(); }}
            placeholder="Cari nomor struk / merchant…"
          />
        }
      >
        <div className="space-y-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <SectorFilter value={sector} onChange={(v) => { onSector(v); reset(); }} />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={mod} onChange={(v) => { setMod(v); reset(); }} options={MODULES} placeholder="Semua modul aplikasi" />
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} className={dateInput} />
            <span className="text-xs text-slate-400">s/d</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} className={dateInput} />
            {(mod || from || to) && (
              <button
                onClick={() => { setMod(''); setFrom(''); setTo(''); reset(); }}
                className="text-xs font-medium text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
              >
                Bersihkan
              </button>
            )}
          </div>
        </div>

        {loading && <Loading />}
        {error && <ErrorBox error={error} />}

        {data && (data.rows.length === 0 ? (
          <Empty label="Tidak ada transaksi yang cocok" />
        ) : (
          <>
            <div className="flex flex-wrap gap-4 bg-slate-50 px-4 py-2.5 text-xs dark:bg-slate-800/40">
              <span className="text-slate-500">
                <b className="text-slate-900 tabular-nums dark:text-slate-100">{angka(data.total)}</b> transaksi
              </span>
              <span className="text-slate-500">
                total <b className="text-slate-900 tabular-nums dark:text-slate-100">{rupiah(data.sumAmount)}</b>
              </span>
              <span className="text-slate-400">(mengikuti filter aktif, bukan hanya halaman ini)</span>
            </div>

            <Table>
              <thead>
                <tr>
                  <Th>Waktu</Th>
                  <Th>Nomor struk</Th>
                  <Th>Merchant</Th>
                  <Th>Sektor</Th>
                  <Th>Modul</Th>
                  <Th>Kasir</Th>
                  <Th align="right">Item</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((x: any) => (
                  <tr
                    key={x.id}
                    onClick={() => setOpenId(x.id)}
                    className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <Td className="text-xs">{waktu(x.created_at)}</Td>
                    <Td className="font-mono text-xs">{x.invoice_number ?? '—'}</Td>
                    <Td className="font-medium text-slate-900 dark:text-slate-100">{x.merchant_name}</Td>
                    <Td><SectorChip sector={x.business_sector} /></Td>
                    <Td><Chip>{x.app_module}</Chip></Td>
                    <Td>{x.cashier_name ?? '—'}</Td>
                    <Td align="right">{angka(x.item_count)}</Td>
                    <Td align="right" className="font-medium text-slate-900 dark:text-slate-100">
                      {rupiah(x.total_amount)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination offset={data.offset} limit={data.limit} total={data.total} onChange={setOffset} />
          </>
        ))}
      </Card>
    </>
  );
}
