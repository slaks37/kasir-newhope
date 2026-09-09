/**
 * Smoke harness for Smart Labor & Commission Core.
 *
 *   npx tsx scripts/dev/smoke-labor.ts
 *
 * Validates calculation accuracy across all three primary models:
 * 1. Barbershop (Per-head kapster commission + retail product bonus)
 * 2. Car Wash (Team pooled split across assigned crew / present staff)
 * 3. F&B (Daily revenue target tier bonus & stretch achievements)
 * 4. Payroll slip creation and WhatsApp formatting
 */

import {
  calculateSmartLaborMetrics,
  createPayrollSlipForStaff,
  formatWhatsAppPayrollText,
} from '../../src/utils/commissionEngine';
import {
  StaffMember,
  StaffCommissionRule,
  AttendanceRecord,
  Order,
  AppointmentBooking,
} from '../../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

console.log('🧪 Starting Smart Labor & Commission Core Smoke Tests...\n');

// -------------------------------------------------------------
// TEST 1: BARBERSHOP KAPSTER PER-HEAD COMMISSION
// -------------------------------------------------------------
console.log('--- Test 1: Barbershop Kapster Per-Head Commission ---');

const barbershopStaff: StaffMember[] = [
  {
    id: 'stf-budi',
    name: 'Budi Kapster',
    role: 'Senior Barber',
    sector: 'BARBERSHOP',
    isAvailable: true,
    baseSalary: 1500000,
    salaryType: 'MONTHLY',
    dailyAllowance: 25000,
  },
  {
    id: 'stf-andre',
    name: 'Andre Barber',
    role: 'Barber',
    sector: 'BARBERSHOP',
    isAvailable: true,
    baseSalary: 50000,
    salaryType: 'DAILY',
    dailyAllowance: 20000,
  },
];

const barbershopAttendance: AttendanceRecord[] = [
  {
    id: 'att-1',
    staffId: 'stf-budi',
    staffName: 'Budi Kapster',
    staffRole: 'Senior Barber',
    clockInTime: '2026-08-10T09:00:00',
    status: 'CLOCKED_OUT',
    businessSector: 'BARBERSHOP',
  },
  {
    id: 'att-2',
    staffId: 'stf-budi',
    staffName: 'Budi Kapster',
    staffRole: 'Senior Barber',
    clockInTime: '2026-08-11T09:00:00',
    status: 'CLOCKED_OUT',
    businessSector: 'BARBERSHOP',
  },
  {
    id: 'att-3',
    staffId: 'stf-andre',
    staffName: 'Andre Barber',
    staffRole: 'Barber',
    clockInTime: '2026-08-10T09:00:00',
    status: 'CLOCKED_OUT',
    businessSector: 'BARBERSHOP',
  },
];

const barbershopBookings: AppointmentBooking[] = [
  {
    id: 'bk-1',
    customerName: 'Ahmad',
    customerPhone: '08123456789',
    staffId: 'stf-budi',
    staffName: 'Budi Kapster',
    staffMemberId: 'stf-budi',
    serviceName: 'Gentleman Haircut',
    servicePrice: 60000,
    date: '2026-08-10',
    bookingDate: '2026-08-10',
    timeSlot: '10:00',
    status: 'COMPLETED',
  },
  {
    id: 'bk-2',
    customerName: 'Joko',
    customerPhone: '08129876543',
    staffId: 'stf-budi',
    staffName: 'Budi Kapster',
    staffMemberId: 'stf-budi',
    serviceName: 'Premium Shave',
    servicePrice: 40000,
    date: '2026-08-11',
    bookingDate: '2026-08-11',
    timeSlot: '14:00',
    status: 'COMPLETED',
  },
];

const barbershopOrders: Order[] = [
  {
    id: 'ORD-B1',
    orderNumber: 1,
    date: '2026-08-10T10:45:00',
    orderType: 'DINE_IN',
    cashierName: 'Admin',
    shiftId: 'sh-1',
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    status: 'COMPLETED',
    subtotal: 110000,
    discountTotal: 0,
    taxTotal: 0,
    serviceChargeTotal: 0,
    total: 110000,
    servedByStaffId: 'stf-budi',
    servedByStaffName: 'Budi Kapster',
    items: [
      {
        id: 'i-1',
        productId: 'prod-haircut',
        name: 'Gentleman Haircut',
        selectedModifiers: [],
        unitPrice: 60000,
        quantity: 1,
        discountPercent: 0,
        discountAmount: 0,
        totalPrice: 60000,
      },
      {
        id: 'i-2',
        productId: 'prod-pomade',
        name: 'Waterbased Matte Pomade',
        selectedModifiers: [],
        unitPrice: 50000,
        quantity: 1,
        discountPercent: 0,
        discountAmount: 0,
        totalPrice: 50000,
      },
    ],
  },
];

const barbershopRules: StaffCommissionRule[] = [
  {
    staffId: 'GLOBAL_SECTOR',
    fixedCommissionPerService: 15000, // Rp 15.000 per kepala
    retailCommissionPercent: 10, // 10% dari penjualan produk
  },
];

const bSummary = calculateSmartLaborMetrics({
  staffMembers: barbershopStaff,
  attendanceRecords: barbershopAttendance,
  orders: barbershopOrders,
  bookings: barbershopBookings,
  rules: barbershopRules,
  sector: 'BARBERSHOP',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
});

const budiMetric = bSummary.staffMetrics.find((m) => m.staffId === 'stf-budi')!;
assert(budiMetric !== undefined, 'Budi Kapster metric is computed');
assert(budiMetric.daysAttended === 2, 'Budi attended 2 days');
assert(budiMetric.baseSalaryPayable === 1500000, 'Budi monthly base salary is 1.500.000');
assert(budiMetric.allowancePayable === 50000, 'Budi allowance is 2 x 25.000 = 50.000');
// Budi has 2 bookings (Gentleman Haircut & Premium Shave) + 1 order haircut = 3 services x 15.000 = 45.000
// Budi sold 1 pomade (50.000) x 10% = 5.000
// Total individual commission = 45.000 + 5.000 = 50.000
assert(budiMetric.individualCommission === 50000, `Budi commission matches 50.000 (actual: ${budiMetric.individualCommission})`);
assert(budiMetric.grossPayable === 1600000, `Budi gross pay is 1.600.000 (actual: ${budiMetric.grossPayable})`);

// -------------------------------------------------------------
// TEST 2: CAR WASH TEAM POOL COMMISSION
// -------------------------------------------------------------
console.log('\n--- Test 2: Car Wash Bagi Hasil Tim Cuci ---');

const carwashStaff: StaffMember[] = [
  {
    id: 'stf-agus',
    name: 'Agus',
    role: 'Cuci Body',
    sector: 'CARWASH',
    isAvailable: true,
  },
  {
    id: 'stf-doni',
    name: 'Doni',
    role: 'Interior Vacuum',
    sector: 'CARWASH',
    isAvailable: true,
  },
];

const carwashOrders: Order[] = [
  {
    id: 'ORD-CW1',
    orderNumber: 1,
    date: '2026-08-11T11:00:00',
    orderType: 'DINE_IN',
    cashierName: 'Admin',
    shiftId: 'sh-1',
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    status: 'COMPLETED',
    subtotal: 100000,
    discountTotal: 0,
    taxTotal: 0,
    serviceChargeTotal: 0,
    total: 100000,
    vehiclePlate: 'B 1234 ABC',
    assignedCrew: ['Agus', 'Doni'], // Both assigned to this car
    items: [],
  },
  {
    id: 'ORD-CW2',
    orderNumber: 2,
    date: '2026-08-11T12:00:00',
    orderType: 'DINE_IN',
    cashierName: 'Admin',
    shiftId: 'sh-1',
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    status: 'COMPLETED',
    subtotal: 50000,
    discountTotal: 0,
    taxTotal: 0,
    serviceChargeTotal: 0,
    total: 50000,
    vehiclePlate: 'B 5678 XYZ',
    assignedCrew: ['Agus'], // Only Agus assigned to this bike/car
    items: [],
  },
];

const carwashRules: StaffCommissionRule[] = [
  {
    staffId: 'GLOBAL_SECTOR',
    teamPoolType: 'PERCENTAGE_OF_POOL',
    teamPoolRate: 20, // 20% pool from total sales
    teamPoolDistribution: 'BY_ASSIGNED_JOB',
  },
];

const cwSummary = calculateSmartLaborMetrics({
  staffMembers: carwashStaff,
  attendanceRecords: [],
  orders: carwashOrders,
  rules: carwashRules,
  sector: 'CARWASH',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
});

// Order 1 (100.000): 20% pool = 20.000 / 2 crew = 10.000 each (Agus & Doni)
// Order 2 (50.000): 20% pool = 10.000 / 1 crew = 10.000 to Agus
// Total Agus = 10.000 + 10.000 = 20.000
// Total Doni = 10.000
const agusMetric = cwSummary.staffMetrics.find((m) => m.staffId === 'stf-agus')!;
const doniMetric = cwSummary.staffMetrics.find((m) => m.staffId === 'stf-doni')!;

assert(agusMetric.teamPoolCommission === 20000, `Agus pooled share is 20.000 (actual: ${agusMetric.teamPoolCommission})`);
assert(doniMetric.teamPoolCommission === 10000, `Doni pooled share is 10.000 (actual: ${doniMetric.teamPoolCommission})`);
assert(cwSummary.totalCommissionExpense === 30000, `Total carwash team pool commission is 30.000 (actual: ${cwSummary.totalCommissionExpense})`);

// -------------------------------------------------------------
// TEST 3: F&B DAILY REVENUE TARGET BONUS
// -------------------------------------------------------------
console.log('\n--- Test 3: F&B Daily Revenue Target Bonus ---');

const fnbStaff: StaffMember[] = [
  {
    id: 'stf-chef',
    name: 'Chef Juna',
    role: 'Head Chef',
    sector: 'FNB',
    isAvailable: true,
  },
  {
    id: 'stf-barista',
    name: 'Rian Barista',
    role: 'Barista',
    sector: 'FNB',
    isAvailable: true,
  },
];

const fnbAttendance: AttendanceRecord[] = [
  {
    id: 'att-f1',
    staffId: 'stf-chef',
    staffName: 'Chef Juna',
    staffRole: 'Head Chef',
    clockInTime: '2026-08-11T08:00:00',
    status: 'CLOCKED_OUT',
    businessSector: 'FNB',
  },
  {
    id: 'att-f2',
    staffId: 'stf-barista',
    staffName: 'Rian Barista',
    staffRole: 'Barista',
    clockInTime: '2026-08-11T08:00:00',
    status: 'CLOCKED_OUT',
    businessSector: 'FNB',
  },
];

const fnbOrders: Order[] = [
  {
    id: 'ORD-F1',
    orderNumber: 1,
    date: '2026-08-11T12:00:00',
    orderType: 'DINE_IN',
    cashierName: 'Kasir',
    shiftId: 'sh-1',
    paymentMethod: 'QRIS',
    paymentStatus: 'PAID',
    status: 'COMPLETED',
    subtotal: 1800000,
    discountTotal: 0,
    taxTotal: 0,
    serviceChargeTotal: 0,
    total: 1800000,
    items: [],
  },
  {
    id: 'ORD-F2',
    orderNumber: 2,
    date: '2026-08-11T19:00:00',
    orderType: 'DINE_IN',
    cashierName: 'Kasir',
    shiftId: 'sh-1',
    paymentMethod: 'QRIS',
    paymentStatus: 'PAID',
    status: 'COMPLETED',
    subtotal: 1500000,
    discountTotal: 0,
    taxTotal: 0,
    serviceChargeTotal: 0,
    total: 1500000,
    items: [],
  },
];

// Total day sales = 1.800.000 + 1.500.000 = 3.300.000 (Target 2.500.000 met!)
const fnbRules: StaffCommissionRule[] = [
  {
    staffId: 'GLOBAL_SECTOR',
    dailyRevenueTarget: 2500000,
    targetBonusAmount: 50000, // Rp 50.000 per staff who clocked in
    targetStretchAmount: 5000000,
    targetStretchBonus: 100000,
    targetBonusType: 'FLAT_PER_STAFF',
  },
];

const fnbSummary = calculateSmartLaborMetrics({
  staffMembers: fnbStaff,
  attendanceRecords: fnbAttendance,
  orders: fnbOrders,
  rules: fnbRules,
  sector: 'FNB',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
});

assert(fnbSummary.dailyTargetAchievements.length === 1, '1 daily target achievement recorded');
assert(fnbSummary.dailyTargetAchievements[0].revenue === 3300000, 'Day revenue is 3.300.000');
assert(fnbSummary.dailyTargetAchievements[0].isAchieved === true, 'Target achieved is true');

const chefMetric = fnbSummary.staffMetrics.find((m) => m.staffId === 'stf-chef')!;
const baristaMetric = fnbSummary.staffMetrics.find((m) => m.staffId === 'stf-barista')!;

assert(chefMetric.dailyTargetBonus === 50000, `Chef received 50.000 bonus (actual: ${chefMetric.dailyTargetBonus})`);
assert(baristaMetric.dailyTargetBonus === 50000, `Barista received 50.000 bonus (actual: ${baristaMetric.dailyTargetBonus})`);
assert(fnbSummary.totalBonusExpense === 100000, `Total bonus expense is 100.000 (actual: ${fnbSummary.totalBonusExpense})`);

// -------------------------------------------------------------
// TEST 4: PAYROLL SLIP & WHATSAPP DELIVERY
// -------------------------------------------------------------
console.log('\n--- Test 4: Payroll Slip & WhatsApp Formatting ---');

const draftSlip = createPayrollSlipForStaff(
  budiMetric,
  '2026-08',
  '2026-08-01',
  '2026-08-31',
  'BARBERSHOP',
  100000, // Rp 100.000 kasbon deduction
  'Potongan pelunasan kasbon bulan Juli'
);

assert(draftSlip.grossEarnings === 1600000, 'Gross earnings match 1.600.000');
assert(draftSlip.deductions === 100000, 'Deductions match 100.000');
assert(draftSlip.netSalary === 1500000, 'Net salary is 1.600.000 - 100.000 = 1.500.000');
assert(draftSlip.status === 'DRAFT', 'Status initialized as DRAFT');

const waText = formatWhatsAppPayrollText(draftSlip, 'Barber King Vintage');
assert(waText.includes('SLIP GAJI & KOMISI RESMI'), 'WA text has official header');
assert(waText.includes('Budi Kapster'), 'WA text includes staff name');
assert(waText.includes('Rp\u00a01.500.000') || waText.includes('1.500.000'), 'WA text contains formatted net salary');
assert(waText.includes('Potongan / Kasbon'), 'WA text includes deductions line');

console.log('\nSample WhatsApp Output:');
console.log(waText);

console.log('\n🎉 ALL SMART LABOR & COMMISSION CORE TESTS PASSED SUCCESSFULLY!\n');
