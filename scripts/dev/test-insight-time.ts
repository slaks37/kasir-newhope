import assert from 'node:assert/strict';
import {
  computeAggregates,
  computeFinancialPerformanceInsight,
  computePeakHoursInsight,
  computeShiftPerformanceInsight,
  computeStaffBehaviourInsight,
  resolveMonthlyTarget,
} from '../../src/lib/assistant/insights';
import type { MerchantSnapshot } from '../../src/lib/assistant/types';
import type { AttendanceRecord, Shift, StaffMember } from '../../src/types';
import { fixture, order } from './brainFixture';
import { reportAggregates } from '../../src/lib/assistant/reportAggregates';
import { buildBusinessBrain } from '../../src/lib/assistant/businessBrain';

const now = new Date('2026-09-01T00:30:00+07:00');
const paid = (date: string, id: string, total = 11_000) => ({ ...order(date, id), total });
const snapshot: MerchantSnapshot = {
  ...fixture,
  generatedAt: now.toISOString(),
  orders: [
    paid('2026-08-29T12:00:00+07:00', 'older-1'),
    paid('2026-08-30T12:00:00+07:00', 'older-2'),
    paid('2026-08-31T23:59:00+07:00', 'previous-month'),
    paid('2026-08-31T17:00:00Z', 'new-month'),
    paid('2026-09-01T00:15:00', 'naive-wib'),
    { ...paid('2026-09-01T00:20:00+07:00', 'unpaid', 900_000), paymentStatus: 'UNPAID' },
    paid('2026-09-01T00:45:00+07:00', 'future-today', 900_000),
    paid('2026-09-02T00:00:00+07:00', 'future-day', 900_000),
    { ...paid('2026-09-01T00:22:00+07:00', 'void'), status: 'VOID' },
    { ...paid('2026-09-02T00:00:00+07:00', 'future-void'), status: 'VOID' },
  ],
};

// The same timestamp must produce the same report in the browser and cron,
// including when their host timezones disagree at a month/day boundary.
const originalTimezone = process.env.TZ;
let baseline: string | undefined;
try {
  for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Jakarta', 'Pacific/Auckland']) {
    process.env.TZ = zone;
    const aggregates = computeAggregates(snapshot, { now, windowDays: 1 });
    assert.equal(aggregates.ordersAnalysed, 2);
    assert.equal(aggregates.revenueTotal, 22_000);
    assert.equal(aggregates.revenueToday, 22_000);
    assert.equal(aggregates.mtdRevenue, 22_000);
    assert.equal(aggregates.voidRatePct, 33.33);
    assert.equal(aggregates.expectedPct, 3.33);
    assert.deepEqual(aggregates.revenueByDay, [{ date: '2026-09-01', orders: 2, revenue: 22_000 }]);
    const report = reportAggregates(snapshot, { period: 'TODAY' });
    assert.equal(report.ordersAnalysed, 2);
    assert.equal(report.revenueTotal, 22_000);
    const brain = buildBusinessBrain(snapshot);
    assert.equal(brain.sales.revenue, 11_000);

    const peak = computePeakHoursInsight(snapshot, { now, windowDays: 1 });
    assert.equal(peak?.payload.kind, 'OPERATIONAL_PEAK');
    if (peak?.payload.kind !== 'OPERATIONAL_PEAK') throw new Error('Missing peak payload');
    assert.deepEqual(peak.payload.byHour, [{ hour: 0, label: '00:00', orders: 2, revenue: 22_000 }]);
    assert.equal(peak.payload.busiestDay, 'Selasa');

    const finance = computeFinancialPerformanceInsight(snapshot, { now });
    assert.equal(finance?.payload.kind, 'FINANCIAL_PERFORMANCE');
    if (finance?.payload.kind !== 'FINANCIAL_PERFORMANCE') throw new Error('Missing financial payload');
    assert.equal(finance.payload.dayOfMonth, 1);
    assert.equal(finance.payload.daysInMonth, 30);
    assert.equal(finance.payload.mtdRevenue, 22_000);
    assert.match(finance.payload.monthLabel, /September 2026/i);
    const target = resolveMonthlyTarget({ ...snapshot, settings: { ...snapshot.settings, monthlyRevenueTarget: 0 } }, { now });
    assert.deepEqual(target, { target: 36_300, source: 'AUTO', monthsUsed: 1 });
    const result = JSON.stringify({ aggregates, peak, finance, target, report, brain });
    if (baseline) assert.equal(result, baseline, `Host timezone leaked into ${zone}`);
    baseline = result;
  }
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}

const staffNow = new Date('2026-09-17T12:00:00+07:00');
const shift = (id: string, startTime: string, endTime: string | undefined, totalSales: number): Shift => ({
  ...fixture.currentShift, id, cashierName: 'Test cashier', status: 'CLOSED', startTime, endTime,
  totalSales, totalOrders: 1, expectedCash: totalSales, actualCash: totalSales, difference: 0,
});
const shifts: Shift[] = [
  shift('complete', '2026-09-16T09:00:00+07:00', '2026-09-16T10:00:00+07:00', 11_000),
  shift('missing-end', '2026-09-16T11:00:00+07:00', undefined, 990_000),
  shift('future', '2026-09-18T09:00:00+07:00', '2026-09-18T10:00:00+07:00', 9_000_000),
];
const shiftInsight = computeShiftPerformanceInsight({ ...snapshot, shifts }, { now: staffNow });
assert.equal(shiftInsight?.payload.kind, 'SHIFT_PERFORMANCE');
if (shiftInsight?.payload.kind !== 'SHIFT_PERFORMANCE') throw new Error('Missing shift payload');
assert.equal(shiftInsight.payload.shiftsAnalysed, 2);
assert.equal(shiftInsight.payload.cashiers[0].totalSales, 1_001_000);
assert.equal(shiftInsight.payload.cashiers[0].hoursWorked, 1);
assert.equal(shiftInsight.payload.cashiers[0].salesPerHour, 11_000);
assert.equal(shiftInsight.payload.benchmarkSalesPerHour, 11_000);
assert.match(shiftInsight.payload.cashiers[0].note, /waktu selesai valid/);

const staff: StaffMember = { id: 'worker', name: 'Test worker', role: 'CASHIER', sector: 'FNB', isAvailable: true };
const attendance = (id: string, start: string, end?: string): AttendanceRecord => ({
  id, staffId: staff.id, staffName: staff.name, staffRole: staff.role,
  clockInTime: start, clockOutTime: end, status: end ? 'CLOCKED_OUT' : 'CLOCKED_IN',
});
const staffSnapshot: MerchantSnapshot = {
  ...snapshot, generatedAt: staffNow.toISOString(), staff: [staff],
  orders: [
    { ...paid('2026-09-16T09:30:00+07:00', 'inside-hours'), servedByStaffId: staff.id },
    { ...paid('2026-09-16T11:30:00+07:00', 'outside-known-hours', 990_000), servedByStaffId: staff.id },
  ],
  attendance: [
    attendance('valid', '2026-09-16T02:00:00Z', '2026-09-16T03:00:00Z'),
    attendance('duplicate', '2026-09-16T09:15:00+07:00', '2026-09-16T09:45:00+07:00'),
    attendance('incomplete', '2026-09-16T11:00:00+07:00'),
    attendance('future', '2026-09-18T09:00:00+07:00'),
  ],
};
const unchanged = JSON.stringify(staffSnapshot);
const staffInsight = computeStaffBehaviourInsight(staffSnapshot, { now: staffNow });
assert.equal(staffInsight?.payload.kind, 'STAFF_BEHAVIOUR');
if (staffInsight?.payload.kind !== 'STAFF_BEHAVIOUR') throw new Error('Missing staff payload');
assert.equal(staffInsight.payload.staff[0].revenue, 1_001_000);
assert.equal(staffInsight.payload.staff[0].hoursWorked, 1);
assert.equal(staffInsight.payload.staff[0].revenuePerHour, 11_000);
assert.equal(staffInsight.payload.staff[0].shiftsWorked, 3);
assert.equal(staffInsight.payload.staff[0].lateClockIns, 2);
assert.equal(computeAggregates(staffSnapshot, { now: staffNow }).staffOnShift, 0);
assert.equal(JSON.stringify(staffSnapshot), unchanged);
console.log('PASS: paid-only/as-of orders; WIB day/month/hour across 4 host timezones; matching sales and valid hours; future/stale attendance; immutable inputs');
