import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { Product } from '../../types';
import { ProductCard } from './ProductCard';
import {
  Search,
  ScanBarcode,
  LayoutGrid,
  List,
  AlertTriangle,
  Coffee,
  CupSoda,
  Utensils,
  Pizza,
  Cake,
  ShoppingBag,
  Layers,
} from 'lucide-react';
import { formatRupiah } from '../../utils/formatters';

interface ProductGridProps {
  onSelectProduct: (product: Product) => void;
}

export const ProductGrid: React.FC<ProductGridProps> = ({ onSelectProduct }) => {
  const {
    products,
    categories,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
  } = usePOS();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);

  // Icon map for categories
  const getCategoryIcon = (iconName: string) => {
    switch (iconName) {
      case 'Coffee':
        return <Coffee className="w-4 h-4" />;
      case 'CupSoda':
        return <CupSoda className="w-4 h-4" />;
      case 'Utensils':
        return <Utensils className="w-4 h-4" />;
      case 'Pizza':
        return <Pizza className="w-4 h-4" />;
      case 'Cake':
        return <Cake className="w-4 h-4" />;
      case 'ShoppingBag':
        return <ShoppingBag className="w-4 h-4" />;
      default:
        return <Layers className="w-4 h-4" />;
    }
  };

  // Filter logic
  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      selectedCategory === 'all' || product.categoryId === selectedCategory;
    const matchesSearch =
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.barcode && product.barcode.includes(searchQuery));
    const matchesLowStock = onlyLowStock ? product.stock <= product.minStockAlert : true;

    return matchesCategory && matchesSearch && matchesLowStock;
  });

  // Handle Barcode Scan Simulation
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput) return;
    const found = products.find(
      (p) => p.barcode === barcodeInput || p.sku.toLowerCase() === barcodeInput.toLowerCase()
    );
    if (found) {
      onSelectProduct(found);
      setBarcodeInput('');
      setShowBarcodeModal(false);
    } else {
      alert(`Produk dengan Barcode/SKU '${barcodeInput}' tidak ditemukan.`);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50/70 p-4 space-y-4 overflow-hidden">
      {/* Search & Toolbar Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Search Input for Mobile/Tablet */}
        <div className="flex-1 min-w-[200px] relative md:hidden">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari produk..."
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-xs"
          />
        </div>

        {/* Filter Badges & Scan Barcode */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowBarcodeModal(true)}
            className="flex items-center space-x-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition-colors shadow-xs"
          >
            <ScanBarcode className="w-4 h-4 text-amber-600" />
            <span className="hidden sm:inline">Scan Barcode</span>
          </button>

          <button
            onClick={() => setOnlyLowStock(!onlyLowStock)}
            className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors shadow-xs ${
              onlyLowStock
                ? 'bg-rose-50 text-rose-700 border-rose-300'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <span className="hidden sm:inline">Stok Menipis</span>
          </button>

          {/* View Switcher */}
          <div className="flex items-center bg-white border border-slate-200 p-1 rounded-xl shadow-xs">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'grid' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'list' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Category Filter Pills Bar */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-200">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            selectedCategory === 'all'
              ? 'bg-amber-500 text-slate-950 shadow-xs font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Semua Menu ({products.length})</span>
        </button>

        {categories.map((cat) => {
          const count = products.filter((p) => p.categoryId === cat.id).length;
          const isSelected = selectedCategory === cat.id;

          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                isSelected
                  ? 'bg-amber-500 text-slate-950 shadow-xs font-bold'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {getCategoryIcon(cat.icon)}
              <span>
                {cat.name} ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Product Display Area */}
      <div className="flex-1 overflow-y-auto pr-1">
        {filteredProducts.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-center space-y-2">
            <Search className="w-10 h-10 stroke-1 text-slate-300" />
            <p className="font-semibold text-slate-600">Tidak ada produk ditemukan</p>
            <p className="text-xs text-slate-400">Coba ubah kata kunci pencarian atau ganti kategori.</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onSelect={onSelectProduct}
              />
            ))}
          </div>
        ) : (
          /* List View Format */
          <div className="space-y-2">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                onClick={() => product.stock > 0 && onSelectProduct(product)}
                className={`bg-white border border-slate-200 hover:border-amber-400 p-3 rounded-2xl flex items-center justify-between cursor-pointer transition-all shadow-xs ${
                  product.stock <= 0 ? 'opacity-50 cursor-not-allowed bg-slate-50' : ''
                }`}
              >
                <div className="flex items-center space-x-3">
                  <img
                    src={product.image || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200'}
                    alt={product.name}
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 rounded-xl object-cover bg-slate-100"
                  />
                  <div>
                    <h4 className="font-semibold text-sm text-slate-900">{product.name}</h4>
                    <p className="text-xs text-slate-500">
                      SKU: {product.sku} • Stok: {product.stock} {product.unit}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-bold text-sm text-amber-600">{formatRupiah(product.price)}</span>
                  <span className="block text-[10px] text-slate-400">+ Tambah Order</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Barcode Scanner Modal Simulation */}
      {showBarcodeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-sm w-full text-slate-900 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-amber-700 flex items-center space-x-2">
                <ScanBarcode className="w-5 h-5 text-amber-600" />
                <span>Simulasi Barcode Scanner</span>
              </h3>
              <button
                onClick={() => setShowBarcodeModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Ketikkan Barcode atau SKU produk (contoh: <code className="text-amber-700 font-mono font-semibold bg-amber-50 px-1 py-0.5 rounded">8991001001</code> atau <code className="text-amber-700 font-mono font-semibold bg-amber-50 px-1 py-0.5 rounded">KPN-001</code>):
            </p>

            <form onSubmit={handleBarcodeSubmit} className="space-y-3">
              <input
                type="text"
                autoFocus
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="Barcode / SKU..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
              />
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowBarcodeModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-xl shadow-xs"
                >
                  Tambah Ke Cart
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
