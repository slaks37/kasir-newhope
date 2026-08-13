import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { ROLE_PERMISSIONS } from '../../data/rolePermissions';
import { User, UserRole, PermissionFeature } from '../../types';
import { newId } from '../../lib/ids';
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  ShieldCheck,
  UserCog,
  Briefcase,
  Store,
  KeyRound,
  CheckCircle2,
  XCircle,
  Lock,
  Save,
  Info,
} from 'lucide-react';

export const UserManagementTab: React.FC = () => {
  const { users, currentUser, saveUser, deleteUser } = usePOS();

  const [isEditing, setIsEditing] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<User>>({
    name: '',
    username: '',
    role: 'CASHIER',
    pin: '1234',
    status: 'ACTIVE',
  });

  const [activeSubTab, setActiveSubTab] = useState<'USERS' | 'PERMISSIONS'>('USERS');

  const handleOpenAdd = () => {
    setEditingUser({
      id: newId('usr'),
      name: '',
      username: '',
      role: 'CASHIER',
      pin: '1234',
      status: 'ACTIVE',
      createdAt: new Date().toISOString().split('T')[0],
    });
    setIsEditing(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser({ ...user });
    setIsEditing(true);
  };

  const handleSaveUserForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser.name || !editingUser.username || !editingUser.pin) {
      alert('Mohon lengkapi Nama, Username, dan PIN 4 digit.');
      return;
    }

    if (editingUser.pin.length !== 4 || !/^\d+$/.test(editingUser.pin)) {
      alert('PIN harus terdiri dari 4 digit angka (contoh: 1234).');
      return;
    }

    saveUser(editingUser as User);
    setIsEditing(false);
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'ADMIN':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-purple-100 text-purple-900 border border-purple-300 flex items-center space-x-1 shrink-0 w-max">
            <UserCog className="w-3.5 h-3.5 text-purple-700" />
            <span>ADMIN (Super)</span>
          </span>
        );
      case 'MANAGER':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-blue-100 text-blue-900 border border-blue-300 flex items-center space-x-1 shrink-0 w-max">
            <Briefcase className="w-3.5 h-3.5 text-blue-700" />
            <span>MANAGER</span>
          </span>
        );
      case 'CASHIER':
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center space-x-1 shrink-0 w-max">
            <Store className="w-3.5 h-3.5 text-emerald-700" />
            <span>KASIR</span>
          </span>
        );
    }
  };

  const featureLabels: Record<PermissionFeature, string> = {
    home: 'Beranda & Overview Sistem',
    pos: 'Transaksi Kasir POS',
    tables: 'Manajemen Denah Meja',
    inventory: 'Katalog Produk & Stok',
    customers: 'Pelanggan & Loyalti',
    reports: 'Laporan Keuangan & Penjualan',
    ai: 'New Hope AI Copilot',
    settings: 'Pengaturan Toko & Pajak',
    void_order: 'Otorisasi Void Order',
    stock_adjustment: 'Penyesuaian Stok Barang',
    user_management: 'Kelola Pengguna (RBAC)',
    billing_subscription: 'Langganan SaaS & Billing',
  };

  return (
    <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-6 shadow-xs">
      {/* Tab Header & Sub-nav */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h3 className="font-extrabold text-lg text-slate-900 flex items-center space-x-2">
            <ShieldCheck className="w-6 h-6 text-amber-600" />
            <span>Manajemen Pengguna & Hak Akses (RBAC)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Atur peran pengguna (Admin, Manager, Kasir), PIN otentikasi, dan matriks batas akses fitur.
          </p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-2xl space-x-1 text-xs font-bold">
          <button
            onClick={() => setActiveSubTab('USERS')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeSubTab === 'USERS'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Daftar Pengguna ({users.length})
          </button>
          <button
            onClick={() => setActiveSubTab('PERMISSIONS')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeSubTab === 'PERMISSIONS'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Matriks Hak Akses
          </button>
        </div>
      </div>

      {/* Sub-tab 1: User Accounts Table */}
      {activeSubTab === 'USERS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm text-slate-800">
              Daftar Staf & Akun Pengguna Active
            </h4>
            <button
              onClick={handleOpenAdd}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl flex items-center space-x-1.5 shadow-xs transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Pengguna Baru</span>
            </button>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-bold text-[10px]">
                <tr>
                  <th className="px-4 py-3">Pengguna</th>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Role Hak Akses</th>
                  <th className="px-4 py-3">PIN Otorisasi</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(users || []).map((user) => {
                  const isCurrent = currentUser?.id === user.id;

                  return (
                    <tr key={user.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-3">
                          <img
                            src={
                              user.avatar ||
                              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                                user.name
                              )}&background=f59e0b&color=fff`
                            }
                            alt={user.name}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded-xl object-cover border border-slate-200 shrink-0"
                          />
                          <div>
                            <span className="font-bold text-slate-900 block">{user.name}</span>
                            {isCurrent && (
                              <span className="text-[10px] text-emerald-700 font-extrabold">
                                (Akun Anda Saat Ini)
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono text-slate-600">@{user.username}</td>

                      <td className="px-4 py-3">{getRoleBadge(user.role)}</td>

                      <td className="px-4 py-3">
                        <span className="bg-slate-100 border border-slate-200 font-mono font-bold px-2.5 py-1 rounded-lg text-slate-800">
                          •••• ({user.pin})
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        {user.status === 'ACTIVE' ? (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-extrabold text-[10px] border border-emerald-200">
                            Aktif
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-bold text-[10px] border border-slate-200">
                            Non-Aktif
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => handleOpenEdit(user)}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                          title="Edit Pengguna"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        {!isCurrent && (
                          <button
                            onClick={() => deleteUser(user.id)}
                            className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors"
                            title="Hapus Pengguna"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub-tab 2: Permission Matrix */}
      {activeSubTab === 'PERMISSIONS' && (
        <div className="space-y-4">
          <div className="bg-amber-50/80 border border-amber-200 p-4 rounded-2xl text-xs text-amber-900 flex items-start space-x-2.5">
            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Informasi Matriks Akses Role RBAC:</p>
              <p className="mt-0.5 text-amber-800">
                Sistem RBAC New Hope membatasi akses ke menu peka seperti Stok Inventori, Laporan Keuangan, dan Void Order berdasarkan peran pengguna yang login.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
                <tr>
                  <th className="px-4 py-3">Fitur / Modul POS</th>
                  <th className="px-4 py-3 text-center">ADMIN (Pemilik)</th>
                  <th className="px-4 py-3 text-center">MANAGER</th>
                  <th className="px-4 py-3 text-center">KASIR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(Object.keys(featureLabels) as PermissionFeature[]).map((feature) => (
                  <tr key={feature} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {featureLabels[feature]}
                    </td>
                    {(['ADMIN', 'MANAGER', 'CASHIER'] as UserRole[]).map((r) => {
                      const hasAcc = ROLE_PERMISSIONS[r].includes(feature);
                      return (
                        <td key={r} className="px-4 py-3 text-center">
                          {hasAcc ? (
                            <span className="inline-flex items-center space-x-1 text-emerald-700 font-extrabold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 text-[10px]">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Diizinkan</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1 text-rose-600 font-bold bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200 text-[10px]">
                              <Lock className="w-3 h-3 text-rose-500" />
                              <span>Terkunci</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Add/Edit User */}
      {isEditing && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-scale-up">
            <div className="p-5 bg-gradient-to-r from-slate-900 to-amber-950 text-white flex items-center justify-between">
              <h4 className="font-extrabold text-base">
                {editingUser.id ? 'Edit Akun Pengguna' : 'Tambah Pengguna Baru'}
              </h4>
              <button
                onClick={() => setIsEditing(false)}
                className="p-1 text-slate-400 hover:text-white rounded-full"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveUserForm} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Nama Lengkap Staf
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Andi Pratama"
                  value={editingUser.name || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Username Log In
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="andi.kasir"
                    value={editingUser.username || ''}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, username: e.target.value.toLowerCase() })
                    }
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    PIN 4 Digit Otorisasi
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={4}
                    placeholder="1234"
                    value={editingUser.pin || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, pin: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-mono font-bold text-amber-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Role Hak Akses (RBAC)
                </label>
                <select
                  value={editingUser.role || 'CASHIER'}
                  onChange={(e) =>
                    setEditingUser({ ...editingUser, role: e.target.value as UserRole })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="CASHIER">KASIR - Transaksi POS, Meja, & Pelanggan</option>
                  <option value="MANAGER">MANAGER - Operational, Stok, Laporan & Void</option>
                  <option value="ADMIN">ADMIN - Super Owner Full Access & Settings</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  URL Avatar / Foto Profil (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={editingUser.avatar || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, avatar: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="pt-3 flex space-x-3">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md flex items-center justify-center space-x-1"
                >
                  <Save className="w-4 h-4" />
                  <span>Simpan Pengguna</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
