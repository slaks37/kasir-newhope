import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { Customer, CustomerTier } from '../../types';
import { formatRupiah } from '../../utils/formatters';
import { Users, UserPlus, Award, Phone, Mail, Search, CheckCircle2, Gift, Upload, User } from 'lucide-react';
import { newId } from '../../lib/ids';

export const CustomerManager: React.FC = () => {
  const { customers, saveCustomer, settings } = usePOS();

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // New Customer Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [avatar, setAvatar] = useState('');

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Ukuran foto profil maksimal 5MB');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery)
  );

  const getTierBadge = (tier: CustomerTier) => {
    switch (tier) {
      case 'PLATINUM':
        return <span className="px-2.5 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200 text-xs font-bold">Platinum</span>;
      case 'GOLD':
        return <span className="px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold">Gold Member</span>;
      case 'SILVER':
        return <span className="px-2.5 py-0.5 rounded-md bg-slate-200 text-slate-800 border border-slate-300 text-xs font-bold">Silver</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-md bg-orange-100 text-orange-800 border border-orange-200 text-xs font-bold">Bronze</span>;
    }
  };

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) return;

    const newCustomer: Customer = {
      id: newId('cust'),
      name,
      phone,
      email,
      avatar,
      points: 100, // Welcome bonus
      tier: 'BRONZE',
      totalSpent: 0,
      visitCount: 0,
      lastVisit: new Date().toISOString().split('T')[0],
    };

    saveCustomer(newCustomer);
    setShowAddModal(false);
    setName('');
    setPhone('');
    setEmail('');
    setAvatar('');
  };

  return (
    <div className="flex-1 bg-slate-50/70 p-6 overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-extrabold text-2xl text-slate-900 flex items-center space-x-2">
            <Users className="w-7 h-7 text-amber-600" />
            <span>Manajemen Pelanggan & Loyalty CRM</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Program poin reward member, riwayat riil belanja pelanggan, dan level keanggotaan.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-2xl flex items-center space-x-2 shadow-xs text-xs transition-all"
        >
          <UserPlus className="w-4 h-4" />
          <span>Pendaftaran Member Baru</span>
        </button>
      </div>

      {/* Program loyalitas dimatikan merchant: daftar member tetap berguna
          sebagai buku alamat pelanggan, jadi halaman ini tidak disembunyikan —
          yang disembunyikan hanya janji poin yang tidak akan ditepati. */}
      {settings.enableLoyalty === false && (
        <div className="p-4 rounded-3xl border border-amber-200 bg-amber-50 text-amber-900">
          <p className="text-xs font-extrabold">Program loyalitas sedang dimatikan</p>
          <p className="text-[11px] mt-1 leading-relaxed text-amber-800/90">
            Poin baru tidak dikumpulkan dan tidak bisa ditukar di kasir. Saldo poin yang sudah
            terkumpul tetap tersimpan dan bisa dipakai lagi begitu program dinyalakan dari
            Pengaturan &rsaquo; Program Loyalitas &amp; Member.
          </p>
        </div>
      )}

      {/* Program Loyalty Rule Cards */}
      {settings.enableLoyalty !== false && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 p-4 rounded-3xl flex items-center space-x-3 shadow-xs">
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-semibold block">Aturan Perolehan Poin</span>
            <p className="text-xs font-bold text-slate-900 mt-0.5">
              Setiap kelipatan {formatRupiah(settings.loyaltyEarnRate)} = 1 Poin
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-3xl flex items-center space-x-3 shadow-xs">
          <div className="p-3 rounded-2xl bg-purple-50 border border-purple-200 text-purple-700">
            <Gift className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-semibold block">Penukaran Diskon</span>
            <p className="text-xs font-bold text-slate-900 mt-0.5">
              1 Poin = Potongan {formatRupiah(settings.loyaltyRedeemRate)}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-4 rounded-3xl flex items-center space-x-3 shadow-xs">
          <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-semibold block">Total Member Aktif</span>
            <p className="text-sm font-extrabold text-slate-900 font-mono mt-0.5">
              {customers.length} Orang Terdaftar
            </p>
          </div>
        </div>
      </div>
      )}

      {/* Search Bar */}
      <div className="flex-1 relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Cari berdasarkan nama atau nomor HP..."
          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500"
        />
      </div>

      {/* Customers Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredCustomers.map((cust) => (
          <div
            key={cust.id}
            className="bg-white border border-slate-200 hover:border-amber-400 p-4 rounded-3xl space-y-3 shadow-xs transition-all"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 border border-amber-200 overflow-hidden flex items-center justify-center shrink-0">
                  {cust.avatar ? (
                    <img
                      src={cust.avatar}
                      alt={cust.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-5 h-5 text-amber-700" />
                  )}
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 leading-tight">{cust.name}</h3>
                  <span className="text-xs text-slate-500 font-mono flex items-center space-x-1 mt-0.5">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span>{cust.phone}</span>
                  </span>
                </div>
              </div>
              {getTierBadge(cust.tier)}
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-100">
                <span className="text-[10px] text-slate-500 block font-medium">Total Poin Loyalty</span>
                <span className="font-extrabold text-base text-amber-700 font-mono block">
                  {cust.points} Poin
                </span>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-2xl border border-slate-100">
                <span className="text-[10px] text-slate-500 block font-medium">Total Belanja</span>
                <span className="font-bold text-xs text-slate-900 font-mono block">
                  {formatRupiah(cust.totalSpent)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
              <span>{cust.visitCount} Kali Transaksi</span>
              <span>Kunjungan Terakhir: {cust.lastVisit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Add Customer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-sm w-full space-y-4 text-slate-900 shadow-2xl">
            <h3 className="font-bold text-base text-amber-700">Pendaftaran Member Baru</h3>

            <form onSubmit={handleCreateCustomer} className="space-y-3">
              {/* Photo Upload Field */}
              <div className="flex items-center space-x-3 bg-slate-50 p-2.5 rounded-2xl border border-slate-200">
                <div className="w-12 h-12 rounded-xl bg-amber-100 border border-amber-200 overflow-hidden shrink-0 flex items-center justify-center relative group">
                  {avatar ? (
                    <>
                      <img
                        src={avatar}
                        alt="Preview"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setAvatar('')}
                        className="absolute inset-0 bg-slate-900/60 text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      >
                        Hapus
                      </button>
                    </>
                  ) : (
                    <User className="w-6 h-6 text-amber-700" />
                  )}
                </div>

                <div className="flex-1 space-y-1">
                  <label className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-2xs">
                    <Upload className="w-3.5 h-3.5 text-amber-600" />
                    <span>Upload Foto Member</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </label>
                  <p className="text-[10px] text-slate-400">Pilih foto dari galeri / perangkat</p>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Nama Lengkap *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Cth: Maya Putri"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Nomor Telepon / WA *</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0812xxxxxxxx"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Email (Opsional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="maya@gmail.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-xs"
                >
                  Simpan Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
