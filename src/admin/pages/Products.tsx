import { useState } from 'react';
import { PackageX, TrendingDown, Archive } from 'lucide-react';
import { api, angka, rupiah, sejak, tanggal } from '../api';
import {
  Card, Chip, Empty, ErrorBox, Loading, Pagination, SearchBox, SectorChip, SectorFilter,
  Table, Td, Th, useAsync,
} from '../ui';

type View = 'sold' | 'catalog';

function marginTone(pct: number) {
  if (pct < 15) return 'text-red-600 dark:text-red-400';
  if (pct < 30) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

export default function Products({ sector, onSector }: { sector: string; onSector: (s: string) => void }) {
  const [view, setView] = useState<View>('sold');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, loading, error } = useAsync(
    () =>
      view === 'sold'
        ? api.products({ sector, search, offset, limit: 50 })
        : api.catalog({ sector, search, offset, limit: 50 }),
    [view, sector, search, offset]
  );

  const switchView = (v: View) => {
    setView(v);
    setOffset(0);
  };

  const tabCls = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-medium transition ${
      active
        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
    }`;

  return (
    <Card
      title={view === 'sold' ? 'Produk terjual' : 'Katalog lengkap'}
      subtitle={
        view === 'sold'
          ? 'Diagregasi dari baris struk — mengganti nama produk tidak menulis ulang riwayat penjualan.'
          : 'Berangkat dari katalog, bukan dari struk. Produk yang belum pernah laku justru ikut terlihat di sini.'
      }
      actions={
        <SearchBox
          value={search}
          onChange={(v) => { setSearch(v); setOffset(0); }}
          placeholder="Cari nama / deskripsi…"
        />
      }
    >
      <div className="space-y-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex gap-1.5">
          <button onClick={() => switchView('sold')} className={tabCls(view === 'sold')}>
            Yang terjual
          </button>
          <button onClick={() => switchView('catalog')} className={tabCls(view === 'catalog')}>
            Katalog lengkap
          </button>
        </div>
        <SectorFilter value={sector} onChange={(v) => { onSector(v); setOffset(0); }} />
      </div>

      {loading && <Loading />}
      {error && <ErrorBox error={error} />}

      {data && view === 'catalog' && (
        <div className="flex flex-wrap gap-4 bg-slate-50 px-4 py-2.5 text-xs dark:bg-slate-800/40">
          <span className="flex items-center gap-1.5 text-slate-500">
            <PackageX className="h-3.5 w-3.5" />
            <b className="text-slate-900 tabular-nums dark:text-slate-100">{angka(data.neverSold)}</b>
            belum pernah terjual
          </span>
          <span className="flex items-center gap-1.5 text-slate-500">
            <TrendingDown className="h-3.5 w-3.5" />
            <b className="text-slate-900 tabular-nums dark:text-slate-100">{angka(data.lowStock)}</b>
            stok menipis
          </span>
          <span className="flex items-center gap-1.5 text-slate-500">
            <Archive className="h-3.5 w-3.5" />
            <b className="text-slate-900 tabular-nums dark:text-slate-100">{angka(data.retired)}</b>
            dinonaktifkan
          </span>
          <span className="text-slate-400">dari {angka(data.total)} produk</span>
        </div>
      )}

      {data && (data.rows.length === 0 ? (
        <Empty
          label={
            view === 'sold'
              ? 'Belum ada produk terjual'
              : 'Katalog belum tersinkronisasi dari perangkat kasir'
          }
        />
      ) : (
        <>
          {view === 'sold' ? (
            <Table>
              <thead>
                <tr>
                  <Th>Sektor</Th>
                  <Th>Produk</Th>
                  <Th>Kategori</Th>
                  <Th>Merchant</Th>
                  <Th align="right">Unit terjual</Th>
                  <Th align="right">Omzet</Th>
                  <Th align="right">HPP</Th>
                  <Th align="right">Laba kotor</Th>
                  <Th align="right">Margin</Th>
                  <Th>Terakhir laku</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p: any, i: number) => {
                  const rev = Number(p.revenue) || 0;
                  const profit = Number(p.gross_profit) || 0;
                  const margin = rev > 0 ? (profit / rev) * 100 : 0;
                  return (
                    <tr key={i} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <Td><SectorChip sector={p.business_sector} /></Td>
                      <Td className="font-medium text-slate-900 dark:text-slate-100">
                        {p.product_name}
                        {p.product_description && (
                          <span
                            title={p.product_description}
                            className="block max-w-xs truncate text-xs font-normal text-slate-500 dark:text-slate-400"
                          >
                            {p.product_description}
                          </span>
                        )}
                      </Td>
                      <Td className="text-xs text-slate-500">{p.category_name ?? '—'}</Td>
                      <Td className="text-xs">{p.merchant_name}</Td>
                      <Td align="right">{angka(p.units_sold)}</Td>
                      <Td align="right" className="font-medium text-slate-900 dark:text-slate-100">{rupiah(rev)}</Td>
                      <Td align="right" className="text-slate-500">{rupiah(p.cogs)}</Td>
                      <Td align="right">{rupiah(profit)}</Td>
                      <Td align="right"><span className={marginTone(margin)}>{margin.toFixed(1).replace('.', ',')}%</span></Td>
                      <Td className="text-xs">{sejak(p.last_sold_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Sektor</Th>
                  <Th>Produk</Th>
                  <Th>SKU</Th>
                  <Th>Merchant</Th>
                  <Th align="right">Harga</Th>
                  <Th align="right">HPP</Th>
                  <Th align="right">Margin</Th>
                  <Th align="right">Stok</Th>
                  <Th align="right">Terjual</Th>
                  <Th>Status</Th>
                  <Th>Katalog disinkron</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p: any) => (
                  <tr key={p.product_id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td><SectorChip sector={p.business_sector} /></Td>
                    <Td className="font-medium text-slate-900 dark:text-slate-100">
                      {p.product_name}
                      {p.description && (
                        <span
                          title={p.description}
                          className="block max-w-xs truncate text-xs font-normal text-slate-500 dark:text-slate-400"
                        >
                          {p.description}
                        </span>
                      )}
                    </Td>
                    <Td className="font-mono text-xs text-slate-500">{p.sku}</Td>
                    <Td className="text-xs">{p.merchant_name}</Td>
                    <Td align="right">{rupiah(p.price)}</Td>
                    <Td align="right" className="text-slate-500">{rupiah(p.cost_price)}</Td>
                    <Td align="right">
                      <span className={marginTone(Number(p.margin_pct) || 0)}>
                        {String(p.margin_pct ?? 0).replace('.', ',')}%
                      </span>
                    </Td>
                    <Td align="right">
                      <span className={p.is_low_stock ? 'font-semibold text-red-600 dark:text-red-400' : ''}>
                        {angka(p.stock)}
                      </span>
                      <span className="text-xs text-slate-400"> / {angka(p.min_stock_alert)}</span>
                    </Td>
                    <Td align="right">
                      {Number(p.units_sold) === 0 ? (
                        <Chip tone="bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800">
                          belum laku
                        </Chip>
                      ) : (
                        angka(p.units_sold)
                      )}
                    </Td>
                    <Td>
                      {!p.is_available ? (
                        <Chip tone="bg-slate-200 text-slate-600 ring-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600">
                          nonaktif
                        </Chip>
                      ) : p.is_low_stock ? (
                        <Chip tone="bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-800">
                          stok menipis
                        </Chip>
                      ) : (
                        <Chip tone="bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800">
                          aktif
                        </Chip>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {p.catalog_synced_at ? tanggal(p.catalog_synced_at) : (
                        // Membedakan "belum pernah dikirim perangkat" dari
                        // "dikirim tapi kosong" — dua hal yang terlihat sama.
                        <span className="text-amber-600 dark:text-amber-400">belum pernah</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pagination offset={data.offset} limit={data.limit} total={data.total} onChange={setOffset} />
        </>
      ))}
    </Card>
  );
}
