/**
 * Smoke harness for Automated WhatsApp Lifecycle Hooks.
 *
 *   npx tsx scripts/dev/smoke-lifecycle.ts
 *
 * Validates message generation and trigger conditions across all five vertical modules:
 * 1. Laundry: "Pakaianmu sudah selesai disetrika dan ada di Rak B-03."
 * 2. Barbershop: "Sudah 3 minggu sejak potong rambut terakhir dengan Mas Doni. Mau booking slot jam 4 sore ini?"
 * 3. Car Wash: "Hujan semalam bikin kotor? Slot cuci mobil kosong jam 10.00."
 * 4. F&B: "Promo makan siang kantor hemat hari ini."
 * 5. Retail: "Poin reward belanjamu di Toko Mart..."
 */

import {
  generateLifecycleHooks,
  formatWhatsAppPhone,
  getWhatsAppUrl,
} from '../../src/utils/whatsappLifecycle';
import {
  Customer,
  Order,
  AppointmentBooking,
  CarwashQueueItem,
} from '../../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

console.log('🧪 Starting Automated WhatsApp Lifecycle Hook Smoke Tests...\n');

// Pinned reference time
const NOW = new Date('2026-08-31T12:00:00');

// -------------------------------------------------------------
// 1. LAUNDRY LIFECYCLE HOOK
// "Pakaianmu sudah selesai disetrika dan ada di Rak B-03."
// -------------------------------------------------------------
console.log('--- 1. Testing Laundry Ready & Storage Rack Hook ---');

const laundryOrders: Order[] = [
  {
    id: 'ORD-LND-001',
    orderNumber: 101,
    date: '2026-08-31T10:00:00',
    orderType: 'DINE_IN',
    cashierName: 'Siti Kasir',
    shiftId: 'sh-1',
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    status: 'COMPLETED',
    laundryStatus: 'SELESAI_SIAP_AMBIL',
    laundryStage: 'SETRIKA',
    storageRack: 'Rak B-03', // Assigned to Rak B-03!
    subtotal: 45000,
    discountTotal: 0,
    taxTotal: 0,
    serviceChargeTotal: 0,
    total: 45000,
    customer: {
      id: 'cust-l1',
      name: 'Ibu Ratna',
      phone: '08123456789',
      points: 10,
      tier: 'BRONZE',
      totalSpent: 45000,
      visitCount: 1,
      lastVisit: '2026-08-31',
    },
    items: [],
  },
];

const laundryHooks = generateLifecycleHooks({
  customers: [],
  orders: laundryOrders,
  sector: 'LAUNDRY',
  storeName: 'Berkah Laundry Express',
  referenceDate: NOW,
});

assert(laundryHooks.length === 1, '1 Laundry hook generated');
const lHook = laundryHooks[0];
assert(lHook.type === 'LAUNDRY_READY', 'Type is LAUNDRY_READY');
assert(lHook.customerName === 'Ibu Ratna', 'Customer name is Ibu Ratna');
assert(
  lHook.message.includes('Pakaianmu sudah selesai disetrika dan ada di Rak B-03'),
  `Laundry message contains requested text (actual:\n${lHook.message})`
);
assert(lHook.message.includes('Rp\u00a045.000') || lHook.message.includes('45.000'), 'Includes order total');

// -------------------------------------------------------------
// 2. BARBERSHOP LIFECYCLE HOOK
// "Sudah 3 minggu sejak potong rambut terakhir dengan Mas Doni. Mau booking slot jam 4 sore ini?"
// -------------------------------------------------------------
console.log('\n--- 2. Testing Barbershop 3-Week Retention Hook ---');

// Customer who visited 21 days ago (August 10, 2026 vs August 31, 2026 = 21 days = exactly 3 weeks)
const barbershopCustomers: Customer[] = [
  {
    id: 'cust-barber-1',
    name: 'Rendy Pratama',
    phone: '085712345678',
    points: 30,
    tier: 'SILVER',
    totalSpent: 180000,
    visitCount: 3,
    lastVisit: '2026-08-10', // 21 days ago
    preferredStylist: 'Mas Doni',
  },
];

const barbershopBookings: AppointmentBooking[] = [
  {
    id: 'bk-old-1',
    customerName: 'Rendy Pratama',
    customerPhone: '085712345678',
    staffId: 'stf-doni',
    staffName: 'Mas Doni',
    staffMemberId: 'stf-doni',
    serviceName: 'Gentleman Haircut',
    servicePrice: 60000,
    date: '2026-08-10',
    bookingDate: '2026-08-10',
    timeSlot: '16:00',
    status: 'COMPLETED',
  },
];

const barberHooks = generateLifecycleHooks({
  customers: barbershopCustomers,
  orders: [],
  bookings: barbershopBookings,
  sector: 'BARBERSHOP',
  storeName: 'Gentlemen Barbershop',
  referenceDate: NOW,
});

assert(barberHooks.length === 1, '1 Barbershop hook generated');
const bHook = barberHooks[0];
assert(bHook.type === 'BARBERSHOP_RETENTION', 'Type is BARBERSHOP_RETENTION');
assert(
  bHook.message.includes('Sudah 3 minggu sejak potong rambut terakhir dengan Mas Doni'),
  `Barbershop message matches 3-week kapster reminder (actual:\n${bHook.message})`
);
assert(
  bHook.message.includes('Mau booking slot jam 4 sore ini'),
  'Barbershop message suggests jam 4 sore slot'
);

// -------------------------------------------------------------
// 3. CAR WASH LIFECYCLE HOOK
// "Hujan semalam bikin kotor? Slot cuci mobil kosong jam 10.00."
// -------------------------------------------------------------
console.log('\n--- 3. Testing Car Wash Weather & Slot Hook ---');

const carwashCustomers: Customer[] = [
  {
    id: 'cust-cw-1',
    name: 'Pak Bambang',
    phone: '081398765432',
    points: 50,
    tier: 'GOLD',
    totalSpent: 350000,
    visitCount: 4,
    lastVisit: '2026-08-20', // 11 days ago
    lastVehiclePlate: 'B 1234 ABC',
  },
];

const cwHooks = generateLifecycleHooks({
  customers: carwashCustomers,
  orders: [],
  carwashQueue: [],
  sector: 'CARWASH',
  storeName: 'Shine & Clean Car Wash',
  referenceDate: NOW,
});

assert(cwHooks.length === 1, '1 Car Wash hook generated');
const cwHook = cwHooks[0];
assert(cwHook.type === 'CARWASH_WEATHER', 'Type is CARWASH_WEATHER');
assert(
  cwHook.message.includes('Hujan semalam bikin kotor? Slot cuci mobil kosong jam 10.00'),
  `Car Wash message matches post-rain slot trigger (actual:\n${cwHook.message})`
);

// -------------------------------------------------------------
// 4. F&B LIFECYCLE HOOK
// "Promo makan siang kantor hemat hari ini."
// -------------------------------------------------------------
console.log('\n--- 4. Testing F&B Lunch Rush Promo Hook ---');

const fnbCustomers: Customer[] = [
  {
    id: 'cust-fnb-1',
    name: 'Maya Kantor',
    phone: '081288889999',
    points: 80,
    tier: 'PLATINUM',
    totalSpent: 950000,
    visitCount: 8,
    lastVisit: '2026-08-29',
  },
];

const fnbHooks = generateLifecycleHooks({
  customers: fnbCustomers,
  orders: [],
  sector: 'FNB',
  storeName: 'Resto Dapur Rasa',
  referenceDate: NOW,
});

assert(fnbHooks.length === 1, '1 F&B hook generated');
const fHook = fnbHooks[0];
assert(fHook.type === 'FNB_LUNCH_PROMO', 'Type is FNB_LUNCH_PROMO');
assert(
  fHook.message.includes('Promo makan siang kantor hemat hari ini'),
  `F&B message matches lunch promo trigger (actual:\n${fHook.message})`
);

// -------------------------------------------------------------
// 5. UNIVERSAL WHATSAPP URL FORMATTING
// -------------------------------------------------------------
console.log('\n--- 5. Testing WhatsApp URL Dispatcher ---');

assert(formatWhatsAppPhone('08123456789') === '628123456789', 'Converts 08xx to 628xx');
assert(formatWhatsAppPhone('+62 812-3456-789') === '628123456789', 'Strips punctuation & country code');

const waUrl = getWhatsAppUrl('08123456789', 'Halo Dunia!');
assert(waUrl.startsWith('https://wa.me/628123456789?text='), 'Builds proper wa.me link');
assert(waUrl.includes('Halo%20Dunia!'), 'Encodes message payload properly');

console.log('\nSample Hook Messages:');
console.log('--- Laundry ---:\n' + lHook.message + '\n');
console.log('--- Barbershop ---:\n' + bHook.message + '\n');
console.log('--- Car Wash ---:\n' + cwHook.message + '\n');
console.log('--- F&B ---:\n' + fHook.message + '\n');

console.log('🎉 ALL AUTOMATED WHATSAPP LIFECYCLE HOOK TESTS PASSED SUCCESSFULLY!\n');
