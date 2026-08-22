import { Fragment, useState } from 'react';
import { api, angka, rupiah, waktu, SEVERITY_STYLE } from '../api';
import {
  Card, Chip, Empty, ErrorBox, Loading, Pagination, SearchBox, SectorChip, SectorFilter,
  Select, Table, Td, Th, useAsync,
} from '../ui';

const MODULES = ['POS', 'TABLES', 'INVENTORY', 'CUSTOMERS', 'REPORTS', 'AI', 'SETTINGS', 'SYNC', 'AUTH']
  .map((m) => ({ value: m, label: m }));

const SEVERITIES = [
  { value: 'INFO', label: 'Info' },
  { value: 'NOTICE', label: 'Perlu dicatat' },
  { value: 'WARNING', label: 'Peringatan' },
  { value: 'CRITICAL', label: 'Kritis' },
];

export default function ActivityPage({ sector, onSector }: { sector: string; onSector: (s: string) => void }) {
  const [search, setSearch] = useState('');
  const [mod, setMod] = useState('');
  const [sev, setSev] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const reset = () => setOffset(0);
  const { data, loading, error } = useAsync(
    () => api.activity({ sector, search, module: mod, severity: sev, offset, limit: 50 }),
    [sector, search, mod, sev, offset]
  );

  return (
    <Card
      title="Jejak aktivitas"
      subtitle="Bukan hanya penjualan: penyesuaian stok, perubahan harga, login gagal, diskon berlebih, sinkronisasi. Append-only."
      actions={<SearchBox value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder="Cari kejadian…" />}
    >
      <div className="space-y-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <SectorFilter value={sector} onChange={(v) => { onSector(v); reset(); }} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={mod} onChange={(v) => { setMod(v); reset(); }} options={MODULES} placeholder="Semua modul aplikasi" />
          <Select value={sev} onChange={(v) => { setSev(v); reset(); }} options={SEVERITIES} placeholder="Semua tingkat" />
          <button
            onClick={() => { setSev('WARNING'); reset(); }}
            className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 ring-inset hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800"
          >
            Peringatan saja
          </button>
          <button
            onClick={() => { setSev('CRITICAL'); reset(); }}
            className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 ring-inset hover:bg-red-100 dark:bg-red-950 dark:text-red-300 dark:ring-red-800"
          >
            Kritis saja
          </button>
          {(mod || sev) && (
            <button
              onClick={() => { setMod(''); setSev(''); reset(); }}
              className="text-xs font-medium text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
            >
              Bersihkan
            </button>
          )}
        </div>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox error={error} />}

      {data && (data.rows.length === 0 ? (
        <Empty label="Tidak ada kejadian yang cocok" />
      ) : (
        <>
          <div className="bg-slate-50 px-4 py-2.5 text-xs text-slate-500 dark:bg-slate-800/40">
            <b className="text-slate-900 tabular-nums dark:text-slate-100">{angka(data.total)}</b> kejadian
          </div>

          <Table>
            <thead>
              <tr>
                <Th>Waktu</Th>
                <Th>Sektor</Th>
                <Th>Modul</Th>
                <Th>Kejadian</Th>
                <Th>Keterangan</Th>
                <Th>Merchant</Th>
                <Th>Pelaku</Th>
                <Th align="right">Nilai</Th>
                <Th>Tingkat</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((a: any) => (
                // Key harus di Fragment, bukan di <tr> di dalamnya: satu baris
                // data menghasilkan dua elemen, dan React mengurutkan yang
                // dikembalikan map, bukan isinya.
                <Fragment key={a.id}>
                  <tr
                    onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                    className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <Td className="text-xs">{waktu(a.occurred_at)}</Td>
                    <Td><SectorChip sector={a.business_sector} /></Td>
                    <Td><Chip>{a.app_module}</Chip></Td>
                    <Td className="font-mono text-xs">{a.event_type}</Td>
                    <Td className="max-w-xs truncate text-slate-900 dark:text-slate-100">{a.summary}</Td>
                    <Td className="text-xs">{a.merchant_name}</Td>
                    <Td className="text-xs">
                      {a.actor_name ?? '—'}
                      {a.actor_role && <span className="ml-1 text-slate-400">({a.actor_role})</span>}
                    </Td>
                    <Td align="right">{a.amount_idr == null ? '—' : rupiah(a.amount_idr)}</Td>
                    <Td><Chip tone={SEVERITY_STYLE[a.severity]}>{a.severity}</Chip></Td>
                  </tr>
                  {expanded === a.id && (
                    <tr>
                      <td colSpan={9} className="border-b border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                        <p className="mb-1 text-xs font-medium text-slate-500">Detail mentah</p>
                        <pre className="overflow-x-auto rounded-lg bg-white p-2.5 font-mono text-xs text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                          {JSON.stringify(a.detail, null, 2)}
                        </pre>
                        <p className="mt-1.5 font-mono text-xs text-slate-400">
                          client_key: {a.client_key ?? '—'}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
          <Pagination offset={data.offset} limit={data.limit} total={data.total} onChange={setOffset} />
        </>
      ))}
    </Card>
  );
}
