import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { orderOperations,mergeOrderOperations } from '../lib/sync/orderOperations';
import {
  Category,
  Product,
  Table,
  Customer,
  Order,
  CartItem,
  Shift,
  StoreSettings,
  InventoryLog,
  OrderType,
  PaymentMethod,
  ProductVariant,
  SelectedModifier,
  User,
  UserRole,
  PermissionFeature,
  PromoCode,
  BusinessSector,
  StaffMember,
  StockItem,
  AttendanceRecord,
  StoreBranch,
  GeoLocationInfo,
  ProductBundle,
  CashMovement,
  CashMovementType,
  CashMovementCategory,
  KDSTicket,
  KDSStatus,
  CarwashQueueItem,
  AppointmentBooking,
  BookingStatus,
  StaffCommissionRule,
  PayrollSlip,
  OrderRefund,
  OrderRefundItem,
} from '../types';
import { BUSINESS_PRESETS } from '../data/businessPresets';
import { ROLE_PERMISSIONS } from '../data/rolePermissions';
import {
  TenantInfo,
  TenantProvider,
  accountKey,
  belongsToBusiness,
  makeBusinessId,
  partitionKey,
  stampBusiness,
} from './TenantContext';
import { posthogTelemetry } from '../utils/posthog';
import {
  enqueue as enqueueSync,
  flush as flushSync,
  getStatus as getSyncStatus,
  orderToPayload,
  getPendingTransactions,
  markCloudRead,
  pushAttendance,
  pushPayroll,
  pullCatalog,
  type SyncStatus,
  type SyncTarget,
} from '../lib/sync/queue';
import {
  hashPin,
  verifyPinHash,
  getPinLockoutStatus,
  recordFailedPinAttempt,
  resetPinAttempts,
} from '../lib/auth/pinSecurity';
import { useAuth } from './AuthContext';
import { isFreePlan, freeProductAllowed } from '../config/freePlanPolicy';
import { mergeServerOutlets, prepareOutletBusiness } from '../lib/sync/outlets';
import { SharedStateSync, recordIdOf, type SharedRecord, type SharedSyncStatus } from '../lib/sync/sharedState';
import { subscriptionAccess } from '../config/subscriptionPolicy';
import { repairOperationalCache, backupOperational,operationalCacheBlocked,operationalCacheError } from '../lib/sync/operationalRecovery';
import { syncStatusModel } from '../lib/sync/statusModel';
import { SyncCenter } from '../components/sync/SyncCenter';
import {
  INITIAL_CATEGORIES,
  INITIAL_PRODUCTS,
  INITIAL_TABLES,
  INITIAL_CUSTOMERS,
  INITIAL_SETTINGS,
  INITIAL_SHIFT,
  INITIAL_HISTORICAL_ORDERS,
  INITIAL_USERS,
  INITIAL_PROMO_CODES,
  INITIAL_STAFF_MEMBERS,
  INITIAL_STOCK_ITEMS,
  INITIAL_ATTENDANCE_LOGS,
  INITIAL_BRANCHES,
  INITIAL_BUNDLES,
  INITIAL_KDS_TICKETS,
  INITIAL_CARWASH_QUEUE,
  INITIAL_BOOKINGS,
  INITIAL_COMMISSION_RULES,
} from '../data/initialData';
import { generateInvoiceNumber, playPOSSound } from '../utils/formatters';
import { newId } from '../lib/ids';
import { migrateLegacyFinancialData, type LegacyMigrationResult } from '../lib/sync/legacyMigration';
import { enqueueCashCommand, cashMovementToCommand, flushCashQueue, getCashSyncStatus, combineFinancialSyncStatus, pendingRefund, refundAcknowledgment } from '../lib/sync/financialQueue';
import { fetchRecentServerTransactions, fetchReportSummary, reportParams } from '../lib/reports/client';

interface POSContextType {
  /**
   * The active business unit + signed-in user. Partition key for all scoped
   * data and the sole source of AI scoping. Also available via `useTenant()`.
   */
  tenant: TenantInfo;

  activeTab: 'home' | 'overview' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings' | 'labor' | 'payment';
  setActiveTab: (tab: 'home' | 'overview' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings' | 'labor' | 'payment') => void;
  
  categories: Category[];
  products: Product[];
  tables: Table[];
  customers: Customer[];
  orders: Order[];
  heldOrders: Order[];
  inventoryLogs: InventoryLog[];
  shift: Shift;
  shiftHistory: Shift[];
  settings: StoreSettings;
  promoCodes: PromoCode[];
  addPromoCode: (promo: {
    code: string;
    discountPercent: number;
    maxDiscountAmount: number;
    minPurchaseAmount?: number;
    isActive?: boolean;
  }) => void;

  // Branch & Geotagging Management
  branches: StoreBranch[];
  activeBranch?: StoreBranch;
  setActiveBranchId: (branchId: string) => void;
  saveBranch: (branch: StoreBranch) => Promise<void>;
  deleteBranch: (branchId: string) => Promise<void>;

  // Staff & Service Assignment & Attendance (Clock In / Out)
  /** Staff belonging to the ACTIVE business sector only. */
  staffMembers: StaffMember[];
  /** The whole cross-sector roster. Only for management/settings screens. */
  allStaffMembers: StaffMember[];
  selectedStaff: StaffMember | null;
  setSelectedStaff: (staff: StaffMember | null) => void;
  addStaffMember: (staff: Omit<StaffMember, 'id'>) => void;
  updateStaffMember: (staff: StaffMember) => void;
  deleteStaffMember: (staffId: string) => void;
  toggleStaffAvailability: (staffId: string) => void;
  attendanceLogs: AttendanceRecord[];
  clockInStaff: (
    staffId: string,
    notes?: string,
    geoInfo?: GeoLocationInfo,
    branchInfo?: { id: string; name: string },
    photoUrl?: string
  ) => void;
  clockOutStaff: (
    staffId: string,
    notes?: string,
    geoInfo?: GeoLocationInfo,
    branchInfo?: { id: string; name: string }
  ) => void;
  getActiveAttendance: (staffId: string) => AttendanceRecord | undefined;

  // Stock & Semi-Finished Items (WIP)
  stockItems: StockItem[];
  saveStockItem: (item: StockItem) => void;
  deleteStockItem: (id: string) => void;
  adjustStockItemQuantity: (id: string, qtyChange: number, reason: string) => void;
  processRawMaterialReceipt: (payload: {
    receiptImage?: string;
    supplierName?: string;
    receiptDate?: string;
    items: {
      stockItemId?: string;
      name: string;
      sku?: string;
      type?: 'BAHAN_BAKU' | 'SETENGAH_JADI';
      quantity: number;
      unit: string;
      costPrice: number;
      location?: string;
    }[];
    paidFromCashDrawer: boolean;
    notes?: string;
  }) => {
    savedItems: StockItem[];
    totalCost: number;
  };

  // Product Bundles (Paket Promo & Bundling)
  bundles: ProductBundle[];
  saveBundle: (bundle: ProductBundle) => void;
  deleteBundle: (id: string) => void;
  toggleBundleAvailability: (id: string) => void;

  // RBAC & User Management
  users: User[];
  currentUser: User;
  switchUser: (user: User) => void;
  saveUser: (user: User) => void;
  deleteUser: (userId: string) => void;
  hasPermission: (feature: PermissionFeature) => boolean;
  verifyPin: (
    pin: string,
    requiredRoles?: UserRole[]
  ) => Promise<{
    success: boolean;
    user?: User;
    message?: string;
    attemptsLeft?: number;
    isLockedOut?: boolean;
    remainingSec?: number;
  }>;
  cart: CartItem[];
  selectedCategory: string;
  setSelectedCategory: (catId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCustomer: Customer | null;
  setSelectedCustomer: (customer: Customer | null) => void;
  selectedTable: Table | null;
  setSelectedTable: (table: Table | null) => void;
  orderType: OrderType;
  setOrderType: (type: OrderType) => void;
  soundEnabled: boolean;
  toggleSound: () => void;
  
  // Cart Actions
  addToCart: (
    product: Product,
    variant?: ProductVariant,
    modifiers?: SelectedModifier[],
    quantity?: number,
    notes?: string
  ) => void;
  updateCartQuantity: (cartItemId: string, newQty: number) => void;
  updateCartItemNotes: (cartItemId: string, notes: string) => void;
  applyCartItemDiscount: (cartItemId: string, discountPercent: number, discountAmount: number) => void;
  removeFromCart: (cartItemId: string) => void;
  clearCart: () => void;
  
  // Checkout & Transactions
  processPayment: (
    paymentMethod: PaymentMethod,
    cashReceived?: number,
    notes?: string,
    completionEstimate?: string,
    channel?: string,
    dropOffDate?: string,
    completionDate?: string,
    extraOptions?: {
      vehiclePlate?: string;
      vehicleModel?: string;
      assignedCrew?: string[];
      storageRack?: string;
      isSplitBill?: boolean;
      splitBillIndex?: number;
      parentOrderId?: string;
      splitAmount?: number;
      paymentTender?: {clientPaymentId:string;method:PaymentMethod;amount:number;createdAt:string};
      splitItems?: CartItem[];
      skipClearCart?: boolean;
    }
  ) => Order | null;
  voidOrder: (orderId: string, reason?: string) => void;
  refundOrderItems: (
    orderId: string,
    refundItems: { cartItemId: string; quantity: number; reason: string }[],
    refundMethod?: 'CASH' | 'ORIGINAL_METHOD'
  ) => Promise<OrderRefund | null>;
  /** Berapa transaksi yang masih menunggu terkirim, dan kapan terakhir berhasil. */
  syncStatus: SyncStatus;
  operationalSyncStatus: SharedSyncStatus;
  syncCenter: ReturnType<typeof syncStatusModel>;
  openSyncCenter: () => void;
  closeSyncCenter: () => void;
  resolveOperationalConflict: (kind:string,recordId:string,choice:'server'|'local') => Promise<void>;
  cloudReady: boolean;
  cloudError: string | null;
  legacyMigrationStatus: LegacyMigrationResult | null;
  mapLegacyOutlet: (originalBranchRef: string, outletId: string) => void;
  /** Memaksa pengiriman sekarang. Dipakai tombol "coba lagi". */
  forceSync: () => void;
  holdOrder: (
    notes?: string,
    extraOptions?: {
      dropOffDate?: string;
      completionDate?: string;
      storageRack?: string;
      vehiclePlate?: string;
      vehicleModel?: string;
      assignedCrew?: string[];
      isSplitBill?: boolean;
    }
  ) => Order | null;
  recallHoldOrder: (orderId: string) => void;
  cancelHoldOrder: (orderId: string) => void;
  payPendingOrder: (
    orderId: string,
    paymentMethod: PaymentMethod,
    cashReceived?: number,
    qrisRef?: string
  ) => Order | null;
  updateOrderLaundryStatus: (orderId: string, status: 'PROSES_CUCI' | 'SELESAI_SIAP_AMBIL' | 'SUDAH_DIAMBIL') => void;
  updateLaundryStage: (orderId: string, stage: 'ANTRIAN' | 'CUCI' | 'KERING' | 'SETRIKA' | 'PACKING' | 'SIAP_AMBIL' | 'SELESAI', storageRack?: string) => void;
  sendLaundryWaNotification: (order: Order) => string;

  // F&B Kitchen Display System (KDS)
  kdsTickets: KDSTicket[];
  updateKDSTicketStatus: (ticketId: string, status: KDSStatus) => void;
  clearCompletedKDSTickets: () => void;

  // Carwash Bay Capacity & Queue Pipeline
  carwashQueue: CarwashQueueItem[];
  addCarwashQueue: (item: Omit<CarwashQueueItem, 'id' | 'enteredAt'>) => void;
  updateCarwashStage: (queueId: string, stage: CarwashQueueItem['stage'], assignedBayId?: string, assignedBayName?: string) => void;
  removeCarwashQueue: (queueId: string) => void;

  // Barbershop Time-Slot Booking & Kapster Engine
  bookings: AppointmentBooking[];
  saveBooking: (booking: AppointmentBooking) => void;
  deleteBooking: (bookingId: string) => void;
  updateBookingStatus: (bookingId: string, status: BookingStatus) => void;
  sendBookingWaReminder: (booking: AppointmentBooking) => string;

  // Staff Commission Rules & Payroll Slips
  commissionRules: StaffCommissionRule[];
  saveCommissionRule: (rule: StaffCommissionRule) => void;
  payrollSlips: PayrollSlip[];
  savePayrollSlip: (slip: PayrollSlip) => void;
  deletePayrollSlip: (slipId: string) => void;
  disbursePayrollCashMovement: (slipId: string, paymentMethod?: string) => boolean;

  // Automated WhatsApp Lifecycle Hooks
  sentLifecycleHookIds: string[];
  markLifecycleHookSent: (hookId: string) => void;
  dismissLifecycleHook: (hookId: string) => void;
  
  // Inventory & Catalog CRUD
  saveProduct: (product: Product) => void;
  deleteProduct: (productId: string) => void;
  toggleProductAvailability: (productId: string) => void;
  saveCategory: (category: Category) => void;
  deleteCategory: (categoryId: string) => void;
  adjustStock: (productId: string, quantityChange: number, type: 'IN' | 'OUT' | 'ADJUSTMENT', reason: string) => void;
  
  // Customer & Table CRUD
  saveCustomer: (customer: Customer) => void;
  saveTable: (table: Table) => void;
  deleteTable: (tableId: string) => void;
  updateSettings: (newSettings: StoreSettings) => void;
  activateBusinessSector: (sector: BusinessSector, customStoreName?: string) => void;
  startShift: (cashierName: string, initialCash: number) => Promise<Shift>;
  endShift: (actualCash: number, notes?: string) => Promise<Shift>;
  
  // Cash Movements & Petty Cash Management
  cashMovements: CashMovement[];
  addCashMovement: (
    type: CashMovementType,
    category: CashMovementCategory,
    amount: number,
    description: string,
    recipientOrSource?: string
  ) => CashMovement;
  deleteCashMovement: (id: string) => void;
  setInitialCash: (amount: number) => void;
}

const POSContext = createContext<POSContextType | undefined>(undefined);

/*
 * Storage keys are derived from the tenant partition key, never hand-built.
 * See src/context/TenantContext.tsx — `businessId` is `${userId}_${sector}`, so
 * these produce exactly the same strings the app has always written.
 */
const getScopedKey = (entity: string, userId: string, sector: BusinessSector): string =>
  partitionKey(makeBusinessId(userId, sector), entity);

const getGlobalUserKey = (entity: string, userId: string): string => accountKey(userId, entity);

export const safeSetLocalStorage = (key: string, value: string): void => {
  if(operationalCacheBlocked(key))return;
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`[storage] LocalStorage write failed for key "${key}" (quota exceeded or blocked):`, e);
  }
};

const loadScopedData = <T,>(entity: string, userId: string, sector: BusinessSector, fallback: T): T => {
  try {
    const key = getScopedKey(entity, userId, sector);
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed=repairOperationalCache(userId,sector,entity,JSON.parse(saved));
      if (Array.isArray(parsed) && entity==='kds_tickets') return parsed.filter(row=>!['kds-01','kds-02'].includes(row.id)) as T;
      if (Array.isArray(parsed) && entity==='carwash_queue') return parsed.filter(row=>!['cwq-01','cwq-02','cwq-03'].includes(row.id)) as T;
      if (Array.isArray(parsed) && entity==='bookings') return parsed.filter(row=>!['bkg-01','bkg-02'].includes(row.id)) as T;
      return parsed;
    }
  } catch (e) {
    console.error(`Failed to load scoped data for ${entity}:`, e);
  }
  return fallback;
};

const loadGlobalUserData = <T,>(entity: string, userId: string, fallback: T): T => {
  try {
    const key = getGlobalUserKey(entity, userId);
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error(`Failed to load global user data for ${entity}:`, e);
  }
  return fallback;
};

/*
 * SECTOR-AWARE SEEDS
 */
const seedCustomersFor = (_sector: BusinessSector): Customer[] => [];

const seedPromosFor = (_sector: BusinessSector): PromoCode[] => [];

/** Attendance seed follows the staff member's own sector. */
const seedAttendanceFor = (_sector: BusinessSector): AttendanceRecord[] => [];

// Financial recovery must preserve every legacy source byte until server acknowledgment.

export const POSProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user: authUser, session: authSession } = useAuth();
  // Store identity is independent of the local cashier profile.
  const storeOwnerId = authUser?.id || 'usr-owner';
  const legacyKeys = React.useRef<Set<string> | null>(null);
  if (!legacyKeys.current) {
    legacyKeys.current = new Set<string>();
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key) legacyKeys.current.add(key);
      }
    } catch { /* Browser storage may be unavailable. */ }
  }

  const defaultOwnerUser: User = {
    id: authUser?.id || 'usr-owner',
    name: authUser?.user_metadata?.full_name || authUser?.user_metadata?.store_name || authUser?.email?.split('@')[0] || 'Pemilik Toko',
    username: authUser?.email?.split('@')[0] || 'owner',
    role: 'ADMIN',
    pin: '1234',
    email: authUser?.email || '',
    phone: '',
    status: 'ACTIVE',
    createdAt: authUser?.created_at || new Date().toISOString(),
  };

  const [activeTab, setActiveTab] = useState<'home' | 'overview' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings' | 'labor' | 'payment'>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      const pendingPlan = sessionStorage.getItem('nhpos_pending_checkout_plan') || localStorage.getItem('nhpos_pending_checkout_plan');
      if (hash.includes('payment') || pendingPlan === 'plan-plus-monthly' || pendingPlan === 'plan-pro-monthly') {
        return 'payment';
      }
    }
    return 'overview';
  });

  // Users & RBAC state
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem(`newhope_users_${storeOwnerId}`) || localStorage.getItem('newhope_users');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.filter((u) => u.name !== 'Budi Santoso' && u.email !== 'budi@newhope.id');
          const admins=cleaned.filter((u:User)=>u.role==='ADMIN');
          if (cleaned.length > 0 && admins.every((u:User)=>u.id===storeOwnerId)) return cleaned;
        }
      } catch {}
    }
    return [defaultOwnerUser];
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    const saved = localStorage.getItem(`newhope_current_user_${storeOwnerId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name !== 'Budi Santoso' && parsed.email !== 'budi@newhope.id') {
          if (parsed.id===storeOwnerId || users.some(u=>u.id===parsed.id)) return parsed;
        }
      } catch (e) {
        console.error('Failed to parse current user', e);
      }
    }
    return defaultOwnerUser;
  });

  // Sync with authUser when user signs in
  useEffect(() => {
    if (authUser) {
      const activeName = authUser.user_metadata?.full_name || authUser.user_metadata?.store_name || authUser.email?.split('@')[0] || 'Pemilik Toko';
      const updatedUser: User = {
        id: authUser.id,
        name: activeName,
        username: authUser.email?.split('@')[0] || 'owner',
        role: 'ADMIN',
        pin: currentUser?.pin || '1234',
        email: authUser.email || '',
        phone: '',
        status: 'ACTIVE',
        createdAt: authUser.created_at || new Date().toISOString(),
      };
      const scopedRoster=localStorage.getItem(`newhope_users_${authUser.id}`);
      let restored:User[]=[];
      try { const parsed=scopedRoster?JSON.parse(scopedRoster):[];if(Array.isArray(parsed))restored=parsed; } catch {}
      let legacy:User[]=[];
      try {const parsed=JSON.parse(localStorage.getItem('newhope_users')||'[]');if(Array.isArray(parsed))legacy=parsed;} catch {}
      const legacyOwners=legacy.filter(u=>u.role==='ADMIN');
      const safeLegacy=!scopedRoster&&legacyOwners.length>0&&legacyOwners.every(u=>u.id===authUser.id)
        ? legacy.filter(u=>u.id!==authUser.id) : [];
      const roster=[updatedUser,...(restored.length?restored:safeLegacy).filter(u=>u.id!==authUser.id&&u.role!=='ADMIN')];
      setUsers(roster);
      void Promise.all(roster.map(async user=>user.id!==authUser.id&&!user.pin.startsWith('sha256$')
        ? {...user,pin:await hashPin(user.pin)} : user)).then(secured=>{
          setUsers(previous=>previous.length===roster.length&&previous.every((user,index)=>user.id===roster[index].id)
            ? secured : previous);
        });
      const last=localStorage.getItem(`newhope_current_user_${authUser.id}`);
      let previous:User|undefined;
      try {previous=last?JSON.parse(last):undefined;} catch {}
      setCurrentUser(roster.find(u=>u.id===previous?.id&&u.status==='ACTIVE')||updatedUser);
    }
  }, [authUser]);

  const [settings, setSettings] = useState<StoreSettings>(() => {
    const uId = storeOwnerId;
    const loaded = loadGlobalUserData('settings', uId, INITIAL_SETTINGS);
    const storeName = authUser?.user_metadata?.store_name || authUser?.user_metadata?.full_name;
    const sector = (authUser?.user_metadata?.business_sector || authUser?.user_metadata?.sector || loaded.businessSector || 'FNB') as BusinessSector;
    const scopedSettings=loadScopedData<Partial<StoreSettings>>('store_settings',uId,sector,{});
    const mismatch=loaded.businessSector&&loaded.businessSector!==sector;
    if(mismatch){const key=getGlobalUserKey('settings',uId),raw=localStorage.getItem(key);
      if(raw)backupOperational(uId,sector,key,raw,[{kind:'store_settings',recordId:'main',reason:'WRONG_SECTOR:'+loaded.businessSector}]);}
    
    // Check if there is an active pending paid plan
    const pendingPlan = typeof window !== 'undefined'
      ? (sessionStorage.getItem('nhpos_pending_checkout_plan') || localStorage.getItem('nhpos_pending_checkout_plan'))
      : null;
    const isPendingPlan = pendingPlan === 'plan-plus-monthly' || pendingPlan === 'plan-pro-monthly';

    let sub = loaded.subscription;
    if (isPendingPlan && (!sub || sub.status !== 'ACTIVE')) {
      const nowIso = new Date().toISOString();
      sub = {
        id: 'sub-pending',
        tenantId: uId,
        planId: pendingPlan || 'plan-plus-monthly',
        status: 'PENDING_PAYMENT' as const,
        accessMode: 'RESTRICTED' as const,
        currentPeriodStart: nowIso,
        currentPeriodEnd: nowIso,
        cancelAtPeriodEnd: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    }

    return {
      ...loaded,
      ...scopedSettings,
      // Brand assets come from the active business, not account-wide browser data.
      logoUrl: undefined,
      storeName: scopedSettings.storeName || (mismatch?BUSINESS_PRESETS[sector]?.defaultStoreName:storeName || (loaded.storeName && loaded.storeName !== 'New Hope POS' ? loaded.storeName : 'Toko Saya')),
      storeMode: scopedSettings.storeMode || BUSINESS_PRESETS[sector]?.storeMode || loaded.storeMode,
      businessSector: sector,
      subscription: sub,
    };
  });

  useEffect(() => {
    if (!authUser?.id) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/v1/subscription/status', {headers:{Authorization:`Bearer ${authSession?.access_token || ''}`}});
        const data = await response.json();
        if (active && response.ok && data.ok && data.subscription) {
          setSettings(prev => ({ ...prev, subscription: data.subscription,
            ...(data.subscription.status==='FREE' && data.subscription.freeSelection ? {activeBranchId:data.subscription.freeSelection.branchId}:{}),
          }));
        }
      } catch { /* Offline uses the last verified deadline; never resets it. */ }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('subscription-updated', refresh);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('subscription-updated', refresh); };
  }, [authUser?.id, authSession?.access_token]);

  useEffect(() => {
    if (!authUser?.id) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/v1/subscription/outlets',{headers:{Authorization:`Bearer ${authSession?.access_token || ''}`}});
        const data = await response.json();
        if (!active || !response.ok || !data.ok || !Array.isArray(data.rows)) return;
        setSettings(prev => {
          const merged = mergeServerOutlets(prev.branches || INITIAL_BRANCHES, data.rows);
          const eligible = merged.filter(branch => branch.isActive && branch.businessSector === (prev.businessSector || 'FNB'));
          const selected = eligible.find(branch => branch.id === (isFreePlan(prev.subscription)?prev.subscription?.freeSelection?.branchId:prev.activeBranchId));
          return { ...prev, branches: merged, activeBranchId: selected?.id || eligible[0]?.id };
        });
      } catch { /* Keep offline branches when the server cannot be reached. */ }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('outlets-updated', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); window.removeEventListener('outlets-updated', refresh); };
  }, [authUser?.id, authSession?.access_token, settings.businessSector]);

  const freeOwnerOnly=isFreePlan(settings.subscription);
  useEffect(()=>{
    if(freeOwnerOnly && authUser?.id && currentUser.id!==authUser.id) switchUser(defaultOwnerUser);
  },[freeOwnerOnly,authUser?.id,currentUser.id]);

  function requireWritable<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: Parameters<T>) => {
      const sub = settings.subscription;
      if (isFreePlan(sub) && (!sub?.freeSelection || currentUser.id !== authUser?.id ||
        sub.freeSelection.sector !== (settings.businessSector || 'FNB') || sub.freeSelection.branchId !== settings.activeBranchId)) {
        throw new Error('FREE_SELECTION_OR_OWNER_REQUIRED');
      }
      if (!sub || subscriptionAccess(sub).accessMode !== 'FULL' || sub.accessMode === 'RESTRICTED') {
        window.alert('Langganan belum aktif atau belum terverifikasi. Periksa Pengaturan → Langganan. Data tetap dapat diekspor.');
        throw new Error('SUBSCRIPTION_READ_ONLY');
      }
      return fn(...args);
    }) as T;
  }

  const activeSector = settings.businessSector || 'FNB';
  useEffect(() => {
    if (!authUser?.id) return;
    let active = true;
    const sector = activeSector;
    setSettings(prev => ({ ...prev, logoUrl: undefined }));
    const loadLogo = async () => {
      try {
        const businessId = makeBusinessId(authUser.id, sector);
        const response = await fetch(`/api/v1/sync/receipt-logo?businessId=${encodeURIComponent(businessId)}`);
        const data = await response.json();
        if (active && response.ok && data.ok) {
          setSettings(prev => (prev.businessSector || 'FNB') === sector
            ? { ...prev, logoUrl: data.logoUrl || undefined } : prev);
        }
      } catch { /* Offline: no cross-business logo fallback. */ }
    };
    void loadLogo();
    return () => { active = false; };
  }, [authUser?.id, activeSector]);
  const defaultPreset = BUSINESS_PRESETS[activeSector] || BUSINESS_PRESETS.FNB;

  /*
   * THE TENANT. Every scoped read/write, every shared-collection filter and the
   * whole AI context derive from this one object — so there is exactly one
   * definition of "which business am I looking at".
   */
  const tenant: TenantInfo = {
    businessId: makeBusinessId(storeOwnerId, activeSector),
    merchantId: storeOwnerId,
    tenantId: storeOwnerId,
    sector: activeSector,
    businessName: settings.storeName,
    storeMode: settings.storeMode,
    slotNoun: defaultPreset.layoutTerm?.itemNoun || 'Meja',
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    permissions: ROLE_PERMISSIONS[currentUser.role] || [],
  };

  /* ------------------------------------------------------------------------ */
  /* SINKRONISASI OTOMATIS                                                     */
  /* ------------------------------------------------------------------------ */
  //
  // Transaksi masuk antrian di disk lalu dikirim di latar belakang. Kasir tidak
  // pernah menunggu jaringan, dan mematikan aplikasi tidak memakan transaksi.
  // Seluruh mekanismenya ada di lib/sync/queue.ts.

  const syncTarget: SyncTarget = {
    businessId: tenant.businessId,
    outletId: /^[0-9a-f-]{36}$/i.test(settings.activeBranchId || '') ? settings.activeBranchId : undefined,
    sector: activeSector,
    storeName: settings.storeName,
    ownerRef: storeOwnerId,
  };

  const [cloudState,setCloudState]=useState<{scope:string;ready:boolean;error:string|null}>({scope:'',ready:false,error:null});
  const financialScopeKey=tenant.businessId+':'+(syncTarget.outletId||'');
  const cloudReady=cloudState.scope===financialScopeKey&&cloudState.ready;
  const cloudError=cloudState.scope===financialScopeKey?cloudState.error:null;
  const [legacyMigrationStatus,setLegacyMigrationStatus]=useState<LegacyMigrationResult|null>(null);
  const legacyMappings=React.useRef<Record<string,string>>({});
  const financialStatus=(businessId:string,inFlight=false)=>combineFinancialSyncStatus(getSyncStatus(businessId,inFlight),getCashSyncStatus(businessId));
  function requireFinancialWritable<T extends (...args:any[])=>any>(fn:T):T{
    return requireWritable(((...args:Parameters<T>)=>{
      if(!cloudReady||!sharedSyncStatus.ready||!syncTarget.outletId)throw new Error('CLOUD_OUTLET_NOT_READY');
      return fn(...args);
    }) as T);
  }
  const mapLegacyOutlet=(originalBranchRef:string,outletId:string)=>{
    if(!settings.branches?.some(branch=>branch.id===outletId&&branch.isActive&&branch.businessSector===activeSector))
      throw new Error('OUTLET_NOT_ACTIVE');
    const key='newhope_legacy_outlet_mappings_'+tenant.businessId;
    let saved:Record<string,string>={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
    saved[originalBranchRef]=outletId;localStorage.setItem(key,JSON.stringify(saved));
    legacyMappings.current=saved;void runSync(syncTarget,true);
  };

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
    getSyncStatus(makeBusinessId(storeOwnerId, activeSector))
  );
  const activeSyncBusinessId=React.useRef(tenant.businessId);
  activeSyncBusinessId.current=tenant.businessId;

  /**
   * Menjalankan pengiriman lalu menyegarkan status di layar.
   *
   * Sengaja tidak pernah melempar: pemanggil terdekatnya adalah jalur
   * penyelesaian transaksi, dan sinkronisasi yang gagal tidak boleh
   * menjatuhkan penjualan yang sudah sah.
   */
  const runSync = React.useCallback(
    async (target: SyncTarget, force = false) => {
      try {
        const mappingKey='newhope_legacy_outlet_mappings_'+target.businessId;
        let mappings:Record<string,string>={};try{mappings=JSON.parse(localStorage.getItem(mappingKey)||'{}');}catch{}
        const migration=migrateLegacyFinancialData(target,{outletMappings:mappings});
        if(activeSyncBusinessId.current===target.businessId){
          setLegacyMigrationStatus(migration);
          setSyncStatus(financialStatus(target.businessId,true));
        }
        if(migration.error){
          if(activeSyncBusinessId.current===target.businessId)setSyncStatus(previous=>({...previous,
            inFlight:false,lastError:migration.error,failures:Math.max(1,previous.failures)}));
          return;
        }
        const after = await flushSync(target, force);
        const cash=await flushCashQueue(target,force);
        const recovered=migrateLegacyFinancialData(target,{outletMappings:mappings});
        if(activeSyncBusinessId.current===target.businessId){
          setLegacyMigrationStatus(recovered);
          setSyncStatus(combineFinancialSyncStatus(after,cash));
        }
        window.dispatchEvent(new Event('financial-updated'));
      } catch {
        if(activeSyncBusinessId.current===target.businessId)setSyncStatus(financialStatus(target.businessId));
      }
    },
    []
  );

  const bizId = tenant.businessId;
  const storeNameForSync = settings.storeName;

  useEffect(() => {
    const target: SyncTarget = {
      businessId: bizId,
      outletId: /^[0-9a-f-]{36}$/i.test(settings.activeBranchId || '') ? settings.activeBranchId : undefined,
      sector: activeSector,
      storeName: storeNameForSync,
      ownerRef: storeOwnerId,
    };

    // Berpindah pengguna atau sektor berarti antrian yang berbeda.
    setSyncStatus(getSyncStatus(bizId));

    // 1. Saat dibuka — mengirim apa pun yang tertinggal dari sesi sebelumnya.
    void runSync(target, Boolean(target.outletId));

    // 2. Saat jaringan kembali. Ini pemicu terpenting bagi kasir yang seharian
    //    offline lalu masuk area ber-WiFi.
    const onOnline = () => void runSync(target);
    const onOutletsUpdated = () => void runSync(target, true);
    window.addEventListener('online', onOnline);
    window.addEventListener('outlets-updated', onOutletsUpdated);

    // 3. Denyut berkala sebagai jaring pengaman. Event 'online' tidak selalu
    //    menyala di semua perangkat, dan server bisa saja yang tadi mati.
    const timer = window.setInterval(() => void runSync(target), 60_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('outlets-updated', onOutletsUpdated);
      window.clearInterval(timer);
    };
  }, [bizId, activeSector, storeNameForSync, storeOwnerId, settings.activeBranchId, runSync]);

  const [categories, setCategories] = useState<Category[]>(() => {
    return loadScopedData('categories', storeOwnerId, activeSector, []);
  });

  const [products, setProducts] = useState<Product[]>(() => {
    return loadScopedData('products', storeOwnerId, activeSector, []);
  });

  const [tables, setTables] = useState<Table[]>(() => {
    return loadScopedData('tables', storeOwnerId, activeSector, []);
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    return loadScopedData('customers', storeOwnerId, activeSector, seedCustomersFor(activeSector));
  });

  const [orders, setOrders] = useState<Order[]>(() => {
    return loadScopedData('orders', storeOwnerId, activeSector, []);
  });


  const [heldOrders, setHeldOrders] = useState<Order[]>(() => {
    return loadScopedData('held_orders', storeOwnerId, activeSector, []);
  });

  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>(() => {
    return loadScopedData('inventory_logs', storeOwnerId, activeSector, []);
  });

  const [cashMovements, setCashMovements] = useState<CashMovement[]>(() => {
    return loadScopedData('cash_movements', storeOwnerId, activeSector, []);
  });

  const [shift, setShift] = useState<Shift>(() => {
    const activeCashier = authUser?.user_metadata?.full_name || currentUser.name || 'Kasir';
    const loaded = loadScopedData('shift', storeOwnerId, activeSector, INITIAL_SHIFT);

    if (
      !loaded.cashierName ||
      loaded.cashierName === 'Ahmad Kasir' ||
      loaded.cashierName === 'Budi Santoso' ||
      loaded.id === 'shift-001' ||
      loaded.totalSales === 2800000
    ) {
      return {
        id: newId('shift'),
        cashierName: activeCashier,
        startTime: new Date().toISOString(),
        initialCash: 0,
        cashSales: 0,
        qrisSales: 0,
        cardSales: 0,
        eWalletSales: 0,
        totalSales: 0,
        totalCashIn: 0,
        totalCashOut: 0,
        expectedCash: 0,
        status: 'OPEN',
      };
    }
    return loaded;
  });

  // Shift totals are hydrated from the authoritative cash and sales ledgers.

  const [shiftHistory, setShiftHistory] = useState<Shift[]>(() => {
    return loadScopedData('shift_history', storeOwnerId, activeSector, []);
  });

  const [promoCodes, setPromoCodes] = useState<PromoCode[]>(() => {
    return loadScopedData('promo_codes', storeOwnerId, activeSector, seedPromosFor(activeSector));
  });

  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Staff Members State & Selection
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>(() => {
    return loadGlobalUserData('staff_members', storeOwnerId, INITIAL_STAFF_MEMBERS);
  });
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);

  // Stock Items State
  const [stockItems, setStockItems] = useState<StockItem[]>(() => {
    return loadScopedData('stock_items', storeOwnerId, activeSector, INITIAL_STOCK_ITEMS);
  });

  // Product Bundles State
  const [bundles, setBundles] = useState<ProductBundle[]>(() => {
    return loadScopedData('bundles', storeOwnerId, activeSector, INITIAL_BUNDLES);
  });

  // Attendance Logs State (Clock In / Out)
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceRecord[]>(() => {
    return loadScopedData('attendance_logs', storeOwnerId, activeSector, seedAttendanceFor(activeSector));
  });

  // KDS Tickets (F&B Kitchen Display System)
  const [kdsTickets, setKdsTickets] = useState<KDSTicket[]>(() => {
    return loadScopedData('kds_tickets', storeOwnerId, activeSector, []);
  });

  // Carwash Bay Queue (Carwash Bay Capacity Pipeline)
  const [carwashQueue, setCarwashQueue] = useState<CarwashQueueItem[]>(() => {
    return loadScopedData('carwash_queue', storeOwnerId, activeSector, []);
  });

  // Appointment Bookings (Barbershop Time-Slot Resource Engine)
  const [bookings, setBookings] = useState<AppointmentBooking[]>(() => {
    return loadScopedData('bookings', storeOwnerId, activeSector, []);
  });

  // Staff Commission Rules
  const [commissionRules, setCommissionRules] = useState<StaffCommissionRule[]>(() => {
    return loadScopedData('commission_rules', storeOwnerId, activeSector, INITIAL_COMMISSION_RULES);
  });

  // Payroll Slips (Smart Labor & Commission Core)
  const [payrollSlips, setPayrollSlips] = useState<PayrollSlip[]>(() => {
    return loadScopedData('payroll_slips', storeOwnerId, activeSector, []);
  });

  // Automated WhatsApp Lifecycle Hooks
  const [sentLifecycleHookIds, setSentLifecycleHookIds] = useState<string[]>(() => {
    return loadScopedData('sent_lifecycle_hooks', storeOwnerId, activeSector, []);
  });

  const [sharedSyncStatus, setSharedSyncStatus] = useState<SharedSyncStatus>({ready:false,pending:0,error:null});
  const [syncCenterOpen,setSyncCenterOpen]=useState(false);
  const openSyncCenter=React.useCallback(()=>setSyncCenterOpen(true),[]);
  const closeSyncCenter=React.useCallback(()=>setSyncCenterOpen(false),[]);
  const syncCenter=syncStatusModel({businessId:makeBusinessId(storeOwnerId,activeSector),financial:syncStatus,
    operational:sharedSyncStatus,recovery:legacyMigrationStatus,cloudReady,cloudError,online:typeof navigator==='undefined'||navigator.onLine});
  const sharedSync = React.useRef<SharedStateSync | null>(null);
  const remoteOrderOperations=React.useRef(new Map<string,Record<string,unknown>>());
  const sharedSettings = React.useMemo(() => {
    const { subscription: _subscription, branches: _branches, activeBranchId: _activeBranchId,
      logoUrl: _logoUrl, registeredTerminalId: _registeredTerminalId,
      autoPrintReceipt: _autoPrintReceipt, receiptPaperSize: _receiptPaperSize,
      businessSector: _businessSector, ...rest } = settings;
    return {id:'main',...rest,businessSector:settings.businessSector,businessId:makeBusinessId(storeOwnerId,settings.businessSector||'FNB')};
  },[settings,storeOwnerId]);

  // Hydrate operational records from the owner account and keep each change in
  // a durable, versioned outbox. Normalized transactions still use the ledger.
  useEffect(() => {
    if(!authUser?.id) return;
    const cacheError=operationalCacheError(authUser.id,activeSector);
    if(cacheError){setSharedSyncStatus({ready:false,pending:0,error:cacheError});return;}
    remoteOrderOperations.current=new Map();
    const importMarker=`newhope_operational_import_v2_${authUser.id}_${activeSector}`;
    const needsLegacyImport=!localStorage.getItem(importMarker);
    const store=new SharedStateSync(authUser.id,activeSector,(records,initial)=>{
      if(sharedSync.current!==store)return;
      const grouped=new Map<string,SharedRecord[]>();
      for(const record of records){
        const group=grouped.get(record.kind)||[];group.push(record);grouped.set(record.kind,group);
      }
      const apply=<T extends object>(kind:string,current:T[],set:React.Dispatch<React.SetStateAction<T[]>>) => {
        const rows=grouped.get(kind)||[];
        const fromServer=rows.filter(row=>!row.deleted&&row.value).map(row=>row.value as T);
        const known=new Set(rows.map(row=>row.recordId));
        const legacyKey=kind==='staff_members' ? getGlobalUserKey(kind,authUser.id)
          : getScopedKey(kind,authUser.id,activeSector);
        const imported=initial && needsLegacyImport && legacyKeys.current?.has(legacyKey)
          ? repairOperationalCache(authUser.id,activeSector,kind,current).filter(row=>!known.has(recordIdOf(kind,row))) : [];
        const merged=[...fromServer,...imported];
        if(imported.length)store.importLegacy(kind,imported);
        const cloudCategories=(grouped.get('categories')||[]).filter(r=>!r.deleted).map(r=>r.value);
        store.prime(kind,kind==='products'?merged.map(row=>({...row,categoryName:cloudCategories.find(c=>c?.id===(row as {categoryId?:string}).categoryId)?.name||'Lainnya'})):merged);
        set(previous=>JSON.stringify(previous)===JSON.stringify(merged)?previous:merged);
      };
      apply('categories',categories,setCategories);
      apply('products',products,setProducts);
      apply('tables',tables,setTables);
      apply('customers',customers,setCustomers);
      const operationRows=(grouped.get('order_operations')||[]).filter(row=>!row.deleted&&row.value);
      remoteOrderOperations.current=new Map(operationRows.map(row=>[row.recordId,row.value!]));
      store.prime('order_operations',operationRows.map(row=>row.value!));
      setOrders(previous=>previous.map(row=>mergeOrderOperations(row,remoteOrderOperations.current.get(row.id))));

      apply('held_orders',heldOrders,setHeldOrders);
      apply('inventory_logs',inventoryLogs,setInventoryLogs);


      apply('promo_codes',promoCodes,setPromoCodes);
      apply('stock_items',stockItems,setStockItems);
      apply('bundles',bundles,setBundles);
      apply('attendance_logs',attendanceLogs,setAttendanceLogs);
      apply('kds_tickets',kdsTickets,setKdsTickets);
      apply('carwash_queue',carwashQueue,setCarwashQueue);
      apply('bookings',bookings,setBookings);
      apply('commission_rules',commissionRules,setCommissionRules);
      apply('payroll_slips',payrollSlips,setPayrollSlips);
      apply('staff_members',staffMembers,setStaffMembers);
      const lifecycle=(grouped.get('sent_lifecycle_hooks')||[]).filter(row=>!row.deleted).map(row=>row.recordId);
      store.prime('sent_lifecycle_hooks',lifecycle.map(id=>({id})));
      if(JSON.stringify(lifecycle)!==JSON.stringify(sentLifecycleHookIds))setSentLifecycleHookIds(lifecycle);
      const remoteSettings=grouped.get('store_settings')?.find(row=>!row.deleted&&row.recordId==='main')?.value
        || (initial&&store.businessName?{...sharedSettings,storeName:store.businessName,storeMode:BUSINESS_PRESETS[activeSector].storeMode,
          receiptHeader:`*** ${store.businessName} ***`,receiptFooter:`Terima kasih telah bertransaksi di ${store.businessName}`}:undefined);
      store.prime('store_settings',remoteSettings?[remoteSettings]:[]);
      if(remoteSettings){
        const {id: _id,businessId:_businessId,...safe}=remoteSettings;
        setSettings(prev=>({...prev,...safe,subscription:prev.subscription,branches:prev.branches,
          activeBranchId:prev.activeBranchId,logoUrl:prev.logoUrl,
          registeredTerminalId:prev.registeredTerminalId,businessSector:prev.businessSector,
          autoPrintReceipt:prev.autoPrintReceipt,receiptPaperSize:prev.receiptPaperSize} as StoreSettings));
      }
      const userRows=grouped.get('users')||[];
      const remoteUsers=userRows.filter(row=>!row.deleted&&row.value).map(row=>row.value as unknown as User);
      const userIds=new Set(userRows.map(row=>row.recordId));
      store.prime('users',remoteUsers);
      setUsers(previous=>{
        const importedUsers=initial&&legacyKeys.current?.has(`newhope_users_${authUser.id}`)
          ? previous.filter(user=>user.id!==authUser.id&&user.role!=='ADMIN'&&user.pin.startsWith('sha256$')&&!userIds.has(user.id)) : [];
        const combined=[previous.find(user=>user.id===authUser.id)||defaultOwnerUser,...remoteUsers,...importedUsers];
        return JSON.stringify(previous)===JSON.stringify(combined)?previous:combined;
      });
      // One-time migration for accounts whose catalog was synced before the
      // versioned store existed. A tombstone counts as a record: never revive it.
      const needsCatalogFallback=initial && needsLegacyImport && !grouped.get('products')?.length && !products.length;
      if(needsCatalogFallback){
        void pullCatalog({businessId:makeBusinessId(authUser.id,activeSector),sector:activeSector,
          storeName:settings.storeName,ownerRef:authUser.id}).then(legacy=>{
          if(!legacy || sharedSync.current!==store)return;
          const restoredProducts=legacy.products.map((product:any)=>({
            id:product.id,name:product.name,price:product.price,costPrice:product.costPrice,
            sku:product.sku||'',unit:product.unit||'pcs',description:product.description||'',
            categoryId:product.categoryId||'cat-1',image:'',stock:0,minStockAlert:5,
            isAvailable:product.isAvailable,
          }));
          const restoredCategories=legacy.categories.map((category:any)=>({
            id:category.id,name:category.name,icon:'Package',color:'#3B82F6',
          }));
          store.importLegacy('products',restoredProducts);store.importLegacy('categories',restoredCategories);
          if(restoredProducts.length)setProducts(previous=>previous.length?previous:restoredProducts);
          if(restoredCategories.length)setCategories(previous=>previous.length?previous:restoredCategories);
          localStorage.setItem(importMarker,'queued-v2');
        });
      }
      if(initial&&!needsCatalogFallback)localStorage.setItem(importMarker,'queued-v2');
    },status=>{const error=operationalCacheError(authUser.id,activeSector);setSharedSyncStatus(error?{...status,ready:false,error}:status);});
    sharedSync.current=store;
    const prime=<T extends object>(kind:string,rows:T[])=>store.prime(kind,rows);
    prime('categories',categories);prime('products',products.map(product=>({
      ...product,categoryName:categories.find(category=>category.id===product.categoryId)?.name||'Lainnya',
    })));prime('tables',tables);prime('customers',customers);
    prime('held_orders',heldOrders);prime('inventory_logs',inventoryLogs);
    prime('order_operations',orders.map(orderOperations));

    prime('promo_codes',promoCodes);prime('stock_items',stockItems);prime('bundles',bundles);
    prime('attendance_logs',attendanceLogs);prime('kds_tickets',kdsTickets);
    prime('carwash_queue',carwashQueue);prime('bookings',bookings);
    prime('commission_rules',commissionRules);prime('payroll_slips',payrollSlips);
    prime('staff_members',staffMembers);
    prime('store_settings',[sharedSettings]);
    store.start();
    const onOnline=()=>void store.refresh(false);
    const onFocus=()=>void store.refresh(false);
    const onOutletsUpdated=()=>void store.resumeAfterOutletUpdate();
    window.addEventListener('online',onOnline);window.addEventListener('focus',onFocus);
    window.addEventListener('outlets-updated',onOutletsUpdated);
    window.addEventListener('subscription-updated',onOutletsUpdated);
    return ()=>{store.stop();if(sharedSync.current===store)sharedSync.current=null;
      window.removeEventListener('online',onOnline);window.removeEventListener('focus',onFocus);
      window.removeEventListener('outlets-updated',onOutletsUpdated);
      window.removeEventListener('subscription-updated',onOutletsUpdated);};
  // Collection changes are tracked by the effect below. Recreating this owner/sector
  // connection on every edit would discard its in-flight version baseline.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[authUser?.id,activeSector]);

  useEffect(()=>{
    if(!authUser?.id)return;
    if(currentUser.id!==authUser.id && !users.some(user=>user.id===currentUser.id&&user.status==='ACTIVE'))
      setCurrentUser(users.find(user=>user.id===authUser.id)||defaultOwnerUser);
  },[users,currentUser.id,authUser?.id]);

  useEffect(()=>{
    sharedSync.current?.setOutletId(/^[0-9a-f-]{36}$/i.test(settings.activeBranchId||'')
      ?settings.activeBranchId:undefined);
  },[settings.activeBranchId,activeSector]);

  useEffect(()=>{safeSetLocalStorage(getScopedKey('store_settings',storeOwnerId,activeSector),JSON.stringify(sharedSettings));},[sharedSettings,storeOwnerId,activeSector]);

  useEffect(()=>{
    const store=sharedSync.current;
    if(!store)return;
    store.track('categories',categories);store.track('products',products.map(product=>({
      ...product,categoryName:categories.find(category=>category.id===product.categoryId)?.name||'Lainnya',
    })));store.track('tables',tables);
    store.track('customers',customers);
    store.track('held_orders',heldOrders);store.track('inventory_logs',inventoryLogs);
    store.track('order_operations',orders.map(orderOperations),false);

    store.track('promo_codes',promoCodes);store.track('stock_items',stockItems);
    store.track('bundles',bundles);store.track('attendance_logs',attendanceLogs);
    store.track('kds_tickets',kdsTickets);store.track('carwash_queue',carwashQueue);
    store.track('bookings',bookings);store.track('commission_rules',commissionRules);
    store.track('payroll_slips',payrollSlips);store.track('staff_members',staffMembers);

    store.track('store_settings',[sharedSettings]);
    store.track('sent_lifecycle_hooks',sentLifecycleHookIds.map(id=>({id})));
    store.track('users',users.filter(user=>user.id!==authUser?.id&&user.pin.startsWith('sha256$')));
  },[categories,products,tables,customers,orders,heldOrders,inventoryLogs,cashMovements,
    shiftHistory,promoCodes,stockItems,bundles,attendanceLogs,kdsTickets,
    carwashQueue,bookings,commissionRules,payrollSlips,staffMembers,shift,
    sharedSettings,sentLifecycleHookIds,users,authUser?.id]);

  // Financial reads replace confirmed cache; pending commands remain recoverable.
  useEffect(()=>{
    if(!authUser?.id||!syncTarget.outletId){setCloudState({scope:financialScopeKey,ready:false,error:null});return;}
    const controller=new AbortController();let running=false;
    setCloudState({scope:financialScopeKey,ready:false,error:null});
    const target={...syncTarget};
    const refresh=async()=>{
      if(running||controller.signal.aborted)return;running=true;
      try{
        // Capture original laptop data before any cloud replacement.
        const mappings=JSON.parse(localStorage.getItem('newhope_legacy_outlet_mappings_'+target.businessId)||'{}');
        const migration=migrateLegacyFinancialData(target,{outletMappings:mappings});
        setLegacyMigrationStatus(migration);
        if(migration.error)throw new Error(migration.error);
        const query={outletId:target.outletId,sector:target.sector};
        const [remote,summary]=await Promise.all([fetchRecentServerTransactions(query,controller.signal),fetchReportSummary(query,controller.signal)]);
        let shiftResponse=await fetch('/api/v1/finance/shift?'+reportParams(query),{signal:controller.signal,cache:'no-store'});
        let shiftData=await shiftResponse.json();
        if(!shiftResponse.ok||!shiftData.ok)throw new Error(shiftData.error||'SHIFT_UNAVAILABLE');
        if(!shiftData.shift&&!shiftData.history?.length){
          shiftResponse=await fetch('/api/v1/finance/shift/open',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
            body:JSON.stringify({sector:target.sector,outletId:target.outletId,clientShiftId:newId('shift'),cashierName:currentUser.name,initialCash:0})});
          const opened=await shiftResponse.json();if(!shiftResponse.ok||!opened.ok)throw new Error(opened.error||'SHIFT_OPEN_FAILED');
          shiftData={...shiftData,shift:opened.shift};
        }
        if(controller.signal.aborted)return;
        const pendingIds=new Set(getPendingTransactions(target.businessId).map(row=>row.clientTxnId));
        setOrders(previous=>{
          const pending=previous.filter(row=>pendingIds.has(row.id));
          const previousOperations=new Map(previous.map(row=>[row.id,orderOperations(row)]));
          const byId=new Map(remote.filter(row=>!pendingIds.has(row.id)).map(row=>[row.id,
            mergeOrderOperations(row,remoteOrderOperations.current.get(row.id)||previousOperations.get(row.id))]));
          for(const row of pending)byId.set(row.id,row);
          for(const row of previous.filter(row=>row.status==='HOLD'))if(!byId.has(row.id))byId.set(row.id,row);
          return [...byId.values()].sort((a,b)=>b.date.localeCompare(a.date));
        });
        setCashMovements(summary.cashMovements);
        if(shiftData.shift)setShift(shiftData.shift);
        else if(shiftData.history?.[0])setShift(shiftData.history[0]);
        setShiftHistory(shiftData.history||[]);
        markCloudRead(target.businessId,summary.generatedAt);
        setSyncStatus(financialStatus(target.businessId));
        setCloudState({scope:financialScopeKey,ready:true,error:null});
      }catch(error){if(!controller.signal.aborted){
        const message=error instanceof Error?error.message:'CLOUD_UNAVAILABLE';
        setCloudState(previous=>({...previous,scope:financialScopeKey,error:message}));
        setSyncStatus(previous=>({...previous,lastError:message,failures:Math.max(1,previous.failures)}));
      }}finally{running=false;}
    };
    void refresh();const timer=window.setInterval(refresh,10000);
    const updated=()=>void refresh();
    window.addEventListener('focus',updated);window.addEventListener('online',updated);window.addEventListener('financial-updated',updated);
    return()=>{controller.abort();window.clearInterval(timer);window.removeEventListener('focus',updated);window.removeEventListener('online',updated);window.removeEventListener('financial-updated',updated);};
  },[authUser?.id,financialScopeKey]);

  // Sync state to LocalStorage scoped per User and Sector
  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('categories', uId, sec), JSON.stringify(categories));
  }, [categories, storeOwnerId, settings.businessSector]);

  // Debounce: products berubah SETIAP transaksi (stok berkurang). Tanpa
  // penundaan, satu jam sibuk menghasilkan ratusan JSON.stringify katalog penuh.
  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    const timer = window.setTimeout(() => {
      safeSetLocalStorage(getScopedKey('products', uId, sec), JSON.stringify(products));
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [products, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('tables', uId, sec), JSON.stringify(tables));
  }, [tables, storeOwnerId, settings.businessSector]);

  // Debounce: sama seperti products — bahan baku terpotong setiap transaksi.
  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    const timer = window.setTimeout(() => {
      safeSetLocalStorage(getScopedKey('stock_items', uId, sec), JSON.stringify(stockItems));
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [stockItems, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('bundles', uId, sec), JSON.stringify(bundles));
  }, [bundles, storeOwnerId, settings.businessSector]);

  // Cap 50 order terbaru. Order lama sudah aman di server lewat sync queue —
  // menyimpan semuanya membengkakkan localStorage (limit 5 MB) dan memperlambat
  // JSON.stringify di setiap transaksi.
  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    // Never truncate/replace the old cache if its recovery snapshot failed.
    let mappings:Record<string,string>={};
    try{mappings=JSON.parse(localStorage.getItem('newhope_legacy_outlet_mappings_'+tenant.businessId)||'{}');}catch{return;}
    if(migrateLegacyFinancialData(syncTarget,{outletMappings:mappings}).error)return;
    safeSetLocalStorage(getScopedKey('orders', uId, sec), JSON.stringify(orders.slice(0, 50)));
  }, [orders, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('held_orders', uId, sec), JSON.stringify(heldOrders));
  }, [heldOrders, storeOwnerId, settings.businessSector]);

  // Cap 50 log terbaru — alasan sama dengan orders di atas.
  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('inventory_logs', uId, sec), JSON.stringify(inventoryLogs.slice(0, 50)));
  }, [inventoryLogs, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('shift', uId, sec), JSON.stringify(shift));
  }, [shift, storeOwnerId, settings.businessSector]);

  // Cap 30 shift terbaru (kurang-lebih 1 bulan harian).
  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('shift_history', uId, sec), JSON.stringify(shiftHistory.slice(0, 30)));
  }, [shiftHistory, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    localStorage.setItem(getGlobalUserKey('settings', uId), JSON.stringify(settings));
  }, [settings, storeOwnerId]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('customers', uId, sec), JSON.stringify(customers));
  }, [customers, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    localStorage.setItem(getGlobalUserKey('staff_members', uId), JSON.stringify(staffMembers));
  }, [staffMembers, storeOwnerId]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('attendance_logs', uId, sec), JSON.stringify(attendanceLogs));
  }, [attendanceLogs, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('promo_codes', uId, sec), JSON.stringify(promoCodes));
  }, [promoCodes, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('kds_tickets', uId, sec), JSON.stringify(kdsTickets));
  }, [kdsTickets, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('carwash_queue', uId, sec), JSON.stringify(carwashQueue));
  }, [carwashQueue, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('bookings', uId, sec), JSON.stringify(bookings));
  }, [bookings, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('commission_rules', uId, sec), JSON.stringify(commissionRules));
  }, [commissionRules, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('payroll_slips', uId, sec), JSON.stringify(payrollSlips));
  }, [payrollSlips, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('sent_lifecycle_hooks', uId, sec), JSON.stringify(sentLifecycleHookIds));
  }, [sentLifecycleHookIds, storeOwnerId, settings.businessSector]);

  // CRM writes use the versioned shared outbox above. The server mirrors accepted
  // metadata into normalized customers in the same transaction for admin reads.

  /*
   * SINKRONISASI PRESENSI / CLOCK-IN STAF KE POSTGRESQL.
   */
  useEffect(() => {
    if (attendanceLogs.length === 0) return;

    const timer = window.setTimeout(() => {
      void pushAttendance(
        {
          businessId: makeBusinessId(storeOwnerId, activeSector),
          sector: activeSector,
          storeName: settings.storeName,
          ownerRef: storeOwnerId,
        },
        attendanceLogs.slice(0, 100).map((a) => ({
          id: a.id,
          staffId: a.staffId,
          staffName: a.staffName,
          staffRole: a.staffRole,
          clockInTime: a.clockInTime,
          clockOutTime: a.clockOutTime,
          shiftNotes: a.shiftNotes,
          status: a.status,
          branchId: a.branchId,
          branchName: a.branchName,
          clockInGeo: a.clockInGeo,
          clockOutGeo: a.clockOutGeo,
        }))
      );
    }, 5_000);

    return () => window.clearTimeout(timer);
  }, [attendanceLogs, storeOwnerId, activeSector, settings.storeName]);

  /*
   * SINKRONISASI PENGGAJIAN / SLIP GAJI STAF KE POSTGRESQL.
   */
  useEffect(() => {
    if (payrollSlips.length === 0) return;

    const timer = window.setTimeout(() => {
      void pushPayroll(
        {
          businessId: makeBusinessId(storeOwnerId, activeSector),
          sector: activeSector,
          storeName: settings.storeName,
          ownerRef: storeOwnerId,
        },
        payrollSlips.slice(0, 50)
      );
    }, 5_000);

    return () => window.clearTimeout(timer);
  }, [payrollSlips, storeOwnerId, activeSector, settings.storeName]);

  /*
   * STAFF ARE SCOPED TO THE ACTIVE BUSINESS SECTOR.
   *
   * Unlike products/categories/tables, the staff list is stored globally per
   * user (one roster across all of a merchant's businesses). Every consumer used
   * to read that raw list, so a barber showed up in the cafe's "Pilih Petugas"
   * modal, in the cafe's clock-in sheet, and inside the cafe's staff-performance
   * insight.
   *
   * Scoping here — at the single source — means no screen can leak the wrong
   * sector by forgetting to filter. `allStaffMembers` stays available for
   * cross-sector management screens that genuinely need the whole roster.
   */
  const sectorStaffMembers = staffMembers.filter((s) => belongsToBusiness(s, tenant));

  /** Guard against a stale selection surviving a business switch. */
  const scopedSelectedStaff =
    selectedStaff && belongsToBusiness(selectedStaff, tenant) ? selectedStaff : null;

  const addStaffMember = (staff: Omit<StaffMember, 'id'>) => {
    if (isFreePlan(settings.subscription)) throw new Error('FREE_OWNER_ONLY');
    // Shared collection: stamp the partition key so the row can never be read
    // by another business unit.
    const newStaff: StaffMember = stampBusiness(
      { ...staff, sector: staff.sector || activeSector, id: newId('stf') },
      tenant
    );
    setStaffMembers((prev) => [newStaff, ...prev]);
    if (soundEnabled) playPOSSound('click');
  };

  const updateStaffMember = (staffToUpdate: StaffMember) => {
    setStaffMembers((prev) =>
      prev.map((s) => (s.id === staffToUpdate.id ? { ...s, ...staffToUpdate } : s))
    );
    if (soundEnabled) playPOSSound('click');
  };

  const deleteStaffMember = (staffId: string) => {
    setStaffMembers((prev) => prev.filter((s) => s.id !== staffId));
    if (soundEnabled) playPOSSound('delete');
  };

  const toggleStaffAvailability = (staffId: string) => {
    setStaffMembers((prev) =>
      prev.map((s) => (s.id === staffId ? { ...s, isAvailable: !s.isAvailable } : s))
    );
    if (soundEnabled) playPOSSound('click');
  };

  const branches = settings.branches || INITIAL_BRANCHES;
  const activeBranch = branches.find((b) => b.id === settings.activeBranchId) || branches[0];

  const setActiveBranchId = (branchId: string) => {
    if (!branches.some(branch => branch.id === branchId && branch.isActive && branch.businessSector === activeSector)) throw new Error('OUTLET_NOT_ACTIVE_FOR_BUSINESS');
    if (isFreePlan(settings.subscription) && branchId !== settings.subscription?.freeSelection?.branchId) throw new Error('FREE_BRANCH_LOCKED');
    setSettings((prev) => ({ ...prev, activeBranchId: branchId }));
  };

  const saveBranch = async (branchToSave: StoreBranch) => {
    if (isFreePlan(settings.subscription) && branchToSave.id !== settings.subscription?.freeSelection?.branchId) throw new Error('FREE_BRANCH_LIMIT');
    const originalId = branchToSave.id;
    await prepareOutletBusiness(branchToSave.businessSector || activeSector, settings.storeName);
    const response = await fetch('/api/v1/subscription/outlets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...branchToSave, businessSector: branchToSave.businessSector || activeSector }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Outlet gagal disimpan');
    branchToSave = { ...branchToSave, id: result.outlet.id };
    setSettings((prev) => {
      const existing = prev.branches || INITIAL_BRANCHES;
      const idx = existing.findIndex((b) => b.id === originalId);
      let updated: StoreBranch[];
      if (idx >= 0) {
        updated = [...existing];
        updated[idx] = branchToSave;
      } else {
        updated = [branchToSave, ...existing];
      }
      return { ...prev, branches: updated, activeBranchId: prev.activeBranchId === originalId ? branchToSave.id : prev.activeBranchId };
    });
    if (soundEnabled) playPOSSound('click');
    window.dispatchEvent(new Event('outlets-updated'));
  };

  const deleteBranch = async (branchId: string) => {
    const branch = settings.branches?.find(b => b.id === branchId);
    if (!branch) return;
    const response = await fetch('/api/v1/subscription/outlets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...branch, businessSector: branch.businessSector || activeSector, isActive: false }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) { window.alert(result.error || 'Outlet gagal dinonaktifkan'); return; }
    setSettings((prev) => {
      const existing = prev.branches || INITIAL_BRANCHES;
      const updated = existing.map((b) => b.id === branchId ? { ...b, isActive: false } : b);
      return { ...prev, branches: updated };
    });
    if (soundEnabled) playPOSSound('delete');
    window.dispatchEvent(new Event('outlets-updated'));
  };

  const clockInStaff = (
    staffId: string,
    notes?: string,
    geoInfo?: GeoLocationInfo,
    branchInfo?: { id: string; name: string },
    photoUrl?: string
  ) => {
    const staff = staffMembers.find((s) => s.id === staffId);
    if (!staff) return;

    const bId = branchInfo?.id || activeBranch?.id;
    const bName = branchInfo?.name || activeBranch?.name;

    const newRecord: AttendanceRecord = {
      id: newId('att'),
      staffId: staff.id,
      staffName: staff.name,
      staffRole: staff.role,
      clockInTime: new Date().toISOString(),
      shiftNotes: notes,
      status: 'CLOCKED_IN',
      branchId: bId,
      branchName: bName,
      clockInGeo: geoInfo,
      businessSector: settings.businessSector,
      photoUrl,
    };

    setAttendanceLogs((prev) => [newRecord, ...prev]);
    if (soundEnabled) playPOSSound('click');
  };

  const clockOutStaff = (
    staffId: string,
    notes?: string,
    geoInfo?: GeoLocationInfo,
    branchInfo?: { id: string; name: string }
  ) => {
    const bId = branchInfo?.id || activeBranch?.id;
    const bName = branchInfo?.name || activeBranch?.name;

    setAttendanceLogs((prev) =>
      prev.map((log) => {
        if (log.staffId === staffId && log.status === 'CLOCKED_IN') {
          return {
            ...log,
            clockOutTime: new Date().toISOString(),
            shiftNotes: notes || log.shiftNotes,
            status: 'CLOCKED_OUT',
            clockOutGeo: geoInfo,
            branchId: log.branchId || bId,
            branchName: log.branchName || bName,
          };
        }
        return log;
      })
    );
    if (soundEnabled) playPOSSound('click');
  };

  const getActiveAttendance = (staffId: string): AttendanceRecord | undefined => {
    return attendanceLogs.find((log) => log.staffId === staffId && log.status === 'CLOCKED_IN');
  };

  const saveStockItem = (item: StockItem) => {
    setStockItems((prev) => {
      const idx = prev.findIndex((s) => s.id === item.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = item;
        return copy;
      }
      return [item, ...prev];
    });
    if (soundEnabled) playPOSSound('click');
  };

  const deleteStockItem = (id: string) => {
    setStockItems((prev) => prev.filter((s) => s.id !== id));
    if (soundEnabled) playPOSSound('delete');
  };

  const saveBundle = (bundle: ProductBundle) => {
    setBundles((prev) => {
      const idx = prev.findIndex((b) => b.id === bundle.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = bundle;
        return copy;
      }
      return [bundle, ...prev];
    });
    if (soundEnabled) playPOSSound('click');
  };

  const deleteBundle = (id: string) => {
    setBundles((prev) => prev.filter((b) => b.id !== id));
    if (soundEnabled) playPOSSound('delete');
  };

  const toggleBundleAvailability = (id: string) => {
    setBundles((prev) =>
      prev.map((b) => (b.id === id ? { ...b, isAvailable: !b.isAvailable } : b))
    );
    if (soundEnabled) playPOSSound('click');
  };

  const adjustStockItemQuantity = (id: string, qtyChange: number, reason: string) => {
    const target = stockItems.find((s) => s.id === id);
    if (!target) return;

    const newQty = Math.max(0, target.stock + qtyChange);
    const log: InventoryLog = {
      id: newId('log'),
      productId: target.id,
      productName: target.name,
      type: qtyChange >= 0 ? 'IN' : 'OUT',
      quantity: Math.abs(qtyChange),
      previousStock: target.stock,
      newStock: newQty,
      reason: reason || 'Penyesuaian Stok Bahan/WIP',
      timestamp: new Date().toISOString(),
      user: shift.cashierName,
    };

    setStockItems((prev) =>
      prev.map((s) => (s.id === id ? { ...s, stock: newQty, lastUpdated: new Date().toISOString() } : s))
    );
    setInventoryLogs((logs) => [log, ...logs]);
    if (soundEnabled) playPOSSound('click');
  };

  // Input Bahan Baku Otomatis dari Kamera / Scan Nota Belanja Supplier
  const processRawMaterialReceipt = (payload: {
    receiptImage?: string;
    supplierName?: string;
    receiptDate?: string;
    items: {
      stockItemId?: string;
      name: string;
      sku?: string;
      type?: 'BAHAN_BAKU' | 'SETENGAH_JADI';
      quantity: number;
      unit: string;
      costPrice: number;
      location?: string;
    }[];
    paidFromCashDrawer: boolean;
    notes?: string;
  }) => {
    const timestamp = new Date().toISOString();
    let updatedStockItems = [...stockItems];
    const newLogs: InventoryLog[] = [];
    const savedItems: StockItem[] = [];
    let totalCost = 0;

    payload.items.forEach((item) => {
      if (!item.name || item.quantity <= 0) return;
      const itemCost = item.quantity * (item.costPrice || 0);
      totalCost += itemCost;

      // Find existing stock item by ID or exact name match
      const existing = item.stockItemId
        ? updatedStockItems.find((s) => s.id === item.stockItemId)
        : updatedStockItems.find(
            (s) => s.name.toLowerCase().trim() === item.name.toLowerCase().trim()
          );

      if (existing) {
        const prevStock = existing.stock;
        const newStock = prevStock + item.quantity;
        const updatedItem: StockItem = {
          ...existing,
          stock: newStock,
          costPrice: item.costPrice > 0 ? item.costPrice : existing.costPrice,
          unit: item.unit || existing.unit,
          lastUpdated: timestamp,
        };

        updatedStockItems = updatedStockItems.map((s) =>
          s.id === existing.id ? updatedItem : s
        );
        savedItems.push(updatedItem);

        newLogs.push({
          id: newId('log'),
          productId: existing.id,
          productName: `[Bahan Baku] ${existing.name}`,
          type: 'IN',
          quantity: item.quantity,
          previousStock: prevStock,
          newStock,
          reason: `Pembelian Supplier (${payload.supplierName || 'Scan Nota Kamera'})`,
          timestamp,
          user: shift.cashierName,
          businessSector: settings.businessSector,
        });
      } else {
        // Create new StockItem
        const newItem: StockItem = {
          id: newId('stk'),
          sku: item.sku || `RAW-${Math.floor(100 + Math.random() * 900)}`,
          name: item.name,
          type: item.type || 'BAHAN_BAKU',
          categoryId: categories[0]?.id || 'cat-makanan',
          categoryName: categories[0]?.name || 'Umum',
          stock: item.quantity,
          minStockAlert: Math.max(10, Math.round(item.quantity * 0.2)),
          unit: item.unit || 'pcs',
          costPrice: item.costPrice || 0,
          location: item.location || 'Gudang Bahan Kering',
          notes: payload.notes || `Input dari Nota ${payload.supplierName || ''}`,
          lastUpdated: timestamp,
        };

        updatedStockItems = [newItem, ...updatedStockItems];
        savedItems.push(newItem);

        newLogs.push({
          id: newId('log'),
          productId: newItem.id,
          productName: `[Bahan Baku Baru] ${newItem.name}`,
          type: 'IN',
          quantity: item.quantity,
          previousStock: 0,
          newStock: item.quantity,
          reason: `Pembelian Supplier Baru (${payload.supplierName || 'Scan Nota Kamera'})`,
          timestamp,
          user: shift.cashierName,
          businessSector: settings.businessSector,
        });
      }
    });

    setStockItems(updatedStockItems);
    if (newLogs.length > 0) {
      setInventoryLogs((prev) => [...newLogs, ...prev]);
    }

    if(payload.paidFromCashDrawer&&totalCost>0)
      addCashMovement('CASH_OUT','BELANJA_BAHAN',totalCost,'Pembelian bahan baku',payload.supplierName);

    if (soundEnabled) playPOSSound('payment_success');

    return { savedItems, totalCost };
  };

  const addPromoCode = (promo: {
    code: string;
    discountPercent: number;
    maxDiscountAmount: number;
    minPurchaseAmount?: number;
    isActive?: boolean;
  }) => {
    const newPromo: PromoCode = {
      code: promo.code.toUpperCase(),
      discountPercent: promo.discountPercent,
      maxDiscountAmount: promo.maxDiscountAmount,
      minPurchaseAmount: promo.minPurchaseAmount ?? 0,
      isActive: promo.isActive ?? true,
      createdAt: new Date().toISOString(),
    };
    setPromoCodes((prev) => [newPromo, ...prev]);
    if (soundEnabled) playPOSSound('click');
  };
  useEffect(() => { if(authUser?.id)safeSetLocalStorage(`newhope_users_${authUser.id}`, JSON.stringify(users)); }, [users,authUser?.id]);
  useEffect(() => { if(authUser?.id)safeSetLocalStorage(`newhope_current_user_${authUser.id}`, JSON.stringify(currentUser)); }, [currentUser,authUser?.id]);
  useEffect(() => {
    localStorage.setItem(
      getScopedKey('cash_movements', storeOwnerId, activeSector),
      JSON.stringify(cashMovements)
    );
  }, [cashMovements, authUser?.id, storeOwnerId, activeSector]);

  const switchUser = (user: User) => {
    if (isFreePlan(settings.subscription) && user.id !== authUser?.id) throw new Error('FREE_OWNER_ONLY');
    if (!users.some(candidate => candidate.id === user.id && candidate.status === 'ACTIVE')) {
      throw new Error('USER_NOT_ACTIVE');
    }
    // Switching cashier changes the actor, not the store or its data.
    setCurrentUser(user);

    clearCart();
    setSearchQuery('');
    if (soundEnabled) playPOSSound('click');
  };

  const saveUser = async (userToSave: User) => {
    if (isFreePlan(settings.subscription) && userToSave.id !== authUser?.id) throw new Error('FREE_OWNER_ONLY');
    const safePin = userToSave.pin.startsWith('sha256$')
      ? userToSave.pin
      : await hashPin(userToSave.pin);
    const securedUser: User = { ...userToSave, pin: safePin };
    setUsers((prev) => {
      const exists = prev.some((u) => u.id === securedUser.id);
      if (exists) {
        return prev.map((u) => (u.id === securedUser.id ? securedUser : u));
      }
      return [...prev, securedUser];
    });
    if (securedUser.id === currentUser.id) {
      setCurrentUser(securedUser);
    }
  };

  const deleteUser = (userId: string) => {
    if (userId === currentUser.id) {
      alert('Tidak dapat menghapus akun yang sedang digunakan!');
      return;
    }
    setUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  const hasPermission = (feature: PermissionFeature): boolean => {
    const allowed = ROLE_PERMISSIONS[currentUser.role] || [];
    return allowed.includes(feature);
  };

  const verifyPin = async (pinInput: string, requiredRoles?: UserRole[]) => {
    // 1. Cek status lockout terlebih dahulu
    const lockout = getPinLockoutStatus();
    if (lockout.isLockedOut) {
      return {
        success: false,
        isLockedOut: true,
        remainingSec: lockout.remainingSec,
        attemptsLeft: 0,
        message: `🔒 Terminal Terkunci: Terlalu banyak percobaan salah. Tunggu ${lockout.remainingSec} detik.`,
      };
    }

    // 2. Cari kecocokan user via Cryptographic Hash / Legacy Plaintext
    let matchedUser: User | undefined;
    for (const u of users) {
      if (u.status !== 'ACTIVE') continue;
      const isMatch = await verifyPinHash(pinInput, u.pin);
      if (isMatch) {
        matchedUser = u;
        break;
      }
    }

    // 3. Jika tidak ada yang cocok -> Catat kegagalan & evaluasi lockout
    if (!matchedUser) {
      const attempt = recordFailedPinAttempt();
      const nowIso = new Date().toISOString();

      // Log Security Audit
      setInventoryLogs((prev) => [
        {
          id: newId('log'),
          productId: 'SEC-PIN-FAIL',
          productName: '[SECURITY AUDIT] Percobaan Otorisasi PIN Gagal',
          type: 'ADJUSTMENT',
          quantity: 0,
          previousStock: 0,
          newStock: 0,
          reason: attempt.isLockedOut
            ? `Terminal terkunci (${attempt.remainingSec}s) akibat 3x kegagalan input PIN`
            : `PIN salah dimasukkan oleh kasir ${currentUser.name} (Sisa ${attempt.attemptsLeft} kesempatan)`,
          timestamp: nowIso,
          user: currentUser.name,
          businessSector: settings.businessSector,
        },
        ...prev,
      ]);

      if (attempt.isLockedOut) {
        return {
          success: false,
          isLockedOut: true,
          remainingSec: attempt.remainingSec,
          attemptsLeft: 0,
          message: `🔒 Terlalu banyak percobaan salah! Terminal dikunci selama ${attempt.remainingSec} detik.`,
        };
      }

      return {
        success: false,
        isLockedOut: false,
        attemptsLeft: attempt.attemptsLeft,
        message: `PIN Salah! Sisa ${attempt.attemptsLeft} kesempatan sebelum terminal terkunci.`,
      };
    }

    // 4. Verifikasi Role Permission
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(matchedUser.role)) {
      return {
        success: false,
        message: `Akses Ditolak! Memerlukan PIN dengan role: ${requiredRoles.join(' / ')}`,
      };
    }

    // 5. Sukses -> Reset counter percobaan gagal
    resetPinAttempts();
    return { success: true, user: matchedUser, message: 'Otorisasi Berhasil' };
  };


  const toggleSound = () => setSoundEnabled((prev) => !prev);

  // Add Item to Cart
  const addToCart = (
    product: Product,
    variant?: ProductVariant,
    modifiers: SelectedModifier[] = [],
    quantity = 1,
    notes = ''
  ) => {
    if (soundEnabled) playPOSSound('add_item');
    if (isFreePlan(settings.subscription) && !freeProductAllowed(settings.subscription?.freeSelection,product.id,activeSector)) {
      window.alert('Produk ini tersimpan tetapi terkunci di paket Free. Ubah pilihan 10 produk atau upgrade.');
      return;
    }

    let unitPrice = product.price;
    if (variant) unitPrice += variant.priceExtra;
    modifiers.forEach((m) => { unitPrice += m.price; });

    // Unique cart line identifier
    const lineKey = `${product.id}-${variant?.id || 'base'}-${modifiers.map((m) => m.optionId).sort().join('_')}`;

    setCart((prevCart) => {
      const existingIndex = prevCart.findIndex((item) => item.id === lineKey);
      if (existingIndex > -1) {
        const updated = [...prevCart];
        const item = updated[existingIndex];
        const newQty = item.quantity + quantity;
        updated[existingIndex] = {
          ...item,
          quantity: newQty,
          totalPrice: unitPrice * newQty - item.discountAmount,
        };
        return updated;
      }

      const newItem: CartItem = {
        id: lineKey,
        productId: product.id,
        name: product.name,
        variantId: variant?.id,
        variantName: variant?.name,
        selectedModifiers: modifiers,
        unitPrice,
        // HPP dibekukan di sini, saat penjualan terjadi. Varian dan modifier
        // tidak menambah HPP karena keduanya belum punya biaya sendiri di model
        // data — kalau nanti ada, tambahkan ke sini, bukan ke pelaporan.
        unitCost: product.costPrice || 0,
        quantity,
        itemNotes: notes,
        discountPercent: 0,
        discountAmount: 0,
        totalPrice: unitPrice * quantity,
      };
      return [...prevCart, newItem];
    });
  };

  const updateCartQuantity = (cartItemId: string, newQty: number) => {
    if (newQty <= 0) {
      removeFromCart(cartItemId);
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.id === cartItemId) {
          const rawTotal = item.unitPrice * newQty;
          const disc = item.discountPercent > 0 ? (rawTotal * item.discountPercent) / 100 : item.discountAmount;
          return {
            ...item,
            quantity: newQty,
            totalPrice: Math.max(0, rawTotal - disc),
          };
        }
        return item;
      })
    );
  };

  const updateCartItemNotes = (cartItemId: string, notes: string) => {
    setCart((prev) =>
      prev.map((item) => (item.id === cartItemId ? { ...item, itemNotes: notes } : item))
    );
  };

  const applyCartItemDiscount = (cartItemId: string, discountPercent: number, discountAmount: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id === cartItemId) {
          const rawTotal = item.unitPrice * item.quantity;
          const disc = discountPercent > 0 ? (rawTotal * discountPercent) / 100 : discountAmount;
          return {
            ...item,
            discountPercent,
            discountAmount: disc,
            totalPrice: Math.max(0, rawTotal - disc),
          };
        }
        return item;
      })
    );
  };

  const removeFromCart = (cartItemId: string) => {
    if (soundEnabled) playPOSSound('delete');
    setCart((prev) => prev.filter((item) => item.id !== cartItemId));
  };

  const clearCart = () => {
    setCart([]);
    setSelectedCustomer(null);
    setSelectedTable(null);
    setSelectedStaff(null);
  };

  // Process Payment & Create Order
  const processPayment = (
    paymentMethod: PaymentMethod,
    cashReceived?: number,
    notes?: string,
    completionEstimate?: string,
    channel?: string,
    dropOffDate?: string,
    completionDate?: string,
    extraOptions?: {
      vehiclePlate?: string;
      vehicleModel?: string;
      assignedCrew?: string[];
      storageRack?: string;
      isSplitBill?: boolean;
      splitBillIndex?: number;
      parentOrderId?: string;
      splitAmount?: number;
      paymentTender?: {clientPaymentId:string;method:PaymentMethod;amount:number;createdAt:string};
      splitItems?: CartItem[];
      skipClearCart?: boolean;
    }
  ): Order | null => {
    if (cart.length === 0) return null;
    const priorSplit=extraOptions?.paymentTender&&extraOptions.parentOrderId?orders.find(order=>order.id===extraOptions.parentOrderId):null;
    if(priorSplit&&extraOptions?.paymentTender){
      const tender=extraOptions.paymentTender;
      if(priorSplit.paymentTenders?.some(payment=>payment.clientPaymentId===tender.clientPaymentId))return priorSplit;
      const paymentTenders=[...(priorSplit.paymentTenders||[]),tender];
      const collected=paymentTenders.reduce((sum,payment)=>sum+payment.amount,0);
      if(collected>priorSplit.total+0.01)throw new Error('TENDER_EXCEEDS_BALANCE');
      const updated:Order={...priorSplit,paymentTenders,paymentStatus:collected>=priorSplit.total-0.01?'PAID':'PENDING'};
      enqueueSync(tenant.businessId,orderToPayload(updated,currentUser.role));
      setOrders(previous=>previous.map(order=>order.id===updated.id?updated:order));
      setSyncStatus(financialStatus(tenant.businessId));void runSync(syncTarget);
      if(!extraOptions.skipClearCart)clearCart();
      return updated;
    }
    if(extraOptions?.paymentTender&&extraOptions.parentOrderId&&!priorSplit)throw new Error('SPLIT_ORDER_NOT_LOADED');

    const isSplit = !!extraOptions?.isSplitBill;
    const splitAmount = extraOptions?.splitAmount;
    const splitItems = extraOptions?.splitItems;
    const skipClear = !!extraOptions?.skipClearCart;

    const effectiveItems = splitItems && splitItems.length > 0 ? splitItems : [...cart];
    if (isFreePlan(settings.subscription) && effectiveItems.some(item=>!freeProductAllowed(settings.subscription?.freeSelection,item.productId,activeSector))) throw new Error('FREE_PRODUCT_LOCKED');
    const subtotal = effectiveItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const taxTotal = settings.enableTax ? Math.round((subtotal * settings.taxRate) / 100) : 0;
    const serviceChargeTotal = settings.enableService ? Math.round((subtotal * settings.serviceRate) / 100) : 0;
    const grandTotal = splitAmount !== undefined && !extraOptions?.paymentTender ? splitAmount : (subtotal + taxTotal + serviceChargeTotal);

    let changeAmount = 0;
    if (paymentMethod === 'CASH' && cashReceived) {
      changeAmount = Math.max(0, cashReceived - grandTotal);
    }

    const invoiceNum = generateInvoiceNumber(orders.length);

    const nowFormatted = new Date().toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const isLaundry = settings.businessSector === 'LAUNDRY';
    const isCarwash = settings.businessSector === 'CARWASH';
    const isFnb = settings.businessSector === 'FNB';
    const laundryDefaultCompletion = isLaundry ? 'Besok, 16:00 WIB' : undefined;

    const newOrder: Order = {
      id: newId('sale'),
      invoiceNumber: invoiceNum,
      orderNumber: orders.length + 1,
      branchId: /^[0-9a-f-]{36}$/i.test(settings.activeBranchId || '') ? settings.activeBranchId : undefined,
      date: new Date().toISOString(),
      items: effectiveItems,
      orderType,
      onlineChannel: (orderType === 'ONLINE' || orderType === 'DELIVERY') ? channel : undefined,
      tableId: selectedTable?.id,
      tableName: selectedTable?.name,
      customer: selectedCustomer || undefined,
      servedByStaffId: selectedStaff?.id,
      servedByStaffName: selectedStaff?.name || shift.cashierName,
      subtotal: subtotal + effectiveItems.reduce((sum,item)=>sum+item.discountAmount,0),
      discountTotal: effectiveItems.reduce((sum, i) => sum + i.discountAmount, 0),
      taxTotal,
      serviceChargeTotal,
      total: grandTotal,
      paymentMethod,
      paymentStatus: extraOptions?.paymentTender&&extraOptions.paymentTender.amount<grandTotal?'PENDING':'PAID',
      ...(extraOptions?.paymentTender?{paymentTenders:[extraOptions.paymentTender]}:{}),
      cashReceived,
      changeAmount,
      qrisRef: paymentMethod === 'QRIS' ? `QRIS-${Math.floor(10000000 + Math.random() * 90000000)}` : undefined,
      cashierName: shift.cashierName,
      shiftId: shift.id,
      status: 'COMPLETED',
      notes,
      dropOffDate: dropOffDate || (isLaundry ? nowFormatted : undefined),
      completionDate: completionDate || completionEstimate || laundryDefaultCompletion,
      completionEstimate: completionEstimate || completionDate || laundryDefaultCompletion,
      laundryStatus: isLaundry ? 'PROSES_CUCI' : undefined,
      laundryStage: isLaundry ? 'CUCI' : undefined,
      storageRack: extraOptions?.storageRack,
      vehiclePlate: extraOptions?.vehiclePlate,
      vehicleModel: extraOptions?.vehicleModel,
      assignedCrew: extraOptions?.assignedCrew,
      carwashStage: isCarwash ? 'CUCI_BUSA' : undefined,
      isSplitBill: extraOptions?.isSplitBill,
      splitBillIndex: extraOptions?.splitBillIndex,
      parentOrderId: extraOptions?.parentOrderId,
      businessSector: settings.businessSector,
      userId: currentUser.id,
    };

    // Persist the financial event before changing any visible POS state. If
    // the browser cannot store the outbox, do not present a completed sale.
    try { enqueueSync(tenant.businessId, orderToPayload(newOrder, currentUser.role)); }
    catch (error) {
      setSyncStatus({...getSyncStatus(tenant.businessId),lastError:error instanceof Error?error.message:'LOCAL_QUEUE_WRITE_FAILED',failures:1});
      window.alert('Transaksi belum disimpan. Ruang penyimpanan browser bermasalah; jangan tutup halaman dan hubungi admin.');
      return null;
    }

    // Auto-create KDS Ticket if F&B sector
    if (isFnb) {
      const kdsTicket: KDSTicket = {
        id: newId('kds'),
        orderId: newOrder.id,
        orderNumber: newOrder.orderNumber,
        tableName: newOrder.tableName || (newOrder.orderType === 'DINE_IN' ? 'Meja 01' : 'Takeaway / Kasir'),
        orderType: newOrder.orderType,
        items: newOrder.items.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          variantName: i.variantName,
          selectedModifiers: i.selectedModifiers,
          notes: i.itemNotes,
          isCompleted: false,
        })),
        notes: newOrder.notes,
        createdAt: newOrder.date,
        status: 'PENDING',
      };
      setKdsTickets((prev) => [kdsTicket, ...prev]);
    }

    // Auto-create Carwash Queue item if Carwash sector
    if (isCarwash && (extraOptions?.vehiclePlate || newOrder.tableName)) {
      const queueItem: CarwashQueueItem = {
        id: newId('cwq'),
        orderId: newOrder.id,
        vehiclePlate: extraOptions?.vehiclePlate || 'B 1000 POS',
        vehicleModel: extraOptions?.vehicleModel || 'Kendaraan Tamu',
        customerName: newOrder.customer?.name || 'Pelanggan Walk-In',
        customerPhone: newOrder.customer?.phone || '',
        serviceName: newOrder.items[0]?.name || 'Cuci Kendaraan',
        assignedBayId: selectedTable?.id,
        assignedBayName: selectedTable?.name || 'Bay Cuci',
        assignedCrew: extraOptions?.assignedCrew || (selectedStaff ? [selectedStaff.name] : ['Operator']),
        stage: 'CUCI_BUSA',
        enteredAt: newOrder.date,
        notes: newOrder.notes,
      };
      setCarwashQueue((prev) => [queueItem, ...prev]);
    }

    // Track Dual-Event to PostHog Telemetry (Non-PII)
    posthogTelemetry.trackTransactionCompleted({
      transactionId: newOrder.id,
      totalAmount: newOrder.total,
      itemCount: newOrder.items.reduce((s, i) => s + i.quantity, 0),
      paymentMethod: newOrder.paymentMethod,
      orderType: newOrder.orderType,
      tenantId: storeOwnerId,
      userRole: currentUser.role,
    });

    // 1. Update Product Stock & Add Inventory Log
    // Everything is computed up-front so the state updaters below stay pure
    // (React may invoke an updater more than once — side effects inside them
    // would duplicate the logs and double-deduct raw material stock).
    const shouldDeductStock = !isSplit || !!extraOptions?.paymentTender || (splitItems && splitItems.length > 0) || (extraOptions?.splitBillIndex === 1);
    const itemsForStock = splitItems && splitItems.length > 0 ? splitItems : cart;

    const soldQtyByProduct = new Map<string, number>();
    if (shouldDeductStock) {
      itemsForStock.forEach((item) => {
        soldQtyByProduct.set(item.productId, (soldQtyByProduct.get(item.productId) || 0) + item.quantity);
      });
    }

    const newLogs: InventoryLog[] = [];
    const rawDeductions = new Map<string, number>();
    const logTimestamp = new Date().toISOString();

    products.forEach((p) => {
      const totalQtySold = soldQtyByProduct.get(p.id);
      if (!totalQtySold) return;

      newLogs.push({
        id: newId('log'),
        productId: p.id,
        productName: p.name,
        type: 'SALE',
        quantity: totalQtySold,
        previousStock: p.stock,
        newStock: Math.max(0, p.stock - totalQtySold),
        reason: `Penjualan ${invoiceNum}`,
        timestamp: logTimestamp,
        user: shift.cashierName,
        businessSector: settings.businessSector,
      });

      // Deduct linked raw material stock item (Recipe Yield) if configured
      if (p.linkedStockItemId) {
        const rawDeductQty = (p.recipeQty || 1) * totalQtySold;
        const stockItem = stockItems.find((s) => s.id === p.linkedStockItemId);
        if (stockItem) {
          const alreadyDeducted = rawDeductions.get(stockItem.id) || 0;
          const previousStock = Math.max(0, stockItem.stock - alreadyDeducted);
          rawDeductions.set(stockItem.id, alreadyDeducted + rawDeductQty);

          newLogs.push({
            id: newId('log'),
            productId: stockItem.id,
            productName: `[Bahan Baku] ${stockItem.name}`,
            type: 'SALE',
            quantity: rawDeductQty,
            previousStock,
            newStock: Math.max(0, previousStock - rawDeductQty),
            reason: `Pengurangan Bahan Baku Trx ${invoiceNum} (${p.name})`,
            timestamp: logTimestamp,
            user: shift.cashierName,
            businessSector: settings.businessSector,
          });
        }
      }

      // Deduct multi-ingredient Bill of Materials (recipeIngredients) if configured
      if (p.recipeIngredients && p.recipeIngredients.length > 0) {
        p.recipeIngredients.forEach((ing) => {
          const rawDeductQty = ing.quantity * totalQtySold;
          const stockItem = stockItems.find((s) => s.id === ing.ingredientId);
          if (stockItem) {
            const alreadyDeducted = rawDeductions.get(stockItem.id) || 0;
            const previousStock = Math.max(0, stockItem.stock - alreadyDeducted);
            rawDeductions.set(stockItem.id, alreadyDeducted + rawDeductQty);

            newLogs.push({
              id: newId('log'),
              productId: stockItem.id,
              productName: `[Bahan Baku] ${stockItem.name}`,
              type: 'SALE',
              quantity: rawDeductQty,
              previousStock,
              newStock: Math.max(0, previousStock - rawDeductQty),
              reason: `Pengurangan Resep BOM Trx ${invoiceNum} (${p.name}: ${ing.quantity} ${ing.unit} x ${totalQtySold})`,
              timestamp: logTimestamp,
              user: shift.cashierName,
              businessSector: settings.businessSector,
            });
          }
        });
      }
    });

    setProducts((prevProducts) =>
      prevProducts.map((p) => {
        const totalQtySold = soldQtyByProduct.get(p.id);
        return totalQtySold ? { ...p, stock: Math.max(0, p.stock - totalQtySold) } : p;
      })
    );

    if (rawDeductions.size > 0) {
      setStockItems((prevStockItems) =>
        prevStockItems.map((s) => {
          const deduct = rawDeductions.get(s.id);
          return deduct
            ? { ...s, stock: Math.max(0, s.stock - deduct), lastUpdated: logTimestamp }
            : s;
        })
      );
    }

    if (newLogs.length > 0) {
      setInventoryLogs((logs) => [...newLogs, ...logs]);
    }

    // 2. Update Customer Points & Total Spent if customer selected
    if (selectedCustomer) {
      const pointsEarned = Math.floor(grandTotal / settings.loyaltyEarnRate);
      setCustomers((prevCusts) =>
        prevCusts.map((c) => {
          if (c.id === selectedCustomer.id) {
            const newTotalSpent = c.totalSpent + grandTotal;
            const newPoints = c.points + pointsEarned;
            let tier = c.tier;
            if (newTotalSpent >= 5000000) tier = 'PLATINUM';
            else if (newTotalSpent >= 2500000) tier = 'GOLD';
            else if (newTotalSpent >= 1000000) tier = 'SILVER';

            return {
              ...c,
              points: newPoints,
              totalSpent: newTotalSpent,
              visitCount: c.visitCount + 1,
              lastVisit: new Date().toISOString().split('T')[0],
              tier,
            };
          }
          return c;
        })
      );
    }

    // 3. Update Table status if DINE_IN
    if (selectedTable && !skipClear) {
      setTables((prevTables) =>
        prevTables.map((t) => (t.id === selectedTable.id ? { ...t, status: 'AVAILABLE', currentOrderId: undefined } : t))
      );
    }

    // 5. Add Order to list
    setOrders((prevOrders) => [newOrder, ...prevOrders]);

    // The durable outbox was written before any local sale effects above.
    setSyncStatus(getSyncStatus(tenant.businessId));
    void runSync(syncTarget);

    if (soundEnabled) playPOSSound('payment_success');

    if (!skipClear) {
      clearCart();
    }
    return newOrder;
  };

  // Void / Cancel Order
  const voidOrder = (orderId: string, reason = 'Kesalahan Input Kasir') => {
    const targetOrder = orders.find((o) => o.id === orderId);
    if (!targetOrder || targetOrder.status === 'VOID') return;

    try {
      enqueueSync(tenant.businessId,
        orderToPayload({ ...targetOrder, status: 'VOID', paymentStatus: 'CANCELLED' }, currentUser.role));
    } catch (error) {
      setSyncStatus({...getSyncStatus(tenant.businessId),lastError:error instanceof Error?error.message:'LOCAL_QUEUE_WRITE_FAILED',failures:1});
      window.alert('Pembatalan belum disimpan. Periksa penyimpanan browser sebelum mencoba lagi.');
      return;
    }

    // 1. Update order status to VOID and payment status to CANCELLED
    setOrders((prevOrders) =>
      prevOrders.map((o) => {
        if (o.id === orderId) {
          return {
            ...o,
            status: 'VOID',
            paymentStatus: 'CANCELLED',
            voidReason: reason,
            notes: o.notes ? `${o.notes} (BATAL/VOID: ${reason})` : `BATAL/VOID: ${reason}`,
          };
        }
        return o;
      })
    );

    // 1b. Antrikan pembatalannya.
    //
    // Void selalu datang SETELAH transaksinya tersimpan, jadi kiriman ini akan
    // menabrak UNIQUE (tenant_id, client_txn_id) di server. Server sengaja
    // memperlakukan tabrakan berstatus CANCELLED sebagai pembaruan, bukan
    // duplikat — kalau tidak, uang yang sudah dikembalikan ke pelanggan akan
    // terus terhitung sebagai omzet di admin panel.
    setSyncStatus(getSyncStatus(tenant.businessId));
    void runSync(syncTarget);

    // 2. Restore Product Stock & Raw Materials, and Create Inventory Refund Log
    const returnedQtyByProduct = new Map<string, number>();
    targetOrder.items.forEach((item) => {
      returnedQtyByProduct.set(
        item.productId,
        (returnedQtyByProduct.get(item.productId) || 0) + item.quantity
      );
    });

    const refundTimestamp = new Date().toISOString();
    const refundLogs: InventoryLog[] = [];
    const rawRestores = new Map<string, number>();

    products.forEach((p) => {
      const totalQtyReturned = returnedQtyByProduct.get(p.id);
      if (!totalQtyReturned) return;

      refundLogs.push({
        id: newId('log'),
        productId: p.id,
        productName: p.name,
        type: 'REFUND',
        quantity: totalQtyReturned,
        previousStock: p.stock,
        newStock: p.stock + totalQtyReturned,
        reason: `Void Trx ${targetOrder.id}: ${reason}`,
        timestamp: refundTimestamp,
        user: shift.cashierName,
      });

      // Restore linked raw material if configured
      if (p.linkedStockItemId) {
        const rawRestoreQty = (p.recipeQty || 1) * totalQtyReturned;
        const stockItem = stockItems.find((s) => s.id === p.linkedStockItemId);
        if (stockItem) {
          const alreadyRestored = rawRestores.get(stockItem.id) || 0;
          const previousStock = stockItem.stock + alreadyRestored;
          rawRestores.set(stockItem.id, alreadyRestored + rawRestoreQty);

          refundLogs.push({
            id: newId('log'),
            productId: stockItem.id,
            productName: `[Bahan Baku] ${stockItem.name}`,
            type: 'REFUND',
            quantity: rawRestoreQty,
            previousStock,
            newStock: previousStock + rawRestoreQty,
            reason: `Void Trx ${targetOrder.id}: Pengembalian Bahan Baku (${p.name})`,
            timestamp: refundTimestamp,
            user: shift.cashierName,
            businessSector: settings.businessSector,
          });
        }
      }

      // Restore multi-ingredient BOM if configured
      if (p.recipeIngredients && p.recipeIngredients.length > 0) {
        p.recipeIngredients.forEach((ing) => {
          const rawRestoreQty = ing.quantity * totalQtyReturned;
          const stockItem = stockItems.find((s) => s.id === ing.ingredientId);
          if (stockItem) {
            const alreadyRestored = rawRestores.get(stockItem.id) || 0;
            const previousStock = stockItem.stock + alreadyRestored;
            rawRestores.set(stockItem.id, alreadyRestored + rawRestoreQty);

            refundLogs.push({
              id: newId('log'),
              productId: stockItem.id,
              productName: `[Bahan Baku] ${stockItem.name}`,
              type: 'REFUND',
              quantity: rawRestoreQty,
              previousStock,
              newStock: previousStock + rawRestoreQty,
              reason: `Void Trx ${targetOrder.id}: Pengembalian Resep BOM (${p.name}: ${ing.quantity} ${ing.unit} x ${totalQtyReturned})`,
              timestamp: refundTimestamp,
              user: shift.cashierName,
              businessSector: settings.businessSector,
            });
          }
        });
      }
    });

    setProducts((prevProducts) =>
      prevProducts.map((p) => {
        const totalQtyReturned = returnedQtyByProduct.get(p.id);
        return totalQtyReturned ? { ...p, stock: p.stock + totalQtyReturned } : p;
      })
    );

    if (rawRestores.size > 0) {
      setStockItems((prevStockItems) =>
        prevStockItems.map((s) => {
          const restore = rawRestores.get(s.id);
          return restore
            ? { ...s, stock: s.stock + restore, lastUpdated: refundTimestamp }
            : s;
        })
      );
    }

    if (refundLogs.length > 0) {
      setInventoryLogs((logs) => [...refundLogs, ...logs]);
    }

    if (soundEnabled) playPOSSound('delete');
  };

  // Retur / Refund Item Parsial
  const refundOrderItems = async (
    orderId: string,
    refundItems: { cartItemId: string; quantity: number; reason: string }[],
    refundMethod: 'CASH' | 'ORIGINAL_METHOD' = 'CASH'
  ): Promise<OrderRefund | null> => {
    const targetOrder = orders.find((o) => o.id === orderId);
    if (!targetOrder || targetOrder.status === 'VOID' || refundItems.length === 0) return null;
    if(pendingRefund(tenant.businessId,orderId)){
      void runSync(syncTarget,true);
      throw new Error('Refund sebelumnya masih menunggu konfirmasi cloud. Tunggu sinkronisasi sebelum membuat refund baru.');
    }

    const refundTimestamp = new Date().toISOString();
    const refundId = newId('refund');

    let subtotalRefund = 0;
    const orderRefundItems: OrderRefundItem[] = [];
    const returnedQtyByProduct = new Map<string, number>();

    // Validate and calculate refund amounts
    refundItems.forEach((rf) => {
      const lineItem = targetOrder.items.find((i) => i.id === rf.cartItemId);
      if (!lineItem || rf.quantity <= 0) return;

      const alreadyRefunded = lineItem.refundedQuantity || 0;
      const maxRefundable = Math.max(0, lineItem.quantity - alreadyRefunded);
      const qtyToRefund = Math.min(rf.quantity, maxRefundable);
      if (qtyToRefund <= 0) return;

      // Unit refund is proportional to line item total price divided by line quantity
      const unitRefund = lineItem.totalPrice / lineItem.quantity;
      const lineRefundTotal = Math.round(unitRefund * qtyToRefund);
      subtotalRefund += lineRefundTotal;

      orderRefundItems.push({
        cartItemId: lineItem.id,
        productId: lineItem.productId,
        productName: lineItem.name,
        quantity: qtyToRefund,
        unitPrice: lineItem.unitPrice,
        totalRefundAmount: lineRefundTotal,
        reason: rf.reason || 'Retur Barang Pelanggan',
      });

      returnedQtyByProduct.set(
        lineItem.productId,
        (returnedQtyByProduct.get(lineItem.productId) || 0) + qtyToRefund
      );
    });

    if (orderRefundItems.length === 0) return null;

    // Calculate tax & service charge refund proportionally if applicable
    const subtotalOriginal = targetOrder.subtotal || targetOrder.total;
    const ratio = subtotalOriginal > 0 ? subtotalRefund / subtotalOriginal : 0;
    const taxRefund = targetOrder.taxTotal > 0 ? Math.round(targetOrder.taxTotal * ratio) : 0;
    const serviceRefund = targetOrder.serviceChargeTotal > 0 ? Math.round(targetOrder.serviceChargeTotal * ratio) : 0;
    const command={clientRefundId:refundId,occurredAt:refundTimestamp,refundMethod,
      reason:refundItems.map(item=>item.reason).filter(Boolean).join(', ')||'Retur item',
      items:orderRefundItems.map(item=>({clientItemId:item.cartItemId,quantity:item.quantity}))};
    enqueueCashCommand(tenant.businessId,{action:'refund',body:{sector:activeSector,outletId:targetOrder.branchId||'',
      clientEventId:refundId,clientTxnId:targetOrder.id,refund:command}});
    await runSync(syncTarget,true);
    const acknowledged=refundAcknowledgment(tenant.businessId,refundId);
    if(!acknowledged)throw new Error('Refund menunggu konfirmasi cloud; perintah tersimpan dan akan dicoba kembali dengan ID yang sama.');
    subtotalRefund=Number(acknowledged.subtotal);
    const authoritativeTax=Number(acknowledged.tax),authoritativeService=Number(acknowledged.service);
    const totalRefund=Number(acknowledged.amount);
    window.dispatchEvent(new Event('financial-updated'));

    const newRefund: OrderRefund = {
      id: refundId,
      orderId: targetOrder.id,
      orderNumber: targetOrder.orderNumber,
      timestamp: refundTimestamp,
      items: orderRefundItems,
      subtotalRefund,
      taxRefund:authoritativeTax,
      serviceRefund:authoritativeService,
      totalRefund,
      refundMethod,
      reason: refundItems.map((r) => r.reason).filter(Boolean).join(', ') || 'Retur Parsial Item',
      cashierName: shift.cashierName,
      shiftId: shift.id,
    };

    // 1. Update Order: cartItems refundedQuantity, order.refunds, and order.refundTotal
    setOrders((prevOrders) =>
      prevOrders.map((o) => {
        if (o.id === orderId) {
          const updatedItems = o.items.map((it) => {
            const rfItem = orderRefundItems.find((r) => r.cartItemId === it.id);
            if (!rfItem) return it;
            return {
              ...it,
              refundedQuantity: Math.max(it.refundedQuantity||0,(targetOrder.items.find(line=>line.id===it.id)?.refundedQuantity||0)+rfItem.quantity),
            };
          });

          const currentRefunds = o.refunds || [];
          const newRefundTotal = Math.max(o.refundTotal||0,(targetOrder.refundTotal||0)+totalRefund);

          // Check if all items in order are now 100% refunded
          const allRefunded = updatedItems.every(
            (it) => (it.refundedQuantity || 0) >= it.quantity
          );

          return {
            ...o,
            items: updatedItems,
            refunds: currentRefunds.some(refund=>refund.id===newRefund.id)?currentRefunds:[newRefund, ...currentRefunds],
            refundTotal: newRefundTotal,
            status: o.status,
            voidReason: allRefunded ? `Semua item diretur (${newRefund.reason})` : o.voidReason,
          };
        }
        return o;
      })
    );

    // 2. Restore Product Stock & Raw Materials
    const refundLogs: InventoryLog[] = [];
    const rawRestores = new Map<string, number>();

    products.forEach((p) => {
      const totalQtyReturned = returnedQtyByProduct.get(p.id);
      if (!totalQtyReturned) return;

      refundLogs.push({
        id: newId('log'),
        productId: p.id,
        productName: p.name,
        type: 'REFUND',
        quantity: totalQtyReturned,
        previousStock: p.stock,
        newStock: p.stock + totalQtyReturned,
        reason: `Retur Parsial Trx ${targetOrder.id}: ${newRefund.reason}`,
        timestamp: refundTimestamp,
        user: shift.cashierName,
      });

      // Restore linked raw material if configured
      if (p.linkedStockItemId) {
        const rawRestoreQty = (p.recipeQty || 1) * totalQtyReturned;
        const stockItem = stockItems.find((s) => s.id === p.linkedStockItemId);
        if (stockItem) {
          const alreadyRestored = rawRestores.get(stockItem.id) || 0;
          const previousStock = stockItem.stock + alreadyRestored;
          rawRestores.set(stockItem.id, alreadyRestored + rawRestoreQty);

          refundLogs.push({
            id: newId('log'),
            productId: stockItem.id,
            productName: `[Bahan Baku] ${stockItem.name}`,
            type: 'REFUND',
            quantity: rawRestoreQty,
            previousStock,
            newStock: previousStock + rawRestoreQty,
            reason: `Retur Parsial Trx ${targetOrder.id}: Pengembalian Bahan Baku (${p.name})`,
            timestamp: refundTimestamp,
            user: shift.cashierName,
            businessSector: settings.businessSector,
          });
        }
      }

      // Restore multi-ingredient BOM if configured
      if (p.recipeIngredients && p.recipeIngredients.length > 0) {
        p.recipeIngredients.forEach((ing) => {
          const rawRestoreQty = ing.quantity * totalQtyReturned;
          const stockItem = stockItems.find((s) => s.id === ing.ingredientId);
          if (stockItem) {
            const alreadyRestored = rawRestores.get(stockItem.id) || 0;
            const previousStock = stockItem.stock + alreadyRestored;
            rawRestores.set(stockItem.id, alreadyRestored + rawRestoreQty);

            refundLogs.push({
              id: newId('log'),
              productId: stockItem.id,
              productName: `[Bahan Baku] ${stockItem.name}`,
              type: 'REFUND',
              quantity: rawRestoreQty,
              previousStock,
              newStock: previousStock + rawRestoreQty,
              reason: `Retur Parsial Trx ${targetOrder.id}: Pengembalian Resep BOM (${p.name}: ${ing.quantity} ${ing.unit} x ${totalQtyReturned})`,
              timestamp: refundTimestamp,
              user: shift.cashierName,
              businessSector: settings.businessSector,
            });
          }
        });
      }
    });

    setProducts((prevProducts) =>
      prevProducts.map((p) => {
        const totalQtyReturned = returnedQtyByProduct.get(p.id);
        return totalQtyReturned ? { ...p, stock: p.stock + totalQtyReturned } : p;
      })
    );

    if (rawRestores.size > 0) {
      setStockItems((prevStockItems) =>
        prevStockItems.map((s) => {
          const restore = rawRestores.get(s.id);
          return restore
            ? { ...s, stock: s.stock + restore, lastUpdated: refundTimestamp }
            : s;
        })
      );
    }

    if (refundLogs.length > 0) {
      setInventoryLogs((logs) => [...refundLogs, ...logs]);
    }

    if (soundEnabled) playPOSSound('delete');

    return newRefund;
  };

  // Hold Order / Save Pending Transaction (Bayar Nanti)
  const holdOrder = (
    notes?: string,
    extraOptions?: {
      dropOffDate?: string;
      completionDate?: string;
      storageRack?: string;
      vehiclePlate?: string;
      vehicleModel?: string;
      assignedCrew?: string[];
      isSplitBill?: boolean;
    }
  ): Order | null => {
    if (cart.length === 0) return null;
    const subtotal = cart.reduce((sum, i) => sum + i.totalPrice, 0);
    const invoiceNum = generateInvoiceNumber(orders.length + heldOrders.length);
    const discountTotal = cart.reduce((s, i) => s + i.discountAmount, 0);
    const taxTotal = settings.enableTax ? Math.round((subtotal * settings.taxRate) / 100) : 0;
    const serviceChargeTotal = settings.enableService ? Math.round((subtotal * settings.serviceRate) / 100) : 0;
    const grandTotal = Math.max(0, subtotal + taxTotal + serviceChargeTotal);

    const isLaundry = settings.businessSector === 'LAUNDRY';
    const isCarwash = settings.businessSector === 'CARWASH';
    const isFnb = settings.businessSector === 'FNB';

    const nowFormatted = new Date().toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const laundryDefaultCompletion = isLaundry ? 'Besok, 16:00 WIB' : undefined;

    const held: Order = {
      id: newId('hold'),
      invoiceNumber: invoiceNum,
      orderNumber: orders.length + heldOrders.length + 1,
      date: new Date().toISOString(),
      items: [...cart],
      orderType,
      tableId: selectedTable?.id,
      tableName: selectedTable?.name,
      customer: selectedCustomer || undefined,
      servedByStaffId: selectedStaff?.id,
      servedByStaffName: selectedStaff?.name || shift.cashierName,
      subtotal: subtotal + discountTotal,
      discountTotal,
      taxTotal,
      serviceChargeTotal,
      total: grandTotal,
      paymentMethod: 'CASH',
      paymentStatus: 'PENDING',
      cashierName: shift.cashierName,
      shiftId: shift.id,
      status: 'HOLD',
      notes,
      dropOffDate: extraOptions?.dropOffDate || (isLaundry ? nowFormatted : undefined),
      completionDate: extraOptions?.completionDate || laundryDefaultCompletion,
      completionEstimate: extraOptions?.completionDate || laundryDefaultCompletion,
      laundryStatus: isLaundry ? 'PROSES_CUCI' : undefined,
      laundryStage: isLaundry ? 'ANTRIAN' : undefined,
      storageRack: extraOptions?.storageRack,
      vehiclePlate: extraOptions?.vehiclePlate,
      vehicleModel: extraOptions?.vehicleModel,
      assignedCrew: extraOptions?.assignedCrew,
      carwashStage: isCarwash ? 'ANTRIAN_BAY' : undefined,
      isSplitBill: extraOptions?.isSplitBill,
      businessSector: settings.businessSector,
      userId: currentUser.id,
    };

    // Auto-create KDS Ticket if F&B sector so kitchen can start preparing
    if (isFnb) {
      const kdsTicket: KDSTicket = {
        id: newId('kds'),
        orderId: held.id,
        orderNumber: held.orderNumber,
        tableName: held.tableName || (held.orderType === 'DINE_IN' ? 'Meja 01' : 'Takeaway / Kasir'),
        orderType: held.orderType,
        items: held.items.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          variantName: i.variantName,
          selectedModifiers: i.selectedModifiers,
          notes: i.itemNotes,
          isCompleted: false,
        })),
        notes: held.notes,
        createdAt: held.date,
        status: 'PENDING',
      };
      setKdsTickets((prev) => [kdsTicket, ...prev]);
    }

    // Auto-create Carwash Queue item if Carwash sector
    if (isCarwash && (extraOptions?.vehiclePlate || held.tableName)) {
      const queueItem: CarwashQueueItem = {
        id: newId('cwq'),
        orderId: held.id,
        vehiclePlate: extraOptions?.vehiclePlate || 'B 1000 POS',
        vehicleModel: extraOptions?.vehicleModel || 'Kendaraan Tamu',
        customerName: held.customer?.name || 'Pelanggan Walk-In',
        customerPhone: held.customer?.phone || '',
        serviceName: held.items[0]?.name || 'Cuci Kendaraan',
        assignedBayId: selectedTable?.id,
        assignedBayName: selectedTable?.name || 'Bay Cuci',
        assignedCrew: extraOptions?.assignedCrew || (selectedStaff ? [selectedStaff.name] : ['Operator']),
        stage: 'ANTRIAN_BAY',
        enteredAt: held.date,
        notes: held.notes,
      };
      setCarwashQueue((prev) => [queueItem, ...prev]);
    }

    if (selectedTable) {
      setTables((prev) =>
        prev.map((t) =>
          t.id === selectedTable.id
            ? {
                ...t,
                status: 'OCCUPIED',
                currentOrderId: held.id,
                activeOrder: {
                  id: held.id,
                  itemsCount: held.items.length,
                  totalAmount: held.total,
                  startTime: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                },
                customerName: held.customer?.name,
              }
            : t
        )
      );
    }

    setHeldOrders((prev) => [held, ...prev]);
    setOrders((prev) => [held, ...prev]);
    clearCart();
    setSelectedTable(null);

    return held;
  };

  const recallHoldOrder = (orderId: string) => {
    const target = heldOrders.find((o) => o.id === orderId) || orders.find((o) => o.id === orderId && o.status === 'HOLD');
    if (!target) return;

    setCart(target.items);
    setOrderType(target.orderType);
    if (target.customer) setSelectedCustomer(target.customer);
    if (target.tableId) {
      const tbl = tables.find((t) => t.id === target.tableId);
      if (tbl) setSelectedTable(tbl);
    }

    setHeldOrders((prev) => prev.filter((o) => o.id !== orderId));
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
    setActiveTab('pos');
  };

  const cancelHoldOrder = (orderId: string) => {
    setHeldOrders((prev) => prev.filter((o) => o.id !== orderId));
    setOrders((prev) => prev.filter((o) => o.id !== orderId || o.paymentStatus === 'PAID'));
    setTables((prev) =>
      prev.map((t) =>
        t.currentOrderId === orderId
          ? { ...t, status: 'AVAILABLE', currentOrderId: undefined, activeOrder: undefined, customerName: undefined }
          : t
      )
    );
  };

  // Selesaikan pembayaran transaksi yang sebelumnya disimpan (Bayar Nanti / Belum Lunas)
  const payPendingOrder = (
    orderId: string,
    paymentMethod: PaymentMethod,
    cashReceived?: number,
    qrisRef?: string
  ): Order | null => {
    const targetOrder = orders.find((o) => o.id === orderId) || heldOrders.find((o) => o.id === orderId);
    if (!targetOrder) return null;

    if(targetOrder.paymentStatus==='PAID'||targetOrder.status==='VOID')return null;
    const paidSoFar=(targetOrder.paymentTenders||[]).reduce((sum,tender)=>sum+tender.amount,0);
    const remaining=Math.max(0,targetOrder.total-paidSoFar);
    const changeAmount = Math.max(0, (cashReceived || 0) - remaining);

    const updatedOrder: Order = {
      ...targetOrder,
      paymentMethod,
      paymentStatus: 'PAID',
      status: 'COMPLETED',
      cashReceived,
      changeAmount,
      ...(targetOrder.paymentTenders?.length?{paymentTenders:[...targetOrder.paymentTenders,{
        clientPaymentId:newId(),method:paymentMethod,amount:remaining,createdAt:new Date().toISOString(),
      }]}:{}),
      qrisRef: paymentMethod === 'QRIS' ? (qrisRef || `QRIS-${Math.floor(10000000 + Math.random() * 90000000)}`) : undefined,
    };

    try { enqueueSync(tenant.businessId,orderToPayload(updatedOrder,currentUser.role)); }
    catch (error) {
      setSyncStatus({...getSyncStatus(tenant.businessId),lastError:error instanceof Error?error.message:'LOCAL_QUEUE_WRITE_FAILED',failures:1});
      window.alert('Pembayaran belum disimpan. Periksa penyimpanan browser sebelum mencoba lagi.');
      return null;
    }
    setSyncStatus(getSyncStatus(tenant.businessId));
    void runSync(syncTarget);

    // Update in orders
    setOrders((prev) => {
      const exists = prev.some((o) => o.id === orderId);
      if (exists) {
        return prev.map((o) => (o.id === orderId ? updatedOrder : o));
      }
      return [updatedOrder, ...prev];
    });

    // Remove from heldOrders
    setHeldOrders((prev) => prev.filter((o) => o.id !== orderId));

    // Update table if attached
    if (updatedOrder.tableId) {
      setTables((prev) =>
        prev.map((t) =>
          t.id === updatedOrder.tableId || t.currentOrderId === orderId
            ? { ...t, status: 'AVAILABLE', currentOrderId: undefined, activeOrder: undefined, customerName: undefined }
            : t
        )
      );
    }

    // Telemetry
    posthogTelemetry.trackTransactionCompleted({
      transactionId: updatedOrder.id,
      totalAmount: updatedOrder.total,
      paymentMethod: updatedOrder.paymentMethod,
      itemCount: updatedOrder.items.length,
      orderType: updatedOrder.orderType,
    });

    if (soundEnabled) playPOSSound('payment_success');

    return updatedOrder;
  };

  // Save / Edit Product
  const saveProduct = (product: Product) => {
    // Saving inventory never silently replaces the owner's active Free selection.
    // New products are retained here and must be selected before use in POS.
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === product.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = product;
        return updated;
      }
      return [product, ...prev];
    });
  };

  const deleteProduct = (productId: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== productId));
  };

  const toggleProductAvailability = (productId: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, isAvailable: !p.isAvailable } : p))
    );
    if (soundEnabled) playPOSSound('click');
  };

  const saveCategory = (category: Category) => {
    setCategories((prev) => {
      const idx = prev.findIndex((c) => c.id === category.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = category;
        return updated;
      }
      return [...prev, category];
    });
  };

  const deleteCategory = (categoryId: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== categoryId));
    setProducts((prev) =>
      prev.map((p) => (p.categoryId === categoryId ? { ...p, categoryId: '' } : p))
    );
  };

  const adjustStock = (
    productId: string,
    quantityChange: number,
    type: 'IN' | 'OUT' | 'ADJUSTMENT',
    reason: string
  ) => {
    const target = products.find((p) => p.id === productId);
    if (!target) return;

    const oldStock = target.stock;
    let newStock = oldStock;
    if (type === 'IN') newStock += quantityChange;
    else if (type === 'OUT') newStock = Math.max(0, oldStock - quantityChange);
    else if (type === 'ADJUSTMENT') newStock = quantityChange;

    const log: InventoryLog = {
      id: newId('log'),
      productId: target.id,
      productName: target.name,
      type,
      quantity: quantityChange,
      previousStock: oldStock,
      newStock,
      reason,
      timestamp: new Date().toISOString(),
      user: shift.cashierName,
      businessSector: settings.businessSector,
    };

    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, stock: newStock } : p)));
    setInventoryLogs((prevLogs) => [log, ...prevLogs]);
  };

  const saveCustomer = (customer: Customer) => {
    setCustomers((prev) => {
      const idx = prev.findIndex((c) => c.id === customer.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = customer;
        return updated;
      }
      return [customer, ...prev];
    });
  };

  const saveTable = (table: Table) => {
    setTables((prev) => {
      const idx = prev.findIndex((t) => t.id === table.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = table;
        return updated;
      }
      return [...prev, table];
    });
  };

  const deleteTable = (tableId: string) => {
    setTables((prev) => prev.filter((t) => t.id !== tableId));
    if (selectedTable?.id === tableId) setSelectedTable(null);
    if (soundEnabled) playPOSSound('delete');
  };

  const updateSettings = (newSettings: StoreSettings) => {
    setSettings(newSettings);
  };

  const activateBusinessSector = (sector: BusinessSector, customStoreName?: string) => {
    if (isFreePlan(settings.subscription) && sector !== settings.subscription?.freeSelection?.sector) throw new Error('FREE_SINGLE_BUSINESS');
    const preset = BUSINESS_PRESETS[sector];
    if (!preset) return;

    const uId = storeOwnerId;
    const currentSec = settings.businessSector || 'FNB';
    if(sector!==currentSec){
      // Cancel outgoing hydration before state changes, not just at effect cleanup.
      sharedSync.current?.stop();sharedSync.current=null;
      setSharedSyncStatus({ready:false,pending:0,error:null});
    }

    // 1. Save current sector state to its own scoped storage before switching
    safeSetLocalStorage(getScopedKey('store_settings',uId,currentSec),JSON.stringify(sharedSettings));
    safeSetLocalStorage(getScopedKey('categories', uId, currentSec), JSON.stringify(categories));
    safeSetLocalStorage(getScopedKey('products', uId, currentSec), JSON.stringify(products));
    safeSetLocalStorage(getScopedKey('tables', uId, currentSec), JSON.stringify(tables));
    safeSetLocalStorage(getScopedKey('stock_items', uId, currentSec), JSON.stringify(stockItems));
    safeSetLocalStorage(getScopedKey('orders', uId, currentSec), JSON.stringify(orders.slice(0, 50)));
    safeSetLocalStorage(getScopedKey('held_orders', uId, currentSec), JSON.stringify(heldOrders));
    safeSetLocalStorage(getScopedKey('inventory_logs', uId, currentSec), JSON.stringify(inventoryLogs.slice(0, 50)));
    safeSetLocalStorage(getScopedKey('shift', uId, currentSec), JSON.stringify(shift));
    safeSetLocalStorage(getScopedKey('shift_history', uId, currentSec), JSON.stringify(shiftHistory.slice(0, 30)));
    safeSetLocalStorage(getScopedKey('customers', uId, currentSec), JSON.stringify(customers));
    safeSetLocalStorage(getScopedKey('attendance_logs', uId, currentSec), JSON.stringify(attendanceLogs));
    safeSetLocalStorage(getScopedKey('promo_codes', uId, currentSec), JSON.stringify(promoCodes));
    safeSetLocalStorage(getScopedKey('cash_movements', uId, currentSec), JSON.stringify(cashMovements));
    safeSetLocalStorage(getScopedKey('kds_tickets', uId, currentSec), JSON.stringify(kdsTickets));
    safeSetLocalStorage(getScopedKey('carwash_queue', uId, currentSec), JSON.stringify(carwashQueue));
    safeSetLocalStorage(getScopedKey('bookings', uId, currentSec), JSON.stringify(bookings));
    safeSetLocalStorage(getScopedKey('commission_rules', uId, currentSec), JSON.stringify(commissionRules));
    safeSetLocalStorage(getScopedKey('payroll_slips', uId, currentSec), JSON.stringify(payrollSlips));
    safeSetLocalStorage(getScopedKey('sent_lifecycle_hooks', uId, currentSec), JSON.stringify(sentLifecycleHookIds));

    // 2. Load target sector state
    const targetCategories = loadScopedData<Category[]>('categories', uId, sector, []);
    const targetProducts = loadScopedData('products', uId, sector, []);
    const targetTables = loadScopedData('tables', uId, sector, []);
    const targetStockItems = loadScopedData('stock_items', uId, sector, INITIAL_STOCK_ITEMS);
    const targetOrders = loadScopedData('orders', uId, sector, []);
    const targetHeldOrders = loadScopedData('held_orders', uId, sector, []);
    const targetLogs = loadScopedData('inventory_logs', uId, sector, []);
    const targetShift = loadScopedData('shift', uId, sector, INITIAL_SHIFT);
    const targetShiftHistory = loadScopedData('shift_history', uId, sector, []);
    const targetCustomers = loadScopedData('customers', uId, sector, seedCustomersFor(sector));
    const targetAttendance = loadScopedData('attendance_logs', uId, sector, seedAttendanceFor(sector));
    const targetPromos = loadScopedData('promo_codes', uId, sector, seedPromosFor(sector));
    const targetCashMovements = loadScopedData('cash_movements', uId, sector, []);
    const targetKds = loadScopedData('kds_tickets', uId, sector, []);
    const targetCarwash = loadScopedData('carwash_queue', uId, sector, []);
    const targetBookings = loadScopedData('bookings', uId, sector, []);
    const targetCommission = loadScopedData('commission_rules', uId, sector, []);
    const targetPayrollSlips = loadScopedData('payroll_slips', uId, sector, []);
    const targetLifecycleHooks = loadScopedData('sent_lifecycle_hooks', uId, sector, []);

    const targetSettings=loadScopedData<Partial<StoreSettings>>('store_settings',uId,sector,{});
    const storeName = customStoreName || targetSettings.storeName || preset.defaultStoreName;

    const newSettings: StoreSettings = {
      ...settings,
      ...targetSettings,
      logoUrl: undefined,
      storeName,
      businessSector: sector,
      storeMode: preset.storeMode,
      receiptHeader: `*** ${storeName} ***`,
      receiptFooter: `Terima kasih telah bertransaksi di ${storeName}`,
    };

    setSettings(newSettings);
    setCategories(targetCategories);
    setProducts(targetProducts);
    setTables(targetTables);
    setStockItems(targetStockItems);
    setOrders(targetOrders);
    setHeldOrders(targetHeldOrders);
    setInventoryLogs(targetLogs);
    setShift(targetShift);
    setShiftHistory(targetShiftHistory);
    setCustomers(targetCustomers);
    setAttendanceLogs(targetAttendance);
    setPromoCodes(targetPromos);
    setCashMovements(targetCashMovements);
    setKdsTickets(targetKds);
    setCarwashQueue(targetCarwash);
    setBookings(targetBookings);
    setCommissionRules(targetCommission);
    setPayrollSlips(targetPayrollSlips);
    setSentLifecycleHookIds(targetLifecycleHooks);

    setSelectedCategory(targetCategories[0]?.id || 'ALL');
    clearCart();
    setSearchQuery('');

    if (soundEnabled) playPOSSound('payment_success');
  };

  const startShift = async (cashierName:string,initialCash:number):Promise<Shift> => {
    const response=await fetch('/api/v1/finance/shift/open',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sector:activeSector,outletId:syncTarget.outletId,clientShiftId:newId('shift'),cashierName,initialCash})});
    const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'SHIFT_OPEN_FAILED');
    setShift(data.shift);window.dispatchEvent(new Event('financial-updated'));return data.shift;
  };
  const endShift = async (actualCash:number,notes?:string):Promise<Shift> => {
    await runSync(syncTarget,true);
    const status=financialStatus(tenant.businessId);
    if(status.pending||status.lastError)throw new Error('PENDING_FINANCIAL_SYNC');
    const response=await fetch('/api/v1/finance/shift/close',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sector:activeSector,outletId:syncTarget.outletId,clientShiftId:shift.id,actualCash,notes})});
    const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||'SHIFT_CLOSE_FAILED');
    setShift(data.shift);setShiftHistory(previous=>[data.shift,...previous.filter(row=>row.id!==data.shift.id)]);
    window.dispatchEvent(new Event('financial-updated'));return data.shift;
  };
  const addCashMovement = (type:CashMovementType,category:CashMovementCategory,amount:number,description:string,recipientOrSource?:string):CashMovement=>{
    if(!Number.isFinite(amount)||amount<=0)throw new Error('INVALID_CASH_AMOUNT');
    const movement:CashMovement={id:newId('cash'),type,category,amount:Math.abs(amount),description:description.trim(),
      timestamp:new Date().toISOString(),cashierName:currentUser.name,shiftId:shift.id,businessSector:activeSector,userId:storeOwnerId,
      branchId:syncTarget.outletId,recipientOrSource:recipientOrSource?.trim()};
    enqueueCashCommand(tenant.businessId,cashMovementToCommand(activeSector,movement,syncTarget.outletId!));
    setCashMovements(previous=>[movement,...previous]);setSyncStatus(financialStatus(tenant.businessId));
    void runSync(syncTarget);return movement;
  };
  const deleteCashMovement = (id:string)=>{
    enqueueCashCommand(tenant.businessId,{action:'reverse',body:{sector:activeSector,outletId:syncTarget.outletId!,
      clientEventId:'reverse:'+id,originalEventId:id,reason:'Koreksi mutasi kas oleh owner'}});
    setSyncStatus(financialStatus(tenant.businessId));void runSync(syncTarget);
  };
  const setInitialCash = (amount:number)=>{
    if(!Number.isFinite(amount)||amount<0)throw new Error('INVALID_CASH_AMOUNT');
    // A change to opening cash is an explicit signed correction, preserving history.
    const delta=amount-shift.initialCash;
    if(delta!==0)addCashMovement(delta>0?'CASH_IN':'CASH_OUT','MODAL_AWAL',Math.abs(delta),'Koreksi modal awal shift');
  };

  const updateOrderLaundryStatus = (
    orderId: string,
    status: 'PROSES_CUCI' | 'SELESAI_SIAP_AMBIL' | 'SUDAH_DIAMBIL'
  ) => {
    setOrders((prev) =>
      prev.map((ord) => {
        if (ord.id === orderId) {
          return {
            ...ord,
            laundryStatus: status,
            waNotifiedAt: status === 'SELESAI_SIAP_AMBIL' ? new Date().toISOString() : ord.waNotifiedAt,
          };
        }
        return ord;
      })
    );
    if (soundEnabled) playPOSSound('payment_success');
  };

  const sendLaundryWaNotification = (order: Order): string => {
    const phone = order.customer?.phone || '6281234567890';
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const formattedPhone = cleanPhone.startsWith('0') ? '62' + cleanPhone.slice(1) : cleanPhone;
    
    const customerName = order.customer?.name || 'Pelanggan Setia';
    const storeName = settings.storeName || 'Laundry POS';
    const itemsSummary = order.items.map((i) => `- ${i.name} (${i.quantity}x)`).join('%0A');
    const tglMasuk = order.dropOffDate || new Date(order.date).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    const tglJadi = order.completionDate || order.completionEstimate || 'Sesuai Jadwal';
    
    const message = `Halo Kak ${customerName},%0A%0ANota *${order.id}* di *${storeName}* sudah *SELESAI DIPROSES & SIAP DIAMBIL*! 🧺✨%0A%0A📅 *Tgl Masuk/Cuci:* ${tglMasuk}%0A⏰ *Tgl Selesai/Jadi:* ${tglJadi}%0A%0ARincian Cucian:%0A${itemsSummary}%0A%0ATotal Tagihan: Rp ${order.total.toLocaleString('id-ID')}%0AStatus Pembayaran: *${order.paymentStatus === 'PAID' ? 'LUNAS' : 'BELUM LUNAS'}*%0A%0ATerima kasih telah mempercayakan laundry Anda kepada kami! 🙏`;
    
    const waUrl = `https://wa.me/${formattedPhone}?text=${message}`;
    
    // Also update order status as notified
    updateOrderLaundryStatus(order.id, 'SELESAI_SIAP_AMBIL');
    
    // Open WhatsApp link in new tab if possible
    window.open(waUrl, '_blank');
    return waUrl;
  };

  const updateLaundryStage = (
    orderId: string,
    stage: 'ANTRIAN' | 'CUCI' | 'KERING' | 'SETRIKA' | 'PACKING' | 'SIAP_AMBIL' | 'SELESAI',
    storageRack?: string
  ) => {
    setOrders((prev) =>
      prev.map((ord) => {
        if (ord.id === orderId) {
          const isReady = stage === 'SIAP_AMBIL';
          const isDone = stage === 'SELESAI';
          return {
            ...ord,
            laundryStage: stage,
            laundryStatus: isReady ? 'SELESAI_SIAP_AMBIL' : isDone ? 'SUDAH_DIAMBIL' : 'PROSES_CUCI',
            storageRack: storageRack !== undefined ? storageRack : ord.storageRack,
            waNotifiedAt: isReady && !ord.waNotifiedAt ? new Date().toISOString() : ord.waNotifiedAt,
          };
        }
        return ord;
      })
    );
    if (soundEnabled) playPOSSound('click');
  };

  const updateKDSTicketStatus = (ticketId: string, status: KDSStatus) => {
    setKdsTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status } : t))
    );
    if (soundEnabled) playPOSSound('click');
  };

  const clearCompletedKDSTickets = () => {
    setKdsTickets((prev) => prev.filter((t) => t.status !== 'SERVED'));
  };

  const addCarwashQueue = (item: Omit<CarwashQueueItem, 'id' | 'enteredAt'>) => {
    const queueItem: CarwashQueueItem = {
      ...item,
      id: newId('cwq'),
      enteredAt: new Date().toISOString(),
    };
    setCarwashQueue((prev) => [queueItem, ...prev]);
    if (soundEnabled) playPOSSound('click');
  };

  const updateCarwashStage = (
    queueId: string,
    stage: CarwashQueueItem['stage'],
    assignedBayId?: string,
    assignedBayName?: string
  ) => {
    setCarwashQueue((prev) =>
      prev.map((q) => {
        if (q.id === queueId) {
          return {
            ...q,
            stage,
            assignedBayId: assignedBayId !== undefined ? assignedBayId : q.assignedBayId,
            assignedBayName: assignedBayName !== undefined ? assignedBayName : q.assignedBayName,
          };
        }
        return q;
      })
    );
    if (soundEnabled) playPOSSound('click');
  };

  const removeCarwashQueue = (queueId: string) => {
    setCarwashQueue((prev) => prev.filter((q) => q.id !== queueId));
  };

  const saveBooking = (booking: AppointmentBooking) => {
    setBookings((prev) => {
      const idx = prev.findIndex((b) => b.id === booking.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = booking;
        return next;
      }
      return [booking, ...prev];
    });
    if (soundEnabled) playPOSSound('click');
  };

  const deleteBooking = (bookingId: string) => {
    setBookings((prev) => prev.filter((b) => b.id !== bookingId));
    if (soundEnabled) playPOSSound('delete');
  };

  const updateBookingStatus = (bookingId: string, status: BookingStatus) => {
    setBookings((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, status } : b))
    );
    if (soundEnabled) playPOSSound('click');
  };

  const sendBookingWaReminder = (booking: AppointmentBooking): string => {
    const cleanPhone = booking.customerPhone.replace(/[^0-9]/g, '');
    const formattedPhone = cleanPhone.startsWith('0') ? '62' + cleanPhone.slice(1) : cleanPhone;
    const storeName = settings.storeName || 'Barbershop POS';
    const message = `Halo Kak *${booking.customerName}*, kami mengingatkan jadwal booking cukur/treatment di *${storeName}*:%0A%0A` +
      `📅 *Tanggal:* ${booking.date}%0A` +
      `⏰ *Waktu:* ${booking.timeSlot} WIB%0A` +
      `💈 *Layanan:* ${booking.serviceName}%0A` +
      `✂️ *Stylist / Kapster:* ${booking.staffName}%0A%0A` +
      `Mohon hadir 5-10 menit sebelum jam janji temu. Sampai jumpa di ${storeName}! 🙏`;

    const waUrl = `https://wa.me/${formattedPhone}?text=${message}`;
    window.open(waUrl, '_blank');
    return waUrl;
  };

  const saveCommissionRule = (rule: StaffCommissionRule) => {
    setCommissionRules((prev) => {
      const idx = prev.findIndex((r) => r.staffId === rule.staffId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = rule;
        return next;
      }
      return [...prev, rule];
    });
  };

  const savePayrollSlip = (slip: PayrollSlip) => {
    setPayrollSlips((prev) => {
      const idx = prev.findIndex((s) => s.id === slip.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = slip;
        return next;
      }
      return [slip, ...prev];
    });
  };

  const deletePayrollSlip = (slipId: string) => {
    setPayrollSlips((prev) => prev.filter((s) => s.id !== slipId));
  };

  const disbursePayrollCashMovement = (slipId: string, paymentMethod: string = 'TUNAI'): boolean => {
    const slip = payrollSlips.find((s) => s.id === slipId);
    if (!slip) return false;

    const updatedSlip: PayrollSlip = {
      ...slip,
      status: 'PAID',
      paidAt: new Date().toISOString(),
      paymentMethod,
    };
    savePayrollSlip(updatedSlip);

    if (paymentMethod.toUpperCase().includes('TUNAI') || paymentMethod.toUpperCase().includes('KAS')) {
      addCashMovement(
        'CASH_OUT',
        'OPERASIONAL',
        slip.netSalary,
        `Pembayaran Gaji & Komisi: ${slip.staffName} (${slip.periodMonth})`,
        slip.staffName
      );
    }
    return true;
  };

  const markLifecycleHookSent = (hookId: string) => {
    setSentLifecycleHookIds((prev) => (prev.includes(hookId) ? prev : [...prev, hookId]));
  };

  const dismissLifecycleHook = (hookId: string) => {
    setSentLifecycleHookIds((prev) => (prev.includes(hookId) ? prev : [...prev, hookId]));
  };

  return (
    <POSContext.Provider
      value={{
        tenant,
        activeTab,
        setActiveTab,
        categories,
        products,
        tables,
        customers,
        orders,
        heldOrders,
        inventoryLogs,
        shift,
        shiftHistory,
        settings,
        promoCodes,
        addPromoCode: requireWritable(addPromoCode),
        branches,
        activeBranch,
        setActiveBranchId,
        saveBranch: requireWritable(saveBranch),
        deleteBranch: requireWritable(deleteBranch),
        staffMembers: sectorStaffMembers,
        allStaffMembers: staffMembers,
        selectedStaff: scopedSelectedStaff,
        setSelectedStaff,
        addStaffMember: requireWritable(addStaffMember),
        updateStaffMember: requireWritable(updateStaffMember),
        deleteStaffMember: requireWritable(deleteStaffMember),
        toggleStaffAvailability: requireWritable(toggleStaffAvailability),
        attendanceLogs,
        clockInStaff: requireWritable(clockInStaff),
        clockOutStaff: requireWritable(clockOutStaff),
        getActiveAttendance,
        stockItems,
        saveStockItem: requireWritable(saveStockItem),
        deleteStockItem: requireWritable(deleteStockItem),
        adjustStockItemQuantity: requireWritable(adjustStockItemQuantity),
        processRawMaterialReceipt: requireWritable(processRawMaterialReceipt),
        bundles,
        saveBundle: requireWritable(saveBundle),
        deleteBundle: requireWritable(deleteBundle),
        toggleBundleAvailability: requireWritable(toggleBundleAvailability),
        users,
        currentUser,
        switchUser,
        saveUser: requireWritable(saveUser),
        deleteUser: requireWritable(deleteUser),
        hasPermission,
        verifyPin,
        cart,
        selectedCategory,
        setSelectedCategory,
        searchQuery,
        setSearchQuery,
        selectedCustomer,
        setSelectedCustomer,
        selectedTable,
        setSelectedTable,
        orderType,
        setOrderType,
        soundEnabled,
        toggleSound,
        addToCart,
        updateCartQuantity,
        updateCartItemNotes,
        applyCartItemDiscount,
        removeFromCart,
        clearCart,
        processPayment: requireFinancialWritable(processPayment),
        voidOrder: requireFinancialWritable(voidOrder),
        refundOrderItems: requireFinancialWritable(refundOrderItems),
        syncStatus,syncCenter,openSyncCenter,closeSyncCenter,
        resolveOperationalConflict:async(kind,recordId,choice)=>{await sharedSync.current?.resolveConflict(choice,{kind,recordId});},
        cloudReady:cloudReady&&sharedSyncStatus.ready,cloudError,legacyMigrationStatus,mapLegacyOutlet,operationalSyncStatus:sharedSyncStatus,
        forceSync: () => { void runSync(syncTarget, true); const store=sharedSync.current;void(async()=>{await store?.refresh(false);await store?.flush();})(); },
        holdOrder: requireWritable(holdOrder),
        recallHoldOrder: requireWritable(recallHoldOrder),
        cancelHoldOrder: requireWritable(cancelHoldOrder),
        payPendingOrder: requireFinancialWritable(payPendingOrder),
        updateOrderLaundryStatus: requireWritable(updateOrderLaundryStatus),
        updateLaundryStage: requireWritable(updateLaundryStage),
        sendLaundryWaNotification: requireWritable(sendLaundryWaNotification),
        kdsTickets,
        updateKDSTicketStatus: requireWritable(updateKDSTicketStatus),
        clearCompletedKDSTickets: requireWritable(clearCompletedKDSTickets),
        carwashQueue,
        addCarwashQueue: requireWritable(addCarwashQueue),
        updateCarwashStage: requireWritable(updateCarwashStage),
        removeCarwashQueue: requireWritable(removeCarwashQueue),
        bookings,
        saveBooking: requireWritable(saveBooking),
        deleteBooking: requireWritable(deleteBooking),
        updateBookingStatus: requireWritable(updateBookingStatus),
        sendBookingWaReminder: requireWritable(sendBookingWaReminder),
        commissionRules,
        saveCommissionRule: requireWritable(saveCommissionRule),
        payrollSlips,
        savePayrollSlip: requireWritable(savePayrollSlip),
        deletePayrollSlip: requireWritable(deletePayrollSlip),
        disbursePayrollCashMovement: requireWritable(disbursePayrollCashMovement),
        sentLifecycleHookIds,
        markLifecycleHookSent: requireWritable(markLifecycleHookSent),
        dismissLifecycleHook: requireWritable(dismissLifecycleHook),
        saveProduct: requireWritable(saveProduct),
        deleteProduct: requireWritable(deleteProduct),
        toggleProductAvailability: requireWritable(toggleProductAvailability),
        saveCategory: requireWritable(saveCategory),
        deleteCategory: requireWritable(deleteCategory),
        adjustStock: requireWritable(adjustStock),
        saveCustomer: requireWritable(saveCustomer),
        saveTable: requireWritable(saveTable),
        deleteTable: requireWritable(deleteTable),
        updateSettings,
        activateBusinessSector,
        startShift: requireFinancialWritable(startShift),
        endShift: requireFinancialWritable(endShift),
        cashMovements,
        addCashMovement: requireFinancialWritable(addCashMovement),
        deleteCashMovement: requireFinancialWritable(deleteCashMovement),
        setInitialCash: requireFinancialWritable(setInitialCash),
      }}
    >
      {/* Anything below can read the active business unit via useTenant(). */}
      <TenantProvider value={tenant}>{children}</TenantProvider>
      {syncCenterOpen && <SyncCenter />}
    </POSContext.Provider>
  );
};

export const usePOS = () => {
  const context = useContext(POSContext);
  if (!context) {
    throw new Error('usePOS must be used within a POSProvider');
  }
  return context;
};
