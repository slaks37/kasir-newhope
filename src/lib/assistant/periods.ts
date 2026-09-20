import type { IntentEntities, IntentPeriod } from './types';

export const DAY = 86_400_000;
const WIB = 7 * 3_600_000;
/** Legacy ISO values without an offset mean store time, never host time. */
export function businessTime(value: Date | number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value !== 'string') return new Date(value).getTime();
  const naive = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(value);
  return Date.parse(naive ? `${value.length === 10 ? value + 'T00:00:00' : value.replace(' ', 'T')}+07:00` : value);
}
export const businessDate = (date: Date | number | string): string =>
  new Date(businessTime(date) + WIB).toISOString().slice(0, 10);
export const businessHour = (date: Date | number | string): number =>
  new Date(businessTime(date) + WIB).getUTCHours();
export const dayStart = (date: string): number => Date.parse(`${date}T00:00:00+07:00`);
export const addDate = (date: string, days: number): string => businessDate(dayStart(date) + days * DAY);
export const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

export interface ReportWindow { start: number; end: number; days: number; label: string; startDate: string; endDate: string }

export function reportWindow(period: IntentPeriod = 'TODAY', now: number = Date.now(), entities: IntentEntities = {}): ReportWindow {
  const today = businessDate(now);
  let from = today;
  let to = today;
  let label = 'hari ini';
  const monday = addDate(today, -((weekday(today) + 6) % 7));
  if (period === 'YESTERDAY') { from = to = addDate(today, -1); label = 'kemarin'; }
  if (period === 'WEEK') { from = monday; label = 'minggu ini'; }
  if (period === 'MONTH') { from = today.slice(0, 8) + '01'; label = 'bulan ini'; }
  if (period === 'LAST_WEEK') { from = addDate(monday, -7); to = addDate(monday, -1); label = 'minggu lalu'; }
  if (period === 'LAST_MONTH') { to = addDate(today.slice(0, 8) + '01', -1); from = to.slice(0, 8) + '01'; label = 'bulan lalu'; }
  if (period === 'LAST_7') { from = addDate(today, -6); label = '7 hari terakhir'; }
  if (period === 'LAST_30') { from = addDate(today, -29); label = '30 hari terakhir'; }
  if (period === 'ALL') { from = '1970-01-01'; label = 'sepanjang waktu'; }
  if (period === 'CUSTOM') { from = entities.startDate!; to = entities.endDate!; label = `${from} s.d. ${to}`; }
  const start = dayStart(from);
  const end = Math.min(dayStart(to) + DAY - 1, now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('INVALID_REPORT_PERIOD');
  return { start, end, days: period === 'ALL' ? 0 : Math.round((dayStart(to) - start) / DAY) + 1, label, startDate: from, endDate: to };
}

const months = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(dayStart(s)) && businessDate(dayStart(s)) === s;

/** Dates that cannot be represented are a clarification, never an implicit TODAY. */
export function parsePeriod(text: string, now = Date.now()): IntentEntities {
  const t = text.toLowerCase();
  const iso = t.match(/(\d{4}-\d{2}-\d{2})(?:\s*(?:sampai|hingga|s\.d\.|s\/d|to|—|–)\s*(\d{4}-\d{2}-\d{2}))?/);
  const named = t.match(/(?:tanggal\s+)?(\d{1,2})(?:\s*(?:-|sampai|hingga|s\.d\.|s\/d)\s*(\d{1,2}))?\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+(\d{4}))?/);
  if (iso || named) {
    const year = named?.[4] || businessDate(now).slice(0, 4);
    const month = String(months.indexOf(named?.[3] || '') + 1).padStart(2, '0');
    const startDate = iso?.[1] || `${year}-${month}-${named![1].padStart(2, '0')}`;
    const endDate = iso?.[2] || (named ? `${year}-${month}-${(named[2] || named[1]).padStart(2, '0')}` : startDate);
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || endDate > businessDate(now))
      return { clarification: 'Rentang tanggal tidak valid atau belum selesai. Sebutkan tanggal awal dan akhir yang sudah terjadi.' };
    return { period: 'CUSTOM', startDate, endDate };
  }
  const patterns: [RegExp, IntentPeriod][] = [
    [/\b(minggu lalu|pekan lalu|last week)\b/, 'LAST_WEEK'], [/\b(bulan lalu|last month)\b/, 'LAST_MONTH'],
    [/\b(kemarin|yesterday|kmrn)\b/, 'YESTERDAY'], [/\b(hari ini|today|sekarang|hr ini)\b/, 'TODAY'],
    [/\b(7 hari|seminggu|sepekan)\b/, 'LAST_7'], [/\b(30 hari|sebulan)\b/, 'LAST_30'],
    [/\b(minggu ini|pekan ini|week|mingguan)\b/, 'WEEK'], [/\b(bulan ini|month|bulanan)\b/, 'MONTH'],
    [/\b(semua waktu|sepanjang|all time|keseluruhan|selamanya|sejak awal)\b/, 'ALL'],
  ];
  const matched = patterns.filter(([re]) => re.test(t));
  if (matched.length > 1) return { clarification: 'Ada lebih dari satu periode. Pilih satu periode dahulu agar angkanya tidak tercampur.' };
  if (matched.length) return { period: matched[0][1] };
  if (/\b(tanggal|kemaren|lusa|tahun|\d+\s+hari|\d+\s+minggu|\d+\s+bulan)\b/.test(t.replace(/\btanggal\s+(muda|tua)\b/g, '')))
    return { clarification: 'Sebutkan rentang tanggal, misalnya 1 sampai 7 September 2026, atau pilih kemarin / minggu ini / bulan ini.' };
  return {};
}
