import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { Product, StockItem, StockType } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { newId } from '../../lib/ids';
import {
  Package,
  Plus,
  Search,
  Edit,
  Trash2,
  ArrowUpRight,
  ArrowDownRight,
  X,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Upload,
  Image,
  Boxes,
  Layers,
  ChefHat,
} from 'lucide-react';

/**
 * Batas panjang deskripsi produk.
 *
 * Sama dengan VARCHAR(300) di kolom products.description. Dipotong di sini juga,
 * bukan hanya di server: pengguna yang mengetik 400 karakter lalu ditolak saat
 * menyimpan sudah kehilangan pekerjaannya.
 */
const DESCRIPTION_MAX = 300;

export const InventoryManager: React.FC = () => {
  const {
    products,
    categories,
    saveProduct,
    deleteProduct,
    adjustStock,
    inventoryLogs,
    stockItems,
    saveStockItem,
    deleteStockItem,
    adjustStockItemQuantity,
  } = usePOS();

  const [activeSubTab, setActiveSubTab] = useState<'catalog' | 'stock' | 'logs'>('catalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'low'>('all');
  const [stockTypeFilter, setStockTypeFilter] = useState<'ALL' | StockType>('ALL');

  // Modal for Add/Edit Stock Item (Bahan Baku / Setengah Jadi / Jadi)
  const [showStockModal, setShowStockModal] = useState(false);
  const [editingStockItem, setEditingStockItem] = useState<StockItem | null>(null);
  const [stockItemName, setStockItemName] = useState('');
  const [stockItemSku, setStockItemSku] = useState('');
  const [stockItemType, setStockItemType] = useState<StockType>('SETENGAH_JADI');
  const [stockItemUnit, setStockItemUnit] = useState('Liter');
  const [stockItemQty, setStockItemQty] = useState(10);
  const [stockItemMinQty, setStockItemMinQty] = useState(3);
  const [stockItemCostPrice, setStockItemCostPrice] = useState(25000);
  const [stockItemLocation, setStockItemLocation] = useState('Storage Dapur/Bar');
  const [stockItemRecipeYield, setStockItemRecipeYield] = useState('');
  const [stockItemNotes, setStockItemNotes] = useState('');

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [stockAdjustProduct, setStockAdjustProduct] = useState<Product | null>(null);
  const [stockQty, setStockQty] = useState(10);
  const [stockType, setStockType] = useState<'IN' | 'OUT'>('IN');
  const [stockReason, setStockReason] = useState('Restok Pembelian Supplier');

  // Form states for Add/Edit Product
  const [formName, setFormName] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formBarcode, setFormBarcode] = useState('');
  const [formCategoryId, setFormCategoryId] = useState(categories[0]?.id || 'cat-coffee');
  const [formPrice, setFormPrice] = useState(25000);
  const [formCostPrice, setFormCostPrice] = useState(12000);
  const [formStock, setFormStock] = useState(50);
  const [formMinStock, setFormMinStock] = useState(10);
  const [formUnit, setFormUnit] = useState('pcs');
  const [formImage, setFormImage] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLinkedStockItemId, setFormLinkedStockItemId] = useState('');
  const [formRecipeQty, setFormRecipeQty] = useState(1);

  const handleProductImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Ukuran foto terlalu besar (maksimal 5MB)');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const lowStockProducts = products.filter((p) => p.stock <= p.minStockAlert);

  const filteredProducts = products.filter((p) => {
    const matchesCat = selectedCategory === 'all' || p.categoryId === selectedCategory;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStock = stockFilter === 'all' || p.stock <= p.minStockAlert;
    return matchesCat && matchesSearch && matchesStock;
  });

  const handleOpenAddModal = () => {
    setFormName('');
    setFormSku(`SKU-${Math.floor(1000 + Math.random() * 9000)}`);
    setFormBarcode(`899${Math.floor(1000000 + Math.random() * 9000000)}`);
    setFormCategoryId(categories[0]?.id || 'cat-coffee');
    setFormPrice(25000);
    setFormCostPrice(12000);
    setFormStock(50);
    setFormMinStock(10);
    setFormUnit('pcs');
    setFormImage('https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=400');
    setFormDescription('');
    setFormLinkedStockItemId('');
    setFormRecipeQty(1);
    setEditingProduct(null);
    setShowAddModal(true);
  };

  const handleOpenEditModal = (p: Product) => {
    setEditingProduct(p);
    setFormName(p.name);
    setFormSku(p.sku);
    setFormBarcode(p.barcode || '');
    setFormCategoryId(p.categoryId);
    setFormPrice(p.price);
    setFormCostPrice(p.costPrice);
    setFormStock(p.stock);
    setFormMinStock(p.minStockAlert);
    setFormUnit(p.unit);
    setFormImage(p.image || '');
    setFormDescription(p.description || '');
    setFormLinkedStockItemId(p.linkedStockItemId || '');
    setFormRecipeQty(p.recipeQty || 1);
    setShowAddModal(true);
  };

  const handleSaveProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName) return;

    const prod: Product = {
      id: editingProduct ? editingProduct.id : newId('prod'),
      sku: formSku,
      barcode: formBarcode,
      name: formName,
      categoryId: formCategoryId,
      price: formPrice,
      costPrice: formCostPrice,
      stock: formStock,
      minStockAlert: formMinStock,
      unit: formUnit,
      image: formImage,
      // Kolom kosong disimpan sebagai undefined, bukan string kosong. Kalau
      // tidak, `p.description && ...` di tempat lain tetap bernilai true untuk
      // '' dan menghasilkan baris kosong di kartu produk.
      description: formDescription.trim() || undefined,
      isAvailable: true,
      variants: editingProduct?.variants || [
        { id: 'v-1', name: 'Regular', priceExtra: 0 },
        { id: 'v-2', name: 'Large', priceExtra: 5000 },
      ],
      modifierGroups: editingProduct?.modifierGroups,
      linkedStockItemId: formLinkedStockItemId || undefined,
      recipeQty: formRecipeQty || 1,
    };

    saveProduct(prod);
    setShowAddModal(false);
  };

  const handleConfirmStockAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockAdjustProduct) return;
    adjustStock(stockAdjustProduct.id, stockQty, stockType, stockReason);
    setStockAdjustProduct(null);
  };

  const handleOpenAddStockModal = () => {
    setEditingStockItem(null);
    setStockItemName('');
    setStockItemSku(`WIP-${Math.floor(100 + Math.random() * 900)}`);
    setStockItemType('SETENGAH_JADI');
    setStockItemUnit('Liter');
    setStockItemQty(10);
    setStockItemMinQty(3);
    setStockItemCostPrice(35000);
    setStockItemLocation('Cold Storage / Rak Dapur');
    setStockItemRecipeYield('1 Liter = 20 Porsi Jual');
    setStockItemNotes('');
    setShowStockModal(true);
  };

  const handleOpenEditStockModal = (item: StockItem) => {
    setEditingStockItem(item);
    setStockItemName(item.name);
    setStockItemSku(item.sku);
    setStockItemType(item.type);
    setStockItemUnit(item.unit);
    setStockItemQty(item.stock);
    setStockItemMinQty(item.minStockAlert);
    setStockItemCostPrice(item.costPrice);
    setStockItemLocation(item.location);
    setStockItemRecipeYield(item.recipeYield || '');
    setStockItemNotes(item.notes || '');
    setShowStockModal(true);
  };

  const handleSaveStockItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockItemName) return;

    const item: StockItem = {
      id: editingStockItem ? editingStockItem.id : newId('stk'),
      sku: stockItemSku,
      name: stockItemName,
      type: stockItemType,
      categoryId: categories[0]?.id || 'cat-coffee',
      categoryName: categories[0]?.name || 'Umum',
      stock: stockItemQty,
      minStockAlert: stockItemMinQty,
      unit: stockItemUnit,
      costPrice: stockItemCostPrice,
      location: stockItemLocation,
      recipeYield: stockItemRecipeYield,
      notes: stockItemNotes,
      lastUpdated: new Date().toISOString(),
    };

    saveStockItem(item);
    setShowStockModal(false);
  };

  return (
    <div className="flex-1 bg-slate-50/70 p-6 overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-extrabold text-2xl text-slate-900 flex items-center space-x-2">
            <Package className="w-7 h-7 text-amber-600" />
            <span>Katalog & Inventori Stok</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Kelola produk, variasi harga, margin profit, serta pencatatan stok masuk/keluar.
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-2xl flex items-center space-x-2 shadow-xs text-xs transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah Produk Baru</span>
        </button>
      </div>

      {/* Low Stock Alert Banner */}
      {lowStockProducts.length > 0 && (
        <div className="bg-gradient-to-r from-rose-500/10 via-amber-500/10 to-rose-500/5 border-2 border-rose-500/30 rounded-3xl p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 bg-rose-600 text-white rounded-2xl shadow-xs animate-bounce">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-sm text-rose-900 flex items-center space-x-2">
                  <span>Peringatan Stok Menipis</span>
                  <span className="bg-rose-600 text-white font-mono text-[11px] font-bold px-2 py-0.5 rounded-full">
                    {lowStockProducts.length} Produk
                  </span>
                </h3>
                <p className="text-xs text-rose-700/90">
                  Produk-produk berikut telah mencapai atau berada di bawah batas stok minimum. Segera lakukan restok agar penjualan tidak terganggu.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setActiveSubTab('catalog');
                setStockFilter(stockFilter === 'low' ? 'all' : 'low');
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 border ${
                stockFilter === 'low'
                  ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                  : 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50'
              }`}
            >
              <AlertCircle className="w-4 h-4" />
              <span>{stockFilter === 'low' ? 'Tampilkan Semua Produk' : 'Filter Stok Menipis Saja'}</span>
            </button>
          </div>

          {/* Quick Restock Cards Carousel/Grid */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 pt-1 scrollbar-thin">
            {lowStockProducts.map((p) => (
              <div
                key={p.id}
                className="bg-white border border-rose-200 rounded-2xl p-2.5 shrink-0 min-w-[220px] flex items-center justify-between space-x-2 shadow-2xs hover:border-rose-400 transition-colors"
              >
                <div className="flex items-center space-x-2 truncate">
                  <img
                    src={p.image || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200'}
                    alt={p.name}
                    referrerPolicy="no-referrer"
                    className="w-8 h-8 rounded-lg object-cover bg-slate-100 shrink-0"
                  />
                  <div className="truncate">
                    <span className="font-bold text-xs text-slate-900 block truncate">{p.name}</span>
                    <span className="text-[10px] text-rose-600 font-bold font-mono">
                      Stok: {p.stock} / Min: {p.minStockAlert} {p.unit}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setStockAdjustProduct(p);
                    setStockQty(20);
                  }}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] px-2.5 py-1 rounded-xl shrink-0 transition-colors flex items-center space-x-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Restok</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subtabs Bar */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveSubTab('catalog')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
              activeSubTab === 'catalog'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Katalog Produk Jual ({products.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('stock')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
              activeSubTab === 'stock'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200'
            }`}
          >
            <Boxes className="w-4 h-4 text-amber-800" />
            <span>Manajemen Stok & Barang Setengah Jadi ({stockItems.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('logs')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
              activeSubTab === 'logs'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 bg-white border border-slate-200'
            }`}
          >
            <RefreshCw className="w-4 h-4" />
            <span>Log Mutasi Stok ({inventoryLogs.length})</span>
          </button>
        </div>

        {/* Quick Stock Alert Badge Toggle */}
        {lowStockProducts.length > 0 && (
          <button
            onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 border transition-all ${
              stockFilter === 'low'
                ? 'bg-rose-600 text-white border-rose-600'
                : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>Peringatan Stok ({lowStockProducts.length})</span>
          </button>
        )}
      </div>

      {activeSubTab === 'catalog' ? (
        <div className="space-y-4">
          {/* Search & Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[240px] relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari berdasarkan nama atau SKU..."
                className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex items-center space-x-2">
              {/* Filter Stock Status buttons */}
              <div className="flex bg-slate-200/80 p-1 rounded-xl space-x-1">
                <button
                  onClick={() => setStockFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                    stockFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Semua ({products.length})
                </button>
                <button
                  onClick={() => setStockFilter('low')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors flex items-center space-x-1 ${
                    stockFilter === 'low'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-rose-700 hover:bg-rose-100/50'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Menipis ({lowStockProducts.length})</span>
                </button>
              </div>

              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 font-medium"
              >
                <option value="all">Semua Kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Table Products Catalog */}
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">Produk</th>
                    <th className="p-3.5">Kategori</th>
                    <th className="p-3.5">Harga Jual</th>
                    <th className="p-3.5">Harga Modal</th>
                    <th className="p-3.5">Profit</th>
                    <th className="p-3.5">Stok Saat Ini</th>
                    <th className="p-3.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map((p) => {
                    const profit = p.price - p.costPrice;
                    const margin = Math.round((profit / p.price) * 100);
                    const isLow = p.stock <= p.minStockAlert;

                    return (
                      <tr
                        key={p.id}
                        className={`transition-colors ${
                          isLow
                            ? 'bg-rose-50/70 hover:bg-rose-100/70 border-l-4 border-l-rose-500'
                            : 'hover:bg-slate-50/60'
                        }`}
                      >
                        <td className="p-3.5">
                          <div className="flex items-center space-x-3">
                            <div className="relative">
                              <img
                                src={p.image || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200'}
                                alt={p.name}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded-xl object-cover bg-slate-100"
                              />
                              {isLow && (
                                <span
                                  className="absolute -top-1 -right-1 w-3 h-3 bg-rose-600 border-2 border-white rounded-full animate-ping"
                                  title="Stok Menipis!"
                                />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-slate-900 block">{p.name}</span>
                                {isLow && (
                                  <span className="bg-rose-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider flex items-center space-x-1">
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                    <span>Menipis</span>
                                  </span>
                                )}
                              </div>
                              {p.description && (
                                <span
                                  title={p.description}
                                  className="block text-[11px] text-slate-600 line-clamp-1 max-w-xs leading-snug"
                                >
                                  {p.description}
                                </span>
                              )}
                              <span className="font-mono text-[10px] text-slate-500">
                                SKU: {p.sku} • Barcode: {p.barcode}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="p-3.5 text-slate-600 font-medium">
                          {categories.find((c) => c.id === p.categoryId)?.name || 'General'}
                        </td>

                        <td className="p-3.5 font-bold text-amber-700 font-mono">
                          {formatRupiah(p.price)}
                        </td>

                        <td className="p-3.5 text-slate-600 font-mono">
                          {formatRupiah(p.costPrice)}
                        </td>

                        <td className="p-3.5 font-mono">
                          <span className="text-emerald-700 font-bold block">
                            +{formatRupiah(profit)}
                          </span>
                          <span className="text-[10px] text-slate-500">Margin {margin}%</span>
                        </td>

                        <td className="p-3.5">
                          <div className="flex flex-col">
                            <div className="flex items-center space-x-2">
                              <span
                                className={`font-mono font-extrabold text-sm ${
                                  isLow ? 'text-rose-600' : 'text-slate-900'
                                }`}
                              >
                                {p.stock} {p.unit}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">
                              Batas Min: {p.minStockAlert} {p.unit}
                            </span>
                          </div>
                        </td>

                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={() => {
                                setStockAdjustProduct(p);
                                setStockQty(20);
                              }}
                              className={`p-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                isLow
                                  ? 'bg-rose-600 text-white hover:bg-rose-700 border-rose-700 shadow-xs'
                                  : 'bg-slate-100 hover:bg-slate-200 text-amber-800 border-slate-200'
                              }`}
                              title="Restok Barang"
                            >
                              +Restok
                            </button>

                            <button
                              onClick={() => handleOpenEditModal(p)}
                              className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg border border-slate-200"
                            >
                              <Edit className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => {
                                if (confirm(`Hapus produk '${p.name}'?`)) {
                                  deleteProduct(p.id);
                                }
                              }}
                              className="p-1.5 text-rose-600 hover:text-rose-700 bg-rose-50 rounded-lg border border-rose-200"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : activeSubTab === 'stock' ? (
        /* Stock & WIP (Barang Setengah Jadi) Subtab */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs">
            <div className="flex items-center space-x-2">
              {[
                { id: 'ALL', label: 'Semua Stok' },
                { id: 'SETENGAH_JADI', label: '🧪 Barang Setengah Jadi (WIP)' },
                { id: 'BAHAN_BAKU', label: '📦 Bahan Baku (Raw Material)' },
                { id: 'JADI', label: '🏷️ Barang Jadi (Siap Jual)' },
              ].map((tf) => (
                <button
                  key={tf.id}
                  onClick={() => setStockTypeFilter(tf.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                    stockTypeFilter === tf.id
                      ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            <button
              onClick={handleOpenAddStockModal}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2 rounded-xl flex items-center space-x-2 text-xs shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Bahan / Barang Setengah Jadi</span>
            </button>
          </div>

          {/* Stock Table */}
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Nama Bahan / Item</th>
                    <th className="py-3 px-4">SKU / Kode</th>
                    <th className="py-3 px-4">Tipe Barang</th>
                    <th className="py-3 px-4 text-center">Jumlah Stok</th>
                    <th className="py-3 px-4">Harga Pokok (HPP)</th>
                    <th className="py-3 px-4">Lokasi Simpan</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                  {stockItems
                    .filter((stk) => stockTypeFilter === 'ALL' || stk.type === stockTypeFilter)
                    .map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{item.name}</div>
                          {item.recipeYield && (
                            <div className="text-[10px] text-amber-700 font-medium">
                              Hasil Olahan: {item.recipeYield}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600 text-[11px]">{item.sku}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border uppercase tracking-wide ${
                              item.type === 'SETENGAH_JADI'
                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                : item.type === 'BAHAN_BAKU'
                                ? 'bg-indigo-100 text-indigo-900 border-indigo-300'
                                : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                            }`}
                          >
                            {item.type === 'SETENGAH_JADI'
                              ? 'Setengah Jadi (WIP)'
                              : item.type === 'BAHAN_BAKU'
                              ? 'Bahan Baku'
                              : 'Barang Jadi'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold">
                          <span
                            className={`px-2 py-0.5 rounded-lg ${
                              item.stock <= item.minStockAlert
                                ? 'bg-rose-100 text-rose-800 font-extrabold'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {item.stock} {item.unit}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700">{formatRupiah(item.costPrice)}</td>
                        <td className="py-3 px-4 text-slate-600 text-[11px]">{item.location}</td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <button
                            onClick={() => {
                              const qtyAdd = Number(prompt(`Tambah/Kurang stok untuk ${item.name} (+ atau -):`, '5'));
                              if (qtyAdd) adjustStockItemQuantity(item.id, qtyAdd, 'Penyesuaian Manual');
                            }}
                            className="px-2 py-1 bg-emerald-100 text-emerald-800 font-bold text-[11px] rounded-lg hover:bg-emerald-200"
                          >
                            + Adjust
                          </button>
                          <button
                            onClick={() => handleOpenEditStockModal(item)}
                            className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg border border-slate-200"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Hapus stok ${item.name}?`)) deleteStockItem(item.id);
                            }}
                            className="p-1.5 text-rose-600 hover:text-rose-700 bg-rose-50 rounded-lg border border-rose-200"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Inventory Logs Subtab */
        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs p-5 space-y-3">
          <h3 className="font-bold text-sm text-amber-800">Log Audit Mutasi Stok</h3>

          <div className="space-y-2">
            {inventoryLogs.map((log) => (
              <div
                key={log.id}
                className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between text-xs"
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`p-2 rounded-xl ${
                      log.type === 'IN'
                        ? 'bg-emerald-100 text-emerald-800'
                        : log.type === 'OUT' || log.type === 'SALE'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {log.type === 'IN' ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900">{log.productName}</h4>
                    <p className="text-[10px] text-slate-500">
                      Alasan: {log.reason} • Oleh: {log.user}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono font-bold text-slate-900 block">
                    {log.type === 'IN' ? `+${log.quantity}` : `-${log.quantity}`}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Stok: {log.previousStock} → {log.newStock} ({formatDateTime(log.timestamp)})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full text-slate-900 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-amber-700">
                {editingProduct ? 'Edit Produk' : 'Tambah Produk Baru'}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-700 font-semibold">Nama Produk *</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Cth: Kopi Susu Aren"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 font-bold"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-700 font-semibold">
                    Deskripsi Produk
                  </label>
                  {/*
                    Penghitung ditampilkan hanya setelah pengguna mulai mengetik.
                    Menampilkan "0/300" pada kolom kosong membaca seperti kuota
                    yang harus dipenuhi, padahal kolom ini opsional.
                  */}
                  {formDescription.length > 0 && (
                    <span
                      className={`text-[10px] font-mono ${
                        formDescription.length > DESCRIPTION_MAX - 30
                          ? 'text-amber-600'
                          : 'text-slate-400'
                      }`}
                    >
                      {formDescription.length}/{DESCRIPTION_MAX}
                    </span>
                  )}
                </div>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                  rows={3}
                  placeholder="Cth: Espresso ganda dengan susu segar dan gula aren asli Jawa. Disajikan dingin."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 resize-y leading-relaxed"
                />
                <p className="text-[10px] text-slate-400">
                  Tampil di kartu produk kasir dan struk digital. Opsional.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">SKU</label>
                  <input
                    type="text"
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Barcode</label>
                  <input
                    type="text"
                    value={formBarcode}
                    onChange={(e) => setFormBarcode(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Harga Jual (Rp) *</label>
                  <input
                    type="number"
                    required
                    value={formPrice}
                    onChange={(e) => setFormPrice(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-amber-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Harga Modal (Rp) *</label>
                  <input
                    type="number"
                    required
                    value={formCostPrice}
                    onChange={(e) => setFormCostPrice(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Stok Awal</label>
                  <input
                    type="number"
                    value={formStock}
                    onChange={(e) => setFormStock(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Batas Min Stok</label>
                  <input
                    type="number"
                    value={formMinStock}
                    onChange={(e) => setFormMinStock(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Satuan Unit</label>
                  <input
                    type="text"
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    placeholder="cup / pcs"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-700 font-semibold">Kategori</label>
                <select
                  value={formCategoryId}
                  onChange={(e) => setFormCategoryId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Linked Raw Material / Recipe Yield Selection */}
              <div className="p-3 bg-amber-500/5 rounded-2xl border border-amber-200/80 space-y-2">
                <label className="text-xs text-amber-900 font-extrabold flex items-center space-x-1.5">
                  <ChefHat className="w-4 h-4 text-amber-600" />
                  <span>Tautkan Bahan Baku (Potong Stok Baku Saat Penjualan)</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <select
                      value={formLinkedStockItemId}
                      onChange={(e) => setFormLinkedStockItemId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-900"
                    >
                      <option value="">-- Tanpa Tautan Bahan Baku --</option>
                      {stockItems.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name} ({st.stock} {st.unit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={formRecipeQty}
                      onChange={(e) => setFormRecipeQty(Number(e.target.value))}
                      placeholder="Jml Resep"
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Photo Upload & Preview Section */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <label className="text-xs text-slate-800 font-extrabold flex items-center justify-between">
                  <span>Foto / Gambar Produk</span>
                  <span className="text-[10px] font-normal text-slate-400">Upload dari Perangkat / Pakai URL</span>
                </label>

                <div className="flex items-start space-x-3">
                  {/* Thumbnail Preview */}
                  <div className="w-20 h-20 bg-slate-100 rounded-2xl border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center relative group">
                    {formImage ? (
                      <>
                        <img
                          src={formImage}
                          alt="Preview"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => setFormImage('')}
                          className="absolute inset-0 bg-slate-900/60 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        >
                          Hapus Foto
                        </button>
                      </>
                    ) : (
                      <Image className="w-8 h-8 text-slate-300 stroke-1" />
                    )}
                  </div>

                  <div className="flex-1 space-y-2">
                    {/* File Upload Button */}
                    <label className="inline-flex items-center space-x-2 px-3.5 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 border border-amber-300 rounded-xl text-xs font-extrabold cursor-pointer transition-colors shadow-2xs">
                      <Upload className="w-4 h-4 text-amber-700" />
                      <span>Upload Foto Produk...</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleProductImageUpload}
                        className="hidden"
                      />
                    </label>

                    {/* Or URL Input */}
                    <div>
                      <input
                        type="text"
                        value={formImage}
                        onChange={(e) => setFormImage(e.target.value)}
                        placeholder="Atau tempelkan URL gambar (https://...)"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-xs"
                >
                  Simpan Produk
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjust Modal */}
      {stockAdjustProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 max-w-sm w-full text-slate-900 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-amber-700">
              Penyesuaian Stok: {stockAdjustProduct.name}
            </h3>

            <form onSubmit={handleConfirmStockAdjust} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Tipe Perubahan</label>
                <select
                  value={stockType}
                  onChange={(e) => setStockType(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
                >
                  <option value="IN">Tambah Stok (Stok Masuk)</option>
                  <option value="OUT">Kurangi Stok (Kerusakan/Spill)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Jumlah Unit</label>
                <input
                  type="number"
                  min="1"
                  value={stockQty}
                  onChange={(e) => setStockQty(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Alasan / Catatan</label>
                <input
                  type="text"
                  value={stockReason}
                  onChange={(e) => setStockReason(e.target.value)}
                  placeholder="Restok dari supplier..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStockAdjustProduct(null)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-xs"
                >
                  Konfirmasi Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Stock Item Modal (Bahan Baku / Setengah Jadi) */}
      {showStockModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full text-slate-900 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-amber-700">
                {editingStockItem ? 'Edit Item Stok' : 'Tambah Bahan / Barang Setengah Jadi'}
              </h3>
              <button
                type="button"
                onClick={() => setShowStockModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStockItemSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-700 font-semibold">Nama Bahan / Item *</label>
                <input
                  type="text"
                  required
                  value={stockItemName}
                  onChange={(e) => setStockItemName(e.target.value)}
                  placeholder="Contoh: Konsentrat Espresso Mix / Sirup Caramel Cold Brew"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Tipe Stok *</label>
                  <select
                    value={stockItemType}
                    onChange={(e) => setStockItemType(e.target.value as StockType)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="SETENGAH_JADI">🧪 Barang Setengah Jadi (WIP)</option>
                    <option value="BAHAN_BAKU">📦 Bahan Baku (Raw Material)</option>
                    <option value="JADI">🏷️ Barang Jadi (Siap Jual)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">SKU / Kode Stok</label>
                  <input
                    type="text"
                    value={stockItemSku}
                    onChange={(e) => setStockItemSku(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Jumlah Stok</label>
                  <input
                    type="number"
                    min="0"
                    value={stockItemQty}
                    onChange={(e) => setStockItemQty(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Satuan (Unit)</label>
                  <input
                    type="text"
                    value={stockItemUnit}
                    onChange={(e) => setStockItemUnit(e.target.value)}
                    placeholder="Liter, Kg, Batch, Pcs"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Min. Alert</label>
                  <input
                    type="number"
                    min="0"
                    value={stockItemMinQty}
                    onChange={(e) => setStockItemMinQty(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Harga Pokok (HPP) Rp</label>
                  <input
                    type="number"
                    min="0"
                    value={stockItemCostPrice}
                    onChange={(e) => setStockItemCostPrice(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Lokasi Penyimpanan</label>
                  <input
                    type="text"
                    value={stockItemLocation}
                    onChange={(e) => setStockItemLocation(e.target.value)}
                    placeholder="Chiller Bar / Rak Dapur B"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-700 font-semibold">Rasio Resep / Yield Olahan (Opsional)</label>
                <input
                  type="text"
                  value={stockItemRecipeYield}
                  onChange={(e) => setStockItemRecipeYield(e.target.value)}
                  placeholder="Contoh: 1 Liter = 20 porsi Kopi Susu Aren"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowStockModal(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs"
                >
                  Simpan Stok
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
