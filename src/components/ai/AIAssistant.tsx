import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah } from '../../utils/formatters';
import { buildSnapshot } from '../../lib/assistant/snapshot';
import { toAiContext, useTenant } from '../../context/TenantContext';
import { ensureDailyInsights } from '../../lib/assistant/scheduler';
import { parseIntent, resolveIntent, QUICK_CHIPS } from '../../lib/assistant/intents';
import { newId } from '../../lib/ids';
import {
  AiCreditWallet,
  AssistantAnswer,
  INTENT_CONFIDENCE_THRESHOLD,
  InsightAction,
  InsightCategory,
  InsightPayload,
  IntentName,
  MerchantInsight,
} from '../../lib/assistant/types';
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  LayoutGrid,
  Lightbulb,
  Package,
  PackageSearch,
  RefreshCw,
  Send,
  ShoppingBag,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';

/* ========================================================================== */
/* Presentation helpers                                                       */
/* ========================================================================== */

type IconType = React.ComponentType<{ className?: string }>;

const CHIP_ICONS: Record<string, IconType> = {
  Sparkles,
  PackageSearch,
  TrendingUp,
  Wallet,
  Clock,
  Users,
  LayoutGrid,
  UserCheck,
  Target,
  CalendarDays,
  ShoppingBag,
};

const CATEGORY_ICONS: Record<InsightCategory, IconType> = {
  INVENTORY_ALERT: PackageSearch,
  CROSS_SELL_OPPORTUNITY: ShoppingBag,
  CRM_CHURN: Users,
  OPERATIONAL_PEAK: Clock,
  FINANCIAL_PERFORMANCE: Target,
  CALENDAR_BEHAVIOR: CalendarDays,
  SHIFT_PERFORMANCE: Wallet,
  LAYOUT_UTILISATION: LayoutGrid,
  STAFF_BEHAVIOUR: UserCheck,
};

/** Priority 1 = act today, 2 = worth knowing, 3 = FYI. */
const PRIORITY_STYLE: Record<number, { ring: string; chip: string; icon: string; label: string }> = {
  1: {
    ring: 'border-rose-200 bg-rose-50/40',
    chip: 'bg-rose-100 text-rose-800 border-rose-200',
    icon: 'bg-rose-100 text-rose-600 border-rose-200',
    label: 'Perlu Aksi',
  },
  2: {
    ring: 'border-amber-200 bg-amber-50/40',
    chip: 'bg-amber-100 text-amber-900 border-amber-200',
    icon: 'bg-amber-100 text-amber-700 border-amber-200',
    label: 'Perhatikan',
  },
  3: {
    ring: 'border-slate-200 bg-white',
    chip: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: 'bg-slate-100 text-slate-600 border-slate-200',
    label: 'Info',
  },
};

const SOURCE_BADGE: Record<string, { label: string; cost: string; cls: string }> = {
  RULE_ENGINE: { label: 'Mesin Aturan', cost: 'Gratis', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  BATCH_INSIGHT: { label: 'Insight Harian', cost: 'Gratis', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  LLM: { label: 'AI Generatif', cost: '-1 Credit', cls: 'bg-purple-100 text-purple-800 border-purple-200' },
  PAYWALL: { label: 'Perlu Credit', cost: '', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
  ERROR: { label: 'Gagal', cost: '', cls: 'bg-slate-200 text-slate-700 border-slate-300' },
};

/**
 * Minimal markdown renderer: **bold**, _italic_, "- " bullet lists and
 * blank-line paragraph breaks. The AI replies and every rule-engine answer are
 * markdown — an unsupported marker shows up as literal punctuation to the
 * merchant, so anything the engine emits has to be handled here.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_\n]+_)/g).map((chunk, i) => {
    if (chunk.length > 4 && chunk.startsWith('**') && chunk.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-b${i}`} className="font-extrabold">
          {chunk.slice(2, -2)}
        </strong>
      );
    }
    if (chunk.length > 2 && chunk.startsWith('_') && chunk.endsWith('_')) {
      return (
        <em key={`${keyPrefix}-i${i}`} className="italic text-slate-500">
          {chunk.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t${i}`}>{chunk}</React.Fragment>;
  });
}

const MarkdownBlock: React.FC<{ text?: string }> = ({ text }) => {
  const lines = (text ?? '').split('\n');
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key} className="list-disc list-outside pl-4 space-y-0.5 my-1">
        {bullets.map((b, i) => (
          <li key={`${key}-li${i}`}>{renderInline(b, `${key}-li${i}`)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^\s*[-•]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-•]\s+/, ''));
      return;
    }
    flushBullets(`ul-${idx}`);
    if (line.trim() === '') {
      blocks.push(<div key={`sp-${idx}`} className="h-1.5" />);
      return;
    }
    blocks.push(
      <p key={`p-${idx}`} className="leading-relaxed">
        {renderInline(line, `p-${idx}`)}
      </p>
    );
  });
  flushBullets('ul-end');

  return <div className="space-y-0.5">{blocks}</div>;
};

const num = (n: number) => (Number.isFinite(n) ? n.toLocaleString('id-ID') : '—');

/** Safe percentage label. Non-finite input (0/0, Infinity) renders as an em dash. */
const pct = (n: number, digits = 0) => (Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—');

const clampPct = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

/** "2026-08-25" / ISO -> "25 Agu 2026". Falls back to the raw string. */
const dayLabel = (value: string): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Small labelled figure used by the new insight detail panels. */
const Stat: React.FC<{ label: string; value: string; hint?: string; valueClass?: string }> = ({
  label,
  value,
  hint,
  valueClass,
}) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-2 min-w-0">
    <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">{label}</p>
    <p className={`text-[12px] font-extrabold font-mono mt-0.5 break-words ${valueClass || 'text-slate-900'}`}>{value}</p>
    {hint ? <p className="text-[9px] text-slate-500 mt-0.5 leading-snug">{hint}</p> : null}
  </div>
);

/* ========================================================================== */
/* Insight payload detail tables                                              */
/* ========================================================================== */

const Th: React.FC<{ children: React.ReactNode; right?: boolean }> = ({ children, right }) => (
  <th className={`px-2 py-1.5 font-bold text-[10px] uppercase tracking-wider text-slate-500 ${right ? 'text-right' : 'text-left'}`}>
    {children}
  </th>
);
const Td: React.FC<{ children: React.ReactNode; right?: boolean; className?: string }> = ({ children, right, className }) => (
  <td className={`px-2 py-1.5 ${right ? 'text-right font-mono' : ''} ${className || ''}`}>{children}</td>
);

const InsightDetail: React.FC<{ payload: InsightPayload }> = ({ payload }) => {
  const wrap = (children: React.ReactNode) => (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-[11px] text-slate-700">{children}</table>
    </div>
  );

  switch (payload.kind) {
    case 'INVENTORY_ALERT':
      return wrap(
        <>
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Item</Th>
              <Th right>Stok</Th>
              <Th right>Pakai/hari</Th>
              <Th right>Cukup</Th>
              <Th right>Saran Order</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payload.items.map((it) => (
              <tr key={it.itemId}>
                <Td>
                  <span className="font-semibold text-slate-900">{it.name}</span>
                  <span className="block text-[9px] text-rose-600 font-bold uppercase tracking-wide">{it.severity}</span>
                </Td>
                <Td right>
                  {num(it.currentStock)} {it.unit}
                </Td>
                <Td right>{num(it.avgDailyConsumption)}</Td>
                <Td right>{it.daysOfCover >= 9999 ? '—' : `${num(it.daysOfCover)} hr`}</Td>
                <Td right className="font-bold text-amber-700">
                  +{num(it.suggestedReorderQty)}
                </Td>
              </tr>
            ))}
          </tbody>
        </>
      );

    case 'CROSS_SELL_OPPORTUNITY':
      return wrap(
        <>
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Pasangan Produk</Th>
              <Th right>Bareng</Th>
              <Th right>Confidence</Th>
              <Th right>Lift</Th>
              <Th right>Saran Bundling</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payload.pairs.map((p) => (
              <tr key={`${p.aId}-${p.bId}`}>
                <Td>
                  <span className="font-semibold text-slate-900">{p.aName}</span>
                  <span className="text-slate-400"> + </span>
                  <span className="font-semibold text-slate-900">{p.bName}</span>
                </Td>
                <Td right>{num(p.coOccurrence)}x</Td>
                <Td right>{Math.round(p.confidence * 100)}%</Td>
                <Td right>{p.lift.toFixed(2)}</Td>
                <Td right className="font-bold text-amber-700">
                  {p.bundlePriceSuggestion ? formatRupiah(p.bundlePriceSuggestion) : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </>
      );

    case 'CRM_CHURN':
      return wrap(
        <>
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Pelanggan</Th>
              <Th>Segmen</Th>
              <Th right>Terakhir</Th>
              <Th right>Total Belanja</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payload.customers.map((c) => (
              <tr key={c.customerId}>
                <Td>
                  <span className="font-semibold text-slate-900">{c.name}</span>
                  <span className="block text-[9px] text-slate-500">{c.suggestedOffer}</span>
                </Td>
                <Td>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[9px] font-bold">
                    {c.segment}
                  </span>
                </Td>
                <Td right>{num(c.recencyDays)} hr</Td>
                <Td right className="font-bold text-slate-900">
                  {formatRupiah(c.monetary)}
                </Td>
              </tr>
            ))}
          </tbody>
        </>
      );

    case 'STAFF_BEHAVIOUR':
      return wrap(
        <>
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Staf</Th>
              <Th right>Order</Th>
              <Th right>Omset</Th>
              <Th right>Telat</Th>
              <Th right>Hadir</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payload.staff.map((s) => (
              <tr key={s.staffId}>
                <Td>
                  <span className="font-semibold text-slate-900">{s.name}</span>
                  <span className="block text-[9px] text-slate-500">{s.role}</span>
                </Td>
                <Td right>{num(s.ordersServed)}</Td>
                <Td right>{formatRupiah(s.revenue)}</Td>
                <Td right className={s.lateClockIns > 0 ? 'text-rose-600 font-bold' : ''}>
                  {num(s.lateClockIns)}x
                </Td>
                <Td right>{num(s.attendanceRatePct)}%</Td>
              </tr>
            ))}
          </tbody>
        </>
      );

    case 'LAYOUT_UTILISATION':
      return wrap(
        <>
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>Zona</Th>
              <Th right>Slot</Th>
              <Th right>Order</Th>
              <Th right>Omset</Th>
              <Th right>Porsi</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payload.zones.map((z) => (
              <tr key={z.zone}>
                <Td>
                  <span className="font-semibold text-slate-900">{z.zone}</span>
                </Td>
                <Td right>{num(z.slots)}</Td>
                <Td right>{num(z.orders)}</Td>
                <Td right>{formatRupiah(z.revenue)}</Td>
                <Td right>{num(z.sharePct)}%</Td>
              </tr>
            ))}
          </tbody>
        </>
      );

    case 'OPERATIONAL_PEAK': {
      const max = payload.byHour.reduce((m, h) => Math.max(m, h.revenue), 0);
      return (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-end gap-[3px] h-24">
            {payload.byHour.map((h) => (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full" title={`${h.label}: ${formatRupiah(h.revenue)} (${h.orders} order)`}>
                <div
                  className={`w-full rounded-t ${h.revenue > 0 ? 'bg-amber-400' : 'bg-slate-100'}`}
                  style={{ height: `${max > 0 ? Math.max(3, (h.revenue / max) * 100) : 3}%` }}
                />
                <span className="text-[8px] text-slate-400 mt-1">{h.hour}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 mt-2">{payload.staffingHint}</p>
        </div>
      );
    }

    case 'FINANCIAL_PERFORMANCE': {
      const runPct = clampPct(payload.runRatePct);
      const expPct = clampPct(payload.expectedPct);
      const onTrack = payload.onTrack;
      const barColor = onTrack ? 'bg-emerald-500' : 'bg-rose-500';
      const textColor = onTrack ? 'text-emerald-700' : 'text-rose-700';
      const gapLabel = Number.isFinite(payload.gapPct)
        ? `${payload.gapPct >= 0 ? '+' : ''}${payload.gapPct.toFixed(1)}%`
        : '—';

      return (
        <div className="space-y-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            {/* headline */}
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  Target {payload.monthLabel}
                </span>
                {payload.targetSource === 'AUTO' && (
                  <span
                    title="Target ini dihitung otomatis dari rata-rata omzet 3 bulan terakhir karena Anda belum menetapkan target sendiri."
                    className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-100 text-slate-600 text-[9px] font-bold"
                  >
                    target otomatis
                  </span>
                )}
              </div>
              <span className={`text-[11px] font-extrabold font-mono ${textColor}`}>
                {pct(payload.runRatePct, 1)} tercapai · {onTrack ? 'sesuai jalur' : 'di bawah jalur'}
              </span>
            </div>

            {/* progress bar with the expected-pace marker */}
            <div className="relative mt-2 h-3 w-full rounded-full bg-slate-100 border border-slate-200 overflow-hidden">
              <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${runPct}%` }} />
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-slate-900/70"
                style={{ left: `${expPct}%` }}
                title={`Seharusnya sudah ${pct(payload.expectedPct, 1)} di hari ke-${payload.dayOfMonth}`}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[9px] text-slate-500">
                Hari ke-{num(payload.dayOfMonth)} dari {num(payload.daysInMonth)}
              </span>
              <span className="text-[9px] text-slate-500">
                Garis hitam = laju ideal {pct(payload.expectedPct, 1)} · selisih {gapLabel}
              </span>
            </div>

            {/* supporting figures */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2.5">
              <Stat
                label="Omzet bulan ini"
                value={formatRupiah(payload.mtdRevenue)}
                hint={`dari target ${formatRupiah(payload.monthlyTarget)}`}
              />
              <Stat
                label="Proyeksi akhir bulan"
                value={formatRupiah(payload.projectedMonthEnd)}
                hint={`${payload.projectedGapIdr >= 0 ? 'lebih' : 'kurang'} ${formatRupiah(Math.abs(payload.projectedGapIdr))} dari target`}
                valueClass={onTrack ? 'text-emerald-700' : 'text-rose-700'}
              />
              <Stat
                label="Perlu per hari"
                value={formatRupiah(payload.dailyRunRateNeeded)}
                hint="rata-rata omzet harian sampai tutup bulan"
              />
            </div>
          </div>

          {/* supporting detail: statistical anomalies */}
          {payload.anomalies.length > 0 &&
            wrap(
              <>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <Th>Metrik</Th>
                    <Th right>Aktual</Th>
                    <Th right>Normal</Th>
                    <Th right>Selisih</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payload.anomalies.map((a, i) => (
                    <tr key={`${a.metric}-${i}`}>
                      <Td>
                        <span className="font-semibold text-slate-900">{a.label}</span>
                        <span className="block text-[9px] text-slate-500">{a.note}</span>
                      </Td>
                      <Td right>{num(Math.round(a.actual))}</Td>
                      <Td right>{num(Math.round(a.expected))}</Td>
                      <Td right className={a.direction === 'BELOW' ? 'text-rose-600 font-bold' : 'text-emerald-700 font-bold'}>
                        {a.direction === 'BELOW' ? '' : '+'}
                        {num(a.deltaPct)}%
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
        </div>
      );
    }

    case 'CALENDAR_BEHAVIOR': {
      const upliftPct = Number.isFinite(payload.basketUplift) ? (payload.basketUplift - 1) * 100 : Number.NaN;
      const volumePct = Number.isFinite(payload.volumeUplift) ? (payload.volumeUplift - 1) * 100 : Number.NaN;
      const upliftUp = Number.isFinite(upliftPct) && upliftPct >= 0;
      const upliftClass = upliftUp ? 'text-emerald-700' : 'text-rose-700';
      const topProducts = payload.topPaydayProducts.slice(0, 5);

      return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
          <div className="flex flex-col sm:flex-row items-stretch gap-2">
            <div className="flex-1 min-w-0 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-center">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-amber-800">Tanggal Muda</p>
              <p className="text-[10px] text-amber-700/80">{payload.paydayWindowLabel}</p>
              <p className="text-sm font-extrabold font-mono text-slate-900 mt-1.5">{formatRupiah(payload.paydayAvgBasket)}</p>
              <p className="text-[9px] text-slate-500 mt-0.5">
                rata-rata belanja · {num(payload.paydayOrders)} order ({payload.paydayOrdersPerDay.toFixed(1)}/hari)
              </p>
            </div>

            <div className="flex sm:flex-col items-center justify-center gap-1.5 sm:gap-0 px-2 py-1 shrink-0">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">Selisih</span>
              <span className={`text-xl font-extrabold font-mono leading-none ${upliftClass}`}>
                {Number.isFinite(upliftPct) ? `${upliftUp ? '+' : ''}${upliftPct.toFixed(0)}%` : '—'}
              </span>
              <span className="text-[9px] text-slate-500">
                volume {Number.isFinite(volumePct) ? `${volumePct >= 0 ? '+' : ''}${volumePct.toFixed(0)}%` : '—'}
              </span>
            </div>

            <div className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-600">Tanggal Biasa</p>
              <p className="text-[10px] text-slate-500">{payload.normalWindowLabel}</p>
              <p className="text-sm font-extrabold font-mono text-slate-900 mt-1.5">{formatRupiah(payload.normalAvgBasket)}</p>
              <p className="text-[9px] text-slate-500 mt-0.5">
                rata-rata belanja · {num(payload.normalOrders)} order ({payload.normalOrdersPerDay.toFixed(1)}/hari)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-2">
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">Laris saat gajian</p>
              {topProducts.length === 0 ? (
                <p className="text-[10px] text-slate-500 mt-1">Belum ada produk yang menonjol.</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {topProducts.map((p, i) => (
                    <li key={`${p.name}-${i}`} className="flex items-baseline justify-between gap-2 text-[10px]">
                      <span className="truncate text-slate-700">
                        {i + 1}. {p.name}
                      </span>
                      <span className="font-mono font-bold text-slate-900 shrink-0">
                        {num(p.qty)}x · {formatRupiah(p.revenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Stat
              label="Siklus gajian berikutnya"
              value={dayLabel(payload.nextPaydayWindowStart)}
              hint={`${payload.hint} · ${num(payload.cyclesObserved)} siklus terpantau`}
            />
          </div>
        </div>
      );
    }

    case 'SHIFT_PERFORMANCE': {
      const FLAG_BADGE: Record<
        'CASH_VARIANCE' | 'LOW_PRODUCTIVITY' | 'TOP_PERFORMER' | 'OK',
        { label: string; cls: string }
      > = {
        CASH_VARIANCE: { label: 'Perlu dicek', cls: 'bg-rose-100 text-rose-800 border-rose-200' },
        LOW_PRODUCTIVITY: { label: 'Produktivitas rendah', cls: 'bg-amber-100 text-amber-900 border-amber-200' },
        TOP_PERFORMER: { label: 'Terbaik', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
        OK: { label: 'Normal', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
      };

      const varianceClass = (v: number) => {
        if (!Number.isFinite(v) || Math.abs(v) < 1) return 'text-slate-500';
        return v < 0 ? 'text-rose-600 font-bold' : 'text-emerald-700 font-bold';
      };

      return (
        <div className="space-y-2">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[10px] text-slate-500">
              <b className="font-extrabold text-slate-900 font-mono">{num(payload.shiftsAnalysed)}</b> sesi shift dianalisa
            </span>
            <span className="text-[10px] text-slate-500">
              Selisih kas total{' '}
              <b className={`font-mono ${varianceClass(payload.totalCashVariance)}`}>
                {formatRupiah(payload.totalCashVariance)}
              </b>
            </span>
            <span className="text-[10px] text-slate-500">
              Rata-rata omzet/jam{' '}
              <b className="font-mono text-slate-900">{formatRupiah(payload.benchmarkSalesPerHour)}</b>
            </span>
          </div>

          {wrap(
            <>
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>Kasir</Th>
                  <Th right>Shift</Th>
                  <Th right>Omzet/Jam</Th>
                  <Th right>Selisih Kas</Th>
                  <Th right>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payload.cashiers.map((c, i) => {
                  const badge = FLAG_BADGE[c.flag];
                  return (
                    <tr key={`${c.cashierName}-${i}`}>
                      <Td>
                        <span className="font-semibold text-slate-900">{c.cashierName}</span>
                        <span className="block text-[9px] text-slate-500">{c.note}</span>
                      </Td>
                      <Td right>{num(c.shifts)}x</Td>
                      <Td right>{formatRupiah(c.salesPerHour)}</Td>
                      <Td right className={varianceClass(c.meanCashVariance)}>
                        {c.meanCashVariance > 0 ? '+' : ''}
                        {formatRupiah(c.meanCashVariance)}
                      </Td>
                      <Td right>
                        <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-bold whitespace-nowrap ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </>
          )}

          <p className="text-[10px] text-slate-500 leading-relaxed">
            {payload.hint} Angka di atas adalah temuan operasional untuk dicek bersama kasir — bisa saja karena salah input,
            kembalian, atau uang laci awal. Bukan tuduhan.
          </p>
        </div>
      );
    }

    default:
      return null;
  }
};

/* ========================================================================== */

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  source?: AssistantAnswer['source'];
  title?: string;
  timestamp: string;
  promoSuggestion?: any;
  /**
   * Dari mana angka dalam jawaban ini berasal. Ditampilkan sebagai lencana.
   *
   * Merchant yang melihat angka berbeda dari yang disebut tim support harus
   * bisa langsung tahu kenapa, tanpa membuka tiket.
   */
  dataSource?: 'DATABASE' | 'CLIENT' | 'NONE';
}

const DATA_BADGE: Record<string, { label: string; cls: string; hint: string }> = {
  DATABASE: {
    label: 'DATA PUSAT',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    hint: 'Dihitung dari database pusat — sama persis dengan yang dilihat tim support.',
  },
  CLIENT: {
    label: 'DATA PERANGKAT',
    cls: 'bg-amber-50 text-amber-800 border-amber-300',
    hint: 'Dihitung dari data di perangkat ini saja. Transaksi dari terminal lain belum ikut terhitung.',
  },
};

const clockLabel = () => new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

export const AIAssistant: React.FC = () => {
  const {
    products,
    categories,
    orders,
    customers,
    tables,
    stockItems,
    staffMembers,
    attendanceLogs,
    inventoryLogs,
    shift,
    shiftHistory,
    promoCodes,
    settings,
    setActiveTab,
    addPromoCode,
  } = usePOS();

  /**
   * The active business unit + signed-in role. Everything the assistant reads,
   * caches and sends to the model is scoped to this.
   */
  const tenant = useTenant();

  const [promptInput, setPromptInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [wallet, setWallet] = useState<AiCreditWallet | null>(null);
  const [paywall, setPaywall] = useState<{ title: string; message: string; ctaLabel: string; addOnPriceIdr: number; addOnCredits: number } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  /* --- LAYER 1: today's batch run ---------------------------------------- */
  /*
   * Everything the assistant sees is bound to `tenant.businessId`. The arrays
   * below already come from POSContext scoped to that partition; buildSnapshot
   * re-verifies the shared ones. Switching business changes businessId, which
   * changes the memo key, the batch cache key and the AI prompt in one step.
   */
  const snapshot = useMemo(
    () =>
      buildSnapshot({
        businessId: tenant.businessId,
        merchantId: tenant.merchantId,
        tenantId: tenant.tenantId,
        userRole: tenant.userRole,
        settings,
        categories,
        products,
        stockItems,
        inventoryLogs,
        orders,
        customers,
        tables,
        staff: staffMembers,
        attendance: attendanceLogs,
        shifts: shiftHistory,
        currentShift: shift,
        promoCodes,
      }),
    // Recompute only when the underlying data actually changes, not per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tenant.businessId,
      tenant.userRole,
      settings,
      categories,
      products,
      stockItems,
      inventoryLogs,
      orders,
      customers,
      tables,
      staffMembers,
      attendanceLogs,
      shiftHistory,
      shift,
      promoCodes,
    ]
  );

  const batch = useMemo(() => ensureDailyInsights(snapshot), [snapshot]);

  const visibleInsights = useMemo(
    () => batch.insights.filter((i) => !dismissed[i.id]).slice(0, 3),
    [batch.insights, dismissed]
  );

  /* --- credits ------------------------------------------------------------ */
  useEffect(() => {
    let cancelled = false;
    // businessId WAJIB ikut: kredit dimiliki UNIT USAHA, bukan akun. Pemilik
    // dengan kafe DAN laundry tidak bisa diselesaikan dari merchantId saja —
    // server sengaja menolak menebak, karena menebak salah berarti kredit kafe
    // terpotong untuk pertanyaan tentang laundry.
    fetch(
      `/api/v1/assistant/credits?merchantId=${encodeURIComponent(tenant.merchantId)}` +
        `&businessId=${encodeURIComponent(tenant.businessId)}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.credits) setWallet(d.credits);
      })
      .catch(() => {
        /* offline is fine — the free path does not need the server */
      });
    return () => {
      cancelled = true;
    };
  }, [tenant.merchantId]);

  useEffect(() => {
    // Greet with the real headline insight instead of a generic hello.
    const head = batch.insights[0];
    setMessages([
      {
        id: 'greet',
        sender: 'ai',
        source: 'BATCH_INSIGHT',
        text: head
          ? `Halo! Saya **Smart Assistant** ${settings.storeName}. Saya sudah membaca **${num(batch.aggregates.ordersAnalysed)} transaksi**, **${num(products.length)} produk**, **${num(customers.length)} pelanggan**, dan **${num(tables.length)} ${snapshot.slotNoun}** dari data toko Anda.\n\nYang paling perlu perhatian hari ini: ${head.summary}`
          : `Halo! Saya **Smart Assistant** ${settings.storeName}. Saya terhubung ke katalog, transaksi, pelanggan, denah, dan absensi staf Anda — tapi datanya masih terlalu sedikit untuk dianalisa. Mulai catat transaksi dulu, nanti saya rangkum otomatis.`,
        timestamp: clockLabel(),
      },
    ]);
    // Only on mount / merchant switch — later messages are appended by the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.merchantId]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isGenerating]);

  const push = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: newId('m'), timestamp: clockLabel() },
    ]);
  }, []);

  /* --- LAYER 2 -> LAYER 3 routing ---------------------------------------- */
  const ask = useCallback(
    async (text: string, forcedIntent?: IntentName) => {
      const label = text.trim();
      if (!label && !forcedIntent) return;

      push({ sender: 'user', text: label || String(forcedIntent) });
      setPromptInput('');
      setPaywall(null);

      // Quick Chip bypasses the parser entirely; free text goes through it.
      const parsed = forcedIntent
        ? { intent: forcedIntent, confidence: 1, entities: {}, matchedKeywords: ['quick-chip'] }
        : parseIntent(label);

      /*
       * SERVER DULU, PERANGKAT SEBAGAI CADANGAN.
       *
       * Sebelumnya urutannya terbalik: pertanyaan yang dikenali dijawab dari
       * localStorage lalu `return`, sehingga server tidak pernah dipanggil untuk
       * 90% pertanyaan tersering.
       *
       * Itu bukan sekadar soal konsistensi angka dengan admin panel. Snapshot
       * lokal hanya berisi transaksi PERANGKAT INI. Merchant dengan dua terminal
       * kasir akan mendapat angka yang keliru — bukan berbeda rumus, tapi
       * memang kurang datanya — dan tidak ada cara menyadarinya dari layar.
       *
       * Jalur lokal tetap dipertahankan penuh untuk saat server tidak bisa
       * dihubungi. Kasir yang sedang offline harus tetap bisa bertanya; yang
       * tidak boleh adalah dia tidak tahu bahwa jawabannya berbasis data
       * sebagian. Karena itu jawaban cadangan selalu diberi lencana
       * "DATA PERANGKAT".
       */
      const answerLocally = (note?: string) => {
        if (parsed.intent === 'UNKNOWN' || parsed.confidence < INTENT_CONFIDENCE_THRESHOLD) {
          return false;
        }
        const local = resolveIntent(parsed, snapshot, batch);
        if (!local) return false;
        push({
          sender: 'ai',
          text: note ? `${note}\n\n${local.markdown}` : local.markdown,
          source: local.source,
          title: local.title,
          dataSource: 'CLIENT',
        });
        return true;
      };

      setIsGenerating(true);
      try {
        const res = await fetch('/api/v1/assistant/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchantId: tenant.merchantId,
            query: label,
            // Tetap dikirim: server memakainya HANYA untuk bidang yang belum
            // punya tabel (pelanggan, meja, staf bertugas). Seluruh angka uang
            // dihitung ulang server dari database dan menimpa kiriman ini.
            aggregates: batch.aggregates,
            insights: batch.insights,
            // Tells the model exactly whose data this is and who is asking, so
            // it can state its scope and be forbidden from straying outside it.
            storeContext: toAiContext(tenant),
          }),
        });
        const data = await res.json();
        if (data?.credits) setWallet(data.credits);
        if (data?.paywall) setPaywall(data.paywall);
        const answer: AssistantAnswer | undefined = data?.answer;

        if (!answer) {
          if (!answerLocally('*Server tidak mengembalikan jawaban — memakai data perangkat ini.*')) {
            push({
              sender: 'ai',
              source: 'ERROR',
              text: 'Maaf, tidak ada jawaban yang bisa ditampilkan.',
            });
          }
          return;
        }

        push({
          sender: 'ai',
          text: answer.markdown ?? '',
          source: answer.source,
          title: answer.title,
          dataSource: data?.dataSource ?? 'CLIENT',
        });
      } catch {
        // Benar-benar offline. Jalur lokal masih lengkap.
        if (
          !answerLocally(
            '*Sedang offline — dijawab dari data perangkat ini. Transaksi dari terminal lain belum ikut terhitung.*'
          )
        ) {
          push({
            sender: 'ai',
            source: 'ERROR',
            text: '**Gagal menghubungi server.** Pertanyaan berbasis data toko tetap bisa dijawab lewat tombol cepat di atas — semuanya diproses langsung di perangkat ini.',
          });
        }
      } finally {
        setIsGenerating(false);
      }
    },
    [batch, tenant, push, snapshot]
  );

  const handleTopUp = async () => {
    try {
      const res = await fetch('/api/v1/assistant/credits/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: tenant.merchantId,
          businessId: tenant.businessId,
          credits: paywall?.addOnCredits ?? 50,
        }),
      });
      const data = await res.json();
      if (data?.credits) setWallet(data.credits);
      setPaywall(null);
      push({ sender: 'ai', source: 'RULE_ENGINE', text: data?.message || '**AI Credit berhasil ditambahkan.**' });
    } catch {
      push({ sender: 'ai', source: 'ERROR', text: '**Gagal memproses pembelian AI Credit.**' });
    }
  };

  const runAction = (action: InsightAction) => {
    switch (action.kind) {
      case 'OPEN_INVENTORY':
        setActiveTab('inventory');
        break;
      case 'OPEN_CUSTOMERS':
        setActiveTab('customers');
        break;
      case 'OPEN_REPORTS':
        setActiveTab('reports');
        break;
      case 'OPEN_TABLES':
        setActiveTab('tables');
        break;
      case 'OPEN_POS':
        setActiveTab('pos');
        break;
      case 'SEND_WHATSAPP': {
        const phone = String(action.params?.phone || '').replace(/[^0-9]/g, '');
        const msg = String(action.params?.message || 'Halo, ada promo spesial untuk Anda!');
        window.open(`https://wa.me/${phone.startsWith('0') ? '62' + phone.slice(1) : phone}?text=${encodeURIComponent(msg)}`, '_blank');
        break;
      }
      case 'CREATE_PROMO':
        void handleGeneratePromo();
        break;
      case 'ASK_ASSISTANT':
      default:
        void ask(String(action.params?.query || action.label));
        break;
    }
  };

  /* --- the two legacy buttons -------------------------------------------- */

  /** Now answered instantly from the local batch — no network, no cost. */
  const handleStockForecast = () => void ask('prediksi stok', 'GET_STOCK_FORECAST');

  const handleGeneratePromo = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/ai/generate-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeType: snapshot.businessSector,
          targetAudience: 'Pelanggan Setia',
          lowSalesProducts: batch.aggregates.slowMovers.slice(0, 3).map((p) => p.name),
        }),
      });
      const data = await res.json();
      if (data?.promo) {
        push({
          sender: 'ai',
          source: 'LLM',
          title: 'Rekomendasi Promo',
          text: `🎯 **Rekomendasi Promo Baru dari AI:**\n\n- **Kode:** ${data.promo.code}\n- **Deskripsi:** ${data.promo.description}\n- **Diskon:** ${data.promo.discountPercent}% (maks. ${formatRupiah(data.promo.maxDiscountAmount || 0)})\n\nKlik tombol di bawah untuk mengaktifkan kode ini di kasir.`,
          promoSuggestion: data.promo,
        });
      } else {
        /*
         * Sebabnya disebutkan, bukan ditelan.
         *
         * Endpoint ini dulu tidak ada sama sekali, jadi setiap klik menerima 404
         * dan berakhir di blok catch sebagai "Gagal membuat ide promo" — pesan
         * yang sama untuk kuota habis, modul AI belum aktif, dan penyedia yang
         * sedang bermasalah. Ketiganya menuntut tindakan berbeda dari pemilik
         * toko, jadi ketiganya harus terbaca berbeda.
         */
        const pesan: Record<string, string> = {
          PAYWALL:
            '**Jatah AI Credit bulan ini sudah habis.** Pertanyaan seputar stok, omzet, dan pelanggan tetap gratis lewat tombol cepat di atas.',
          LLM_NOT_CONFIGURED:
            '**Modul AI generatif belum aktif di server ini.** Credit Anda tidak dipotong.',
          LLM_FAILED:
            '**Gagal menghubungi layanan AI.** Credit Anda sudah dikembalikan — silakan coba lagi sebentar lagi.',
        };
        push({
          sender: 'ai',
          source: 'ERROR',
          text: pesan[String(data?.error)] || `**Gagal membuat ide promo.** ${data?.message ?? ''}`.trim(),
        });
      }
    } catch {
      push({
        sender: 'ai',
        source: 'ERROR',
        text: '**Tidak bisa menghubungi server.** Periksa koneksi lalu coba lagi.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleActivatePromo = (promo: any) => {
    addPromoCode({
      code: promo.code,
      discountPercent: promo.discountPercent,
      maxDiscountAmount: promo.maxDiscountAmount,
      minPurchaseAmount: promo.minPurchaseAmount || 0,
      isActive: true,
    });
    push({ sender: 'ai', source: 'RULE_ENGINE', text: `**Kode promo ${promo.code} sudah aktif di kasir.**` });
  };

  /* --- the "data terhubung" proof strip ---------------------------------- */
  const connections = [
    { icon: Package, label: 'produk', value: products.length },
    { icon: ShoppingBag, label: 'transaksi', value: batch.aggregates.ordersAnalysed },
    { icon: Users, label: 'pelanggan', value: customers.length },
    { icon: LayoutGrid, label: snapshot.slotNoun.toLowerCase(), value: tables.length },
    { icon: UserCheck, label: 'staf', value: staffMembers.length },
    { icon: Database, label: 'bahan baku', value: stockItems.length },
  ];

  return (
    <div className="flex-1 bg-slate-50/70 p-4 lg:p-6 overflow-y-auto space-y-5 animate-fade-in">
      {/* ---------------------------------------------------------------- */}
      {/* 1. HEADER + LIVE DATA CONNECTION STRIP                           */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-extrabold text-2xl text-slate-900 flex items-center space-x-2">
            <Sparkles className="w-7 h-7 text-amber-600 shrink-0" />
            <span>Smart Assistant</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Analisa otomatis dari data toko Anda — stok, penjualan, pelanggan, denah, dan staf.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleStockForecast}
            disabled={isGenerating}
            className="bg-white hover:bg-slate-100 border border-slate-200 text-amber-700 font-bold px-3.5 py-2 rounded-2xl flex items-center space-x-1.5 text-xs shadow-xs transition-all disabled:opacity-50"
          >
            <PackageSearch className="w-4 h-4 text-amber-600" />
            <span>Prediksi Stok</span>
            <span className="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-200 px-1 py-0.5 rounded font-extrabold">
              GRATIS
            </span>
          </button>

          <button
            onClick={handleGeneratePromo}
            disabled={isGenerating}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-3.5 py-2 rounded-2xl flex items-center space-x-1.5 text-xs shadow-md transition-all disabled:opacity-50"
          >
            <Zap className="w-4 h-4 fill-slate-950" />
            <span>Buat Promo AI</span>
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-xs">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
            Data toko terhubung
          </span>
          <span className="text-[10px] text-slate-400">
            · diperbarui {new Date(batch.generatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · {batch.durationMs} ms · Rp 0
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {connections.map((c) => {
            const Icon = c.icon;
            return (
              <span
                key={c.label}
                className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-[11px] text-slate-700"
              >
                <Icon className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <b className="font-extrabold text-slate-900 font-mono">{num(c.value)}</b>
                <span className="text-slate-500">{c.label}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 2. INSIGHT HARI INI — max 3 Smart Cards                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Lightbulb className="w-4 h-4 text-amber-600" />
            Insight Hari Ini
          </h3>
          <span className="text-[10px] text-slate-400">
            {batch.insights.length} temuan dari batch {batch.insightDate}
          </span>
        </div>

        {visibleInsights.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="font-bold text-sm text-slate-800">Tidak ada yang mendesak hari ini</p>
            <p className="text-xs text-slate-500 mt-1">
              Stok, penjualan, dan pelanggan dalam kondisi normal. Gunakan tombol cepat di bawah untuk menggali lebih dalam.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {visibleInsights.map((ins: MerchantInsight) => {
              const style = PRIORITY_STYLE[ins.priority] || PRIORITY_STYLE[3];
              const Icon = CATEGORY_ICONS[ins.category] || Sparkles;
              const isOpen = !!expanded[ins.id];
              return (
                <div key={ins.id} className={`border rounded-3xl p-4 shadow-xs flex flex-col ${style.ring}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className={`w-9 h-9 rounded-2xl border flex items-center justify-center shrink-0 ${style.icon}`}>
                      <Icon className="w-4.5 h-4.5" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border uppercase tracking-wide ${style.chip}`}>
                        {style.label}
                      </span>
                      <button
                        onClick={() => setDismissed((d) => ({ ...d, [ins.id]: true }))}
                        title="Tutup kartu ini"
                        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-white rounded-lg transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <h4 className="font-extrabold text-sm text-slate-900 mt-2.5 leading-snug">{ins.title}</h4>
                  <p className="text-[11px] text-slate-600 leading-relaxed mt-1 flex-1">{ins.summary}</p>

                  <span className="inline-flex self-start mt-2 px-2 py-0.5 bg-white border border-slate-200 rounded-lg text-[10px] font-extrabold font-mono text-slate-800">
                    {ins.metricLabel}
                  </span>

                  {isOpen && (
                    <div className="mt-3">
                      <InsightDetail payload={ins.payload} />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-slate-200/70">
                    <button
                      onClick={() => setExpanded((e) => (isOpen ? (({ [ins.id]: _drop, ...rest }) => rest)(e) : { ...e, [ins.id]: true }))}
                      className="inline-flex items-center gap-1 px-2 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-[10px] font-bold transition-colors"
                    >
                      {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {isOpen ? 'Tutup detail' : 'Lihat detail'}
                    </button>
                    {ins.actions.map((a, i) => (
                      <button
                        key={`${ins.id}-a${i}`}
                        onClick={() => runAction(a)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[10px] font-bold transition-colors"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 3. QUICK CHIPS — guaranteed Rp 0 (parser bypassed)               */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Tanya Cepat</h3>
          <span className="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded font-extrabold">
            GRATIS · TANPA BATAS
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_CHIPS.map((chip) => {
            const Icon = CHIP_ICONS[chip.icon] || Sparkles;
            return (
              <button
                key={chip.intent}
                onClick={() => void ask(chip.label, chip.intent)}
                disabled={isGenerating}
                className="inline-flex items-center gap-1.5 bg-white hover:bg-amber-50 hover:border-amber-300 border border-slate-200 text-slate-700 px-3 py-2 rounded-xl text-[11px] font-semibold shadow-xs transition-all disabled:opacity-50"
              >
                <Icon className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 4-6. CONVERSATION + PAYWALL + INPUT                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm flex flex-col">
        <div ref={transcriptRef} className="p-4 overflow-y-auto space-y-3 max-h-[380px] min-h-[200px]">
          {messages.map((msg) => {
            const badge = msg.source ? SOURCE_BADGE[msg.source] : undefined;
            return (
              <div key={msg.id} className={`flex items-start gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.sender === 'ai' && (
                  <div className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center shrink-0 shadow-xs">
                    <Bot className="w-4.5 h-4.5" />
                  </div>
                )}
                <div
                  className={`max-w-[82%] rounded-2xl p-3.5 text-xs space-y-1.5 ${
                    msg.sender === 'user'
                      ? 'bg-amber-500 text-slate-950 font-medium rounded-tr-none shadow-xs'
                      : 'bg-slate-50 border border-slate-200 text-slate-800 rounded-tl-none'
                  }`}
                >
                  {msg.sender === 'ai' && (badge || msg.dataSource) && (
                    <div className="flex items-center gap-1.5 pb-1 flex-wrap">
                      {badge && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      )}
                      {msg.dataSource && DATA_BADGE[msg.dataSource] && (
                        <span
                          title={DATA_BADGE[msg.dataSource].hint}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold border ${DATA_BADGE[msg.dataSource].cls}`}
                        >
                          {DATA_BADGE[msg.dataSource].label}
                        </span>
                      )}
                      {badge?.cost && <span className="text-[9px] text-slate-400 font-bold">{badge.cost}</span>}
                    </div>
                  )}
                  <MarkdownBlock text={msg.text} />

                  {msg.promoSuggestion && (
                    <button
                      onClick={() => handleActivatePromo(msg.promoSuggestion)}
                      className="w-full py-2 mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1 shadow-xs transition-all"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Aktifkan Promo Ke Kasir
                    </button>
                  )}

                  <span className="text-[9px] opacity-60 block text-right font-mono pt-0.5">{msg.timestamp}</span>
                </div>
              </div>
            );
          })}

          {isGenerating && (
            <div className="flex items-center gap-2.5 text-amber-700 text-xs font-semibold p-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Menganalisa data toko…</span>
            </div>
          )}
        </div>

        {paywall && (
          <div className="mx-4 mb-3 p-4 bg-purple-50 border border-purple-200 rounded-2xl">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-2xl bg-purple-100 border border-purple-200 text-purple-700 flex items-center justify-center shrink-0">
                <Sparkles className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-extrabold text-sm text-purple-950">{paywall.title}</h4>
                <p className="text-[11px] text-purple-900/80 leading-relaxed mt-0.5">{paywall.message}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  <button
                    onClick={handleTopUp}
                    className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-[11px] rounded-xl shadow-xs transition-colors"
                  >
                    {paywall.ctaLabel} — {formatRupiah(paywall.addOnPriceIdr)} / {paywall.addOnCredits} credit
                  </button>
                  <button
                    onClick={() => setPaywall(null)}
                    className="px-3 py-2 text-[11px] font-bold text-purple-800 hover:underline"
                  >
                    Nanti saja
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(promptInput);
          }}
          className="p-3 bg-slate-50/80 border-t border-slate-200 flex items-center gap-2"
        >
          <div className="flex-1 relative">
            <input
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder="Tanya Smart Assistant…"
              className="w-full bg-white border border-slate-200 rounded-2xl pl-4 pr-28 py-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 whitespace-nowrap">
              Sisa AI Credit: <b className="text-slate-700 font-mono">{wallet ? wallet.balance : '—'}</b>
            </span>
          </div>
          <button
            type="submit"
            disabled={!promptInput.trim() || isGenerating}
            className="p-3 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-2xl shadow-xs font-bold transition-all disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
