import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { Product, StockItem, StockType, ProductBundle, RecipeIngredient, BundleItem } from '../../types';
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
  Sparkles,
  UtensilsCrossed,
  Tag,
  Percent,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  Info,
} from 'lucide-react';

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
    bundles,
    saveBundle,
    deleteBundle,
  } = usePOS();

  const [activeSubTab, setActiveSubTab] = useState<'catalog' | 'bundles' | 'stock' | 'recipes' | 'logs'>('catalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'low'>('all');
  const [stockTypeFilter, setStockTypeFilter] = useState<'ALL' | StockType>('ALL');

  // Modal for Add/Edit Stock Item (Bahan Baku / Setengah Jadi / Jadi)
  const [showStockModal, setShowStockModal] = useState(false);
  const [editingStockItem, setEditingStockItem] = useState<StockItem | null>(null);
  const [stockItemName, setStockItemName] = useState('');
  const [stockItemSku, setStockItemSku] = useState('');
  const [stockItemType, setStockItemType] = useState<StockType>('BAHAN_BAKU');
  const [stockItemUnit, setStockItemUnit] = useState('Gram');
  const [stockItemQty, setStockItemQty] = useState(1000);
  const [stockItemMinQty, setStockItemMinQty] = useState(200);
  const [stockItemCostPrice, setStockItemCostPrice] = useState(150); // e.g. Rp 150 / gram
  const [stockItemLocation, setStockItemLocation] = useState('Gudang Bahan Kering');
  const [stockItemRecipeYield, setStockItemRecipeYield] = useState('');
  const [stockItemNotes, setStockItemNotes] = useState('');

  // Modal for Add/Edit Product
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
  const [formCategoryId, setFormCategoryId] = useState(categories[0]?.id || 'cat-makanan');
  const [formPrice, setFormPrice] = useState(25000);
  const [formCostPrice, setFormCostPrice] = useState(12000);
  const [formStock, setFormStock] = useState(50);
  const [formMinStock, setFormMinStock] = useState(10);
  const [formUnit, setFormUnit] = useState('porsi');
  const [formImage, setFormImage] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // Modal & Form for Multi-Ingredient Recipe Linking (BOM)
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [recipeProduct, setRecipeProduct] = useState<Product | null>(null);
  const [recipeIngredientsList, setRecipeIngredientsList] = useState<RecipeIngredient[]>([]);

  // Modal & Form for Product Bundling (Paket Combo)
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [editingBundle, setEditingBundle] = useState<ProductBundle | null>(null);
  const [bundleName, setBundleName] = useState('');
  const [bundleSku, setBundleSku] = useState('');
  const [bundleDescription, setBundleDescription] = useState('');
  const [bundleImage, setBundleImage] = useState('');
  const [bundlePrice, setBundlePrice] = useState(35000);
  const [bundleItemsList, setBundleItemsList] = useState<BundleItem[]>([]);

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

  const filteredStockItems = stockItems.filter((s) => {
    const matchesType = stockTypeFilter === 'ALL' || s.type === stockTypeFilter;
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  const filteredBundles = (bundles || []).filter((b) => {
    return (
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.sku.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  /* -------------------------------------------------------------------------- */
  /* PRODUCT ACTIONS                                                            */
  /* -------------------------------------------------------------------------- */

  const handleOpenAddModal = () => {
    setFormName('');
    setFormSku(`SKU-${Math.floor(1000 + Math.random() * 9000)}`);
    setFormBarcode(`899${Math.floor(1000000 + Math.random() * 9000000)}`);
    setFormCategoryId(categories[0]?.id || 'cat-makanan');
    setFormPrice(25000);
    setFormCostPrice(12000);
    setFormStock(50);
    setFormMinStock(10);
    setFormUnit('porsi');
    setFormImage('https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=400');
    setFormDescription('');
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
      description: formDescription.trim() || undefined,
      isAvailable: true,
      variants: editingProduct?.variants || [
        { id: 'v-1', name: 'Regular', priceExtra: 0 },
        { id: 'v-2', name: 'Large', priceExtra: 5000 },
      ],
      modifierGroups: editingProduct?.modifierGroups,
      recipeIngredients: editingProduct?.recipeIngredients,
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

  /* -------------------------------------------------------------------------- */
  /* STOCK ITEM (RAW MATERIAL) ACTIONS                                          */
  /* -------------------------------------------------------------------------- */

  const handleOpenAddStockModal = () => {
    setEditingStockItem(null);
    setStockItemName('');
    setStockItemSku(`RAW-${Math.floor(100 + Math.random() * 900)}`);
    setStockItemType('BAHAN_BAKU');
    setStockItemUnit('Gram');
    setStockItemQty(1000);
    setStockItemMinQty(200);
    setStockItemCostPrice(160);
    setStockItemLocation('Gudang Bahan Kering');
    setStockItemRecipeYield('');
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
      categoryId: categories[0]?.id || 'cat-makanan',
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

  /* -------------------------------------------------------------------------- */
  /* MULTI-INGREDIENT RECIPE LINKING (BOM) ACTIONS                              */
  /* -------------------------------------------------------------------------- */

  const handleOpenRecipeModal = (p: Product) => {
    setRecipeProduct(p);
    setRecipeIngredientsList(p.recipeIngredients || []);
    setShowRecipeModal(true);
  };

  const handleAddIngredientRow = () => {
    const defaultStock = stockItems[0];
    if (!defaultStock) {
      alert('Tambahkan bahan baku di tab "Bahan Baku & Mentah" terlebih dahulu!');
      return;
    }

    const newItem: RecipeIngredient = {
      ingredientId: defaultStock.id,
      ingredientName: defaultStock.name,
      quantity: 1,
      unit: defaultStock.unit,
      costPerUnit: defaultStock.costPrice,
      subtotalCost: defaultStock.costPrice * 1,
    };
    setRecipeIngredientsList([...recipeIngredientsList, newItem]);
  };

  const handleUpdateIngredientRow = (index: number, field: string, value: any) => {
    const updated = [...recipeIngredientsList];
    const row = { ...updated[index] };

    if (field === 'ingredientId') {
      const selectedStock = stockItems.find((s) => s.id === value);
      if (selectedStock) {
        row.ingredientId = selectedStock.id;
        row.ingredientName = selectedStock.name;
        row.unit = selectedStock.unit;
        row.costPerUnit = selectedStock.costPrice;
        row.subtotalCost = row.quantity * selectedStock.costPrice;
      }
    } else if (field === 'quantity') {
      const qty = Math.max(0.01, Number(value) || 0);
      row.quantity = qty;
      row.subtotalCost = Math.round(qty * row.costPerUnit);
    }

    updated[index] = row;
    setRecipeIngredientsList(updated);
  };

  const handleRemoveIngredientRow = (index: number) => {
    setRecipeIngredientsList(recipeIngredientsList.filter((_, i) => i !== index));
  };

  const totalCalculatedCOGS = recipeIngredientsList.reduce((sum, item) => sum + item.subtotalCost, 0);

  const handleSaveRecipe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeProduct) return;

    const updatedProduct: Product = {
      ...recipeProduct,
      recipeIngredients: recipeIngredientsList,
      costPrice: totalCalculatedCOGS > 0 ? totalCalculatedCOGS : recipeProduct.costPrice,
    };

    saveProduct(updatedProduct);
    setShowRecipeModal(false);
  };

  /* -------------------------------------------------------------------------- */
  /* PRODUCT BUNDLING ACTIONS                                                   */
  /* -------------------------------------------------------------------------- */

  const handleOpenAddBundleModal = () => {
    setEditingBundle(null);
    setBundleName('');
    setBundleSku(`BUN-${Math.floor(100 + Math.random() * 900)}`);
    setBundleDescription('');
    setBundleImage('https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=400');
    setBundlePrice(35000);

    // Initial item row
    const firstProd = products[0];
    if (firstProd) {
      setBundleItemsList([
        {
          productId: firstProd.id,
          productName: firstProd.name,
          quantity: 1,
          unitPrice: firstProd.price,
          subtotalPrice: firstProd.price,
        },
      ]);
    } else {
      setBundleItemsList([]);
    }
    setShowBundleModal(true);
  };

  const handleOpenEditBundleModal = (b: ProductBundle) => {
    setEditingBundle(b);
    setBundleName(b.name);
    setBundleSku(b.sku);
    setBundleDescription(b.description || '');
    setBundleImage(b.image || '');
    setBundlePrice(b.bundlePrice);
    setBundleItemsList(b.items || []);
    setShowBundleModal(true);
  };

  const handleAddBundleItemRow = () => {
    const firstProd = products[0];
    if (!firstProd) return;
    const newItem: BundleItem = {
      productId: firstProd.id,
      productName: firstProd.name,
      quantity: 1,
      unitPrice: firstProd.price,
      subtotalPrice: firstProd.price,
    };
    setBundleItemsList([...bundleItemsList, newItem]);
  };

  const handleUpdateBundleItemRow = (index: number, field: string, value: any) => {
    const updated = [...bundleItemsList];
    const row = { ...updated[index] };

    if (field === 'productId') {
      const selectedProd = products.find((p) => p.id === value);
      if (selectedProd) {
        row.productId = selectedProd.id;
        row.productName = selectedProd.name;
        row.unitPrice = selectedProd.price;
        row.subtotalPrice = row.quantity * selectedProd.price;
      }
    } else if (field === 'quantity') {
      const qty = Math.max(1, parseInt(value) || 1);
      row.quantity = qty;
      row.subtotalPrice = qty * row.unitPrice;
    }

    updated[index] = row;
    setBundleItemsList(updated);
  };

  const handleRemoveBundleItemRow = (index: number) => {
    setBundleItemsList(bundleItemsList.filter((_, i) => i !== index));
  };

  const totalBundleRegularPrice = bundleItemsList.reduce((sum, item) => sum + item.subtotalPrice, 0);
  const bundleDiscountPercent =
    totalBundleRegularPrice > 0
      ? Math.max(0, Math.round(((totalBundleRegularPrice - bundlePrice) / totalBundleRegularPrice) * 100))
      : 0;

  const handleSaveBundleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bundleName || bundleItemsList.length === 0) {
      alert('Nama paket dan minimal 1 produk penyusun harus diisi!');
      return;
    }

    const bundleToSave: ProductBundle = {
      id: editingBundle ? editingBundle.id : newId('bun'),
      sku: bundleSku,
      name: bundleName,
      description: bundleDescription.trim() || undefined,
      image: bundleImage || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=400',
      items: bundleItemsList,
      regularPrice: totalBundleRegularPrice,
      bundlePrice: bundlePrice,
      discountPercent: bundleDiscountPercent,
      isAvailable: true,
      createdAt: editingBundle?.createdAt || new Date().toISOString(),
    };

    saveBundle(bundleToSave);
    setShowBundleModal(false);
  };

  return (
    <div className="flex-1 bg-slate-50/70 p-6 overflow-y-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-black text-2xl text-slate-950 flex items-center space-x-2.5">
            <Package className="w-7 h-7 text-amber-600" />
            <span>Katalog, Resep &amp; Paket Bundling</span>
          </h2>
          <p className="text-xs text-slate-600 font-medium mt-1">
            Kelola produk jadi, racikan resep multi-bahan baku (BOM), dan paket promo bundling untuk kasir.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {activeSubTab === 'catalog' && (
            <button
              onClick={handleOpenAddModal}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2.5 rounded-2xl flex items-center space-x-2 shadow-xs text-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Produk Baru</span>
            </button>
          )}

          {activeSubTab === 'bundles' && (
            <button
              onClick={handleOpenAddBundleModal}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2.5 rounded-2xl flex items-center space-x-2 shadow-xs text-xs transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Buat Paket Bundling Baru</span>
            </button>
          )}

          {activeSubTab === 'stock' && (
            <button
              onClick={handleOpenAddStockModal}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2.5 rounded-2xl flex items-center space-x-2 shadow-xs text-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Bahan Baku</span>
            </button>
          )}
        </div>
      </div>

      {/* Subtabs Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveSubTab('catalog')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 cursor-pointer ${
            activeSubTab === 'catalog'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Package className="w-4 h-4 text-amber-500" />
          <span>Katalog Produk Jadi ({products.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('bundles')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 cursor-pointer ${
            activeSubTab === 'bundles'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span>Paket Bundling Promo ({bundles?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('recipes')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 cursor-pointer ${
            activeSubTab === 'recipes'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <UtensilsCrossed className="w-4 h-4 text-amber-500" />
          <span>Penautan Bahan Baku &amp; Resep (BOM)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('stock')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 cursor-pointer ${
            activeSubTab === 'stock'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Boxes className="w-4 h-4 text-amber-500" />
          <span>Bahan Baku &amp; Mentah ({stockItems.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('logs')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 cursor-pointer ${
            activeSubTab === 'logs'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4 text-amber-500" />
          <span>Riwayat Mutasi Stok ({inventoryLogs.length})</span>
        </button>
      </div>

      {/* SEARCH BAR & CATEGORY FILTER */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activeSubTab === 'bundles'
                ? 'Cari nama paket bundling / SKU promo…'
                : activeSubTab === 'stock'
                ? 'Cari nama bahan mentah / SKU…'
                : 'Cari nama menu produk, SKU, barcode…'
            }
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
          />
        </div>

        {activeSubTab === 'catalog' && (
          <div className="flex items-center space-x-2 overflow-x-auto">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-amber-500 text-slate-950 font-black'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Semua Kategori
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCategory(c.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  selectedCategory === c.id
                    ? 'bg-amber-500 text-slate-950 font-black'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------------- */}
      {/* 1. SUBTAB: KATALOG PRODUK JADI                                         */}
      {/* ---------------------------------------------------------------------- */}
      {activeSubTab === 'catalog' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/90 text-slate-700 font-black uppercase text-[11px] border-b border-slate-200">
                <tr>
                  <th className="p-4">Foto &amp; Produk</th>
                  <th className="p-4">Kategori</th>
                  <th className="p-4 text-right">Harga Jual</th>
                  <th className="p-4 text-right">HPP (Modal)</th>
                  <th className="p-4 text-right">Estimasi Margin</th>
                  <th className="p-4 text-center">Stok</th>
                  <th className="p-4 text-center">Bahan Baku (BOM)</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((p) => {
                  const profit = p.price - (p.costPrice || 0);
                  const marginPct = p.price > 0 ? Math.round((profit / p.price) * 100) : 0;
                  const hasIngredients = (p.recipeIngredients || []).length > 0;

                  return (
                    <tr key={p.id} className="hover:bg-amber-50/30 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center space-x-3">
                          <img
                            src={p.image || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200'}
                            alt={p.name}
                            className="w-10 h-10 rounded-xl object-cover bg-slate-100 shrink-0 border border-slate-200"
                          />
                          <div>
                            <span className="font-black text-slate-950 block text-sm">{p.name}</span>
                            <span className="font-mono text-slate-500 text-[11px] font-bold">{p.sku}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 font-bold text-slate-700">
                        {categories.find((c) => c.id === p.categoryId)?.name || 'Umum'}
                      </td>
                      <td className="p-4 text-right font-mono font-black text-slate-950 text-sm">
                        {formatRupiah(p.price)}
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-slate-600">
                        {formatRupiah(p.costPrice || 0)}
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          {marginPct}% ({formatRupiah(profit)})
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span
                          className={`font-mono font-black px-2.5 py-1 rounded-full text-xs border ${
                            p.stock <= p.minStockAlert
                              ? 'bg-rose-100 text-rose-950 border-rose-300'
                              : 'bg-slate-100 text-slate-900 border-slate-200'
                          }`}
                        >
                          {p.stock} {p.unit}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        {hasIngredients ? (
                          <button
                            onClick={() => handleOpenRecipeModal(p)}
                            className="px-2.5 py-1 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-950 font-black text-[11px] border border-emerald-300 transition-colors cursor-pointer"
                          >
                            ✓ {p.recipeIngredients?.length} Bahan Tertaut
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenRecipeModal(p)}
                            className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-amber-100 text-slate-700 font-bold text-[11px] border border-slate-200 transition-colors cursor-pointer"
                          >
                            + Tautkan Bahan
                          </button>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            onClick={() => handleOpenEditModal(p)}
                            className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                            title="Edit Produk"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Hapus produk "${p.name}"?`)) {
                                deleteProduct(p.id);
                              }
                            }}
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer"
                            title="Hapus Produk"
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
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* 2. SUBTAB: PAKET BUNDLING PRODUK (COMBO SETS)                          */}
      {/* ---------------------------------------------------------------------- */}
      {activeSubTab === 'bundles' && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start space-x-3">
            <Sparkles className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-950 leading-relaxed font-medium">
              <strong className="font-black">Fitur Paket Bundling Produk:</strong> Gabungkan beberapa produk jadi (misal: 1x Makanan + 1x Minuman) menjadi 1 paket promo hemat. Kasir dapat memilih paket ini langsung pada mesin POS.
            </div>
          </div>

          {filteredBundles.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
              <Sparkles className="w-10 h-10 text-slate-300 mx-auto" />
              <h4 className="text-sm font-black text-slate-900">Belum Ada Paket Bundling</h4>
              <p className="text-xs text-slate-500">Buat paket bundling pertamamu untuk mendongkrak penjualan!</p>
              <button
                onClick={handleOpenAddBundleModal}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-4 py-2 rounded-xl text-xs cursor-pointer inline-flex items-center space-x-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Buat Paket Bundling Baru</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {filteredBundles.map((b) => (
                <div
                  key={b.id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4 hover:shadow-md transition-all relative overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <img
                        src={b.image || 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200'}
                        alt={b.name}
                        className="w-12 h-12 rounded-xl object-cover bg-slate-100 shrink-0 border border-slate-200"
                      />
                      <div>
                        <span className="font-mono text-[10px] font-bold text-slate-400">{b.sku}</span>
                        <h3 className="text-base font-black text-slate-950 leading-tight">{b.name}</h3>
                        {b.description && (
                          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{b.description}</p>
                        )}
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-xl bg-amber-500 text-slate-950 font-black text-xs shrink-0 shadow-xs">
                      Hemat {b.discountPercent}%
                    </span>
                  </div>

                  {/* Included Items */}
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-xs">
                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-wider block">
                      Isi Produk dalam Paket:
                    </span>
                    <ul className="space-y-1 text-slate-900 font-semibold">
                      {b.items.map((item, idx) => (
                        <li key={idx} className="flex justify-between items-center">
                          <span>• {item.quantity}x {item.productName}</span>
                          <span className="font-mono text-slate-500">{formatRupiah(item.subtotalPrice)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Pricing Comparison & Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <div>
                      <span className="text-[11px] text-slate-400 line-through font-bold font-mono block">
                        {formatRupiah(b.regularPrice)}
                      </span>
                      <span className="text-lg font-black text-slate-950 font-mono">
                        {formatRupiah(b.bundlePrice)}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleOpenEditBundleModal(b)}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs cursor-pointer flex items-center space-x-1"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Hapus paket bundling "${b.name}"?`)) {
                            deleteBundle(b.id);
                          }
                        }}
                        className="p-1.5 rounded-xl text-rose-600 hover:bg-rose-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* 3. SUBTAB: PENAUTAN RESEP & MULTI-BAHAN BAKU (BOM)                      */}
      {/* ---------------------------------------------------------------------- */}
      {activeSubTab === 'recipes' && (
        <div className="space-y-4">
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-start space-x-3">
            <UtensilsCrossed className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            <div className="text-xs text-emerald-950 leading-relaxed font-medium">
              <strong className="font-black">Fitur Penautan Bahan Baku (Bill of Materials):</strong> Setiap menu produk jadi dapat ditautkan dengan <strong>beberapa bahan baku sekaligus</strong> (misal: Biji Kopi + Susu + Gula Aren + Cup). Sistem akan otomatis menghitung Total HPP modal dan mengurangi stok bahan saat transaksi kasir selesai.
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100/90 text-slate-700 font-black uppercase text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-4">Produk Menu</th>
                    <th className="p-4">Kategori</th>
                    <th className="p-4 text-right">Harga Jual</th>
                    <th className="p-4">Komposisi Bahan Baku (Takaran &amp; Biaya)</th>
                    <th className="p-4 text-right">Total HPP Modal Bahan</th>
                    <th className="p-4 text-right">Margin Laba</th>
                    <th className="p-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => {
                    const ingList = p.recipeIngredients || [];
                    const calculatedCogs = ingList.reduce((sum, i) => sum + i.subtotalCost, 0);
                    const finalCogs = calculatedCogs > 0 ? calculatedCogs : p.costPrice;
                    const profit = p.price - finalCogs;
                    const marginPct = p.price > 0 ? Math.round((profit / p.price) * 100) : 0;

                    return (
                      <tr key={p.id} className="hover:bg-amber-50/30 transition-colors">
                        <td className="p-4 font-black text-slate-950 text-sm">{p.name}</td>
                        <td className="p-4 font-bold text-slate-600">
                          {categories.find((c) => c.id === p.categoryId)?.name || 'Umum'}
                        </td>
                        <td className="p-4 text-right font-mono font-black text-slate-950">
                          {formatRupiah(p.price)}
                        </td>
                        <td className="p-4">
                          {ingList.length === 0 ? (
                            <span className="text-slate-400 italic">Belum ada bahan baku tertaut</span>
                          ) : (
                            <div className="space-y-1">
                              {ingList.map((ing, idx) => (
                                <div key={idx} className="flex items-center justify-between text-[11px] gap-2">
                                  <span className="font-semibold text-slate-800">
                                    • {ing.ingredientName} ({ing.quantity} {ing.unit})
                                  </span>
                                  <span className="font-mono font-bold text-slate-500">
                                    {formatRupiah(ing.subtotalCost)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-right font-mono font-black text-rose-700 text-sm">
                          {formatRupiah(finalCogs)}
                        </td>
                        <td className="p-4 text-right">
                          <span className="font-mono font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                            {marginPct}% (+{formatRupiah(profit)})
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => handleOpenRecipeModal(p)}
                            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-amber-500 hover:text-slate-950 text-white font-black text-xs transition-colors cursor-pointer"
                          >
                            {ingList.length > 0 ? 'Edit Resep' : '+ Tautkan Bahan'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* 4. SUBTAB: BAHAN BAKU & MENTAH INVENTORI                               */}
      {/* ---------------------------------------------------------------------- */}
      {activeSubTab === 'stock' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/90 text-slate-700 font-black uppercase text-[11px] border-b border-slate-200">
                <tr>
                  <th className="p-4">SKU &amp; Nama Bahan Baku</th>
                  <th className="p-4">Kategori / Tipe</th>
                  <th className="p-4 text-right">Stok Gudang</th>
                  <th className="p-4 text-right">Harga Modal / Satuan</th>
                  <th className="p-4">Lokasi Simpan</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStockItems.map((s) => (
                  <tr key={s.id} className="hover:bg-amber-50/30 transition-colors">
                    <td className="p-4">
                      <span className="font-black text-slate-950 block text-sm">{s.name}</span>
                      <span className="font-mono text-slate-500 text-[11px] font-bold">{s.sku}</span>
                    </td>
                    <td className="p-4">
                      <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-bold border border-slate-200">
                        {s.type}
                      </span>
                    </td>
                    <td className="p-4 text-right font-mono font-black text-slate-950 text-sm">
                      {s.stock} {s.unit}
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-700">
                      {formatRupiah(s.costPrice)} / {s.unit}
                    </td>
                    <td className="p-4 text-slate-600 font-medium">{s.location}</td>
                    <td className="p-4 text-center">
                      {s.stock <= s.minStockAlert ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-950 border border-rose-300 font-black text-xs">
                          ⚠️ Menipis
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-950 border border-emerald-300 font-black text-xs">
                          ✓ Aman
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          onClick={() => handleOpenEditStockModal(s)}
                          className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Hapus bahan baku "${s.name}"?`)) {
                              deleteStockItem(s.id);
                            }
                          }}
                          className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* 5. SUBTAB: RIWAYAT MUTASI STOK                                         */}
      {/* ---------------------------------------------------------------------- */}
      {activeSubTab === 'logs' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/90 text-slate-700 font-black uppercase text-[11px] border-b border-slate-200">
                <tr>
                  <th className="p-4">Waktu</th>
                  <th className="p-4">Item / Produk</th>
                  <th className="p-4">Tipe Mutasi</th>
                  <th className="p-4 text-right">Jumlah Perubahan</th>
                  <th className="p-4 text-right">Stok Akhir</th>
                  <th className="p-4">Keterangan / Alasan</th>
                  <th className="p-4">Operator Kasir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inventoryLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-amber-50/30 transition-colors">
                    <td className="p-4 text-slate-500 font-mono text-[11px]">{formatDateTime(log.timestamp)}</td>
                    <td className="p-4 font-black text-slate-950">{log.productName}</td>
                    <td className="p-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                          log.type === 'IN'
                            ? 'bg-emerald-100 text-emerald-950 border-emerald-300'
                            : 'bg-rose-100 text-rose-950 border-rose-300'
                        }`}
                      >
                        {log.type}
                      </span>
                    </td>
                    <td className="p-4 text-right font-mono font-black text-slate-950">
                      {log.type === 'IN' ? `+${log.quantity}` : `-${log.quantity}`}
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-700">{log.newStock}</td>
                    <td className="p-4 text-slate-700 font-medium">{log.reason}</td>
                    <td className="p-4 font-bold text-slate-900">{log.user || 'Admin'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 1: ADD / EDIT PRODUCT                                            */}
      {/* ====================================================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-base text-slate-950">
                {editingProduct ? 'Edit Menu Produk' : 'Tambah Menu Produk Baru'}
              </h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded-xl hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="font-black text-slate-700 block mb-1">Nama Produk *</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Contoh: Es Kopi Susu Gula Aren"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">SKU Produk</label>
                  <input
                    type="text"
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-slate-950 font-bold focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Kategori</label>
                  <select
                    value={formCategoryId}
                    onChange={(e) => setFormCategoryId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Harga Jual Kasir (Rp) *</label>
                  <input
                    type="number"
                    required
                    value={formPrice}
                    onChange={(e) => setFormPrice(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono font-black text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Biaya Modal (HPP Satuan)</label>
                  <input
                    type="number"
                    value={formCostPrice}
                    onChange={(e) => setFormCostPrice(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Stok Awal</label>
                  <input
                    type="number"
                    value={formStock}
                    onChange={(e) => setFormStock(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Satuan</label>
                  <input
                    type="text"
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    placeholder="pcs / cup / porsi"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 font-black text-slate-950 shadow-xs cursor-pointer"
                >
                  Simpan Produk
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 2: MULTI-INGREDIENT RECIPE LINKING (BOM)                        */}
      {/* ====================================================================== */}
      {showRecipeModal && recipeProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase text-amber-600 tracking-wider">
                  Bill of Materials (BOM)
                </span>
                <h3 className="font-black text-base text-slate-950">
                  Tautkan Resep &amp; Bahan Baku: {recipeProduct.name}
                </h3>
              </div>
              <button onClick={() => setShowRecipeModal(false)} className="p-1 rounded-xl hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRecipe} className="space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500 block text-[11px] font-semibold">Harga Jual Menu Kasir:</span>
                  <span className="font-mono font-black text-base text-slate-950">{formatRupiah(recipeProduct.price)}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-[11px] font-semibold">Total HPP Modal Bahan:</span>
                  <span className="font-mono font-black text-base text-rose-700">{formatRupiah(totalCalculatedCOGS)}</span>
                </div>
                <div className="text-right pl-4 border-l border-slate-200">
                  <span className="text-slate-500 block text-[11px] font-semibold">Estimasi Margin Laba:</span>
                  <span className="font-mono font-black text-base text-emerald-700">
                    {recipeProduct.price > 0
                      ? Math.round(((recipeProduct.price - totalCalculatedCOGS) / recipeProduct.price) * 100)
                      : 0}
                    %
                  </span>
                </div>
              </div>

              {/* Ingredients List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-slate-900 uppercase tracking-wider text-[11px]">
                    Daftar Bahan Mentah yang Dikaitkan:
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddIngredientRow}
                    className="px-3 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 font-black text-slate-950 text-xs flex items-center space-x-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Bahan Baku</span>
                  </button>
                </div>

                {recipeIngredientsList.length === 0 ? (
                  <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
                    Belum ada bahan baku yang dikaitkan. Klik tombol "+ Tambah Bahan Baku" di atas.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recipeIngredientsList.map((row, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3"
                      >
                        <div className="flex-1">
                          <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Bahan Baku</label>
                          <select
                            value={row.ingredientId}
                            onChange={(e) => handleUpdateIngredientRow(idx, 'ingredientId', e.target.value)}
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-900 text-xs outline-none"
                          >
                            {stockItems.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({formatRupiah(s.costPrice)} / {s.unit})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="w-24">
                          <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Takaran</label>
                          <input
                            type="number"
                            step="any"
                            value={row.quantity}
                            onChange={(e) => handleUpdateIngredientRow(idx, 'quantity', e.target.value)}
                            className="w-full p-2 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 text-xs outline-none"
                          />
                        </div>

                        <div className="w-16">
                          <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Satuan</label>
                          <span className="p-2 block text-xs font-bold text-slate-700 bg-slate-100 rounded-lg text-center">
                            {row.unit}
                          </span>
                        </div>

                        <div className="w-28 text-right">
                          <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Subtotal HPP</label>
                          <span className="p-2 block text-xs font-mono font-black text-rose-700 text-right">
                            {formatRupiah(row.subtotalCost)}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveIngredientRow(idx)}
                          className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer mt-3"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRecipeModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 font-black text-slate-950 shadow-xs cursor-pointer"
                >
                  Simpan Komposisi Resep
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 3: PRODUCT BUNDLING (COMBO PROMO SETS)                           */}
      {/* ====================================================================== */}
      {showBundleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase text-amber-600 tracking-wider">
                  Combo Promo Packages
                </span>
                <h3 className="font-black text-base text-slate-950">
                  {editingBundle ? 'Edit Paket Bundling' : 'Buat Paket Bundling Produk Baru'}
                </h3>
              </div>
              <button onClick={() => setShowBundleModal(false)} className="p-1 rounded-xl hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBundleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="font-black text-slate-700 block mb-1">Nama Paket Bundling *</label>
                  <input
                    type="text"
                    required
                    value={bundleName}
                    onChange={(e) => setBundleName(e.target.value)}
                    placeholder="Contoh: Paket Kenyang Hemat (Nasi Goreng + Es Kopi)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">SKU Paket</label>
                  <input
                    type="text"
                    value={bundleSku}
                    onChange={(e) => setBundleSku(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Harga Promo Paket (Rp) *</label>
                  <input
                    type="number"
                    required
                    value={bundlePrice}
                    onChange={(e) => setBundlePrice(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono font-black text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="font-black text-slate-700 block mb-1">Deskripsi Paket</label>
                  <input
                    type="text"
                    value={bundleDescription}
                    onChange={(e) => setBundleDescription(e.target.value)}
                    placeholder="Contoh: Hemat 20% untuk pembelian kombo makan siang"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-medium text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>
              </div>

              {/* Price Calculation Summary Strip */}
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500 block text-[11px] font-semibold">Total Harga Normal Satuan:</span>
                  <span className="font-mono font-black text-base text-slate-950">
                    {formatRupiah(totalBundleRegularPrice)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px] font-semibold">Harga Promo Paket:</span>
                  <span className="font-mono font-black text-base text-slate-950">
                    {formatRupiah(bundlePrice)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block text-[11px] font-semibold">Nilai Diskon Pelanggan:</span>
                  <span className="font-mono font-black text-base text-emerald-700">
                    Hemat {bundleDiscountPercent}% ({formatRupiah(Math.max(0, totalBundleRegularPrice - bundlePrice))})
                  </span>
                </div>
              </div>

              {/* Constituent Products Selector */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-slate-900 uppercase tracking-wider text-[11px]">
                    Produk Penyusun Paket:
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddBundleItemRow}
                    className="px-3 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 font-black text-slate-950 text-xs flex items-center space-x-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Produk ke Paket</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {bundleItemsList.map((item, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3">
                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Produk Jadi</label>
                        <select
                          value={item.productId}
                          onChange={(e) => handleUpdateBundleItemRow(idx, 'productId', e.target.value)}
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-slate-900 text-xs outline-none"
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({formatRupiah(p.price)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-24">
                        <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Jumlah (Qty)</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleUpdateBundleItemRow(idx, 'quantity', e.target.value)}
                          className="w-full p-2 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900 text-xs outline-none text-center"
                        />
                      </div>

                      <div className="w-28 text-right">
                        <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Subtotal Harga</label>
                        <span className="p-2 block text-xs font-mono font-black text-slate-950 text-right">
                          {formatRupiah(item.subtotalPrice)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveBundleItemRow(idx)}
                        className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer mt-3"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBundleModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 font-black text-slate-950 shadow-xs cursor-pointer"
                >
                  Simpan Paket Bundling
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 4: ADD / EDIT RAW MATERIAL STOCK ITEM                            */}
      {/* ====================================================================== */}
      {showStockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-base text-slate-950">
                {editingStockItem ? 'Edit Bahan Baku' : 'Tambah Bahan Baku / Mentah Baru'}
              </h3>
              <button onClick={() => setShowStockModal(false)} className="p-1 rounded-xl hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStockItemSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="font-black text-slate-700 block mb-1">Nama Bahan Baku *</label>
                  <input
                    type="text"
                    required
                    value={stockItemName}
                    onChange={(e) => setStockItemName(e.target.value)}
                    placeholder="Contoh: Biji Kopi Arabika Gayo"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">SKU Bahan</label>
                  <input
                    type="text"
                    value={stockItemSku}
                    onChange={(e) => setStockItemSku(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Tipe Item</label>
                  <select
                    value={stockItemType}
                    onChange={(e) => setStockItemType(e.target.value as StockType)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                  >
                    <option value="BAHAN_BAKU">BAHAN BAKU (Raw Material)</option>
                    <option value="SETENGAH_JADI">SETENGAH JADI (WIP / Racikan)</option>
                    <option value="JADI">BARANG JADI (Kemasan)</option>
                  </select>
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Harga Beli Modal (Rp / Satuan) *</label>
                  <input
                    type="number"
                    required
                    value={stockItemCostPrice}
                    onChange={(e) => setStockItemCostPrice(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono font-black text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Satuan Takar</label>
                  <input
                    type="text"
                    value={stockItemUnit}
                    onChange={(e) => setStockItemUnit(e.target.value)}
                    placeholder="Gram / ml / Liter / Kg / pcs"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Stok Awal di Gudang</label>
                  <input
                    type="number"
                    value={stockItemQty}
                    onChange={(e) => setStockItemQty(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-black text-slate-700 block mb-1">Batas Minimum Peringatan</label>
                  <input
                    type="number"
                    value={stockItemMinQty}
                    onChange={(e) => setStockItemMinQty(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono font-bold text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>

                <div className="col-span-2">
                  <label className="font-black text-slate-700 block mb-1">Lokasi Penyimpanan</label>
                  <input
                    type="text"
                    value={stockItemLocation}
                    onChange={(e) => setStockItemLocation(e.target.value)}
                    placeholder="Contoh: Gudang Bahan Kering / Kulkas Bar"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-medium text-slate-950 focus:border-amber-500 outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowStockModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 font-black text-slate-950 shadow-xs cursor-pointer"
                >
                  Simpan Bahan Baku
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
