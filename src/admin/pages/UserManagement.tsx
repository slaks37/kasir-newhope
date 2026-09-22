import React, { useState, useMemo } from 'react';
import {
  api,
  ROLE_LABEL,
  ROLE_DESCRIPTION,
  type Identity,
  type InternalRole,
  type InternalCapability,
  internalCapabilities,
  requiresAudit,
  requiresJustification,
} from '../api';
import { Card, Table, Th, Td, Loading, ErrorBox, useAsync } from '../ui';
import {
  ShieldCheck,
  Users,
  KeyRound,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  Search,
  Plus,
  ArrowRight,
  Sparkles,
  Info,
  Sliders,
  Check,
  X,
  UserCheck,
  Layers,
} from 'lucide-react';

interface CapabilityGroup {
  domain: string;
  desc: string;
  items: Array<{
    cap: InternalCapability;
    label: string;
    desc: string;
  }>;
}

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    domain: 'Analitik & Finansial Platform',
    desc: 'Metrik makro tingkat platform, kohor retensi, dan performa omzet agregat.',
    items: [
      {
        cap: 'VIEW_SECTOR_ANALYTICS',
        label: 'Ringkasan 5 Sektor Usaha',
        desc: 'Melihat tren penjualan agregat F&B, Laundry, Ritel, Carwash, dan Barbershop.',
      },
      {
        cap: 'VIEW_PLATFORM_REVENUE',
        label: 'Pendapatan Platform SaaS',
        desc: 'Melihat akumulasi pembayaran langganan, GMV kotor, dan proyeksi omzet platform.',
      },
      {
        cap: 'VIEW_CHURN_COHORT',
        label: 'Analisis Kohor & Churn Rate',
        desc: 'Melihat metrik retensi merchant, tingkat churn, dan status kelangsungan toko.',
      },
      {
        cap: 'VIEW_FEATURE_ADOPTION',
        label: 'Tingkat Adopsi Fitur',
        desc: 'Statistik penggunaan modul KDS, AI Copilot, timbangan laundry, dan split bill.',
      },
    ],
  },
  {
    domain: 'Merchant & Operasional Toko',
    desc: 'Pengawasan kesehatan toko, detail operasional, dan bantuan teknis merchant.',
    items: [
      {
        cap: 'VIEW_MERCHANT_HEALTH',
        label: 'Kesehatan & Direktori Toko',
        desc: 'Melihat daftar merchant, status langganan, dan skor performa toko.',
      },
      {
        cap: 'VIEW_MERCHANT_DETAIL',
        label: 'Detail Privat Merchant',
        desc: 'Melihat data profil toko, cabang, dan konfigurasi sensitif (Wajib Audit Log).',
      },
      {
        cap: 'MANAGE_SUPPORT',
        label: 'Tindakan Dukungan Operasional',
        desc: 'Membantu merchant mengatasi kendala teknis dan mencatat tiket penyelesaian.',
      },
      {
        cap: 'IMPERSONATE_MERCHANT',
        label: 'Mode Penyamaran (Impersonation)',
        desc: 'Masuk sementara ke panel merchant untuk diagnosis teknis tingkat tinggi.',
      },
    ],
  },
  {
    domain: 'Langganan & Lisensi SaaS',
    desc: 'Pengelolaan paket langganan, lisensi outlet, dan kredit layanan AI.',
    items: [
      {
        cap: 'MANAGE_SUBSCRIPTION',
        label: 'Kelola Paket & Lisensi Toko',
        desc: 'Ubah paket Plus/Pro, tambah kuota cabang, dan atur perpanjangan manual.',
      },
      {
        cap: 'GRANT_AI_CREDITS',
        label: 'Pemberian Token AI Copilot',
        desc: 'Menambahkan kuota token AI asisten bisnis untuk merchant tertentu.',
      },
    ],
  },
  {
    domain: 'Log Transaksi & Audit Keamanan',
    desc: 'Pembukuan struk penjualan, mutasi stok, jejak aktivitas, dan audit internal.',
    items: [
      {
        cap: 'VIEW_TRANSACTION_LOG',
        label: 'Log Transaksi & Struk Penjualan',
        desc: 'Melihat rincian nota belanja, metode bayar, dan nominal penjualan merchant.',
      },
      {
        cap: 'VIEW_PRODUCT_SALES',
        label: 'Analisis Produk Terjual',
        desc: 'Melihat data katalog produk dan menu yang paling laris di merchant.',
      },
      {
        cap: 'VIEW_ACTIVITY_LOG',
        label: 'Jejak Aktivitas Toko',
        desc: 'Riwayat perubahan data produk, harga, stok, dan absensi di merchant.',
      },
      {
        cap: 'VIEW_ACCESS_AUDIT',
        label: 'Jejak Audit Akses & RBAC',
        desc: 'Melihat riwayat login administrator, siapa mengakses data apa, dan kelola role.',
      },
    ],
  },
];

export default function UserManagement() {
  const { data, loading, error, reload } = useAsync(() => api.identities(), []);
  const [activeTab, setActiveTab] = useState<'users' | 'matrix' | 'policy'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | InternalRole>('ALL');

  // Modal: Change Role
  const [editingUser, setEditingUser] = useState<Identity | null>(null);
  const [targetRole, setTargetRole] = useState<InternalRole>('ROLE_INTERNAL_SUPPORT');
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [roleUpdateMsg, setRoleUpdateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal: Add User
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<InternalRole>('ROLE_INTERNAL_SUPPORT');
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [addMsg, setAddMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filtered users
  const filteredUsers = useMemo(() => {
    if (!data?.identities) return [];
    return data.identities.filter((user) => {
      const matchSearch =
        user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchRole = roleFilter === 'ALL' || user.role === roleFilter;
      return matchSearch && matchRole;
    });
  }, [data?.identities, searchQuery, roleFilter]);

  const handleOpenEditRole = (user: Identity) => {
    setEditingUser(user);
    setTargetRole(user.role);
    setRoleUpdateMsg(null);
  };

  const handleSaveRole = async () => {
    if (!editingUser) return;
    setIsUpdatingRole(true);
    setRoleUpdateMsg(null);
    try {
      const res = await api.updateUserRole(editingUser.email, targetRole);
      setRoleUpdateMsg({ type: 'success', text: res.message || 'Role berhasil diperbarui!' });
      setTimeout(() => {
        setEditingUser(null);
        reload();
      }, 1200);
    } catch (err: any) {
      setRoleUpdateMsg({
        type: 'error',
        text: err.message || 'Gagal mengubah role pengguna. Pastikan Anda memiliki hak Superadmin.',
      });
    } finally {
      setIsUpdatingRole(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newName.trim()) {
      setAddMsg({ type: 'error', text: 'Email dan nama lengkap wajib diisi.' });
      return;
    }
    setIsAddingUser(true);
    setAddMsg(null);
    try {
      await api.createInternalUser({
        email: newEmail.trim(),
        fullName: newName.trim(),
        role: newRole,
      });
      setAddMsg({ type: 'success', text: 'Operator internal berhasil didaftarkan!' });
      setTimeout(() => {
        setShowAddModal(false);
        setNewEmail('');
        setNewName('');
        setNewRole('ROLE_INTERNAL_SUPPORT');
        reload();
      }, 1200);
    } catch (err: any) {
      setAddMsg({
        type: 'error',
        text: err.message || 'Gagal menambahkan operator internal.',
      });
    } finally {
      setIsAddingUser(false);
    }
  };

  const renderCapabilityStatus = (cap: InternalCapability, role: InternalRole) => {
    const caps = internalCapabilities(role);
    const hasCap = caps.includes(cap);
    const isAudited = requiresAudit(cap);
    const needsJustify = requiresJustification(role, cap);

    if (!hasCap) {
      return (
        <span className="inline-flex items-center gap-1 text-slate-300 font-bold text-xs">
          <X size={14} className="stroke-[2.5]" />
          <span>Dibatasi</span>
        </span>
      );
    }

    if (needsJustify) {
      return (
        <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-md font-extrabold text-[11px]">
          <Lock size={12} className="text-amber-600" />
          <span>Wajib Alasan & Log</span>
        </span>
      );
    }

    if (isAudited) {
      return (
        <span className="inline-flex items-center gap-1 text-sky-800 bg-sky-50 border border-sky-300 px-2 py-0.5 rounded-md font-extrabold text-[11px]">
          <Check size={12} className="text-sky-600" />
          <span>Aktif (Audit Log)</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-md font-extrabold text-[11px]">
        <Check size={12} className="text-emerald-600" />
        <span>Diizinkan</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Heading */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-300 text-[10px] font-black uppercase tracking-wider">
              Role-Based Access Control
            </span>
            <span className="text-xs text-slate-400 font-mono">•</span>
            <span className="text-xs text-slate-500 font-semibold">
              Otorisasi Berlapis Platform
            </span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mt-1 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-rose-600" />
            <span>Manajemen Pengguna &amp; RBAC</span>
          </h1>
          <p className="text-xs text-slate-600 max-w-2xl mt-1 leading-relaxed">
            Tentukan dan pantau wewenang operator internal platform New Hope POS. Setiap peran (role)
            dibatasi secara ketat di tingkat server untuk menjaga privasi data transaksi merchant.
          </p>
        </div>

        <button
          onClick={() => {
            setShowAddModal(true);
            setAddMsg(null);
          }}
          className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 shadow-xs transition-all cursor-pointer"
        >
          <Plus size={16} />
          <span>Tambah Operator Baru</span>
        </button>
      </div>

      {/* Tabs Navigation */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'users'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Users size={16} className="text-amber-500" />
          <span>Pengguna &amp; Hak Akses ({data?.identities?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveTab('matrix')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'matrix'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <KeyRound size={16} className="text-amber-500" />
          <span>Matriks RBAC &amp; Kapabilitas (14 Izin)</span>
        </button>

        <button
          onClick={() => setActiveTab('policy')}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'policy'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
          }`}
        >
          <Sliders size={16} className="text-amber-500" />
          <span>Pedoman &amp; Kebijakan Peran</span>
        </button>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox error={error} />}

      {/* ========================================================================= */}
      {/* TAB 1: DAFTAR PENGGUNA & PENUGASAN ROLE                                   */}
      {/* ========================================================================= */}
      {activeTab === 'users' && data && (
        <Card
          title={
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-600" />
              <span>Daftar Operator Internal Platform</span>
            </div>
          }
          subtitle="Identitas operator berasal dari database internal. Hanya Superadmin yang berhak mengubah role."
        >
          {/* Filters Bar */}
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
            <div className="flex-1 min-w-[240px] relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama operator atau email..."
                className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-xs"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'ALL', label: 'Semua Role' },
                { id: 'ROLE_SUPERADMIN', label: 'Superadmin' },
                { id: 'ROLE_INTERNAL_GROWTH', label: 'Growth' },
                { id: 'ROLE_INTERNAL_SUPPORT', label: 'Support' },
              ].map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRoleFilter(r.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                    roleFilter === r.id
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <Table>
            <thead>
              <tr>
                <Th>Nama Operator</Th>
                <Th>Email Akun</Th>
                <Th>Peran (Role RBAC)</Th>
                <Th>Cakupan Wewenang</Th>
                <Th>Kapabilitas Aktif</Th>
                <Th>Aksi</Th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400 text-xs font-medium">
                    Tidak ada pengguna internal yang sesuai dengan pencarian atau filter.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const roleMeta = ROLE_DESCRIPTION[u.role] || {
                    badge: 'bg-slate-100 text-slate-800 border-slate-200',
                    scope: 'Standard',
                  };
                  const capsCount = internalCapabilities(u.role).length;

                  return (
                    <tr key={u.email} className="hover:bg-slate-50/80 transition-colors">
                      <Td>
                        <div className="flex items-center space-x-2.5">
                          <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                            {u.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-extrabold text-slate-900 text-xs block">
                              {u.full_name}
                            </span>
                            <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              Aktif
                            </span>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <span className="font-mono text-xs text-slate-700">{u.email}</span>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black border ${roleMeta.badge}`}
                        >
                          <ShieldCheck size={12} />
                          <span>{ROLE_LABEL[u.role]}</span>
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs text-slate-600 font-medium">{roleMeta.scope}</span>
                      </Td>
                      <Td>
                        <span className="text-xs font-mono font-bold text-slate-800 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-lg">
                          {capsCount} dari 14 Izin
                        </span>
                      </Td>
                      <Td>
                        <button
                          onClick={() => handleOpenEditRole(u)}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Sliders size={13} />
                          <span>Ubah Role</span>
                        </button>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: MATRIKS RBAC & KAPABILITAS                                         */}
      {/* ========================================================================= */}
      {activeTab === 'matrix' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-amber-500/10 via-amber-50 to-transparent border border-amber-200 rounded-3xl p-5 flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-700 space-y-1">
              <p className="font-extrabold text-slate-900 text-sm">
                Matriks Hak Akses Granular Berdasarkan Peran (Capabilities Matrix)
              </p>
              <p className="leading-relaxed">
                Platform New Hope POS menerapkan prinsip <i>Least Privilege</i> (hak akses minimum yang dibutuhkan)
                dan pemisahan wewenang (<i>Separation of Duty</i>). Pengecekan dilakukan langsung oleh server API pada setiap permintaan.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {CAPABILITY_GROUPS.map((group, gIdx) => (
              <Card
                key={gIdx}
                title={
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-amber-600" />
                    <span>{group.domain}</span>
                  </div>
                }
                subtitle={group.desc}
              >
                <Table>
                  <thead>
                    <tr>
                      <Th>Kapabilitas &amp; Deskripsi</Th>
                      <Th>
                        <div className="text-center">
                          <span className="block font-black text-rose-800">Superadmin</span>
                          <span className="text-[10px] text-slate-400 font-normal">Akses Penuh</span>
                        </div>
                      </Th>
                      <Th>
                        <div className="text-center">
                          <span className="block font-black text-emerald-800">Growth</span>
                          <span className="text-[10px] text-slate-400 font-normal">Analitik Makro</span>
                        </div>
                      </Th>
                      <Th>
                        <div className="text-center">
                          <span className="block font-black text-sky-800">Support</span>
                          <span className="text-[10px] text-slate-400 font-normal">Operasional</span>
                        </div>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.cap} className="hover:bg-slate-50/80 transition-colors">
                        <Td>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-xs text-slate-900">
                                {item.label}
                              </span>
                              <code className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1 py-0.5 rounded">
                                {item.cap}
                              </code>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">{item.desc}</p>
                          </div>
                        </Td>
                        <Td>
                          <div className="flex justify-center">
                            {renderCapabilityStatus(item.cap, 'ROLE_SUPERADMIN')}
                          </div>
                        </Td>
                        <Td>
                          <div className="flex justify-center">
                            {renderCapabilityStatus(item.cap, 'ROLE_INTERNAL_GROWTH')}
                          </div>
                        </Td>
                        <Td>
                          <div className="flex justify-center">
                            {renderCapabilityStatus(item.cap, 'ROLE_INTERNAL_SUPPORT')}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: PEDOMAN & KEBIJAKAN PERAN                                          */}
      {/* ========================================================================= */}
      {activeTab === 'policy' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card Superadmin */}
          <div className="bg-white border-2 border-rose-300 rounded-3xl p-6 space-y-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-rose-500 text-white px-3 py-1 rounded-bl-2xl text-[10px] font-black uppercase tracking-wider">
              Akses Penuh
            </div>
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
              <ShieldCheck size={26} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">ROLE_SUPERADMIN</h3>
              <p className="text-xs text-slate-500 font-medium">Administrator Utama Sistem</p>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Memiliki kontrol penuh atas seluruh platform, termasuk penagihan langganan SaaS,
              manajemen pengguna internal, modifikasi kuota outlet, dan pengawasan audit trail.
            </p>
            <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
              <span className="font-bold text-slate-900 block">Karakteristik &amp; Wewenang:</span>
              <ul className="space-y-1.5 text-slate-600 text-[11px] list-disc list-inside">
                <li>Dapat mengakses seluruh 14 kapabilitas internal.</li>
                <li>Dapat mengubah role pengguna internal lainnya.</li>
                <li>Dapat mengelola paket langganan dan kuota outlet.</li>
                <li>Dapat melihat audit jejak akses seluruh operator.</li>
              </ul>
            </div>
          </div>

          {/* Card Growth */}
          <div className="bg-white border-2 border-emerald-300 rounded-3xl p-6 space-y-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-emerald-500 text-white px-3 py-1 rounded-bl-2xl text-[10px] font-black uppercase tracking-wider">
              Analitik Makro
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              <Sparkles size={26} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">ROLE_INTERNAL_GROWTH</h3>
              <p className="text-xs text-slate-500 font-medium">Tim Riset, Pasar &amp; Pertumbuhan</p>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Berfokus pada pertumbuhan bisnis dan metrik tingkat makro tanpa diberikan akses ke data pribadi
              (PII) maupun pembukuan detail merchant individual.
            </p>
            <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
              <span className="font-bold text-slate-900 block">Karakteristik &amp; Wewenang:</span>
              <ul className="space-y-1.5 text-slate-600 text-[11px] list-disc list-inside">
                <li>Melihat ringkasan omzet agregat 5 sektor bisnis.</li>
                <li>Melihat kohor retensi dan churn rate merchant.</li>
                <li>Dilarang membaca transaksi struk individual.</li>
                <li>Dilarang mengubah langganan atau lisensi toko.</li>
              </ul>
            </div>
          </div>

          {/* Card Support */}
          <div className="bg-white border-2 border-sky-300 rounded-3xl p-6 space-y-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-sky-500 text-white px-3 py-1 rounded-bl-2xl text-[10px] font-black uppercase tracking-wider">
              Operasional
            </div>
            <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
              <UserCheck size={26} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">ROLE_INTERNAL_SUPPORT</h3>
              <p className="text-xs text-slate-500 font-medium">Layanan Bantuan &amp; Operasional</p>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Membantu merchant memecahkan kendala teknis satu per satu. Setiap akses ke data privat
              merchant wajib menyertakan alasan (justifikasi) dan dicatat permanen ke log audit.
            </p>
            <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
              <span className="font-bold text-slate-900 block">Karakteristik &amp; Wewenang:</span>
              <ul className="space-y-1.5 text-slate-600 text-[11px] list-disc list-inside">
                <li>Melihat direktori dan status kesehatan toko.</li>
                <li>Melihat log transaksi spesifik dengan alasan justifikasi.</li>
                <li>Dilarang melihat pendapatan platform global.</li>
                <li>Dilarang mengubah role pengguna lain.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: UBAH ROLE PENGGUNA                                                 */}
      {/* ========================================================================= */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full text-slate-900 space-y-5 shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-amber-600" />
                  <span>Ubah Role &amp; Hak Akses Pengguna</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tentukan wewenang dan batasan akses untuk operator ini.
                </p>
              </div>
              <button
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-slate-700 text-sm p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* Profile snapshot */}
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
              <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">
                Target Operator:
              </span>
              <p className="text-sm font-black text-slate-900">{editingUser.full_name}</p>
              <p className="text-xs font-mono text-slate-600">{editingUser.email}</p>
            </div>

            {/* Role Options */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-slate-700 block">
                Pilih Role Baru:
              </label>

              {(['ROLE_SUPERADMIN', 'ROLE_INTERNAL_GROWTH', 'ROLE_INTERNAL_SUPPORT'] as InternalRole[]).map(
                (roleKey) => {
                  const meta = ROLE_DESCRIPTION[roleKey];
                  const isSelected = targetRole === roleKey;

                  return (
                    <div
                      key={roleKey}
                      onClick={() => setTargetRole(roleKey)}
                      className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-amber-500 bg-amber-50/50 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="targetRole"
                            checked={isSelected}
                            onChange={() => setTargetRole(roleKey)}
                            className="accent-amber-500 cursor-pointer"
                          />
                          <span className="font-extrabold text-xs text-slate-900">
                            {meta.title}
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${meta.badge}`}>
                          {meta.scope}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 pl-5 leading-relaxed">
                        {meta.desc}
                      </p>
                    </div>
                  );
                }
              )}
            </div>

            {roleUpdateMsg && (
              <div
                className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
                  roleUpdateMsg.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                    : 'bg-rose-50 text-rose-800 border border-rose-300'
                }`}
              >
                {roleUpdateMsg.type === 'success' ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <AlertTriangle size={16} />
                )}
                <span>{roleUpdateMsg.text}</span>
              </div>
            )}

            <div className="flex justify-end items-center gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isUpdatingRole}
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-all cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isUpdatingRole || targetRole === editingUser.role}
                onClick={handleSaveRole}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isUpdatingRole ? 'Menyimpan Role...' : 'Simpan Perubahan Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: TAMBAH OPERATOR BARU                                               */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full text-slate-900 space-y-4 shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-amber-600" />
                  <span>Daftarkan Operator Internal Baru</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tambahkan akun ke database operator dengan wewenang yang ditentukan.
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 text-sm p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Nama Lengkap Operator:</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Cth: Budi Santoso"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Email Akun (Supabase Auth):</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="operator@perusahaan.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Peran Awal (Role):</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as InternalRole)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                >
                  <option value="ROLE_INTERNAL_SUPPORT">Support (Operasional Merchant)</option>
                  <option value="ROLE_INTERNAL_GROWTH">Growth (Agregat &amp; Analitik)</option>
                  <option value="ROLE_SUPERADMIN">Superadmin (Akses Penuh)</option>
                </select>
              </div>

              {addMsg && (
                <div
                  className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
                    addMsg.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                      : 'bg-rose-50 text-rose-800 border border-rose-300'
                  }`}
                >
                  {addMsg.type === 'success' ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <AlertTriangle size={16} />
                  )}
                  <span>{addMsg.text}</span>
                </div>
              )}

              <div className="flex justify-end items-center gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isAddingUser}
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isAddingUser}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs rounded-xl shadow-xs transition-all cursor-pointer"
                >
                  {isAddingUser ? 'Mendaftarkan...' : 'Daftarkan Operator'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
