import React, { useState, useEffect, useRef } from 'react';
import { usePOS } from '../../context/POSContext';
import { Product, ProductBundle } from '../../types';
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
  Sparkles,
  Camera,
  CheckCircle2,
  Zap,
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
    bundles,
    addToCart,
  } = usePOS();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [scanToast, setScanToast] = useState<{ name: string; barcode: string } | null>(null);

  // Global Hardware USB / Bluetooth Barcode Scanner Listener
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      const currentTime = Date.now();
      if (currentTime - lastKeyTime > 100) {
        buffer = ''; // Reset buffer if typing was slow (manual typing)
      }
      lastKeyTime = currentTime;

      if (e.key === 'Enter') {
        if (buffer.length >= 3) {
          e.preventDefault();
          const cleanCode = buffer.trim();
          const found = products.find(
            (p) => p.barcode === cleanCode || p.sku.toLowerCase() === cleanCode.toLowerCase()
          );
          if (found) {
            onSelectProduct(found);
            setScanToast({ name: found.name, barcode: cleanCode });
            setTimeout(() => setScanToast(null), 3000);
          }
        }
        buffer = '';
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [products, onSelectProduct]);

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

  // Handle Barcode Scan Manual/Submit
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput) return;
    const found = products.find(
      (p) => p.barcode === barcodeInput || p.sku.toLowerCase() === barcodeInput.toLowerCase()
    );
    if (found) {
      onSelectProduct(found);
      setScanToast({ name: found.name, barcode: barcodeInput });
      setTimeout(() => setScanToast(null), 3000);
      setBarcodeInput('');
      setShowBarcodeModal(false);
    } else {
      alert(`Produk dengan Barcode/SKU '${barcodeInput}' tidak ditemukan.`);
    }
  };

  return (
    <div className="nh-product-grid flex-1 flex flex-col h-full bg-slate-50/70 p-4 space-y-4 overflow-hidden">
      <div className="nh-app-pos-heading"><div><h1>Kasir</h1><p>Pilih produk, buat pesanan, lanjutkan pembayaran.</p></div><span>{filteredProducts.length} produk</span></div>
      {/* Search & Toolbar Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Search Input for Mobile/Tablet */}
        <div className="flex-1 min-w-[200px] relative md:hidden">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Cari produk"
            placeholder="Cari produk..."
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-xs"
          />
        </div>

        {/* Filter Badges & Fast Scan Barcode */}
        <div className="flex items-center space-x-2">
          {/* USB Scanner Ready Pill */}
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-[11px] font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Scanner siap</span>
          </div>

          <button
            onClick={() => setShowBarcodeModal(true)}
            className="flex items-center space-x-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-semibold transition-colors shadow-xs cursor-pointer"
            title="Ketik manual Barcode atau SKU"
          >
            <ScanBarcode className="w-4 h-4 text-amber-600" />
            <span className="hidden sm:inline">Ketik Barcode</span>
          </button>

          <button
            onClick={() => setShowCameraScanner(true)}
            className="flex items-center space-x-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 px-3 py-2 rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer"
            title="Scan Cepat Barcode dengan Kamera"
          >
            <Camera className="w-4 h-4 text-amber-600" />
            <span className="hidden sm:inline">Kamera Scan</span>
          </button>

          <button
            aria-label="Filter stok menipis"
            aria-pressed={onlyLowStock}
            onClick={() => setOnlyLowStock(!onlyLowStock)}
            className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors shadow-xs cursor-pointer ${
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
              aria-label="Tampilan kartu" aria-pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                viewMode === 'grid' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              aria-label="Tampilan daftar" aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                viewMode === 'list' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Instant Scan Success Toast Notification */}
      {scanToast && (
        <div className="bg-emerald-600 text-white px-4 py-2.5 rounded-2xl shadow-lg flex items-center justify-between text-xs font-bold animate-slide-down">
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-amber-300 fill-amber-300 animate-pulse" />
            <span>⚡ Produk Ter-Scan: <strong>{scanToast.name}</strong> (Barcode: <span className="font-mono">{scanToast.barcode}</span>)</span>
          </div>
          <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-md flex items-center space-x-1">
            <CheckCircle2 className="w-3 h-3 text-white" />
            <span>Masuk Keranjang</span>
          </span>
        </div>
      )}

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

        <button
          onClick={() => setSelectedCategory('bundles')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            selectedCategory === 'bundles'
              ? 'bg-amber-500 text-slate-950 shadow-xs font-bold'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-600" />
          <span>🎁 Paket Bundling ({bundles?.length || 0})</span>
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
      <div className="flex-1 overflow-y-auto pr-1 pb-32 lg:pb-4">
        {selectedCategory === 'bundles' ? (
          (bundles || []).length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-center space-y-2">
              <Sparkles className="w-10 h-10 stroke-1 text-slate-300" />
              <p className="font-semibold text-slate-600">Belum ada paket bundling aktif</p>
              <p className="text-xs text-slate-400">Buat paket bundling di menu Manajemen Inventori.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(bundles || []).map((bundle) => (
                <div
                  key={bundle.id}
                  onClick={() => {
                    const bundleProd: Product = {
                      id: bundle.id,
                      sku: bundle.sku,
                      name: `[PAKET] ${bundle.name}`,
                      categoryId: 'cat-bundle',
                      price: bundle.bundlePrice,
                      costPrice: Math.round(bundle.bundlePrice * 0.5),
                      stock: 99,
                      minStockAlert: 5,
                      unit: 'paket',
                      image: bundle.image,
                      description: bundle.description,
                      isAvailable: true,
                    };
                    addToCart(bundleProd);
                  }}
                  className="bg-white border-2 border-amber-400/80 hover:border-amber-500 p-3.5 rounded-2xl cursor-pointer transition-all shadow-xs hover:shadow-md space-y-3 relative group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center space-x-2.5">
                      <img
                        src={bundle.image || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200'}
                        alt={bundle.name}
                        className="w-11 h-11 rounded-xl object-cover bg-slate-100 shrink-0 border border-slate-200"
                      />
                      <div>
                        <span className="font-mono text-[10px] font-bold text-slate-400 block">{bundle.sku}</span>
                        <h4 className="font-black text-xs text-slate-950 leading-snug">{bundle.name}</h4>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-lg bg-amber-500 text-slate-950 font-black text-[10px] shrink-0">
                      Hemat {bundle.discountPercent}%
                    </span>
                  </div>

                  <div className="p-2 bg-slate-50 rounded-xl text-[11px] space-y-0.5 text-slate-700 font-medium">
                    {bundle.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>• {item.quantity}x {item.productName}</span>
                        <span className="font-mono text-slate-400">{formatRupiah(item.subtotalPrice)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-400 line-through font-bold font-mono block">
                        {formatRupiah(bundle.regularPrice)}
                      </span>
                      <span className="font-mono font-black text-sm text-slate-950">
                        {formatRupiah(bundle.bundlePrice)}
                      </span>
                    </div>
                    <span className="bg-amber-500 group-hover:bg-amber-400 text-slate-950 font-black text-xs px-3 py-1.5 rounded-xl flex items-center space-x-1 shadow-2xs">
                      <span>+ Tambah</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : filteredProducts.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-center space-y-2">
            <Search className="w-10 h-10 stroke-1 text-slate-300" />
            <p className="font-semibold text-slate-600">Tidak ada produk ditemukan</p>
            <p className="text-xs text-slate-400">Coba ubah kata kunci pencarian atau ganti kategori.</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
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

      {/* Camera Barcode Scanner Modal */}
      {showCameraScanner && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full text-slate-900 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-amber-900 flex items-center space-x-2">
                <Camera className="w-5 h-5 text-amber-600" />
                <span>Kamera Scanner Barcode Cepat</span>
              </h3>
              <button
                onClick={() => setShowCameraScanner(false)}
                className="text-slate-400 hover:text-slate-700 text-sm p-1 rounded-lg hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            {/* Simulated Camera Viewport with Red Laser Line */}
            <div className="relative w-full h-48 bg-slate-950 rounded-2xl overflow-hidden flex flex-col items-center justify-center border-2 border-amber-500/50 shadow-inner">
              {/* Corner reticles */}
              <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-amber-400"></div>
              <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-amber-400"></div>
              <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-amber-400"></div>
              <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-amber-400"></div>

              {/* Scanning Laser animation */}
              <div className="absolute left-6 right-6 h-0.5 bg-red-500 shadow-[0_0_12px_#ef4444] animate-pulse"></div>

              <ScanBarcode className="w-16 h-16 text-slate-600 opacity-40 mb-2" />
              <p className="text-[11px] text-amber-300 font-bold z-10 text-center px-4">
                Arahkan Barcode atau QR Code produk ke dalam kotak bidik
              </p>
              <span className="text-[10px] text-slate-400 mt-1">Auto-focus aktif • Sensor 60 FPS</span>
            </div>

            {/* Quick 1-Click Scan Triggers from Catalog */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">Simulasi Tembak Barcode Produk:</span>
                <span className="text-[10px] text-slate-400 font-medium">Klik untuk uji coba</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-1">
                {products.filter((p) => p.barcode).slice(0, 6).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onSelectProduct(p);
                      setScanToast({ name: p.name, barcode: p.barcode || p.sku });
                      setTimeout(() => setScanToast(null), 3000);
                      setShowCameraScanner(false);
                    }}
                    className="p-2 text-left bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-xl transition-all text-xs"
                  >
                    <p className="font-bold text-slate-900 truncate">{p.name}</p>
                    <p className="font-mono text-[10px] text-amber-700 font-bold">{p.barcode}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowCameraScanner(false)}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-colors"
              >
                Tutup Kamera
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
