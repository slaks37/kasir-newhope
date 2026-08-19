/**
 * User Admin & Client.
 *
 * Dua daftar yang sengaja tidak dicampur: akun KONSOL INTERNAL (yang bisa
 * melihat data lintas merchant) dan STAF MERCHANT (kasir di toko). Keduanya
 * hidup di tabel berbeda sejak awal, dan itu bukan detail teknis — kalau
 * SUPERADMIN hanya satu nilai lagi di kolom role staf, satu bug mass-assignment
 * di form pengaturan merchant menjadi jalan ke seluruh data semua tenant.
 *
 * MENETAPKAN PASSWORD ORANG LAIN TIDAK ADA DI SINI, dan itu disengaja. Admin
 * yang bisa mengetikkan password rekannya tahu password itu; tindakan atas nama
 * seseorang lalu berhenti membuktikan orang itu yang melakukannya. Yang tersedia
 * hanya MENCABUT — pemiliknya menetapkan sendiri lewat `npm run admin:password`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Shield,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import {
  api,
  waktu,
  sejak,
  ROLE_LABEL,
  SECTOR_LABEL,
  type InternalUserRow,
  type InternalRole,
  type Sector,
} from '../api';
import { Card, ErrorBox, Empty, Loading, SearchBox, SectorFilter, Table, Td, Th } from '../ui';

const ROLES: InternalRole[] = ['ROLE_SUPERADMIN', 'ROLE_INTERNAL_GROWTH', 'ROLE_INTERNAL_SUPPORT'];

const ROLE_TONE: Record<InternalRole, string> = {
  ROLE_SUPERADMIN: 'bg-rose-100 text-rose-900 border-rose-300',
  ROLE_INTERNAL_GROWTH: 'bg-sky-100 text-sky-900 border-sky-300',
  ROLE_INTERNAL_SUPPORT: 'bg-emerald-100 text-emerald-900 border-emerald-300',
};

const kelasInput =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

/* -------------------------------------------------------------------------- */
/* UNDANG AKUN                                                                 */
/* -------------------------------------------------------------------------- */

function ModalUndang({
  onTutup,
  onSelesai,
}: {
  onTutup: () => void;
  onSelesai: () => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<InternalRole>('ROLE_INTERNAL_SUPPORT');
  const [galat, setGalat] = useState<string | null>(null);
  const [kirim, setKirim] = useState(false);

  const simpan = async () => {
    setKirim(true);
    setGalat(null);
    try {
      await api.inviteInternalUser({ email, fullName, role });
      onSelesai();
    } catch (e: any) {
      setGalat(e.message);
    } finally {
      setKirim(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="my-10 w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <header className="flex items-center gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <UserCog className="h-5 w-5 text-slate-500" />
          <h2 className="flex-1 text-base font-bold text-slate-900 dark:text-slate-100">
            Undang Akun Internal
          </h2>
          <button onClick={onTutup} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-6">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Email</span>
            <input className={kelasInput} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@perusahaan.com" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Nama Lengkap</span>
            <input className={kelasInput} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nama yang muncul di jejak audit" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Role</span>
            <select className={kelasInput} value={role} onChange={(e) => setRole(e.target.value as InternalRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </label>

          <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs leading-relaxed">
              Akun dibuat <b>tanpa password</b> dan belum bisa dipakai masuk. Pemiliknya menetapkan
              sendiri lewat <code className="font-mono">npm run admin:password -- {email || 'email'}</code>.
              Password yang pernah melewati chat bukan lagi rahasia.
            </p>
          </div>

          {galat && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{galat}</span>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button onClick={onTutup} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Batal
          </button>
          <button
            onClick={simpan}
            disabled={kirim || !email || !fullName}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
          >
            {kirim ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Undang
          </button>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* HALAMAN                                                                     */
/* -------------------------------------------------------------------------- */

type Tab = 'ADMIN_USERS' | 'CLIENT_USERS';

export default function UserManagement() {
  const [tab, setTab] = useState<Tab>('ADMIN_USERS');
  const [rows, setRows] = useState<InternalUserRow[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<{ code?: string; message: string } | null>(null);
  const [undang, setUndang] = useState(false);
  const [sibuk, setSibuk] = useState<string | null>(null);

  const [sector, setSector] = useState('');
  const [search, setSearch] = useState('');
  const [staff, setStaff] = useState<any>(null);
  const [staffMemuat, setStaffMemuat] = useState(false);

  const muat = useCallback(() => {
    setMemuat(true);
    api
      .internalUsers()
      .then((d) => {
        setRows(d.rows);
        setGalat(null);
      })
      .catch((e) => setGalat({ code: e.code, message: e.message }))
      .finally(() => setMemuat(false));
  }, []);

  useEffect(muat, [muat]);

  useEffect(() => {
    if (tab !== 'CLIENT_USERS') return;
    setStaffMemuat(true);
    api
      .merchantStaff({ sector, search, limit: 100 })
      .then(setStaff)
      .catch((e) => setGalat({ code: e.code, message: e.message }))
      .finally(() => setStaffMemuat(false));
  }, [tab, sector, search]);

  const ubah = async (
    id: string,
    change: { role?: string; isActive?: boolean; revokePassword?: boolean }
  ) => {
    setSibuk(id);
    setGalat(null);
    try {
      const { user } = await api.updateInternalUser(id, change);
      setRows((xs) => xs.map((x) => (x.id === user.id ? user : x)));
    } catch (e: any) {
      // Penolakan seperti "ini satu-satunya superadmin" adalah informasi, bukan
      // kerusakan — ditampilkan apa adanya supaya admin tahu harus apa.
      setGalat({ code: e.code, message: e.message });
    } finally {
      setSibuk(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">User Admin &amp; Client</h1>
          <p className="text-xs text-slate-500">
            Akun konsol internal dan staf kasir merchant. Keduanya sengaja terpisah.
          </p>
        </div>
        <button onClick={muat} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          <RotateCcw className="h-3.5 w-3.5" /> Muat ulang
        </button>
        {tab === 'ADMIN_USERS' && (
          <button onClick={() => setUndang(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900">
            <Plus className="h-3.5 w-3.5" /> Undang Akun
          </button>
        )}
      </div>

      <div className="flex gap-1">
        {([
          ['ADMIN_USERS', 'Akun Konsol Internal', ShieldCheck],
          ['CLIENT_USERS', 'Staf Kasir Merchant', Building2],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === id
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {galat && <ErrorBox error={galat} />}

      {tab === 'ADMIN_USERS' &&
        (memuat ? (
          <Loading label="Memuat akun internal..." />
        ) : (
          <Card
            title="Akun Konsol Internal"
            subtitle="Bisa melihat data lintas merchant. Setiap tindakannya tercatat di Jejak Akses."
          >
            <Table>
              <thead>
                <tr>
                  <Th>Akun</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Login Terakhir</Th>
                  <Th>Tindakan</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <span className="block font-semibold text-slate-900 dark:text-slate-100">{u.fullName}</span>
                      <span className="block font-mono text-[11px] text-slate-500">{u.email}</span>
                    </Td>
                    <Td>
                      <select
                        value={u.role}
                        disabled={sibuk === u.id}
                        onChange={(e) => ubah(u.id, { role: e.target.value })}
                        className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${ROLE_TONE[u.role]} disabled:opacity-50`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-1">
                        <span
                          className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                            u.isActive
                              ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                              : 'border-slate-300 bg-slate-100 text-slate-600'
                          }`}
                        >
                          {u.isActive ? 'AKTIF' : 'NONAKTIF'}
                        </span>
                        {!u.hasPassword && (
                          <span className="w-fit rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                            BELUM BISA LOGIN
                          </span>
                        )}
                        {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-900">
                            <Lock className="h-2.5 w-2.5" /> TERKUNCI
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td className="text-[11px] text-slate-600 dark:text-slate-400">
                      {u.lastLoginAt ? sejak(u.lastLoginAt) : 'belum pernah'}
                      {u.failedLoginCount > 0 && (
                        <span className="block text-rose-600">{u.failedLoginCount}× gagal</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => ubah(u.id, { isActive: !u.isActive })}
                          disabled={sibuk === u.id}
                          className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        {u.hasPassword && (
                          <button
                            onClick={() => ubah(u.id, { revokePassword: true })}
                            disabled={sibuk === u.id}
                            title="Mencabut password. Pemiliknya menetapkan yang baru lewat npm run admin:password."
                            className="rounded-lg border border-amber-300 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-40"
                          >
                            Cabut Password
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {rows.length === 0 && <Empty label="Belum ada akun internal." />}

            <div className="flex items-start gap-2.5 border-t border-slate-200 px-5 py-3 text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <Shield className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-[11px] leading-relaxed">
                Akun tidak bisa dihapus, hanya dinonaktifkan — jejak audit menunjuk barisnya, dan
                jejak yang kehilangan pelakunya berhenti menjadi jejak audit. Superadmin terakhir
                yang masih bisa login tidak bisa diturunkan atau dinonaktifkan.
              </p>
            </div>
          </Card>
        ))}

      {tab === 'CLIENT_USERS' && (
        <>
          <div className="flex flex-wrap gap-3">
            <SectorFilter value={sector} onChange={setSector} />
            <SearchBox value={search} onChange={setSearch} placeholder="Cari nama staf atau toko..." />
          </div>

          {staffMemuat ? (
            <Loading label="Memuat staf merchant..." />
          ) : (
            <Card
              title={`Staf Kasir Merchant (${staff?.total ?? 0})`}
              subtitle="Hanya baca. PIN tidak pernah ikut dikirim ke konsol internal."
            >
              <Table>
                <thead>
                  <tr>
                    <Th>Staf</Th>
                    <Th>Toko</Th>
                    <Th>Sektor</Th>
                    <Th>Peran</Th>
                    <Th>PIN</Th>
                  </tr>
                </thead>
                <tbody>
                  {(staff?.rows ?? []).map((u: any) => (
                    <tr key={u.id}>
                      <Td>
                        <span className="block font-semibold text-slate-900 dark:text-slate-100">{u.name}</span>
                        <span className="block font-mono text-[11px] text-slate-500">{u.username}</span>
                      </Td>
                      <Td className="text-slate-700 dark:text-slate-300">{u.merchant_name}</Td>
                      <Td className="text-[11px] text-slate-600 dark:text-slate-400">
                        {SECTOR_LABEL[u.business_sector as Sector] ?? u.business_sector}
                      </Td>
                      <Td>
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {u.role}
                        </span>
                      </Td>
                      <Td className="text-[11px] text-slate-600 dark:text-slate-400">
                        {u.pin_terpasang ? 'Terpasang' : 'Belum diatur'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {(staff?.rows ?? []).length === 0 && <Empty label="Belum ada staf merchant yang tersinkronisasi." />}
            </Card>
          )}
        </>
      )}

      {undang && (
        <ModalUndang
          onTutup={() => setUndang(false)}
          onSelesai={() => {
            setUndang(false);
            muat();
          }}
        />
      )}
    </div>
  );
}
