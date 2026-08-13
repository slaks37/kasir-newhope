import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { Customer } from '../../types';
import { UserPlus, Search, Award, Check, X } from 'lucide-react';
import { formatRupiah } from '../../utils/formatters';
import { newId } from '../../lib/ids';

interface CustomerSelectModalProps {
  onClose: () => void;
}

export const CustomerSelectModal: React.FC<CustomerSelectModalProps> = ({ onClose }) => {
  const { customers, selectedCustomer, setSelectedCustomer, saveCustomer } = usePOS();

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // New Customer Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery)
  );

  const handleSelect = (customer: Customer) => {
    setSelectedCustomer(customer);
    onClose();
  };

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) return;

    const newCustomer: Customer = {
      id: newId('cust'),
      name,
      phone,
      email,
      points: 50, // welcome bonus points!
      tier: 'BRONZE',
      totalSpent: 0,
      visitCount: 0,
      lastVisit: new Date().toISOString().split('T')[0],
    };

    saveCustomer(newCustomer);
    setSelectedCustomer(newCustomer);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full text-slate-900 overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Award className="w-5 h-5 text-amber-600" />
            <h3 className="font-bold text-base text-slate-900">
              {showAddForm ? 'Pendaftaran Member Baru' : 'Pilih Pelanggan / Member'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        {showAddForm ? (
          <form onSubmit={handleCreateCustomer} className="p-5 space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Nama Lengkap *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cth: Rina Wijaya"
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
                placeholder="rina@gmail.com"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="pt-3 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl"
              >
                Kembali
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-md hover:bg-amber-600"
              >
                Daftar & Pilih
              </button>
            </div>
          </form>
        ) : (
          <div className="p-4 flex-1 flex flex-col space-y-3 overflow-hidden">
            {/* Search & Add Button */}
            <div className="flex items-center space-x-2">
              <div className="flex-1 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari nama / nomor HP..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <button
                onClick={() => setShowAddForm(true)}
                className="p-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl font-bold text-xs flex items-center space-x-1 shadow-xs"
              >
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">Tambah</span>
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredCustomers.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  Tidak ada member ditemukan.
                </div>
              ) : (
                filteredCustomers.map((cust) => {
                  const isSelected = selectedCustomer?.id === cust.id;
                  return (
                    <div
                      key={cust.id}
                      onClick={() => handleSelect(cust)}
                      className={`p-3 rounded-2xl border cursor-pointer flex items-center justify-between transition-all ${
                        isSelected
                          ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold'
                          : 'bg-slate-50/80 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="font-bold text-sm text-slate-900">{cust.name}</h4>
                          <span
                            className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border ${
                              cust.tier === 'PLATINUM'
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : cust.tier === 'GOLD'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : cust.tier === 'SILVER'
                                ? 'bg-slate-100 text-slate-700 border-slate-300'
                                : 'bg-orange-50 text-orange-700 border-orange-200'
                            }`}
                          >
                            {cust.tier}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{cust.phone}</p>
                        <p className="text-[10px] text-slate-400">Total belanja: {formatRupiah(cust.totalSpent)}</p>
                      </div>

                      <div className="text-right">
                        <span className="font-extrabold text-sm text-amber-700 font-mono block">
                          {cust.points} Poin
                        </span>
                        {isSelected && (
                          <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-700 font-bold mt-1">
                            <Check className="w-3 h-3" />
                            <span>Terpilih</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
