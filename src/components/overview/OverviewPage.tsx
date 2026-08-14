import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah } from '../../utils/formatters';
import { BUSINESS_PRESETS, BusinessSector } from '../../data/businessPresets';
import {
  LayoutDashboard,
  ShoppingCart,
  Grid2X2,
  Package,
  Users,
  BarChart3,
  Bot,
  Settings,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Layers,
  Store,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  Coffee,
  Shirt,
  ShoppingBag,
  Car,
  Scissors,
  DollarSign,
  Receipt,
  UserCheck,
} from 'lucide-react';

interface OverviewPageProps {
  onBackToHome?: () => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ onBackToHome }) => {
  const {
    setActiveTab,
    products,
    categories,
    tables,
    customers,
    orders,
    shift,
    settings,
    currentUser,
    hasPermission,
    activateBusinessSector,
  } = usePOS();

  const activeSector = settings.businessSector || 'FNB';
  const activePreset = BUSINESS_PRESETS[activeSector] || BUSINESS_PRESETS.FNB;

  const [selectedSector, setSelectedSector] = useState<BusinessSector>(activeSector);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Metrics calculation
  const todayStr = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter(
    (o) => o.date.startsWith(todayStr) && o.status === 'COMPLETED'
  );
  const todaySales = todayOrders.reduce((sum, o) => sum + o.total, 0);
  const todayItemsSold = todayOrders.reduce(
    (sum, o) => sum + o.items.reduce((iSum, i) => iSum + i.quantity, 0),
    0
  );

  const lowStockProducts = products.filter((p) => p.stock <= p.minStockAlert);
  const occupiedTables = tables.filter((t) => t.status === 'OCCUPIED').length;

  const handleSwitchSector = (sec: BusinessSector) => {
    activateBusinessSector(sec);
    setSelectedSector(sec);
    setSuccessMsg(`Sektor usaha berhasil diganti ke "${BUSINESS_PRESETS[sec].name}"!`);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const sectorIcons: Record<BusinessSector, any> = {
    FNB: Coffee,
    LAUNDRY: Shirt,
    RETAIL: ShoppingBag,
    CARWASH: Car,
    BARBERSHOP: Scissors,
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/60 p-4 lg:p-8 space-y-6 animate-fade-in">
      {/* Toast Alert */}
      {successMsg && (
        <div className="bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-lg flex items-center justify-between animate-bounce">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-200" />
            <p className="font-bold text-sm">{successMsg}</p>
          </div>
        </div>
      )}

      {/* Top Banner: Store Status & Shift */}
      <div className="relative overflow-hidden rounded-3xl bg-slate-900 text-white p-6 lg:p-8 shadow-xl border border-slate-800">
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold uppercase">
                <Store className="w-3.5 h-3.5" />
                <span>{activePreset.name}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700">
                <UserCheck className="w-3.5 h-3.5 text-blue-400" />
                <span>Kasir: {currentUser?.name || 'Kasir Aktif'} ({currentUser?.role || 'ADMIN'})</span>
              </span>
              {shift.status === 'OPEN' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Shift Aktif</span>
                </span>
              )}
            </div>

            <h1 className="text-2xl lg:text-3xl font-black text-white tracking-tight">
              {settings.storeName || 'New Hope POS'}
            </h1>
            <p className="text-xs lg:text-sm text-slate-300 max-w-xl">
              Konsol ringkasan operasional toko, penjualan kasir realtime, status stok barang, dan kontrol denah layout.
            </p>
          </div>

          {/* Quick Launch Buttons */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => setActiveTab('pos')}
              className="px-5 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Buka Kasir (POS)</span>
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs transition-all flex items-center gap-2"
            >
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              <span>Laporan</span>
            </button>
            {onBackToHome && (
              <button
                onClick={onBackToHome}
                className="px-4 py-3 rounded-2xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold text-xs transition-all flex items-center gap-1.5"
                title="Kembali ke Beranda Depan"
              >
                <span>Halaman Depan</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Omzet Hari Ini */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Omzet Hari Ini</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl lg:text-2xl font-black text-slate-900">{formatRupiah(todaySales)}</p>
          <p className="text-xs text-slate-400">{todayOrders.length} transaksi selesai</p>
        </div>

        {/* Produk Terjual */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Item Terjual</span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl lg:text-2xl font-black text-slate-900">{todayItemsSold} <span className="text-sm font-semibold text-slate-400">item</span></p>
          <p className="text-xs text-slate-400">{products.length} total produk aktif</p>
        </div>

        {/* Meja / Slot Terisi */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">{activePreset.layoutTerm?.itemNoun || 'Meja'} Terisi</span>
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <Grid2X2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl lg:text-2xl font-black text-slate-900">{occupiedTables} / {tables.length}</p>
          <p className="text-xs text-slate-400">{tables.length - occupiedTables} {activePreset.layoutTerm?.itemNoun || 'meja'} kosong</p>
        </div>

        {/* Status Stok Rendah */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Stok Kritis</span>
            <div className={`p-2 rounded-xl ${lowStockProducts.length > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl lg:text-2xl font-black text-slate-900">{lowStockProducts.length} <span className="text-sm font-semibold text-slate-400">produk</span></p>
          <p className="text-xs text-slate-400">{lowStockProducts.length > 0 ? 'Perlu restok segera' : 'Stok aman terkendali'}</p>
        </div>
      </div>

      {/* Sektor Bisnis Switcher & Quick Navigation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ganti Sektor Bisnis Toko */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-500" />
                <span>Pilih Mode Sektor Bisnis Toko</span>
              </h2>
              <p className="text-xs text-slate-500">Ganti format katalog produk, layout denah, dan fitur spesifik bidang usaha:</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(Object.keys(BUSINESS_PRESETS) as BusinessSector[]).map((sec) => {
              const preset = BUSINESS_PRESETS[sec];
              const Icon = sectorIcons[sec];
              const isCurrent = activeSector === sec;

              return (
                <button
                  key={sec}
                  onClick={() => handleSwitchSector(sec)}
                  className={`p-3.5 rounded-2xl border text-left transition-all relative flex flex-col justify-between space-y-2 ${
                    isCurrent
                      ? 'border-amber-500 bg-amber-50/50 shadow-xs ring-2 ring-amber-500/20'
                      : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/80 hover:border-slate-300'
                  }`}
                >
                  {isCurrent && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-amber-500 text-slate-950 text-[9px] font-black rounded-md">
                      Aktif
                    </span>
                  )}
                  <div className={`p-2 rounded-xl w-fit ${isCurrent ? 'bg-amber-500 text-slate-950' : 'bg-slate-200/80 text-slate-700'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-extrabold text-xs text-slate-900 leading-tight">{preset.name.split('&')[0]}</p>
                    <p className="text-[10px] text-slate-500">{preset.layoutTerm?.itemNoun || 'Item'}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Fitur Aktif Sektor Terpilih */}
          <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                Fitur Unggulan Mode {activePreset.name}:
              </span>
              <span className="text-[11px] text-slate-400">{activePreset.products.length} produk contoh</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
              {activePreset.features.map((feat, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{feat.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modul Akses Cepat */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-500" />
            <span>Pintasan Modul Kasir</span>
          </h2>

          <div className="space-y-2">
            <button
              onClick={() => setActiveTab('pos')}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-50 hover:bg-amber-50/60 border border-slate-200 hover:border-amber-300 text-left transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-500 text-slate-950">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-extrabold text-slate-900 group-hover:text-amber-700">Mesin Kasir (POS)</p>
                  <p className="text-[11px] text-slate-500">Proses transaksi belanja & struk</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600" />
            </button>

            <button
              onClick={() => setActiveTab('tables')}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-50 hover:bg-blue-50/60 border border-slate-200 hover:border-blue-300 text-left transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-500 text-white">
                  <Grid2X2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-extrabold text-slate-900 group-hover:text-blue-700">{activePreset.layoutTerm?.tabLabel || 'Denah Layout'}</p>
                  <p className="text-[11px] text-slate-500">Kelola nomor meja / slot antrean</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600" />
            </button>

            <button
              onClick={() => setActiveTab('inventory')}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50/60 border border-slate-200 hover:border-emerald-300 text-left transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500 text-white">
                  <Package className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-extrabold text-slate-900 group-hover:text-emerald-700">Produk & Inventori</p>
                  <p className="text-[11px] text-slate-500">Harga, varian, dan stok gudang</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600" />
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              className="w-full flex items-center justify-between p-3 rounded-2xl bg-purple-50 hover:bg-purple-100/60 border border-purple-200 hover:border-purple-300 text-left transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-600 text-white">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-extrabold text-purple-900">AI Copilot Bisnis</p>
                  <p className="text-[11px] text-purple-700">Analisis cerdas & prediksi penjualan</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-purple-600" />
            </button>
          </div>
        </div>
      </div>

      {/* Recent Orders List */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-slate-600" />
            <span>Transaksi Terkini Toko ({orders.length})</span>
          </h2>
          <button
            onClick={() => setActiveTab('reports')}
            className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
          >
            <span>Buka Semua di Laporan</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {orders.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Belum ada riwayat transaksi hari ini. Buka Kasir untuk melakukan penjualan pertama!
          </div>
        ) : (
          <div className="divide-y divide-slate-100 overflow-x-auto">
            {orders.slice(0, 5).map((order) => (
              <div key={order.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                <div>
                  <p className="font-mono font-bold text-slate-900">{order.id.slice(0, 16).toUpperCase()}</p>
                  <p className="text-slate-400 text-[11px]">{new Date(order.date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} • {order.items.length} item • Kasir: {order.cashierName}</p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold text-slate-900">{formatRupiah(order.total)}</p>
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold text-[10px] rounded-md">
                    {order.paymentMethod}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OverviewPage;
