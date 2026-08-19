import React, { useState } from 'react';
import {
  Award,
  Box,
  Boxes,
  Building2,
  ChevronRight,
  Crown,
  DollarSign,
  Flame,
  Layers,
  Package,
  PackageCheck,
  PackageSearch,
  Percent,
  Receipt,
  Scale,
  Search,
  Sparkles,
  Store,
  Tag,
  TrendingDown,
  TrendingUp,
  UtensilsCrossed,
  Zap,
} from 'lucide-react';
import {
  api,
  angka,
  rupiah,
  rupiahShort,
  sejak,
  tanggal,
  SECTORS,
  SECTOR_LABEL,
  SECTOR_STYLE,
  type Sector,
} from '../api';
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

type ProductTab = 'LEADERBOARD' | 'ALL_PRODUCTS' | 'RAW_MATERIALS' | 'BUNDLES' | 'RECIPES';

export default function Products({ sector, onSector }: { sector: string; onSector: (s: string) => void }) {
  const [activeTab, setActiveTab] = useState<ProductTab>('LEADERBOARD');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  // Queries
  const { data: prodData, loading: prodLoading } = useAsync(
    () => api.products({ sector, search, offset, limit: 50 }),
    [sector, search, offset]
  );
  const { data: rawData, loading: rawLoading } = useAsync(
    () => api.rawMaterials({ search }),
    [search]
  );
  const { data: bundleData, loading: bundleLoading } = useAsync(
    () => api.bundles({ sector, search }),
    [sector, search]
  );
  const { data: recipeData, loading: recipeLoading } = useAsync(
    () => api.recipes({ sector, search }),
    [sector, search]
  );

  // Katalog dipakai untuk kartu ringkasan di atas tab. Dibaca dari database
  // lewat contract.catalog — sebelumnya dari array yang ditulis di dalam
  // bundle, jadi angkanya sama untuk semua orang dan tidak pernah berubah.
  const { data: catalogData } = useAsync(
    () => api.catalog({ sector, search, limit: 200 }),
    [sector, search]
  );

  const allProds: any[] = catalogData?.rows ?? [];
  const rawRows: any[] = rawData?.rows ?? [];
  const recipeRows: any[] = recipeData?.rows ?? [];
  const bundleRows: any[] = bundleData?.rows ?? [];

  const num = (v: unknown) => Number(v) || 0;

  // contract.product_recipes memberi satu baris per pasangan produk-bahan.
  // Pengelompokannya dilakukan di sini, bukan di SQL: bentuk tampilan tidak
  // boleh dipaksakan ke dalam kontrak yang juga dibaca service lain.
  const recipeGroups = Object.values(
    recipeRows.reduce((acc: Record<string, any>, r: any) => {
      const g = (acc[r.product_id] ??= {
        id: r.product_id,
        business_sector: r.business_sector,
        merchant_name: r.merchant_name,
        product_name: r.product_name,
        price: num(r.product_price),
        ingredients: [] as any[],
        total_material_cost: 0,
      });
      g.ingredients.push({
        name: r.ingredient_name,
        qty: `${num(r.quantity_required)} ${r.ingredient_unit ?? ''}`.trim(),
        cost: num(r.biaya_per_porsi),
      });
      g.total_material_cost += num(r.biaya_per_porsi);
      return acc;
    }, {})
  ).map((g: any) => {
    const gross_profit = g.price - g.total_material_cost;
    return {
      ...g,
      gross_profit,
      // Margin dari harga NOL akan menghasilkan Infinity dan tampil sebagai
      // "Infinity%" di layar. Produk gratis memang bermargin nol.
      margin_pct: g.price > 0 ? Math.round((gross_profit / g.price) * 1000) / 10 : 0,
    };
  });
  const urut = (k: string) => [...allProds].sort((a, b) => num(b[k]) - num(a[k]))[0];

  const topRevenueProduct = urut('gross_revenue');
  const mostSoldProduct = urut('units_sold');
  const mostExpensiveProduct = urut('price');
  const berstok = allProds.filter((p) => num(p.stock) < 999);
  const averageStockRetail = Math.round(
    berstok.reduce((s, p) => s + num(p.stock), 0) / Math.max(berstok.length, 1)
  );
  const totalCatalogCount = catalogData?.total ?? allProds.length;
  const totalValuation = allProds.reduce(
    (s, p) => s + num(p.stock) * (num(p.cost_price) || num(p.price) * 0.5),
    0
  );

  return (
    <div className="space-y-6">
      {/* Header & Main Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-950 dark:text-white flex items-center gap-2">
            <span>Manajemen &amp; Analitik Produk Seluruh Client</span>
            <span className="text-xs px-2.5 py-0.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-300 font-extrabold">
              Master Catalog &amp; BOM
            </span>
          </h1>
          <p className="text-xs text-slate-600 font-medium dark:text-slate-400 mt-0.5">
            Database terintegrasi produk, omzet tertinggi, produk termahal, stok inventori, bahan baku/mentah, dan resep komposisi merchant.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab('LEADERBOARD')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'LEADERBOARD'
                ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-500/20'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Crown className="w-4 h-4" />
            <span>Leaderboard &amp; Insight</span>
          </button>

          <button
            onClick={() => setActiveTab('ALL_PRODUCTS')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'ALL_PRODUCTS'
                ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-500/20'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Semua Produk ({totalCatalogCount})</span>
          </button>

          <button
            onClick={() => setActiveTab('RAW_MATERIALS')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'RAW_MATERIALS'
                ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-500/20'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>Bahan Baku &amp; Mentah ({rawData?.total ?? 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('BUNDLES')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'BUNDLES'
                ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-500/20'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Bundle Set Promo ({bundleData?.total ?? 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('RECIPES')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'RECIPES'
                ? 'bg-amber-500 text-slate-950 shadow-md ring-2 ring-amber-500/20'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <UtensilsCrossed className="w-4 h-4" />
            <span>Resep &amp; Komposisi BOM ({recipeGroups.length})</span>
          </button>
        </div>
      </div>

      {/* 1. TAB LEADERBOARD & EXECUTIVE INSIGHTS */}
      {activeTab === 'LEADERBOARD' && (
        <div className="space-y-6">
          {/* Top 4 Insight Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Produk Omzet Tertinggi */}
            <div className="p-5 rounded-2xl bg-white border border-amber-200 shadow-xs space-y-3 relative overflow-hidden bg-amber-50/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-amber-600" />
                  <span>Omzet Tertinggi</span>
                </span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 border border-amber-300">
                  #1 Top GMV
                </span>
              </div>
              <div>
                <p className="font-black text-sm text-slate-950">{topRevenueProduct.product_name}</p>
                <p className="text-xs text-slate-600 font-medium">Merchant: {topRevenueProduct.merchant_name}</p>
                <div className="mt-2 pt-2 border-t border-amber-200/60 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Total Omzet:</span>
                  <span className="font-mono font-black text-sm text-slate-950">
                    {rupiah(topRevenueProduct.gross_revenue)}
                  </span>
                </div>
                <p className="text-[11px] text-emerald-700 font-bold mt-0.5">
                  {angka(topRevenueProduct.units_sold)} unit terjual ({rupiah(topRevenueProduct.price)}/unit)
                </p>
              </div>
            </div>

            {/* 2. Produk Paling Banyak Ditransaksikan */}
            <div className="p-5 rounded-2xl bg-white border border-blue-200 shadow-xs space-y-3 relative overflow-hidden bg-blue-50/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-blue-600" />
                  <span>Paling Sering Ditransaksikan</span>
                </span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-blue-100 text-blue-950 border border-blue-300">
                  ⚡ High Volume
                </span>
              </div>
              <div>
                <p className="font-black text-sm text-slate-950">{mostSoldProduct.product_name}</p>
                <p className="text-xs text-slate-600 font-medium">Merchant: {mostSoldProduct.merchant_name}</p>
                <div className="mt-2 pt-2 border-t border-blue-200/60 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Frekuensi Transaksi:</span>
                  <span className="font-mono font-black text-sm text-blue-900">
                    {angka(mostSoldProduct.transaction_count)} Transaksi
                  </span>
                </div>
                <p className="text-[11px] text-blue-700 font-bold mt-0.5">
                  Total {angka(mostSoldProduct.units_sold)} unit laku terjual
                </p>
              </div>
            </div>

            {/* 3. Produk Termahal & Jumlah Transaksi */}
            <div className="p-5 rounded-2xl bg-white border border-purple-200 shadow-xs space-y-3 relative overflow-hidden bg-purple-50/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-purple-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Crown className="w-4 h-4 text-purple-600" />
                  <span>Produk Termahal di Platform</span>
                </span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-purple-100 text-purple-950 border border-purple-300">
                  💎 Premium Ticket
                </span>
              </div>
              <div>
                <p className="font-black text-sm text-slate-950">{mostExpensiveProduct.product_name}</p>
                <p className="text-xs text-slate-600 font-medium">Merchant: {mostExpensiveProduct.merchant_name}</p>
                <div className="mt-2 pt-2 border-t border-purple-200/60 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Harga Satuan:</span>
                  <span className="font-mono font-black text-sm text-purple-950">
                    {rupiah(mostExpensiveProduct.price)}
                  </span>
                </div>
                <p className="text-[11px] text-purple-800 font-extrabold mt-0.5">
                  Berhasil ditransaksikan sebanyak <strong>{mostExpensiveProduct.transaction_count} kali</strong>
                </p>
              </div>
            </div>

            {/* 4. Rata-Rata Stok Klien & Valuasi */}
            <div className="p-5 rounded-2xl bg-white border border-emerald-200 shadow-xs space-y-3 relative overflow-hidden bg-emerald-50/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Box className="w-4 h-4 text-emerald-600" />
                  <span>Rata-Rata Stok &amp; Valuasi</span>
                </span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-950 border border-emerald-300">
                  📦 Inventory
                </span>
              </div>
              <div>
                <p className="font-black text-sm text-slate-950">{averageStockRetail} Unit / SKU Fisik</p>
                <p className="text-xs text-slate-600 font-medium">Total Terdata: {totalCatalogCount} Produk Aktif</p>
                <div className="mt-2 pt-2 border-t border-emerald-200/60 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Estimasi Valuasi Stok:</span>
                  <span className="font-mono font-black text-sm text-emerald-900">
                    {rupiahShort(totalValuation)}
                  </span>
                </div>
                <p className="text-[11px] text-emerald-700 font-bold mt-0.5">Stok aman &amp; tersinkronisasi kasir</p>
              </div>
            </div>
          </div>

          {/* Top 10 Best Selling Products Across All Clients */}
          <Card
            title="Peringkat 10 Produk Kontributor Omzet Tertinggi (Cross-Merchant)"
            subtitle="Daftar produk dengan kontribusi pendapatan kotor terbesar dari seluruh client dan sektor usaha terdaftar"
          >
            <Table>
              <thead>
                <tr>
                  <Th>Peringkat &amp; Produk</Th>
                  <Th>Merchant / Toko</Th>
                  <Th>Sektor Bisnis</Th>
                  <Th align="right">Harga Jual</Th>
                  <Th align="right">HPP (Modal)</Th>
                  <Th align="right">Margin Laba</Th>
                  <Th align="right">Unit Terjual</Th>
                  <Th align="right">Jumlah Transaksi</Th>
                  <Th align="right">Total Omzet</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {[...allProds]
                  .sort((a, b) => b.gross_revenue - a.gross_revenue)
                  .slice(0, 10)
                  .map((p, idx) => (
                    <tr key={p.id} className="hover:bg-amber-50/30 transition-colors">
                      <Td>
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${
                              idx === 0
                                ? 'bg-amber-400 text-slate-950 shadow-xs'
                                : idx === 1
                                ? 'bg-slate-300 text-slate-900'
                                : idx === 2
                                ? 'bg-amber-700 text-white'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {idx + 1}
                          </span>
                          <div>
                            <span className="font-black text-slate-950 block">{p.product_name}</span>
                            <span className="text-[11px] text-slate-500 font-medium">{p.category_name}</span>
                          </div>
                        </div>
                      </Td>
                      <Td className="font-bold text-slate-800">
                        <div className="flex items-center gap-1.5">
                          <Store className="w-3.5 h-3.5 text-slate-400" />
                          <span>{p.merchant_name}</span>
                        </div>
                      </Td>
                      <Td><SectorChip sector={p.business_sector} /></Td>
                      <Td align="right" className="font-mono font-bold text-slate-900">{rupiah(p.price)}</Td>
                      <Td align="right" className="font-mono text-slate-600">{rupiah(p.cost_price)}</Td>
                      <Td align="right">
                        <span className="font-mono font-extrabold text-emerald-700">
                          {p.margin_pct}%
                        </span>
                      </Td>
                      <Td align="right" className="font-bold">{angka(p.units_sold)} unit</Td>
                      <Td align="right" className="font-mono text-slate-800">{angka(p.transaction_count)} struk</Td>
                      <Td align="right" className="font-mono font-black text-slate-950 text-sm">
                        {rupiah(p.gross_revenue)}
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      {/* 2. TAB SEMUA PRODUK KLIEN */}
      {activeTab === 'ALL_PRODUCTS' && (
        <Card
          title="Katalog Lengkap Seluruh Produk Klien"
          subtitle="Daftar seluruh menu, sembako, paket cuci, dan jasa dari semua merchant yang terintegrasi di POS"
          actions={
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v);
                setOffset(0);
              }}
              placeholder="Cari nama produk / merchant…"
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

          {prodLoading && <Loading label="Memuat katalog produk..." />}
          {prodData && (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Sektor</Th>
                    <Th>Nama Produk &amp; SKU</Th>
                    <Th>Merchant / Pemilik</Th>
                    <Th>Kategori</Th>
                    <Th align="right">Harga Jual</Th>
                    <Th align="right">HPP (Modal)</Th>
                    <Th align="right">Margin</Th>
                    <Th align="right">Stok Gudang</Th>
                    <Th align="right">Terjual</Th>
                    <Th align="right">Total Omzet</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {prodData.rows.map((p: any) => (
                    <tr key={p.id} className="hover:bg-amber-50/30 transition-colors">
                      <Td><SectorChip sector={p.business_sector} /></Td>
                      <Td>
                        <span className="font-black text-slate-950 block">{p.product_name}</span>
                        <span className="font-mono text-[11px] text-slate-500 font-semibold">{p.sku}</span>
                      </Td>
                      <Td className="font-bold text-slate-800">{p.merchant_name}</Td>
                      <Td className="font-medium text-slate-600">{p.category_name}</Td>
                      <Td align="right" className="font-mono font-bold text-slate-950">{rupiah(p.price)}</Td>
                      <Td align="right" className="font-mono text-slate-600">{rupiah(p.cost_price)}</Td>
                      <Td align="right">
                        <span className="font-mono font-bold text-emerald-700">{p.margin_pct}%</span>
                      </Td>
                      <Td align="right">
                        <span
                          className={`font-bold ${
                            p.stock < p.min_stock_alert && p.stock < 999
                              ? 'text-rose-600 font-extrabold'
                              : 'text-slate-900'
                          }`}
                        >
                          {p.stock >= 999 ? 'Unlimited / Jasa' : `${angka(p.stock)} pcs`}
                        </span>
                      </Td>
                      <Td align="right" className="font-bold">{angka(p.units_sold)}</Td>
                      <Td align="right" className="font-mono font-black text-slate-950">
                        {rupiah(p.gross_revenue)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination
                offset={prodData.offset}
                limit={prodData.limit}
                total={prodData.total}
                onChange={setOffset}
              />
            </>
          )}
        </Card>
      )}

      {/* 3. TAB BAHAN BAKU & MENTAH KLIEN */}
      {activeTab === 'RAW_MATERIALS' && (
        <Card
          title="Stok Bahan Baku &amp; Bahan Mentah Klien (Raw Materials)"
          subtitle="Inventori bahan mentah yang disimpan di gudang merchant untuk meracik produk atau melayani jasa"
          actions={
            <SearchBox
              value={search}
              onChange={(v) => setSearch(v)}
              placeholder="Cari bahan mentah / supplier…"
            />
          }
        >
          {rawLoading && <Loading label="Memuat inventori bahan baku..." />}
          {rawData && (
            <Table>
              <thead>
                <tr>
                  <Th>Nama Bahan Mentah / Baku</Th>
                  <Th>Merchant Pemilik</Th>
                  <Th>Kategori Bahan</Th>
                  <Th align="right">Stok Tersedia</Th>
                  <Th align="right">Harga Modal / Unit</Th>
                  <Th align="right">Ambang Min. Stok</Th>
                  <Th>Status Stok</Th>
                  <Th>Pemasok / Supplier</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rawData.rows.map((m: any) => (
                  <tr key={m.id} className="hover:bg-amber-50/30 transition-colors">
                    <Td className="font-black text-slate-950">{m.material_name}</Td>
                    <Td className="font-bold text-slate-800">{m.merchant_name}</Td>
                    <Td className="font-semibold text-slate-600">
                      <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-bold border border-slate-200">
                        {m.category}
                      </span>
                    </Td>
                    <Td align="right" className="font-mono font-black text-slate-950 text-sm">
                      {m.stock_quantity} {m.unit}
                    </Td>
                    <Td align="right" className="font-mono font-bold text-slate-700">
                      {rupiah(m.cost_per_unit)} / {m.unit}
                    </Td>
                    <Td align="right" className="font-mono text-slate-600">
                      {m.min_stock} {m.unit}
                    </Td>
                    <Td>
                      {m.status === 'LOW_STOCK' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-950 border border-rose-300">
                          ⚠️ Menipis
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-950 border border-emerald-300">
                          ✓ Stok Aman
                        </span>
                      )}
                    </Td>
                    <Td className="text-xs font-medium text-slate-600">{m.supplier}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {/* 4. TAB BUNDLE SET PROMO KLIEN */}
      {activeTab === 'BUNDLES' && (
        <Card
          title="Daftar Paket Promo &amp; Bundle Set Klien"
          subtitle="Paket bundling yang dijual oleh merchant untuk mendongkrak rata-rata nilai transaksi (AOV)"
        >
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            {bundleRows.length === 0 && (
              <p className="col-span-full p-6 text-center text-xs text-slate-500">
                Belum ada paket promo yang tersinkronisasi dari perangkat kasir.
              </p>
            )}
            {bundleRows.map((b: any) => (
              <div
                key={b.id}
                className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4 hover:shadow-md transition-all relative overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase">{b.merchant_name}</span>
                    <h3 className="text-base font-black text-slate-950 mt-0.5">{b.name}</h3>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!b.is_available && (
                      <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 font-bold text-[10px] border border-slate-200">
                        Nonaktif
                      </span>
                    )}
                    <span className="px-2.5 py-1 rounded-xl bg-amber-500 text-slate-950 font-black text-xs shadow-xs">
                      Hemat {b.diskon_persen}%
                    </span>
                  </div>
                </div>

                {/* Isi paket */}
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                  <p className="text-[11px] font-black text-slate-700 uppercase">
                    Item Penyusun Bundle ({b.jumlah_item}):
                  </p>
                  <ul className="text-xs space-y-1 text-slate-800 font-medium list-disc list-inside">
                    {(b.items ?? []).map((item: any, idx: number) => (
                      <li key={idx}>
                        {item.quantity}&times; {item.product_name}
                        <span className="text-slate-500 font-mono"> — {rupiah(item.subtotal_price)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Harga. Angka penjualan per paket sengaja TIDAK ditampilkan:
                    baris struk tidak mencatat paket asalnya, jadi "berapa paket
                    terjual" tidak bisa dijawab tanpa mengarang. */}
                <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-100">
                  <div>
                    <span className="text-slate-500 block text-[11px]">Harga Normal Satuan:</span>
                    <span className="font-mono text-slate-400 line-through font-bold">{rupiah(b.regular_price)}</span>
                    <span className="font-mono text-sm font-black text-slate-950 block mt-0.5">
                      {rupiah(b.bundle_price)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 block text-[11px]">Selisih untuk Pelanggan:</span>
                    <span className="font-mono font-black text-emerald-700 block mt-0.5">
                      {rupiah(b.hemat_rupiah)}
                    </span>
                    <span className="text-[11px] text-slate-500 block mt-0.5">
                      diperbarui {sejak(b.updated_at)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 5. TAB RESEP & KOMPOSISI BAHAN MENTAH (BILL OF MATERIALS) */}
      {activeTab === 'RECIPES' && (
        <Card
          title="Resep &amp; Komposisi Bahan Mentah (Bill of Materials / BOM)"
          subtitle="Rincian bahan mentah dan takaran yang digunakan merchant untuk memproduksi setiap menu atau paket jasa"
        >
          <div className="p-5 space-y-6">
            {recipeGroups.map((r: any) => (
              <div
                key={r.id}
                className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4 hover:border-amber-300 transition-all"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-black uppercase border border-slate-200">
                        {r.business_sector}
                      </span>
                      <span className="text-xs text-slate-500 font-bold">{r.merchant_name}</span>
                    </div>
                    <h3 className="text-base font-black text-slate-950 mt-1">{r.product_name}</h3>
                  </div>

                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <span className="text-[11px] text-slate-500 block font-medium">Harga Jual Menu:</span>
                      <span className="font-mono font-black text-slate-950 text-base">{rupiah(r.price)}</span>
                    </div>
                    <div className="pl-4 border-l border-slate-200">
                      <span className="text-[11px] text-slate-500 block font-medium">Margin Laba:</span>
                      <span className="font-mono font-black text-emerald-700 text-base">{r.margin_pct}%</span>
                    </div>
                  </div>
                </div>

                {/* Ingredients composition table */}
                <div>
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-2">
                    Bahan Mentah yang Digunakan:
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-[11px] text-slate-700 font-black uppercase">
                        <tr>
                          <th className="p-3">Bahan Mentah</th>
                          <th className="p-3 text-right">Takaran per Porsi</th>
                          <th className="p-3 text-right">Biaya Modal Bahan (HPP)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {r.ingredients.map((ing: any, idx: number) => (
                          <tr key={idx}>
                            <td className="p-3 font-bold text-slate-900">{ing.name}</td>
                            <td className="p-3 text-right font-mono text-slate-700">{ing.qty}</td>
                            <td className="p-3 text-right font-mono font-bold text-slate-950">
                              {rupiah(ing.cost)}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50 font-black text-slate-950">
                          <td className="p-3" colSpan={2}>
                            Total Biaya Modal Bahan Mentah (HPP Pokok):
                          </td>
                          <td className="p-3 text-right font-mono text-sm text-rose-700">
                            {rupiah(r.total_material_cost)}
                          </td>
                        </tr>
                        <tr className="bg-emerald-50/50 font-black text-emerald-950">
                          <td className="p-3" colSpan={2}>
                            Estimasi Laba Kotor per Produk:
                          </td>
                          <td className="p-3 text-right font-mono text-sm text-emerald-800">
                            +{rupiah(r.gross_profit)} ({r.margin_pct}%)
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
