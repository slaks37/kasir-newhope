import {
  StaffMember,
  StaffCommissionRule,
  AttendanceRecord,
  Order,
  AppointmentBooking,
  BusinessSector,
  PayrollSlip,
} from '../types';
import { formatRupiah, formatDateOnly } from './formatters';

export interface StaffPerformanceMetric {
  staffId: string;
  staffName: string;
  staffRole: string;
  phone?: string;
  avatar?: string;
  daysAttended: number;
  attendedDates: string[];
  totalServiceCount: number; // e.g. Jumlah potong rambut / cuci mobil / pesanan
  totalServiceSales: number;
  totalRetailSales: number;
  individualCommission: number;
  teamPoolCommission: number;
  dailyTargetBonus: number;
  baseSalaryPayable: number;
  allowancePayable: number;
  grossPayable: number;
  breakdownNotes: string[];
}

export interface DailyTargetAchievement {
  date: string;
  revenue: number;
  target: number;
  isAchieved: boolean;
  isStretchAchieved: boolean;
  bonusAmount: number;
  eligibleStaffIds: string[];
  eligibleStaffNames: string[];
}

export interface SectorLaborSummary {
  sector: BusinessSector;
  periodStart: string;
  periodEnd: string;
  totalLaborExpense: number;
  totalCommissionExpense: number;
  totalBonusExpense: number;
  totalBaseExpense: number;
  totalRevenueInPeriod: number;
  laborToRevenueRatioPercent: number;
  staffMetrics: StaffPerformanceMetric[];
  dailyTargetAchievements: DailyTargetAchievement[];
}

export interface LaborEngineParams {
  staffMembers: StaffMember[];
  attendanceRecords: AttendanceRecord[];
  orders: Order[];
  bookings?: AppointmentBooking[];
  rules: StaffCommissionRule[];
  sector: BusinessSector;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

/**
 * Filter orders within date range [startDate, endDate] inclusive
 * and match status === 'COMPLETED'.
 */
function getCompletedOrdersInDateRange(
  orders: Order[],
  startDate: string,
  endDate: string,
  sector?: BusinessSector
): Order[] {
  return orders.filter((o) => {
    if (o.status !== 'COMPLETED') return false;
    if (sector && o.businessSector && o.businessSector !== sector) return false;
    const orderDate = (o.date || '').slice(0, 10);
    return orderDate >= startDate && orderDate <= endDate;
  });
}

/**
 * Core computation engine for staff earnings, per-head commissions, team pool splits,
 * and daily revenue target bonuses.
 */
export function calculateSmartLaborMetrics(params: LaborEngineParams): SectorLaborSummary {
  const {
    staffMembers,
    attendanceRecords,
    orders,
    bookings = [],
    rules,
    sector,
    startDate,
    endDate,
  } = params;

  // Filter valid staff for the active sector (or all if sector not specified)
  const sectorStaff = staffMembers.filter((s) => !s.sector || s.sector === sector);

  // Filter completed orders in window
  const periodOrders = getCompletedOrdersInDateRange(orders, startDate, endDate, sector);

  // Group orders by date (YYYY-MM-DD)
  const ordersByDate = new Map<string, Order[]>();
  let totalRevenueInPeriod = 0;

  for (const ord of periodOrders) {
    const d = (ord.date || '').slice(0, 10);
    if (!ordersByDate.has(d)) ordersByDate.set(d, []);
    ordersByDate.get(d)!.push(ord);
    totalRevenueInPeriod += ord.total || 0;
  }

  // Attendance by staff
  const staffAttendanceMap = new Map<string, Set<string>>(); // staffId -> set of unique dates
  for (const att of attendanceRecords) {
    const attDate = (att.clockInTime || '').slice(0, 10);
    if (attDate >= startDate && attDate <= endDate) {
      if (!staffAttendanceMap.has(att.staffId)) {
        staffAttendanceMap.set(att.staffId, new Set());
      }
      staffAttendanceMap.get(att.staffId)!.add(attDate);
    }
  }

  // Find general sector rule or fallback
  const sectorRule = rules.find((r) => r.staffId === 'GLOBAL_SECTOR' || r.staffId === sector) ||
    rules[0] || {
      staffId: 'GLOBAL_SECTOR',
      serviceCommissionPercent: sector === 'BARBERSHOP' ? 35 : 0,
      retailCommissionPercent: sector === 'BARBERSHOP' ? 10 : 5,
      teamPoolType: 'PERCENTAGE_OF_POOL',
      teamPoolRate: sector === 'CARWASH' ? 20 : 0,
      teamPoolDistribution: 'BY_ASSIGNED_JOB',
      dailyRevenueTarget: sector === 'FNB' ? 2500000 : 3000000,
      targetBonusAmount: 50000,
      targetStretchAmount: 5000000,
      targetStretchBonus: 100000,
      targetBonusType: 'FLAT_PER_STAFF',
    };

  // 1. Calculate Daily Target Achievements (for F&B, Retail, or configured sectors)
  const dailyTargetAchievements: DailyTargetAchievement[] = [];
  const staffDailyTargetBonusMap = new Map<string, number>();

  if (sectorRule.dailyRevenueTarget && sectorRule.dailyRevenueTarget > 0) {
    ordersByDate.forEach((dayOrders, date) => {
      const dayRev = dayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      const isTargetMet = dayRev >= (sectorRule.dailyRevenueTarget || 0);
      const isStretchMet =
        Boolean(sectorRule.targetStretchAmount) &&
        dayRev >= (sectorRule.targetStretchAmount || 0);

      if (isTargetMet) {
        // Identify staff clocked-in on this date
        const eligibleStaff: StaffMember[] = [];
        sectorStaff.forEach((st) => {
          const dates = staffAttendanceMap.get(st.id);
          if (dates && dates.has(date)) {
            eligibleStaff.push(st);
          }
        });

        // If no attendance record found on that day, consider all active sector staff eligible as fallback
        const recipients = eligibleStaff.length > 0 ? eligibleStaff : sectorStaff;
        let dayBonusPerStaff = 0;

        if (isStretchMet && sectorRule.targetStretchBonus) {
          dayBonusPerStaff = sectorRule.targetStretchBonus;
        } else if (sectorRule.targetBonusType === 'SURPLUS_PERCENTAGE' && sectorRule.surplusPercent) {
          const surplus = Math.max(0, dayRev - (sectorRule.dailyRevenueTarget || 0));
          const pool = (surplus * sectorRule.surplusPercent) / 100;
          dayBonusPerStaff = recipients.length > 0 ? Math.round(pool / recipients.length) : 0;
        } else {
          dayBonusPerStaff = sectorRule.targetBonusAmount || 50000;
        }

        recipients.forEach((st) => {
          const current = staffDailyTargetBonusMap.get(st.id) || 0;
          staffDailyTargetBonusMap.set(st.id, current + dayBonusPerStaff);
        });

        dailyTargetAchievements.push({
          date,
          revenue: dayRev,
          target: sectorRule.dailyRevenueTarget || 0,
          isAchieved: isTargetMet,
          isStretchAchieved: isStretchMet,
          bonusAmount: dayBonusPerStaff,
          eligibleStaffIds: recipients.map((r) => r.id),
          eligibleStaffNames: recipients.map((r) => r.name),
        });
      }
    });
  }

  // 2. Calculate Team Pool Split (especially Car Wash or team-based)
  const staffTeamPoolMap = new Map<string, number>();

  if (sector === 'CARWASH' || sectorRule.teamPoolRate) {
    const poolRate = sectorRule.teamPoolRate || 20; // 20% by default for carwash
    const poolType = sectorRule.teamPoolType || 'PERCENTAGE_OF_POOL';
    const distType = sectorRule.teamPoolDistribution || 'BY_ASSIGNED_JOB';

    if (distType === 'BY_ASSIGNED_JOB') {
      // Split each vehicle order commission among assigned crew
      for (const ord of periodOrders) {
        const orderVehicleCommission =
          poolType === 'FIXED_PER_VEHICLE'
            ? poolRate
            : Math.round(((ord.subtotal || ord.total || 0) * poolRate) / 100);

        const assignedCrew = ord.assignedCrew || [];
        if (assignedCrew.length > 0) {
          const sharePerCrew = Math.round(orderVehicleCommission / assignedCrew.length);
          for (const crewName of assignedCrew) {
            // Find staff by name or id
            const st = sectorStaff.find(
              (s) => s.name.toLowerCase().trim() === crewName.toLowerCase().trim() || s.id === crewName
            );
            if (st) {
              const prev = staffTeamPoolMap.get(st.id) || 0;
              staffTeamPoolMap.set(st.id, prev + sharePerCrew);
            }
          }
        } else {
          // If no specific crew assigned to this car, pool among present staff on that date
          const ordDate = (ord.date || '').slice(0, 10);
          const presentStaff: StaffMember[] = [];
          sectorStaff.forEach((st) => {
            const dates = staffAttendanceMap.get(st.id);
            if (dates && dates.has(ordDate)) presentStaff.push(st);
          });
          const poolRecipients = presentStaff.length > 0 ? presentStaff : sectorStaff;
          const share = poolRecipients.length > 0 ? Math.round(orderVehicleCommission / poolRecipients.length) : 0;
          poolRecipients.forEach((st) => {
            const prev = staffTeamPoolMap.get(st.id) || 0;
            staffTeamPoolMap.set(st.id, prev + share);
          });
        }
      }
    } else {
      // EQUAL_AMONG_PRESENT: aggregate total car wash revenue/orders per day and split equally among clocked in
      ordersByDate.forEach((dayOrders, date) => {
        let dayPool = 0;
        if (poolType === 'FIXED_PER_VEHICLE') {
          dayPool = dayOrders.length * poolRate;
        } else {
          const daySales = dayOrders.reduce((sum, o) => sum + (o.subtotal || o.total || 0), 0);
          dayPool = Math.round((daySales * poolRate) / 100);
        }

        const presentStaff: StaffMember[] = [];
        sectorStaff.forEach((st) => {
          const dates = staffAttendanceMap.get(st.id);
          if (dates && dates.has(date)) presentStaff.push(st);
        });
        const poolRecipients = presentStaff.length > 0 ? presentStaff : sectorStaff;
        const share = poolRecipients.length > 0 ? Math.round(dayPool / poolRecipients.length) : 0;
        poolRecipients.forEach((st) => {
          const prev = staffTeamPoolMap.get(st.id) || 0;
          staffTeamPoolMap.set(st.id, prev + share);
        });
      });
    }
  }

  // 3. Calculate Individual Staff Metrics & Commissions (Barbershop kapster per-head, retail bonus, etc.)
  const staffMetrics: StaffPerformanceMetric[] = sectorStaff.map((staff) => {
    // Find staff-specific rule or fallback to sector rule
    const staffRule = rules.find((r) => r.staffId === staff.id) || sectorRule;

    const attendedDatesSet = staffAttendanceMap.get(staff.id) || new Set();
    const daysAttended = attendedDatesSet.size;
    const attendedDates = Array.from(attendedDatesSet).sort();

    // Base salary calculation
    let baseSalaryPayable = 0;
    if (staff.baseSalary && staff.baseSalary > 0) {
      if (staff.salaryType === 'DAILY') {
        baseSalaryPayable = staff.baseSalary * daysAttended;
      } else {
        // Monthly base salary
        baseSalaryPayable = staff.baseSalary;
      }
    }

    // Daily allowance (uang makan / transport)
    const allowancePayable = (staff.dailyAllowance || 0) * daysAttended;

    // Track services and retail sales
    let totalServiceCount = 0;
    let totalServiceSales = 0;
    let totalRetailSales = 0;
    let individualCommission = 0;
    const breakdownNotes: string[] = [];

    // Check Barbershop Bookings served by this staff
    if (sector === 'BARBERSHOP' && bookings.length > 0) {
      const staffBookings = bookings.filter(
        (b) =>
          b.status === 'COMPLETED' &&
          (b.staffMemberId === staff.id ||
            b.staffMemberName?.toLowerCase() === staff.name.toLowerCase() ||
            b.staffName?.toLowerCase() === staff.name.toLowerCase()) &&
          (b.bookingDate || b.date || '').slice(0, 10) >= startDate &&
          (b.bookingDate || b.date || '').slice(0, 10) <= endDate
      );

      totalServiceCount += staffBookings.length;
      const bookingSales = staffBookings.reduce((sum, b) => sum + (b.servicePrice || 0), 0);
      totalServiceSales += bookingSales;
    }

    // Check completed Orders served by this staff
    for (const ord of periodOrders) {
      const isServedByStaff =
        ord.servedByStaffId === staff.id ||
        (ord.servedByStaffName &&
          ord.servedByStaffName.toLowerCase().trim() === staff.name.toLowerCase().trim());

      // Check item-level attribution if present
      for (const item of ord.items) {
        const itemServedByThisStaff =
          item.servedByStaffName &&
          item.servedByStaffName.toLowerCase().trim() === staff.name.toLowerCase().trim();

        if (isServedByStaff || itemServedByThisStaff) {
          // If item is a service or retail
          const itemPrice = item.totalPrice || item.unitPrice * item.quantity;
          const isService =
            sector === 'BARBERSHOP'
              ? item.name.toLowerCase().includes('cut') ||
                item.name.toLowerCase().includes('cukur') ||
                item.name.toLowerCase().includes('grooming') ||
                item.name.toLowerCase().includes('shave') ||
                item.name.toLowerCase().includes('coloring') ||
                item.name.toLowerCase().includes('treatment')
              : true;

          if (isService) {
            // Count unique customer heads / services
            totalServiceCount += item.quantity;
            totalServiceSales += itemPrice;
          } else {
            totalRetailSales += itemPrice;
          }
        }
      }
    }

    // Calculate individual commission:
    // A. Service Commission
    if (staffRule.fixedCommissionPerService && staffRule.fixedCommissionPerService > 0) {
      const fixedComm = totalServiceCount * staffRule.fixedCommissionPerService;
      individualCommission += fixedComm;
      breakdownNotes.push(
        `Komisi Jasa: ${totalServiceCount} layanan x ${formatRupiah(staffRule.fixedCommissionPerService)} = ${formatRupiah(fixedComm)}`
      );
    } else if (staffRule.serviceCommissionPercent && staffRule.serviceCommissionPercent > 0) {
      const pctComm = Math.round((totalServiceSales * staffRule.serviceCommissionPercent) / 100);
      individualCommission += pctComm;
      breakdownNotes.push(
        `Komisi Jasa: ${staffRule.serviceCommissionPercent}% dari ${formatRupiah(totalServiceSales)} = ${formatRupiah(pctComm)}`
      );
    } else if (staffRule.commissionType === 'FIXED_PER_ORDER' && staffRule.rateValue) {
      const comm = totalServiceCount * staffRule.rateValue;
      individualCommission += comm;
      breakdownNotes.push(
        `Komisi Tetap: ${totalServiceCount} order x ${formatRupiah(staffRule.rateValue)} = ${formatRupiah(comm)}`
      );
    } else if (staffRule.commissionType === 'PERCENTAGE' && staffRule.rateValue) {
      const comm = Math.round((totalServiceSales * staffRule.rateValue) / 100);
      individualCommission += comm;
      breakdownNotes.push(
        `Komisi: ${staffRule.rateValue}% dari ${formatRupiah(totalServiceSales)} = ${formatRupiah(comm)}`
      );
    }

    // B. Retail Commission
    if (staffRule.retailCommissionPercent && staffRule.retailCommissionPercent > 0 && totalRetailSales > 0) {
      const retailComm = Math.round((totalRetailSales * staffRule.retailCommissionPercent) / 100);
      individualCommission += retailComm;
      breakdownNotes.push(
        `Komisi Produk Retail: ${staffRule.retailCommissionPercent}% dari ${formatRupiah(totalRetailSales)} = ${formatRupiah(retailComm)}`
      );
    }

    // Team pool share
    const teamPoolCommission = staffTeamPoolMap.get(staff.id) || 0;
    if (teamPoolCommission > 0) {
      breakdownNotes.push(`Bagi Hasil Tim Pool: ${formatRupiah(teamPoolCommission)}`);
    }

    // Daily target bonus
    const dailyTargetBonus = staffDailyTargetBonusMap.get(staff.id) || 0;
    if (dailyTargetBonus > 0) {
      breakdownNotes.push(`Bonus Target Harian: ${formatRupiah(dailyTargetBonus)}`);
    }

    const grossPayable =
      baseSalaryPayable + allowancePayable + individualCommission + teamPoolCommission + dailyTargetBonus;

    return {
      staffId: staff.id,
      staffName: staff.name,
      staffRole: staff.role,
      phone: staff.phone,
      avatar: staff.avatar,
      daysAttended,
      attendedDates,
      totalServiceCount,
      totalServiceSales,
      totalRetailSales,
      individualCommission,
      teamPoolCommission,
      dailyTargetBonus,
      baseSalaryPayable,
      allowancePayable,
      grossPayable,
      breakdownNotes,
    };
  });

  // Calculate sector aggregate summary
  const totalBaseExpense = staffMetrics.reduce((s, m) => s + m.baseSalaryPayable + m.allowancePayable, 0);
  const totalCommissionExpense = staffMetrics.reduce(
    (s, m) => s + m.individualCommission + m.teamPoolCommission,
    0
  );
  const totalBonusExpense = staffMetrics.reduce((s, m) => s + m.dailyTargetBonus, 0);
  const totalLaborExpense = totalBaseExpense + totalCommissionExpense + totalBonusExpense;
  const laborToRevenueRatioPercent =
    totalRevenueInPeriod > 0
      ? Math.round((totalLaborExpense / totalRevenueInPeriod) * 1000) / 10
      : 0;

  return {
    sector,
    periodStart: startDate,
    periodEnd: endDate,
    totalLaborExpense,
    totalCommissionExpense,
    totalBonusExpense,
    totalBaseExpense,
    totalRevenueInPeriod,
    laborToRevenueRatioPercent,
    staffMetrics,
    dailyTargetAchievements,
  };
}

/**
 * Factory to create a clean draft PayrollSlip from staff performance metric.
 */
export function createPayrollSlipForStaff(
  metric: StaffPerformanceMetric,
  periodMonth: string,
  startDate: string,
  endDate: string,
  sector: BusinessSector,
  deductions: number = 0,
  notes: string = ''
): PayrollSlip {
  const netSalary = Math.max(0, metric.grossPayable - deductions);

  return {
    id: `SLIP-${metric.staffId}-${periodMonth}-${Date.now().toString(36).toUpperCase()}`,
    staffId: metric.staffId,
    staffName: metric.staffName,
    staffRole: metric.staffRole,
    periodMonth,
    periodStart: startDate,
    periodEnd: endDate,
    daysAttended: metric.daysAttended,
    baseSalary: metric.baseSalaryPayable,
    allowance: metric.allowancePayable,
    individualCommission: metric.individualCommission,
    teamPoolCommission: metric.teamPoolCommission,
    dailyTargetBonus: metric.dailyTargetBonus,
    grossEarnings: metric.grossPayable,
    deductions,
    netSalary,
    status: 'DRAFT',
    businessSector: sector,
    notes: notes || metric.breakdownNotes.join(' • '),
  };
}

/**
 * Format a WhatsApp message text ready to send directly to the staff member.
 */
export function formatWhatsAppPayrollText(slip: PayrollSlip, storeName: string): string {
  const lines = [
    `*SLIP GAJI & KOMISI RESMI*`,
    `🏪 *${storeName.toUpperCase()}*`,
    `--------------------------------`,
    `👤 *Nama Staf:* ${slip.staffName} (${slip.staffRole})`,
    `📅 *Periode:* ${formatDateOnly(slip.periodStart)} s/d ${formatDateOnly(slip.periodEnd)}`,
    `🗓️ *Hari Masuk:* ${slip.daysAttended} Hari`,
    `--------------------------------`,
    `*RINCIAN PENDAPATAN:*`,
  ];

  if (slip.baseSalary > 0) {
    lines.push(`• Gaji Pokok: ${formatRupiah(slip.baseSalary)}`);
  }
  if (slip.allowance > 0) {
    lines.push(`• Uang Makan/Transport: ${formatRupiah(slip.allowance)}`);
  }
  if (slip.individualCommission > 0) {
    lines.push(`• Komisi Jasa & Retail: ${formatRupiah(slip.individualCommission)}`);
  }
  if (slip.teamPoolCommission > 0) {
    lines.push(`• Bagi Hasil Tim: ${formatRupiah(slip.teamPoolCommission)}`);
  }
  if (slip.dailyTargetBonus > 0) {
    lines.push(`• Bonus Target Omzet: ${formatRupiah(slip.dailyTargetBonus)}`);
  }

  lines.push(`--------------------------------`);
  lines.push(`💰 *Total Pendapatan Kotor:* ${formatRupiah(slip.grossEarnings)}`);

  if (slip.deductions > 0) {
    lines.push(`🔻 *Potongan / Kasbon:* -${formatRupiah(slip.deductions)}`);
  }

  lines.push(`✨ *TOTAL GAJI BERSIH (TAKE HOME PAY):* *${formatRupiah(slip.netSalary)}*`);
  lines.push(`--------------------------------`);

  if (slip.status === 'PAID') {
    lines.push(`✅ *STATUS: SUDAH DIBAYARKAN*`);
    if (slip.paidAt) lines.push(`🕒 Tanggal: ${formatDateOnly(slip.paidAt)}`);
    if (slip.paymentMethod) lines.push(`💳 Metode: ${slip.paymentMethod}`);
  } else {
    lines.push(`⏳ *STATUS: DRAFT / SIAP DICAIRKAN*`);
  }

  if (slip.notes) {
    lines.push(`📝 *Catatan:* ${slip.notes}`);
  }

  lines.push(`\n_Terima kasih atas dedikasi dan kerja keras Anda bersama ${storeName}!_`);
  return lines.join('\n');
}
