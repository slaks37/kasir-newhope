import React, { useEffect, useState } from 'react';
import { useBusinessModule } from './ModuleWorkspaceGate';
import { modulePath } from './routing';
import { navigate } from '../../lib/navigation/workspaceRouter';
import { refreshCoordinator, coalescedRead } from '../../lib/sync/refreshCoordinator';
type Metrics = { buckets: { status: string; count: number }[]; total: number; generatedAt: string };
export default function OperationalDashboard({ title, description, labels }: { title: string; description: string; labels: Record<string, string> }) {
  const runtime = useBusinessModule()!;
  const { access, manifest, grant } = runtime;
  const key = JSON.stringify([access.businessId, access.outletId, manifest.id]);
  const [state, setState] = useState<{ key: string; metrics?: Metrics; error?: string }>({ key });
  useEffect(() => {
    const controller = new AbortController();
    const url = '/api/v1/sync/modules/dashboard?' + new URLSearchParams({ businessId: access.businessId, outletId: access.outletId, moduleId: manifest.id, page: 'dashboard' });
    const run = async () => {
      try {
        const metrics = await coalescedRead(url, async () => {
          const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
          const result = await response.json();
          if (!response.ok || !result.ok) throw Error(result.error || 'DASHBOARD_UNAVAILABLE');
          return result as Metrics;
        }, controller.signal);
        if (!controller.signal.aborted) setState({ key, metrics });
      } catch (error) { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : 'DASHBOARD_UNAVAILABLE' }); }
    };
    const off = refreshCoordinator.register('module-dashboard:' + key, { run, interval: 120000, events: ['financial-updated','outlets-updated'] });
    return () => { controller.abort(); off(); };
  }, [key]);
  const current = state.key === key ? state : { key };
  const operations = manifest.pages.find(p => p.id === 'operations')!;
  const canOperate = grant.permissions.includes(operations.permission) && grant.features.includes(operations.permission);
  return <section className="flex-1 overflow-auto bg-slate-50 p-6 md:p-10"><div className="max-w-5xl mx-auto space-y-6">
    <header><p className="text-sm text-slate-500">{manifest.name}</p><h1 className="text-3xl font-bold mt-2">{title}</h1><p className="mt-3 text-slate-600">{description}</p></header>
    <aside className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="font-semibold">Batas fitur pilot</p>{manifest.limitations.map(limit => <p key={limit} className="text-sm mt-2">{limit}</p>)}</aside>
    <ol className="flex flex-wrap gap-3" aria-label="Alur sektor">{manifest.workflow.map((step, index) => <li key={step} className="rounded-xl bg-white border px-4 py-3">{index + 1}. {step}</li>)}</ol>
    {current.error ? <p role="alert">Ringkasan belum tersedia: {current.error}</p> : !current.metrics ? <p role="status">Memuat ringkasan operasional…</p> : <>
      <div className="grid gap-4 sm:grid-cols-3">{current.metrics.buckets.map(bucket => <article key={bucket.status} className="rounded-2xl border bg-white p-6"><p className="text-slate-600">{labels[bucket.status] || bucket.status}</p><p className="text-3xl font-bold mt-2">{bucket.count}</p></article>)}</div>
      {!current.metrics.total && <p>Belum ada catatan operasional tersinkron di ruang kerja ini.</p>}
      <p className="text-xs text-slate-500">Ringkasan catatan operasional tersinkron · {new Date(current.metrics.generatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB. Draf dan antrean perangkat belum masuk angka ini.</p>
    </>}
    {canOperate && <button className="rounded-xl bg-amber-400 px-6 py-3 font-semibold" onClick={() => navigate(modulePath(access.businessId, access.outletId, manifest.id, 'operations'))}>{operations.label}</button>}
  </div></section>;
}
