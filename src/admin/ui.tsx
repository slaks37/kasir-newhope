/** Primitif tampilan bersama untuk admin panel dengan kontras warna tinggi dan tipografi tajam. */

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
      className={`rounded-2xl border border-slate-200/90 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-base font-extrabold text-slate-900 dark:text-slate-100">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 font-medium dark:text-slate-400">{subtitle}</p>
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
  if (!s) return <span className="text-xs text-slate-500 font-bold">{sector}</span>;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {SECTOR_SHORT[sector as Sector]}
    </span>
  );
}

export function Chip({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${
        tone ||
        'bg-slate-100 text-slate-800 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700'
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
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange('')}
        className={`rounded-xl px-3 py-1.5 text-xs font-black transition-all cursor-pointer ${
          value === ''
            ? 'bg-slate-900 text-white shadow-xs dark:bg-slate-100 dark:text-slate-900'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
        }`}
      >
        Semua Sektor Usaha
      </button>
      {SECTORS.map((s) => (
        <button
          key={s}
          onClick={() => onChange(value === s ? '' : s)}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black transition-all cursor-pointer ${
            value === s
              ? 'bg-slate-900 text-white shadow-xs dark:bg-slate-100 dark:text-slate-900'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${SECTOR_STYLE[s].dot}`} />
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
      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
      className="w-full min-w-48 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:w-64 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
    />
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left text-xs">{children}</table>
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
      className={`whitespace-nowrap border-b border-slate-200 bg-slate-100/90 px-4 py-3 text-[11px] font-black tracking-wider text-slate-700 uppercase dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 ${
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
      className={`border-b border-slate-100 px-4 py-3 whitespace-nowrap text-slate-800 dark:border-slate-800/80 dark:text-slate-200 ${
        align === 'right' ? 'text-right tabular-nums' : ''
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function Pagination(props: {
  offset?: number;
  limit?: number;
  total?: number;
  onChange?: (offset: number) => void;
  hasMore?: boolean;
  onNext?: () => void;
  onPrev?: () => void;
  canPrev?: boolean;
}) {
  if (props.offset !== undefined && props.limit !== undefined && props.total !== undefined && props.onChange) {
    const { offset, limit, total, onChange } = props;
    const canPrev = offset > 0;
    const hasMore = offset + limit < total;
    return (
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 bg-slate-50/50">
        <span className="text-xs text-slate-500 font-medium">
          Menampilkan <b className="text-slate-900">{Math.min(offset + 1, total)}</b>–<b className="text-slate-900">{Math.min(offset + limit, total)}</b> dari <b className="text-slate-900">{total}</b> data
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={!canPrev}
            onClick={() => onChange(Math.max(0, offset - limit))}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer shadow-2xs"
          >
            ← Sebelumnya
          </button>
          <button
            disabled={!hasMore}
            onClick={() => onChange(offset + limit)}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer shadow-2xs"
          >
            Selanjutnya →
          </button>
        </div>
      </div>
    );
  }

  const { hasMore = false, onNext, onPrev, canPrev = false } = props;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 bg-slate-50/50">
      <button
        disabled={!canPrev}
        onClick={onPrev}
        className="rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer shadow-2xs"
      >
        ← Sebelumnya
      </button>
      <button
        disabled={!hasMore}
        onClick={onNext}
        className="rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer shadow-2xs"
      >
        Selanjutnya →
      </button>
    </div>
  );
}

export function Empty({ label = 'Tidak ada data yang cocok' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center text-slate-400 dark:text-slate-500">
      <Inbox className="h-8 w-8 stroke-1" />
      <p className="mt-2 text-xs font-medium text-slate-600 dark:text-slate-400">{label}</p>
    </div>
  );
}

export function Loading({ label = 'Memuat data dari server...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-12 text-xs font-semibold text-slate-600 dark:text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error }: { error: { code?: string; message: string } }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 flex items-start gap-3 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
      <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
      <div>
        <p className="font-extrabold">{error.code || 'Terjadi Kesalahan'}</p>
        <p className="mt-0.5 leading-relaxed">{error.message}</p>
      </div>
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fn()
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError({ code: err.code, message: err.message || 'Gagal memuat data' });
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: () => setLoading(true) };
}
