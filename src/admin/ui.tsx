/** Primitif tampilan bersama untuk admin panel. */

import React from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { SECTORS, SECTOR_SHORT, SECTOR_STYLE, type Sector } from './api';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function SectorChip({ sector }: { sector: string }) {
  const s = SECTOR_STYLE[sector as Sector];
  if (!s) return <span className="text-xs text-slate-400">{sector}</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {SECTOR_SHORT[sector as Sector]}
    </span>
  );
}

export function Chip({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        tone ||
        'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
      }`}
    >
      {children}
    </span>
  );
}

/** Filter sektor — kontrol utama seluruh panel, jadi selalu di posisi sama. */
export function SectorFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => onChange('')}
        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
          value === ''
            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
        }`}
      >
        Semua sektor
      </button>
      {SECTORS.map((s) => (
        <button
          key={s}
          onClick={() => onChange(value === s ? '' : s)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
            value === s
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${SECTOR_STYLE[s].dot}`} />
          {SECTOR_SHORT[s]}
        </button>
      ))}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full min-w-40 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 sm:w-56 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
    />
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  // Tabel lebar menggulung di dalam wadahnya sendiri; halaman tidak pernah
  // menggulung ke samping.
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-slate-100 px-4 py-2.5 text-xs font-medium tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400 ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className = '',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td
      className={`border-b border-slate-50 px-4 py-2.5 whitespace-nowrap text-slate-700 dark:border-slate-800/60 dark:text-slate-300 ${
        align === 'right' ? 'text-right tabular-nums' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function Loading({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
      <Inbox className="h-6 w-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/**
 * Error ditampilkan apa adanya, termasuk kodenya.
 * CAPABILITY_DENIED bukan kegagalan — itu RBAC yang bekerja — jadi dibedakan
 * dari error sungguhan agar tidak terbaca sebagai aplikasi rusak.
 */
export function ErrorBox({ error }: { error: { code?: string; message: string } }) {
  const denied = error.code === 'CAPABILITY_DENIED' || error.code === 'JUSTIFICATION_REQUIRED';
  return (
    <div
      className={`m-4 flex items-start gap-3 rounded-lg p-4 ring-1 ring-inset ${
        denied
          ? 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900'
          : 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900'
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{denied ? 'Akses ditolak oleh RBAC' : 'Terjadi kesalahan'}</p>
        <p className="mt-0.5 opacity-90">{error.message}</p>
        {error.code && <p className="mt-1 font-mono text-xs opacity-60">{error.code}</p>}
      </div>
    </div>
  );
}

export function Pagination({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
      <span>
        {from.toLocaleString('id-ID')}–{to.toLocaleString('id-ID')} dari{' '}
        {total.toLocaleString('id-ID')}
      </span>
      <div className="flex gap-1.5">
        <button
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
          className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium disabled:opacity-40 enabled:hover:bg-slate-50 dark:border-slate-700 dark:enabled:hover:bg-slate-800"
        >
          Sebelumnya
        </button>
        <button
          disabled={to >= total}
          onClick={() => onChange(offset + limit)}
          className="rounded-lg border border-slate-200 px-2.5 py-1 font-medium disabled:opacity-40 enabled:hover:bg-slate-50 dark:border-slate-700 dark:enabled:hover:bg-slate-800"
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
}

/** Hook pengambil data dengan pembatalan — hasil basi tidak boleh menimpa yang baru. */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [state, setState] = React.useState<{
    data: T | null;
    loading: boolean;
    error: { code?: string; message: string } | null;
  }>({ data: null, loading: true, error: null });

  React.useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => alive && setState({ data, loading: false, error: null }),
      (err) =>
        alive &&
        setState({
          data: null,
          loading: false,
          error: { code: err?.code, message: err?.message ?? 'Gagal memuat' },
        })
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
