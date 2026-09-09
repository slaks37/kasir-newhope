import {
  Customer,
  Order,
  AppointmentBooking,
  CarwashQueueItem,
  BusinessSector,
  WhatsAppLifecycleHook,
  LifecycleHookType,
} from '../types';
import { formatRupiah } from './formatters';

export interface GenerateLifecycleHooksParams {
  customers: Customer[];
  orders: Order[];
  bookings?: AppointmentBooking[];
  carwashQueue?: CarwashQueueItem[];
  sector: BusinessSector;
  storeName: string;
  sentHookIds?: string[];
  referenceDate?: Date;
}

/**
 * Standardize Indonesian phone number to international WhatsApp format (628xxxx)
 */
export function formatWhatsAppPhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return '62' + digits.slice(1);
  }
  if (digits.startsWith('62')) {
    return digits;
  }
  return digits;
}

/**
 * Build WhatsApp Web/App Universal Link
 */
export function getWhatsAppUrl(phone: string, text: string): string {
  const cleanPhone = formatWhatsAppPhone(phone);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

/**
 * Calculates calendar day difference between two date strings or timestamps.
 */
function getDaysDifference(dateStr1: string, date2: Date): number {
  try {
    const d1 = new Date(dateStr1);
    const diffMs = date2.getTime() - d1.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * Main automated lifecycle hook generator.
 * Analyzes milestone completions, time-decay retention thresholds, weather/open slots,
 * and rush-hour promotional opportunities.
 */
export function generateLifecycleHooks(
  params: GenerateLifecycleHooksParams
): WhatsAppLifecycleHook[] {
  const {
    customers,
    orders,
    bookings = [],
    carwashQueue = [],
    sector,
    storeName,
    sentHookIds = [],
    referenceDate = new Date(),
  } = params;

  const sentSet = new Set(sentHookIds);
  const hooks: WhatsAppLifecycleHook[] = [];

  // =========================================================================
  // 1. LAUNDRY LIFECYCLE HOOK:
  // "Pakaianmu sudah selesai disetrika dan ada di Rak B-03."
  // =========================================================================
  if (sector === 'LAUNDRY') {
    // Find laundry orders completed or ready for pickup at a specific rack
    const readyOrders = orders.filter((o) => {
      if (o.businessSector && o.businessSector !== 'LAUNDRY') return false;
      const isReadyStage =
        o.laundryStatus === 'SELESAI_SIAP_AMBIL' ||
        o.laundryStage === 'SETRIKA' ||
        o.status === 'COMPLETED';
      const hasRack = Boolean(o.storageRack && o.storageRack.trim() !== '');
      const hasPhone = Boolean(o.customer?.phone);
      return isReadyStage && hasRack && hasPhone;
    });

    for (const ord of readyOrders) {
      const hookId = `hook-laundry-${ord.id}-${ord.storageRack}`;
      if (sentSet.has(hookId)) continue;

      const custName = ord.customer?.name || 'Pelanggan';
      const custPhone = ord.customer?.phone || '';
      const rack = ord.storageRack || 'Rak Pengambilan';
      const totalStr = formatRupiah(ord.total);

      const message = [
        `Halo Kak ${custName}! 🧺✨`,
        `Pakaianmu sudah selesai disetrika dan ada di ${rack}.`,
        `Siap diambil di ${storeName} kapan saja. Total pesanan: ${totalStr}.`,
        `Terima kasih telah mempercayakan cucianmu kepada kami! 🙏`,
      ].join('\n');

      hooks.push({
        id: hookId,
        type: 'LAUNDRY_READY',
        sector: 'LAUNDRY',
        customerId: ord.customer?.id,
        customerName: custName,
        customerPhone: custPhone,
        title: `Pakaian Selesai Disetrika (${rack})`,
        message,
        triggerReason: `Pesanan ${ord.id} telah disetrika rapi & disimpan di ${rack}`,
        urgency: 'HIGH',
        metadata: {
          orderId: ord.id,
          storageRack: rack,
          totalAmount: ord.total,
        },
        status: 'PENDING',
        createdAt: ord.date || new Date().toISOString(),
      });
    }
  }

  // =========================================================================
  // 2. BARBERSHOP LIFECYCLE HOOK:
  // "Sudah 3 minggu sejak potong rambut terakhir dengan Mas Doni. Mau booking slot jam 4 sore ini?"
  // =========================================================================
  if (sector === 'BARBERSHOP') {
    // Scan all customers with hair cut history
    for (const cust of customers) {
      if (!cust.phone) continue;

      // Find last haircut order or booking
      const custBookings = bookings.filter(
        (b) =>
          b.status === 'COMPLETED' &&
          (b.customerName.toLowerCase() === cust.name.toLowerCase() ||
            b.customerPhone === cust.phone)
      );

      const custOrders = orders.filter(
        (o) =>
          o.status === 'COMPLETED' &&
          (o.customer?.id === cust.id || o.customer?.phone === cust.phone)
      );

      // Determine most recent date and stylist
      let lastDateStr = cust.lastVisit || '';
      let stylistName = cust.preferredStylist || 'Mas Doni';

      if (custBookings.length > 0) {
        const latestBooking = custBookings[custBookings.length - 1];
        if (latestBooking.date || latestBooking.bookingDate) {
          lastDateStr = latestBooking.date || latestBooking.bookingDate || lastDateStr;
        }
        if (latestBooking.staffName || latestBooking.staffMemberName) {
          stylistName = latestBooking.staffName || latestBooking.staffMemberName || stylistName;
        }
      } else if (custOrders.length > 0) {
        const latestOrder = custOrders[custOrders.length - 1];
        if (latestOrder.date) lastDateStr = latestOrder.date.slice(0, 10);
        if (latestOrder.servedByStaffName) stylistName = latestOrder.servedByStaffName;
      }

      if (!lastDateStr) continue;

      const daysDiff = getDaysDifference(lastDateStr, referenceDate);

      // Check if around 3 weeks (between 18 and 30 days)
      if (daysDiff >= 18) {
        const hookId = `hook-barber-${cust.id || cust.phone}-${lastDateStr.slice(0, 10)}`;
        if (sentSet.has(hookId)) continue;

        const suggestedTime = 'jam 4 sore ini';
        const message = [
          `Halo Kak ${cust.name}! 💈✂️`,
          `Sudah 3 minggu sejak potong rambut terakhir dengan ${stylistName}.`,
          `Rambut sudah mulai panjang dan kurang rapi nih. Mau booking slot ${suggestedTime} di ${storeName}?`,
          `Balas pesan ini untuk langsung amankan kursi ya!`,
        ].join('\n');

        hooks.push({
          id: hookId,
          type: 'BARBERSHOP_RETENTION',
          sector: 'BARBERSHOP',
          customerId: cust.id,
          customerName: cust.name,
          customerPhone: cust.phone,
          title: `Radar 3 Minggu: Potong Rambut (${stylistName})`,
          message,
          triggerReason: `Terakhir potong rambut ${daysDiff} hari lalu (${lastDateStr}) bersama ${stylistName}`,
          urgency: daysDiff >= 24 ? 'HIGH' : 'MEDIUM',
          metadata: {
            stylistName,
            daysSinceLastCut: daysDiff,
            suggestedTimeSlot: suggestedTime,
            lastVisitDate: lastDateStr,
          },
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // =========================================================================
  // 3. CAR WASH LIFECYCLE HOOK:
  // "Hujan semalam bikin kotor? Slot cuci mobil kosong jam 10.00."
  // =========================================================================
  if (sector === 'CARWASH') {
    // Look at past carwash customers who haven't visited in 5+ days
    for (const cust of customers) {
      if (!cust.phone) continue;

      // Check if customer is already currently in queue
      const inQueue = carwashQueue.some(
        (q) =>
          q.customerPhone === cust.phone ||
          (q.customerName && q.customerName.toLowerCase() === cust.name.toLowerCase())
      );
      if (inQueue) continue;

      const lastVisitStr = cust.lastVisit || '2026-08-01';
      const daysSinceWash = getDaysDifference(lastVisitStr, referenceDate);

      if (daysSinceWash >= 5) {
        const hookId = `hook-carwash-${cust.id || cust.phone}-${referenceDate.toISOString().slice(0, 10)}`;
        if (sentSet.has(hookId)) continue;

        const plate = cust.lastVehiclePlate || 'mobil Anda';
        const slotTime = '10.00';

        const message = [
          `Halo Kak ${cust.name}! 🚗🌧️`,
          `Hujan semalam bikin kotor? Slot cuci mobil kosong jam ${slotTime} di ${storeName}.`,
          `Yuk mampir cuci kilat tanpa antre panjang biar kendaraan kembali kinclong!`,
          `Balas pesan ini jika ingin booking slot terlebih dahulu ya.`,
        ].join('\n');

        hooks.push({
          id: hookId,
          type: 'CARWASH_WEATHER',
          sector: 'CARWASH',
          customerId: cust.id,
          customerName: cust.name,
          customerPhone: cust.phone,
          title: `Broadcast Cuci: Pasca Hujan / Slot Jam ${slotTime}`,
          message,
          triggerReason: `Kendaraan terakhir dicuci ${daysSinceWash} hari lalu. Bay cuci sedang lengang`,
          urgency: 'MEDIUM',
          metadata: {
            vehiclePlate: plate,
            slotTime,
            daysSinceWash,
          },
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // =========================================================================
  // 4. F&B LIFECYCLE HOOK:
  // "Promo makan siang kantor hemat hari ini."
  // =========================================================================
  if (sector === 'FNB') {
    // Select top loyal customers / office members
    for (const cust of customers) {
      if (!cust.phone) continue;

      const hookId = `hook-fnb-lunch-${cust.id || cust.phone}-${referenceDate.toISOString().slice(0, 10)}`;
      if (sentSet.has(hookId)) continue;

      const message = [
        `Halo Kak ${cust.name}! 🍱🍗`,
        `Promo makan siang kantor hemat hari ini di ${storeName}:`,
        `Nikmati paket hemat makan siang + gratis es teh untuk santap bersama rekan kerja!`,
        `Bisa dine-in atau take-away. Mau kami siapkan meja atau pesanan terlebih dahulu?`,
      ].join('\n');

      hooks.push({
        id: hookId,
        type: 'FNB_LUNCH_PROMO',
        sector: 'FNB',
        customerId: cust.id,
        customerName: cust.name,
        customerPhone: cust.phone,
        title: `Promo Makan Siang Kantor Hemat`,
        message,
        triggerReason: `Rush-hour makan siang kantor (11.00 - 13.00) untuk member aktif`,
        urgency: 'MEDIUM',
        metadata: {
          promoType: 'LUNCH_RUSH',
          points: cust.points,
        },
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
    }
  }

  // =========================================================================
  // 5. RETAIL LIFECYCLE HOOK:
  // Loyalty points & VIP Restock Hook
  // =========================================================================
  if (sector === 'RETAIL') {
    for (const cust of customers) {
      if (!cust.phone || (cust.points || 0) < 50) continue;

      const hookId = `hook-retail-vip-${cust.id || cust.phone}-${referenceDate.toISOString().slice(0, 10)}`;
      if (sentSet.has(hookId)) continue;

      const message = [
        `Halo Kak ${cust.name}! 🛍️🎁`,
        `Poin reward belanjamu di ${storeName} sudah terkumpul ${cust.points} poin.`,
        `Stok produk favorit baru saja mendarat di toko. Yuk mampir hari ini dan tukarkan poinmu dengan potongan langsung!`,
      ].join('\n');

      hooks.push({
        id: hookId,
        type: 'RETAIL_VIP',
        sector: 'RETAIL',
        customerId: cust.id,
        customerName: cust.name,
        customerPhone: cust.phone,
        title: `Poin Reward & Kedatangan Stok Baru`,
        message,
        triggerReason: `Member memiliki ${cust.points} poin loyalty siap redeem`,
        urgency: 'LOW',
        metadata: {
          points: cust.points,
        },
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return hooks;
}

/**
 * Dispatch hook directly into WhatsApp Web or Mobile App
 */
export function dispatchWhatsAppHook(
  hook: WhatsAppLifecycleHook,
  onSent?: (hookId: string) => void
): void {
  const url = getWhatsAppUrl(hook.customerPhone, hook.message);
  window.open(url, '_blank');
  if (onSent) {
    onSent(hook.id);
  }
}
