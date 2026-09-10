export type StoreMode = 'FNB' | 'RETAIL' | 'SERVICE';
export type BusinessSector = 'FNB' | 'LAUNDRY' | 'RETAIL' | 'CARWASH' | 'BARBERSHOP';

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'ONLINE';

export type PaymentMethod = 'CASH' | 'QRIS' | 'DEBIT' | 'CREDIT' | 'SHOPEEPAY' | 'GOPAY' | 'OVO' | 'ONLINE';

export type PaymentStatus = 'PAID' | 'PENDING' | 'CANCELLED' | 'REFUNDED';

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'BILLING';

export type CustomerTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  businessSector?: BusinessSector;
}

export interface ModifierOption {
  id: string;
  name: string;
  price: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect?: number;
  maxSelect?: number;
  options: ModifierOption[];
}

export interface ProductVariant {
  id: string;
  name: string;
  priceExtra: number; // additional price e.g. +5000 for Large
}

export interface RecipeIngredient {
  ingredientId: string; // ID of the StockItem (BAHAN_BAKU or SETENGAH_JADI)
  ingredientName: string;
  quantity: number; // Takaran per porsi (e.g. 18 for gram, 150 for ml)
  unit: string; // "gram", "ml", "liter", "pcs", "porsi"
  costPerUnit: number;
  subtotalCost: number; // quantity * costPerUnit
}

export interface BundleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotalPrice: number;
}

export interface ProductBundle {
  id: string;
  sku: string;
  name: string;
  description?: string;
  image?: string;
  items: BundleItem[];
  regularPrice: number; // Sum of item standard prices
  bundlePrice: number; // Promotional combo package price
  discountPercent: number; // Auto-computed discount %
  isAvailable: boolean;
  businessSector?: BusinessSector;
  createdAt?: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  categoryId: string;
  price: number;
  costPrice: number; // untuk hitung profit bersih
  stock: number;
  minStockAlert: number;
  unit: string; // "pcs", "cup", "porsi", "pack"
  image?: string;
  description?: string;
  isAvailable: boolean;
  variants?: ProductVariant[];
  modifierGroups?: ModifierGroup[];
  businessSector?: BusinessSector;
  linkedStockItemId?: string;
  recipeQty?: number;
  recipeIngredients?: RecipeIngredient[]; // Multi-ingredient Bill of Materials
  reorderPointWholesale?: number; // Reorder point grosir (batas restok supplier)
  wholesaleMinQty?: number; // Minimum pembelian grosir (MOQ)
  targetMarginPercent?: number; // Target margin % per unit
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  sector: BusinessSector;
  /** Partition key of the owning business unit. See TenantContext. */
  businessId?: string;
  avatar?: string;
  isAvailable: boolean;
  phone?: string;
  baseSalary?: number;
  salaryType?: 'MONTHLY' | 'DAILY';
  dailyAllowance?: number;
}

export interface StoreBranch {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  allowedRadiusMeters: number;
  businessSector?: BusinessSector;
  isActive: boolean;
  notes?: string;
}

export interface GeoLocationInfo {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  distanceFromBranchMeters?: number;
  isWithinRadius: boolean;
  locationName?: string;
}

export interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: string;
  clockInTime: string;
  clockOutTime?: string;
  shiftNotes?: string;
  status: 'CLOCKED_IN' | 'CLOCKED_OUT';
  branchId?: string;
  branchName?: string;
  clockInGeo?: GeoLocationInfo;
  clockOutGeo?: GeoLocationInfo;
  businessSector?: BusinessSector;
}

// Haversine formula for GPS distance calculation in meters
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export type StockType = 'JADI' | 'SETENGAH_JADI' | 'BAHAN_BAKU';

export interface StockItem {
  id: string;
  sku: string;
  name: string;
  type: StockType;
  categoryId: string;
  categoryName: string;
  stock: number;
  minStockAlert: number;
  unit: string;
  costPrice: number;
  location: string;
  recipeYield?: string;
  notes?: string;
  lastUpdated?: string;
  businessSector?: BusinessSector;
}

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  price: number;
}

export interface CartItem {
  id: string; // unique line ID
  productId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  selectedModifiers: SelectedModifier[];
  unitPrice: number; // base price + variant + modifiers
  /**
   * HPP satuan pada saat item dimasukkan ke keranjang.
   *
   * Disalin, bukan di-join ke katalog — alasannya sama dengan unitPrice: kalau
   * dibaca dari products saat pelaporan, menaikkan harga modal hari ini akan
   * menulis ulang margin seluruh penjualan bulan lalu.
   *
   * Opsional karena keranjang yang tersimpan di localStorage sebelum kolom ini
   * ada tidak memilikinya.
   */
  unitCost?: number;
  quantity: number;
  itemNotes?: string;
  discountPercent: number;
  discountAmount: number;
  totalPrice: number; // (unitPrice * quantity) - discount
  servedByStaffName?: string;
}

export interface Table {
  id: string;
  name: string;
  capacity: number;
  zone: string;
  status: TableStatus;
  currentOrderId?: string;
  occupiedSince?: string;
  customerName?: string;
  businessSector?: BusinessSector;
  activeOrder?: {
    id: string;
    itemsCount: number;
    totalAmount: number;
    startTime: string;
  };
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  avatar?: string;
  points: number;
  tier: CustomerTier;
  totalSpent: number;
  visitCount: number;
  lastVisit: string;
  preferredStylist?: string;
  lastServiceType?: string;
  lastVehiclePlate?: string;
}

export interface Order {
  id: string; // INV-20260810-001
  orderNumber: number;
  date: string; // ISO date string
  items: CartItem[];
  orderType: OrderType;
  onlineChannel?: string;
  tableId?: string;
  tableName?: string;
  customer?: Customer;
  servedByStaffId?: string;
  servedByStaffName?: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  serviceChargeTotal: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  cashReceived?: number;
  changeAmount?: number;
  qrisRef?: string;
  cashierName: string;
  shiftId: string;
  status: 'COMPLETED' | 'HOLD' | 'VOID';
  notes?: string;
  voidReason?: string;
  // Laundry / Washing estimate and notification fields
  dropOffDate?: string; // e.g. "11 Ags 2026, 13:55"
  completionDate?: string; // e.g. "12 Ags 2026, 16:00"
  completionEstimate?: string; // e.g. "2026-08-11T16:00" or "Besok, 16:00 WITA"
  laundryStatus?: 'PROSES_CUCI' | 'SELESAI_SIAP_AMBIL' | 'SUDAH_DIAMBIL';
  laundryStage?: LaundryStage;
  storageRack?: string; // e.g. "Rak A-02", "Loker B-01"
  waNotifiedAt?: string; // ISO date string when WA notification sent
  // Carwash specific
  vehiclePlate?: string; // e.g. "B 1234 ABC"
  vehicleModel?: string; // e.g. "Avanza Hitam"
  assignedCrew?: string[]; // Daftar nama kru cuci
  carwashStage?: CarwashStage;
  // Split bill references
  isSplitBill?: boolean;
  splitBillIndex?: number;
  parentOrderId?: string;
  businessSector?: BusinessSector;
  userId?: string;
}

export type LaundryStage = 'ANTRIAN' | 'CUCI' | 'KERING' | 'SETRIKA' | 'PACKING' | 'SIAP_AMBIL' | 'SELESAI';
export type CarwashStage = 'ANTRIAN_BAY' | 'CUCI_BUSA' | 'PENGERINGAN_VAKUM' | 'INSPEKSI_SELESAI' | 'SIAP_KELUAR';

export type KDSStatus = 'PENDING' | 'PREPARING' | 'READY' | 'SERVED';

export interface KDSTicketItem {
  id: string;
  name: string;
  productName?: string;
  quantity: number;
  variantName?: string;
  selectedModifiers?: SelectedModifier[];
  notes?: string;
  isCompleted?: boolean;
}

export interface KDSTicket {
  id: string;
  orderId: string;
  orderNumber: number;
  tableName?: string;
  customerName?: string;
  orderType: OrderType;
  items: KDSTicketItem[];
  notes?: string;
  createdAt: string; // ISO date string
  status: KDSStatus;
}

export interface CarwashQueueItem {
  id: string;
  orderId?: string;
  vehiclePlate: string;
  vehicleModel: string;
  serviceName: string;
  assignedBayId?: string;
  assignedBayName?: string;
  bayName?: string;
  assignedCrew: string[];
  stage: CarwashStage;
  enteredAt: string; // ISO date string
  customerName?: string;
  customerPhone?: string;
  estimatedMinutes?: number;
  notes?: string;
}

export type BookingStatus = 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface AppointmentBooking {
  id: string;
  customerName: string;
  customerPhone: string;
  staffId: string;
  staffName: string;
  staffMemberId?: string;
  staffMemberName?: string;
  serviceId?: string;
  serviceName: string;
  servicePrice?: number;
  date: string; // YYYY-MM-DD
  bookingDate?: string;
  timeSlot: string; // e.g. "10:00"
  startTime?: string;
  endTime?: string;
  durationMinutes?: number; // e.g. 45
  status: BookingStatus;
  notes?: string;
  createdAt?: string;
}

export interface StaffCommissionRule {
  id?: string;
  staffId: string;
  staffName?: string;
  staffMemberId?: string;
  // Mode 1: Individual / Barbershop Per-Head
  serviceCommissionPercent?: number; // e.g. 30%
  fixedCommissionPerService?: number; // e.g. Rp 15.000
  retailCommissionPercent?: number; // e.g. 5%
  commissionType?: 'PERCENTAGE' | 'FIXED_PER_ORDER';
  rateValue?: number;
  // Mode 2: Car Wash / Team Pooled Split
  teamPoolType?: 'PERCENTAGE_OF_POOL' | 'FIXED_PER_VEHICLE';
  teamPoolRate?: number; // e.g. 15% dari omzet car wash atau Rp 10.000 per mobil
  teamPoolDistribution?: 'EQUAL_AMONG_PRESENT' | 'BY_ASSIGNED_JOB';
  // Mode 3: F&B / Retail Daily Revenue Target Incentive
  dailyRevenueTarget?: number; // e.g. Rp 3.000.000 / hari
  targetBonusAmount?: number; // e.g. Rp 50.000 per staf jika tembus target
  targetStretchAmount?: number; // e.g. Rp 6.000.000 / hari
  targetStretchBonus?: number; // e.g. Rp 100.000 per staf jika tembus stretch
  targetBonusType?: 'FLAT_PER_STAFF' | 'SURPLUS_PERCENTAGE';
  surplusPercent?: number; // e.g. 5% dari surplus omzet di atas target
}

export interface PayrollSlip {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: string;
  periodMonth: string; // YYYY-MM
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  daysAttended: number;
  baseSalary: number;
  allowance: number;
  individualCommission: number;
  teamPoolCommission: number;
  dailyTargetBonus: number;
  grossEarnings: number;
  deductions: number;
  netSalary: number;
  status: 'DRAFT' | 'PAID';
  paidAt?: string;
  paymentMethod?: string;
  notes?: string;
  businessSector?: BusinessSector;
}

export type LifecycleHookType =
  | 'LAUNDRY_READY'
  | 'BARBERSHOP_RETENTION'
  | 'CARWASH_WEATHER'
  | 'FNB_LUNCH_PROMO'
  | 'RETAIL_VIP';

export interface WhatsAppLifecycleHook {
  id: string;
  type: LifecycleHookType;
  sector: BusinessSector;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  title: string;
  message: string;
  triggerReason: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  metadata?: {
    orderId?: string;
    storageRack?: string;
    weightKg?: number;
    stylistName?: string;
    daysSinceLastCut?: number;
    suggestedTimeSlot?: string;
    vehiclePlate?: string;
    vehicleModel?: string;
    promoCode?: string;
    points?: number;
    [key: string]: any;
  };
  status: 'PENDING' | 'SENT' | 'DISMISSED';
  createdAt: string;
  sentAt?: string;
}

export interface InventoryLog {
  id: string;
  productId: string;
  productName: string;
  type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'SALE' | 'REFUND';
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string;
  timestamp: string;
  user: string;
  businessSector?: BusinessSector;
  userId?: string;
}

export type CashMovementType = 'CASH_IN' | 'CASH_OUT';
export type CashMovementCategory =
  | 'MODAL_AWAL' // Kas Awal / Modal Awal
  | 'BELANJA_BAHAN' // Belanja Bahan Baku & Stok
  | 'OPERASIONAL' // Listrik, Air, Gas, Kebersihan, Internet
  | 'KASBON' // Kasbon Karyawan
  | 'TAMBAH_MODAL' // Setoran Tambahan Modal Kasir
  | 'PENDAPATAN_LAIN' // Pendapatan Non-Sales
  | 'PENGELUARAN_LAIN'; // Pengeluaran Lain-lain

export interface CashMovement {
  id: string;
  type: CashMovementType;
  category: CashMovementCategory;
  amount: number;
  description: string;
  timestamp: string; // ISO date string
  cashierName: string;
  shiftId?: string;
  businessSector?: BusinessSector;
  userId?: string;
  recipientOrSource?: string;
}

export interface Shift {
  id: string;
  cashierName: string;
  startTime: string;
  endTime?: string;
  initialCash: number;
  cashSales: number;
  qrisSales: number;
  cardSales: number;
  eWalletSales: number;
  totalSales: number;
  totalCashIn?: number;
  totalCashOut?: number;
  expectedCash: number;
  actualCash?: number;
  difference?: number;
  totalOrders?: number;
  notes?: string;
  status: 'OPEN' | 'CLOSED';
  businessSector?: BusinessSector;
  userId?: string;
}

export interface StoreSettings {
  storeName: string;
  tagline: string;
  address: string;
  phone: string;
  logoUrl?: string;
  taxRate: number; // e.g. 10 for 10% PB1/PPN
  enableTax: boolean;
  serviceRate: number; // e.g. 5 for 5% service
  enableService: boolean;
  currencySymbol: string; // "Rp"
  receiptHeader: string;
  receiptFooter: string;
  storeMode: StoreMode;
  businessSector?: BusinessSector;
  autoPrintReceipt: boolean;
  receiptPaperSize?: '58mm' | '80mm';
  loyaltyEarnRate: number; // Rp 10.000 per 1 point
  loyaltyRedeemRate: number; // 1 point = Rp 100 discount
  /**
   * Target omzet bulanan. Opsional: kalau merchant tidak mengisinya, Smart
   * Assistant menurunkan target otomatis dari rata-rata 3 bulan terakhir.
   */
  monthlyRevenueTarget?: number;
  branches?: StoreBranch[];
  activeBranchId?: string;
  geofenceEnforcement?: 'STRICT' | 'FLEXIBLE';
  subscription?: SaaSSubscription;
  whatsappLifecycleEnabled?: boolean;
}

export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface User {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  pin: string; // 4-digit PIN for authentication/authorization
  avatar?: string;
  email?: string;
  phone?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
}

export type PermissionFeature = 
  | 'home'
  | 'overview'
  | 'pos' 
  | 'tables' 
  | 'inventory' 
  | 'customers' 
  | 'reports' 
  | 'ai' 
  | 'settings' 
  | 'void_order' 
  | 'stock_adjustment' 
  | 'user_management'
  | 'billing_subscription'
  | 'labor';

export interface PromoCode {
  code: string;
  discountPercent: number;
  maxDiscountAmount: number;
  minPurchaseAmount?: number;
  isActive: boolean;
  createdAt: string;
}

// --- SAAS SUBSCRIPTION TYPES ---

export type BillingCycle = 'MONTHLY' | 'YEARLY';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELED';
export type SaaSPaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
export type PlanTierLevel = 1 | 2 | 3 | 4;

export interface SaaSPlan {
  id: string;
  name: string;
  tierLevel: PlanTierLevel;
  billingCycle: BillingCycle;
  priceIdr: number;
  priceYearlyIdr?: number; // Biaya per bulan jika ditagih tahunan
  currency: string;
  features: string[];
  maxOutlets: number;
  isActive: boolean;
  
  // New SaaS Parameters
  productLimit: number; // -1 untuk unlimited
  aiQuotaMonthly: number; // Jumlah total interaksi AI
  dashboardAccessLevel: 'BASIC' | 'FULL' | 'ADVANCED';
  extraOutletPriceIdr?: number; // Harga add-on per ekstra outlet per bulan
  extraOutletYearlyIdr?: number; // Harga efektif per bulan bila add-on ditagih tahunan
  annualDiscountPercent?: number;
  isTrial?: boolean;
  trialDays?: number;
  gracePeriodDays?: number;
}

export interface SaaSSubscription {
  accessMode?: 'FULL' | 'READ_ONLY' | 'RESTRICTED';
  billingCycle?: 'MONTHLY' | 'YEARLY';
  extraOutlets?: number;
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string; // ISO Date String
  currentPeriodEnd: string; // ISO Date String
  gracePeriodEnd?: string; // ISO Date String
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
  plan?: SaaSPlan;
}

export interface SaaSInvoice {
  id: string;
  subscriptionId: string;
  tenantId: string;
  amount: number;
  currency: string;
  paymentStatus: SaaSPaymentStatus;
  paymentGatewayRef?: string;
  paymentLinkUrl?: string;
  paidAt?: string;
  dueDate: string;
  createdAt: string;
  planName: string;
}
