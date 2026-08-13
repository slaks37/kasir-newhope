import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { StoreSettings, StoreBranch, BusinessSector } from '../../types';
import { UserManagementTab } from './UserManagementTab';
import { SubscriptionBillingTab } from './SubscriptionBillingTab';
import {
  Settings,
  Store,
  Receipt,
  Percent,
  Tag,
  Plus,
  CheckCircle2,
  Save,
  Upload,
  Image,
  ShieldCheck,
  Building2,
  MapPin,
  Crosshair,
  Edit,
  Trash2,
  RefreshCw,
  Globe,
  Compass,
  CreditCard,
} from 'lucide-react';
import { formatRupiah } from '../../utils/formatters';
import { newId } from '../../lib/ids';

export const SettingsManager: React.FC = () => {
  const {
    settings,
    updateSettings,
    promoCodes,
    addPromoCode,
    branches,
    saveBranch,
    deleteBranch,
    currentUser,
    hasPermission,
  } = usePOS();

  const [activeTab, setActiveTab] = useState<'STORE' | 'BRANCHES' | 'USERS' | 'BILLING'>('STORE');
  const [formSettings, setFormSettings] = useState<StoreSettings>(settings);
  const [isSaved, setIsSaved] = useState(false);

  // New Promo Code state
  const [promoCode, setPromoCode] = useState('');
  const [promoPercent, setPromoPercent] = useState(10);
  const [promoMaxAmount, setPromoMaxAmount] = useState(15000);

  // Branch Modal State
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<StoreBranch | null>(null);
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchLat, setBranchLat] = useState(-6.2215);
  const [branchLon, setBranchLon] = useState(106.8014);
  const [branchRadius, setBranchRadius] = useState(200);
  const [branchSector, setBranchSector] = useState<BusinessSector>('FNB');
  const [isGettingGps, setIsGettingGps] = useState(false);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Ukuran gambar logo maksimal 5MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormSettings((prev) => ({ ...prev, logoUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings(formSettings);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleAddPromo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode) return;

    addPromoCode({
      code: promoCode.toUpperCase(),
      discountPercent: promoPercent,
      maxDiscountAmount: promoMaxAmount,
      minPurchaseAmount: 0,
      isActive: true,
    });

    setPromoCode('');
  };

  const handleOpenAddBranch = () => {
    setEditingBranch(null);
    setBranchName('');
    setBranchAddress('');
    setBranchLat(-6.2215);
    setBranchLon(106.8014);
    setBranchRadius(200);
    setBranchSector(settings.businessSector || 'FNB');
    setShowBranchModal(true);
  };

  const handleOpenEditBranch = (b: StoreBranch) => {
    setEditingBranch(b);
    setBranchName(b.name);
    setBranchAddress(b.address);
    setBranchLat(b.latitude);
    setBranchLon(b.longitude);
    setBranchRadius(b.allowedRadiusMeters);
    setBranchSector(b.businessSector || 'FNB');
    setShowBranchModal(true);
  };

  const handleGetCurrentGps = () => {
    setIsGettingGps(true);
    if (!navigator.geolocation) {
      alert('Geolocation tidak didukung browser ini.');
      setIsGettingGps(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBranchLat(Number(pos.coords.latitude.toFixed(6)));
        setBranchLon(Number(pos.coords.longitude.toFixed(6)));
        setIsGettingGps(false);
      },
      (err) => {
        alert(`Gagal mengambil GPS: ${err.message}`);
        setIsGettingGps(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleSaveBranchForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName) return;

    const b: StoreBranch = {
      id: editingBranch ? editingBranch.id : newId('branch'),
      name: branchName,
      address: branchAddress,
      latitude: branchLat,
      longitude: branchLon,
      allowedRadiusMeters: branchRadius,
      businessSector: branchSector,
      isActive: true,
    };

    saveBranch(b);
    setShowBranchModal(false);
  };

  return (
    <div className="flex-1 bg-slate-50/70 p-6 overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-extrabold text-2xl text-slate-900 flex items-center space-x-2">
            <Settings className="w-7 h-7 text-amber-600" />
            <span>Pengaturan Toko, Cabang & Hak Akses (RBAC)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Konfigurasi identitas toko, langganan SaaS, geo-fencing cabang, pajak PB1, dan voucher promo.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Nav Tabs */}
          <div className="flex bg-slate-200/80 p-1 rounded-2xl space-x-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('STORE')}
              className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-1.5 ${
                activeTab === 'STORE'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <Store className="w-4 h-4" />
              <span>Profil & Pajak Toko</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('BILLING')}
              className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-1.5 ${
                activeTab === 'BILLING'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>Langganan & Billing</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('BRANCHES')}
              className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-1.5 ${
                activeTab === 'BRANCHES'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>Cabang & Geo-Tagging</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('USERS')}
              className={`px-4 py-2 rounded-xl transition-all flex items-center space-x-1.5 ${
                activeTab === 'USERS'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Pengguna & RBAC</span>
            </button>
          </div>

          {isSaved && (
            <div className="flex items-center space-x-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-2xl text-xs font-bold animate-fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Pengaturan Disimpan!</span>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'BILLING' ? (
        <SubscriptionBillingTab />
      ) : activeTab === 'USERS' ? (
        <UserManagementTab />
      ) : activeTab === 'BRANCHES' ? (
        /* BRANCHES & GEO-TAGGING TAB */
        <div className="space-y-6 animate-fade-in">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-extrabold text-lg text-slate-900 flex items-center space-x-2">
                <MapPin className="w-5 h-5 text-amber-600" />
                <span>Daftar Cabang Toko & Geo-Fencing GPS</span>
              </h3>
              <p className="text-xs text-slate-500">
                Atur koordinat lokasi GPS dan radius toleransi presensi clock in/out untuk tiap cabang usaha.
              </p>
            </div>

            <div className="flex items-center space-x-3">
              {/* Geofence Enforcement Mode Selector */}
              <div className="flex items-center space-x-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 text-xs font-bold">
                <span className="text-slate-500 px-2">Mode GPS:</span>
                <select
                  value={formSettings.geofenceEnforcement || 'FLEXIBLE'}
                  onChange={(e) => {
                    const mode = e.target.value as 'STRICT' | 'FLEXIBLE';
                    setFormSettings((prev) => ({ ...prev, geofenceEnforcement: mode }));
                    updateSettings({ ...settings, geofenceEnforcement: mode });
                  }}
                  className="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-slate-900 font-extrabold focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="FLEXIBLE">FLEXIBLE (Catat Jarak + Peringatan)</option>
                  <option value="STRICT">STRICT (Wajib Dalam Radius)</option>
                </select>
              </div>

              <button
                onClick={handleOpenAddBranch}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs flex items-center space-x-1.5 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Cabang Baru</span>
              </button>
            </div>
          </div>

          {/* Branches Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((b) => (
              <div
                key={b.id}
                className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4 hover:shadow-md transition-all"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase border border-amber-200">
                        {b.businessSector || 'FNB'}
                      </span>
                      <h4 className="font-extrabold text-base text-slate-900 mt-1">{b.name}</h4>
                    </div>
                    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-extrabold border border-emerald-200">
                      Aktif
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">{b.address}</p>
                </div>

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs space-y-1 font-mono">
                  <div className="flex items-center justify-between text-slate-700">
                    <span className="text-[11px] font-bold text-slate-500">Koordinat GPS:</span>
                    <span className="font-extrabold text-amber-800">
                      {b.latitude}, {b.longitude}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-700">
                    <span className="text-[11px] font-bold text-slate-500">Radius Toleransi:</span>
                    <span className="font-extrabold text-emerald-700">±{b.allowedRadiusMeters} Meter</span>
                  </div>

                  {b.notes && <p className="text-[10px] text-slate-400 italic font-sans pt-1">{b.notes}</p>}
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => handleOpenEditBranch(b)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center space-x-1"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>

                  {branches.length > 1 && (
                    <button
                      onClick={() => deleteBranch(b.id)}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl transition-all flex items-center space-x-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add / Edit Branch Modal */}
          {showBranchModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl animate-scale-up">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-extrabold text-lg text-slate-900 flex items-center space-x-2">
                    <Building2 className="w-5 h-5 text-amber-600" />
                    <span>{editingBranch ? 'Edit Cabang Toko' : 'Tambah Cabang Baru'}</span>
                  </h3>
                  <button onClick={() => setShowBranchModal(false)} className="text-slate-400 hover:text-slate-600">
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSaveBranchForm} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-700 font-extrabold">Nama Cabang Toko *</label>
                    <input
                      type="text"
                      required
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      placeholder="misal: Cabang Utama - Senayan"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-700 font-extrabold">Alamat Lengkap Cabang</label>
                    <input
                      type="text"
                      value={branchAddress}
                      onChange={(e) => setBranchAddress(e.target.value)}
                      placeholder="Jl. Asia Afrika No. 8, Jakarta Pusat"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
                    />
                  </div>

                  <div className="space-y-2 p-3 bg-amber-50/70 border border-amber-200 rounded-2xl">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-amber-950 font-extrabold flex items-center space-x-1.5">
                        <Crosshair className="w-4 h-4 text-amber-600" />
                        <span>Titik Koordinat GPS Cabang</span>
                      </label>

                      <button
                        type="button"
                        onClick={handleGetCurrentGps}
                        disabled={isGettingGps}
                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-[10px] rounded-lg transition-all flex items-center space-x-1 shadow-2xs"
                      >
                        <RefreshCw className={`w-3 h-3 ${isGettingGps ? 'animate-spin' : ''}`} />
                        <span>Ambil GPS Saya Saat Ini</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 font-bold block">Latitude</label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={branchLat}
                          onChange={(e) => setBranchLat(Number(e.target.value))}
                          className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-500 font-bold block">Longitude</label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={branchLon}
                          onChange={(e) => setBranchLon(Number(e.target.value))}
                          className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-slate-900"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-700 font-extrabold">Radius Toleransi (Meter)</label>
                      <input
                        type="number"
                        required
                        value={branchRadius}
                        onChange={(e) => setBranchRadius(Number(e.target.value))}
                        placeholder="200"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-emerald-700"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-slate-700 font-extrabold">Modul Layanan Bisnis</label>
                      <select
                        value={branchSector}
                        onChange={(e) => setBranchSector(e.target.value as BusinessSector)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-semibold"
                      >
                        <option value="FNB">Kafe, Resto & F&B</option>
                        <option value="LAUNDRY">Laundry Kiloan & Satuan</option>
                        <option value="RETAIL">Ritel & Minimarket</option>
                        <option value="CARWASH">Cuci Mobil & Motor</option>
                        <option value="BARBERSHOP">Barbershop & Salon</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setShowBranchModal(false)}
                      className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-xs"
                    >
                      Simpan Cabang
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* STORE PROFILES & TAX TAB */
        <>
          {/* General Store Info */}
          <form onSubmit={handleSaveSettings} className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
              <h3 className="font-extrabold text-lg text-slate-900 flex items-center space-x-2">
                <Store className="w-5 h-5 text-amber-600" />
                <span>Identitas Toko / Resto</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Nama Toko / Usaha *</label>
                  <input
                    type="text"
                    required
                    value={formSettings.storeName}
                    onChange={(e) => setFormSettings((p) => ({ ...p, storeName: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Slogan / Tagline</label>
                  <input
                    type="text"
                    value={formSettings.tagline}
                    onChange={(e) => setFormSettings((p) => ({ ...p, tagline: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Alamat Toko</label>
                  <input
                    type="text"
                    value={formSettings.address}
                    onChange={(e) => setFormSettings((p) => ({ ...p, address: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-700 font-semibold">Nomor Telepon / WhatsApp</label>
                  <input
                    type="text"
                    value={formSettings.phone}
                    onChange={(e) => setFormSettings((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>

            {/* Tax & Service Settings */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
              <h3 className="font-extrabold text-lg text-slate-900 flex items-center space-x-2">
                <Percent className="w-5 h-5 text-amber-600" />
                <span>Pajak Resto (PB1/PPN) & Biaya Layanan</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900">Aktifkan Pajak PB1/PPN</span>
                    <input
                      type="checkbox"
                      checked={formSettings.enableTax}
                      onChange={(e) => setFormSettings((p) => ({ ...p, enableTax: e.target.checked }))}
                      className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                    />
                  </div>
                  {formSettings.enableTax && (
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-500 font-semibold">Persentase Pajak (%)</label>
                      <input
                        type="number"
                        value={formSettings.taxRate}
                        onChange={(e) => setFormSettings((p) => ({ ...p, taxRate: Number(e.target.value) }))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-amber-700"
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900">Aktifkan Biaya Layanan (Service Charge)</span>
                    <input
                      type="checkbox"
                      checked={formSettings.enableService}
                      onChange={(e) => setFormSettings((p) => ({ ...p, enableService: e.target.checked }))}
                      className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                    />
                  </div>
                  {formSettings.enableService && (
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-500 font-semibold">Persentase Layanan (%)</label>
                      <input
                        type="number"
                        value={formSettings.serviceRate}
                        onChange={(e) => setFormSettings((p) => ({ ...p, serviceRate: Number(e.target.value) }))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-amber-700"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md flex items-center space-x-2 transition-all"
              >
                <Save className="w-4 h-4" />
                <span>Simpan Perubahan</span>
              </button>
            </div>
          </form>

          {/* Voucher Promo Section */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="font-extrabold text-lg text-slate-900 flex items-center space-x-2">
              <Tag className="w-5 h-5 text-amber-600" />
              <span>Manajemen Kode Promo & Diskon</span>
            </h3>

            <form onSubmit={handleAddPromo} className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block">Kode Promo</label>
                <input
                  type="text"
                  required
                  placeholder="KODE15"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono uppercase"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block">Diskon (%)</label>
                <input
                  type="number"
                  value={promoPercent}
                  onChange={(e) => setPromoPercent(Number(e.target.value))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block">Maks. Potongan (Rp)</label>
                <input
                  type="number"
                  value={promoMaxAmount}
                  onChange={(e) => setPromoMaxAmount(Number(e.target.value))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center space-x-1 shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tambah Promo</span>
                </button>
              </div>
            </form>

            {/* Promo Codes List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {(promoCodes || []).map((p) => (
                <div
                  key={p.code}
                  className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-mono font-extrabold text-amber-700 text-sm block">
                      {p.code}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Diskon {p.discountPercent}% (Maks {formatRupiah(p.maxDiscountAmount)})
                    </span>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold border border-emerald-200">
                    Aktif
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
