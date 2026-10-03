import React, { useState, useEffect, ReactNode } from 'react';
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
import {useWorkspaceBusiness} from './WorkspaceBusinessContext';
import {WorkspaceCache} from '../lib/workspace/operationalCache';
import {hasVerifiedFinancialScope,saveVerifiedFinancialScope} from '../lib/workspace/offlineBootstrap';
import {readReceiptLogo,saveReceiptLogo} from '../lib/workspace/receiptLogo';
import {useOnline} from '../lib/workspace/useOnline';
import {useCartState} from './domains/useCartState';
import {useCatalogState,useCustomerState} from './domains/useCatalogState';
import {useLaborState} from './domains/useLaborState';
import {useInventoryState} from './domains/useInventoryState';
import {directoryOutletRows} from '../lib/workspace/businessIdentity';
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
import { fetchFinancialWorkspace } from '../lib/reports/client';
import { useWorkspaceRoute, navigateModule } from '../lib/navigation/workspaceRouter';
import { moduleForPath } from '../lib/navigation/routes';
import { refreshCoordinator } from '../lib/sync/refreshCoordinator';
import { POSDomainProvider,usePOSSnapshot } from './POSDomains';
import { kindsForModule } from '../lib/sync/moduleKinds';

export interface POSContextType {
  /**
   * The active business unit + signed-in user. Partition key for all scoped
   * data and the sole source of AI scoping. Also available via `useTenant()`.
   */
  tenant: TenantInfo;

  activeTab: 'home' | 'overview' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings' | 'labor' | 'payment' | 'businesses';
  setActiveTab: (tab: 'home' | 'overview' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings' | 'labor' | 'payment' | 'businesses') => void;
  
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

// Compatibility consumers retain usePOS; hot paths subscribe to individual domains.

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
    if(localStorage.getItem(key)!==value)localStorage.setItem(key, value);
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
  const workspaceBusiness=useWorkspaceBusiness();
  const online=useOnline();
  const selectedBusiness=workspaceBusiness.business;
  const storageId=selectedBusiness.transportRef!;
  const operationalNamespace=selectedBusiness.legacyAlias?undefined:selectedBusiness.businessId;
  const cache=React.useRef<WorkspaceCache|null>(null);
  if(!cache.current)cache.current=new WorkspaceCache(authUser!.id,selectedBusiness.sector,storageId,operationalNamespace);
  // These closures belong to this immutable provider instance. A second
  // same-sector business never consults an owner_sector partition.
  const getScopedKey=(entity:string,_owner:string,_sector:BusinessSector)=>cache.current!.key(entity);
  const safeSetLocalStorage=(key:string,value:string)=>{try{cache.current!.write(key,value);}catch(error){console.warn('[storage] Cache write failed; original data retained',error);}};
  const loadScopedData=<T,>(entity:string,owner:string,sector:BusinessSector,fallback:T):T=>{
    try{return cache.current!.load(entity,fallback,kindsForModule(activeTab));
    }catch{return fallback;}
  };
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

  const workspaceRoute=useWorkspaceRoute();
  const activeTab=moduleForPath(workspaceRoute.split('?')[0])||'overview';
  const setActiveTab=navigateModule;

  // Users & RBAC state
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem(`newhope_users_${storeOwnerId}`) || localStorage.getItem('newhope_users');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.filter((u) => u.name !== 'Budi Santoso' && u.email !== 'budi@newhope.id');
          const admins=cleaned.filter((u:User)=>u.role==='ADMIN');
          if (cleaned.length > 0 && admins.length > 0 && admins.every((u:User)=>u.id===storeOwnerId)) return cleaned;
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
          const selected=users.find(u=>u.id===parsed.id&&u.status==='ACTIVE');
          if(selected)return selected;
        }
      } catch (e) {
        console.error('Failed to parse current user', e);
      }
    }
    return defaultOwnerUser;
  });

  // This provider is mounted per account/business. Token refresh must never
  // rehydrate the roster from disk or replace a cashier's current cloud profile.
  const ownerName=authUser?.user_metadata?.full_name || authUser?.user_metadata?.store_name || authUser?.email?.split('@')[0] || 'Pemilik Toko';
  const ownerEmail=authUser?.email||'';
  useEffect(() => {
    const update=(user:User)=>user.id===storeOwnerId&&(user.name!==ownerName||user.email!==ownerEmail)
      ?{...user,name:ownerName,email:ownerEmail}:user;
    setUsers(previous=>previous.some(user=>update(user)!==user)?previous.map(update):previous);
    setCurrentUser(update);
  },[storeOwnerId,ownerName,ownerEmail]);

  useEffect(()=>{
    let active=true;
    for(const original of users){
      if(original.id===storeOwnerId||original.pin.startsWith('sha256$'))continue;
      void hashPin(original.pin).then(pin=>{
        if(!active)return;
        // An arriving cloud record or edit wins over this old hashing job.
        setUsers(previous=>previous.includes(original)?previous.map(user=>user===original?{...user,pin}:user):previous);
      }).catch(()=>{console.warn('[auth] Staff PIN migration deferred');});
    }
    return()=>{active=false;};
  },[storeOwnerId]);

  const [settings, setSettings] = useState<StoreSettings>(() => {
    const uId = storeOwnerId;
    const loaded = loadGlobalUserData('settings', uId, INITIAL_SETTINGS);
    const storeName = authUser?.user_metadata?.store_name || authUser?.user_metadata?.full_name;
    const sector = selectedBusiness.sector as BusinessSector;
    const legacySettingsMatch=!!selectedBusiness.legacyAlias&&loaded.businessSector===sector&&
      (!loaded.activeBranchId||selectedBusiness.outlets.some(outlet=>outlet.outletId===loaded.activeBranchId));
    const scopedSettings=loadScopedData<Partial<StoreSettings>>('store_settings',uId,sector,{});
    const mismatch=loaded.businessSector&&loaded.businessSector!==sector;
    if(mismatch){const key=getGlobalUserKey('settings',uId),raw=localStorage.getItem(key);
      if(raw)backupOperational(uId,sector,key,raw,[{kind:'store_settings',recordId:'main',reason:'WRONG_SECTOR:'+loaded.businessSector}]);}
    
    // Entitlement comes only from the verified account bootstrap. Checkout
    // hints choose form defaults, never overwrite server subscription state.
    const sub = workspaceBusiness.subscription;

    return {
      ...(legacySettingsMatch?loaded:INITIAL_SETTINGS),
      ...scopedSettings,
      // Brand assets come from the active business, not account-wide browser data.
      logoUrl: !navigator.onLine?readReceiptLogo(uId,selectedBusiness.businessId):undefined,
      storeName: scopedSettings.storeName || selectedBusiness.name,
      storeMode: BUSINESS_PRESETS[sector].storeMode,
      autoPrintReceipt:loaded.autoPrintReceipt,receiptPaperSize:loaded.receiptPaperSize,
      businessSector: sector,
      subscription: sub,
      activeBranchId:workspaceBusiness.outletId,
    };
  });

  useEffect(()=>{
    setSettings(previous=>JSON.stringify(previous.subscription)===JSON.stringify(workspaceBusiness.subscription)?previous:{...previous,subscription:workspaceBusiness.subscription});
  },[workspaceBusiness.subscription]);

  useEffect(()=>{
    // Account bootstrap already owns the verified directory. Do not run a
    // second outlet/subscription poller in POS or the setup gate.
    setSettings(previous=>{
      const branches=mergeServerOutlets(previous.branches||INITIAL_BRANCHES,directoryOutletRows(workspaceBusiness.directory.businesses));
      const next={...previous,branches,activeBranchId:workspaceBusiness.outletId};
      return JSON.stringify(previous)===JSON.stringify(next)?previous:next;
    });
  },[workspaceBusiness.directory,workspaceBusiness.outletId]);

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
      if(!sharedSync.current?.hasLoadedKinds(kindsForModule(activeTab)))throw Error('MODULE_CLOUD_STATE_NOT_READY');
      if(!navigator.onLine&&(!workspaceBusiness.offlineExpiresAt||Date.now()>=workspaceBusiness.offlineExpiresAt))throw Error('OFFLINE_VERIFICATION_EXPIRED');
      return fn(...args);
    }) as T;
  }

  const activeSector = settings.businessSector || 'FNB';
  useEffect(() => {
    if (!authUser?.id) return;
    let active = true;
    const sector = activeSector;
    setSettings(prev => ({ ...prev, logoUrl: !navigator.onLine?readReceiptLogo(storeOwnerId,selectedBusiness.businessId):undefined }));
    if(!navigator.onLine)return;
    const loadLogo = async () => {
      try {
        const businessId = storageId;
        const response = await fetch(`/api/v1/sync/receipt-logo?businessId=${encodeURIComponent(businessId)}`);
        const data = await response.json();
        if (active && response.ok && data.ok) {
          try{saveReceiptLogo(storeOwnerId,selectedBusiness.businessId,data.logoUrl||null);}catch{console.warn('[workspace] Logo offline cache unavailable; cloud logo unchanged');}
          setSettings(prev => (prev.businessSector || 'FNB') === sector
            ? { ...prev, logoUrl: data.logoUrl || undefined } : prev);
        }
      } catch { /* Offline: no cross-business logo fallback. */ }
    };
    void loadLogo();
    return () => { active = false; };
  }, [authUser?.id, activeSector,online,storeOwnerId,selectedBusiness.businessId]);
  const defaultPreset = BUSINESS_PRESETS[activeSector] || BUSINESS_PRESETS.FNB;

  /*
   * THE TENANT. Every scoped read/write, every shared-collection filter and the
   * whole AI context derive from this one object — so there is exactly one
   * definition of "which business am I looking at".
   */
  const tenant: TenantInfo = {
    businessId: storageId,
    canonicalBusinessId:selectedBusiness.businessId,
    legacyAlias:selectedBusiness.legacyAlias,
    merchantId: selectedBusiness.businessId,
    tenantId: selectedBusiness.tenantId,
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
    canonicalBusinessId:selectedBusiness.businessId,legacyAlias:selectedBusiness.legacyAlias,
  };

  const [cloudState,setCloudState]=useState<{scope:string;ready:boolean;error:string|null}>({scope:'',ready:false,error:null});
  const financialScopeKey=tenant.businessId+':'+(syncTarget.outletId||'');
  const offlineFinancialReady=!online&&!!workspaceBusiness.offlineExpiresAt&&!!syncTarget.outletId&&
    hasVerifiedFinancialScope(storeOwnerId,selectedBusiness.businessId,syncTarget.outletId,workspaceBusiness.offlineExpiresAt);
  const cloudReady=cloudState.scope===financialScopeKey&&cloudState.ready||offlineFinancialReady;
  const cloudError=cloudState.scope===financialScopeKey?cloudState.error:null;
  const [legacyMigrationStatus,setLegacyMigrationStatus]=useState<LegacyMigrationResult|null>(null);
  const legacyMappings=React.useRef<Record<string,string>>({});
  const financialStatus=(businessId:string,inFlight=false)=>combineFinancialSyncStatus(getSyncStatus(businessId,inFlight),getCashSyncStatus(businessId));
  function requireFinancialWritable<T extends (...args:any[])=>any>(fn:T):T{
    return requireWritable(((...args:Parameters<T>)=>{
      if(!cloudReady||!sharedSyncStatus.ready||!syncTarget.outletId)throw new Error('CLOUD_OUTLET_NOT_READY');
      if(!navigator.onLine&&workspaceBusiness.offlineExpiresAt&&Date.now()>=workspaceBusiness.offlineExpiresAt)throw Error('OFFLINE_VERIFICATION_EXPIRED');
      return fn(...args);
    }) as T);
  }
  const mapLegacyOutlet=(originalBranchRef:string,outletId:string)=>{
    if(!settings.branches?.some(branch=>branch.id===outletId&&branch.isActive&&branch.businessId===selectedBusiness.businessId))
      throw new Error('OUTLET_NOT_ACTIVE');
    const key='newhope_legacy_outlet_mappings_'+tenant.businessId;
    let saved:Record<string,string>={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
    saved[originalBranchRef]=outletId;localStorage.setItem(key,JSON.stringify(saved));
    legacyMappings.current=saved;void runSync(syncTarget,true);
  };

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
    getSyncStatus(storageId)
  );
  const activeSyncBusinessId=React.useRef(tenant.businessId);
  activeSyncBusinessId.current=tenant.businessId;
  const runningFinancialSync=React.useRef(new Set<string>());

  /**
   * Menjalankan pengiriman lalu menyegarkan status di layar.
   *
   * Sengaja tidak pernah melempar: pemanggil terdekatnya adalah jalur
   * penyelesaian transaksi, dan sinkronisasi yang gagal tidak boleh
   * menjatuhkan penjualan yang sudah sah.
   */
  const runSync = React.useCallback(
    async (target: SyncTarget, force = false) => {
      if(runningFinancialSync.current.has(target.businessId))return;
      runningFinancialSync.current.add(target.businessId);
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
        const before=financialStatus(target.businessId);
        const transactionBefore=getSyncStatus(target.businessId);
        const cashBefore=getCashSyncStatus(target.businessId);
        const after = await flushSync(target, force);
        const cash=await flushCashQueue(target,force);
        const recovered=migrateLegacyFinancialData(target,{outletMappings:mappings});
        if(activeSyncBusinessId.current===target.businessId){
          setLegacyMigrationStatus(recovered);
          setSyncStatus(combineFinancialSyncStatus(after,cash));
        }
        if(after.pending+cash.pending<before.pending||after.lastSyncedAt!==transactionBefore.lastSyncedAt||cash.lastSyncedAt!==cashBefore.lastSyncedAt)
          window.dispatchEvent(new Event('financial-updated'));
      } catch {
        if(activeSyncBusinessId.current===target.businessId)setSyncStatus(financialStatus(target.businessId));
      } finally {runningFinancialSync.current.delete(target.businessId);}
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
      canonicalBusinessId:selectedBusiness.businessId,legacyAlias:selectedBusiness.legacyAlias,
    };

    // Berpindah pengguna atau sektor berarti antrian yang berbeda.
    setSyncStatus(getSyncStatus(bizId));

    // 1. Saat dibuka — mengirim apa pun yang tertinggal dari sesi sebelumnya.
    void runSync(target, Boolean(target.outletId));

    const unsubscribe=refreshCoordinator.register('financial-write:'+bizId,{run:()=>runSync(target),interval:15000,hidden:true,events:['outlets-updated']});
    return unsubscribe;
  }, [bizId, activeSector, storeNameForSync, storeOwnerId, settings.activeBranchId, runSync]);

  const {categories,setCategories,products,setProducts,syncProducts,saveProduct,deleteProduct,toggleProductAvailability,saveCategory,deleteCategory}=useCatalogState(
    (kind,fallback)=>loadScopedData(kind,storeOwnerId,activeSector,fallback),
    ()=>{if(soundEnabled)playPOSSound('click');},
  );

  const [tables, setTables] = useState<Table[]>(() => {
    return loadScopedData('tables', storeOwnerId, activeSector, []);
  });

  const {customers,setCustomers,saveCustomer}=useCustomerState((kind,fallback)=>loadScopedData(kind,storeOwnerId,activeSector,fallback));

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

  const {cart,setCart,selectedCustomer,setSelectedCustomer,selectedTable,setSelectedTable,selectedStaff,setSelectedStaff,
    orderType,setOrderType,selectedCategory,setSelectedCategory,searchQuery,setSearchQuery,soundEnabled,
    addToCart,removeFromCart,updateCartQuantity,updateCartItemNotes,applyCartItemDiscount,clearCart,toggleSound}=useCartState({
      key:partitionKey(storageId,'cart_draft_'+(workspaceBusiness.outletId||'unselected')),
      registerSwitchGuard:workspaceBusiness.registerSwitchGuard,
      onPersistenceError:()=>setSyncStatus(previous=>({...previous,lastError:'CART_DRAFT_NOT_SAVED',failures:Math.max(1,previous.failures)})),
      canAdd:product=>{
        if(isFreePlan(settings.subscription)&&!freeProductAllowed(settings.subscription?.freeSelection,product.id,activeSector)){
          window.alert('Produk ini tersimpan tetapi terkunci di paket Free. Ubah pilihan 10 produk atau upgrade.');return false;
        }return true;
      },
    });

  const {staffMembers,setStaffMembers,sectorStaffMembers,addStaffMember,updateStaffMember,deleteStaffMember,toggleStaffAvailability,
    attendanceLogs,setAttendanceLogs,clockInStaff,clockOutStaff,getActiveAttendance,commissionRules,setCommissionRules,
    payrollSlips,setPayrollSlips,saveCommissionRule,savePayrollSlip,deletePayrollSlip}=useLaborState({
      tenant,free:isFreePlan(settings.subscription),load:(kind,fallback)=>loadScopedData(kind,storeOwnerId,activeSector,fallback),
      loadRoster:()=>cache.current!.loadRoster(kindsForModule(activeTab)),
      outlet:()=>activeBranch,sound:kind=>{if(soundEnabled)playPOSSound(kind);},
    });
  const {stockItems,setStockItems,bundles,setBundles,saveStockItem,deleteStockItem,saveBundle,deleteBundle,toggleBundleAvailability,adjustStockItemQuantity}=useInventoryState(
    (kind,fallback)=>loadScopedData(kind,storeOwnerId,activeSector,fallback),
    {sound:kind=>{if(soundEnabled)playPOSSound(kind);},cashier:()=>shift.cashierName,appendLog:log=>setInventoryLogs(previous=>[log,...previous])},
  );

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



  // Automated WhatsApp Lifecycle Hooks
  const [sentLifecycleHookIds, setSentLifecycleHookIds] = useState<string[]>(() => {
    return loadScopedData('sent_lifecycle_hooks', storeOwnerId, activeSector, []);
  });

  const [sharedSyncStatus, setSharedSyncStatus] = useState<SharedSyncStatus>({ready:false,pending:0,error:null});
  const [syncCenterOpen,setSyncCenterOpen]=useState(false);
  const openSyncCenter=React.useCallback(()=>setSyncCenterOpen(true),[]);
  const closeSyncCenter=React.useCallback(()=>setSyncCenterOpen(false),[]);
  const syncCenter=React.useMemo(()=>syncStatusModel({businessId:storageId,owner:storeOwnerId,operationalNamespace,financial:syncStatus,
    operational:sharedSyncStatus,recovery:legacyMigrationStatus,cloudReady,cloudError,online}),
    [storageId,storeOwnerId,operationalNamespace,syncStatus,sharedSyncStatus,legacyMigrationStatus,cloudReady,cloudError,online]);
  const sharedSync = React.useRef<SharedStateSync | null>(null);
  const remoteOrderOperations=React.useRef(new Map<string,Record<string,unknown>>());
  const sharedSettings = React.useMemo(() => {
    const { subscription: _subscription, branches: _branches, activeBranchId: _activeBranchId,
      logoUrl: _logoUrl, registeredTerminalId: _registeredTerminalId,
      autoPrintReceipt: _autoPrintReceipt, receiptPaperSize: _receiptPaperSize,
      businessSector: _businessSector, ...rest } = settings;
    return {id:'main',...rest,businessSector:settings.businessSector,businessId:storageId};
  },[settings,storeOwnerId]);

  // Hydrate operational records from the owner account and keep each change in
  // a durable, versioned outbox. Normalized transactions still use the ledger.
  useEffect(() => {
    if(!authUser?.id) return;
    const cacheError=operationalCacheError(authUser.id,activeSector,storageId);
    if(cacheError){setSharedSyncStatus({ready:false,pending:0,error:cacheError});return;}
    remoteOrderOperations.current=new Map();
    const importMarker=`newhope_operational_import_v2_${storageId}`;
    const hydratedKinds=new Set<string>();
    const needsImport=(kind:string)=>!hydratedKinds.has(kind)&&!localStorage.getItem(importMarker)&&!localStorage.getItem(`${importMarker}:${kind}`);
    const store=new SharedStateSync(authUser.id,activeSector,(records,initial,loadedKinds)=>{
      if(sharedSync.current!==store)return;
      const grouped=new Map<string,SharedRecord[]>();
      for(const record of records){
        const group=grouped.get(record.kind)||[];group.push(record);grouped.set(record.kind,group);
      }
      const apply=<T extends object>(kind:string,current:T[],set:React.Dispatch<React.SetStateAction<T[]>>) => {
        if(loadedKinds&&!loadedKinds.includes(kind))return;
        const rows=grouped.get(kind)||[];
        const fromServer=rows.filter(row=>!row.deleted&&row.value).map(row=>row.value as T);
        const known=new Set(rows.map(row=>row.recordId));
        const legacyKey=kind==='staff_members' ? getGlobalUserKey(kind,authUser.id)
          : getScopedKey(kind,authUser.id,activeSector);
        const legacy=kind==='staff_members'?cache.current!.hydrateRoster() as T[]:cache.current!.hydrate<T[]>(kind,current);
        const imported=needsImport(kind) && legacyKeys.current?.has(legacyKey)
          ? repairOperationalCache(authUser.id,activeSector,kind,legacy,{businessId:storageId,namespace:operationalNamespace}).filter(row=>!known.has(recordIdOf(kind,row))&&!store.legacyQuarantined(kind,recordIdOf(kind,row))) : [];
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
      if(!loadedKinds||loadedKinds.includes('order_operations')){
        remoteOrderOperations.current=new Map(operationRows.map(row=>[row.recordId,row.value!]));
        store.prime('order_operations',operationRows.map(row=>row.value!));
        setOrders(previous=>previous.map(row=>mergeOrderOperations(row,remoteOrderOperations.current.get(row.id))));
      }

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
      if(!loadedKinds||loadedKinds.includes('sent_lifecycle_hooks')){
        store.prime('sent_lifecycle_hooks',lifecycle.map(id=>({id})));
        if(JSON.stringify(lifecycle)!==JSON.stringify(sentLifecycleHookIds))setSentLifecycleHookIds(lifecycle);
      }
      const settingsQuarantined=grouped.get('store_settings')?.some(r=>r.quarantineReason);
      const fallbackName=settingsQuarantined?BUSINESS_PRESETS[activeSector].defaultStoreName:store.businessName;
      const remoteSettings=grouped.get('store_settings')?.find(row=>!row.deleted&&row.recordId==='main')?.value
        || (fallbackName?{...sharedSettings,storeName:fallbackName,storeMode:BUSINESS_PRESETS[activeSector].storeMode,
          receiptHeader:`*** ${fallbackName} ***`,receiptFooter:`Terima kasih telah bertransaksi di ${fallbackName}`}:undefined);
      store.prime('store_settings',remoteSettings?[remoteSettings]:[]);
      if(settingsQuarantined&&remoteSettings&&!grouped.get('store_settings')?.some(r=>!r.deleted&&r.recordId==='main')){
        // A structural sector repair has a safe preset; persist it automatically,
        // against the tombstone revision, instead of repeatedly falling back to stale metadata.
        store.prime('store_settings',[]);store.track('store_settings',[remoteSettings]);
      }
      if(remoteSettings){
        const {id: _id,businessId:_businessId,...safe}=remoteSettings;
        setSettings(prev=>{const next={...prev,...safe,subscription:prev.subscription,branches:prev.branches,
          activeBranchId:prev.activeBranchId,logoUrl:prev.logoUrl,
          registeredTerminalId:prev.registeredTerminalId,businessSector:prev.businessSector,
          autoPrintReceipt:prev.autoPrintReceipt,receiptPaperSize:prev.receiptPaperSize} as StoreSettings;
          return JSON.stringify(prev)===JSON.stringify(next)?prev:next;});
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
      const needsCatalogFallback=needsImport('products') && (!loadedKinds||loadedKinds.includes('products')) && !grouped.get('products')?.length && !products.length;
      if(needsCatalogFallback){
        void pullCatalog({businessId:storageId,sector:activeSector,
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
          localStorage.setItem(`${importMarker}:products`,'queued-v2');
          localStorage.setItem(`${importMarker}:categories`,'queued-v2');
        });
      }
      // Core-only boot must not checkpoint collections that have not been read.
      const completedKinds=loadedKinds||[...grouped.keys()];
      for(const kind of completedKinds){
        hydratedKinds.add(kind);
        if(!(needsCatalogFallback&&['products','categories'].includes(kind)))localStorage.setItem(`${importMarker}:${kind}`,'queued-v2');
      }
    },status=>{const error=operationalCacheError(authUser.id,activeSector,storageId);setSharedSyncStatus(error?{...status,ready:false,error}:status);},{businessId:selectedBusiness.businessId,transportRef:storageId,namespace:operationalNamespace});
    sharedSync.current=store;
    store.setKinds(kindsForModule(activeTab));
    const prime=<T extends object>(kind:string,rows:T[])=>store.prime(kind,rows);
    prime('categories',categories);prime('products',syncProducts);prime('tables',tables);prime('customers',customers);
    prime('held_orders',heldOrders);prime('inventory_logs',inventoryLogs);
    prime('order_operations',orders.map(orderOperations));

    prime('promo_codes',promoCodes);prime('stock_items',stockItems);prime('bundles',bundles);
    prime('attendance_logs',attendanceLogs);prime('kds_tickets',kdsTickets);
    prime('carwash_queue',carwashQueue);prime('bookings',bookings);
    prime('commission_rules',commissionRules);prime('payroll_slips',payrollSlips);
    prime('staff_members',staffMembers);
    prime('store_settings',[sharedSettings]);
    if(workspaceBusiness.offlineExpiresAt&&!navigator.onLine)store.restoreOffline(workspaceBusiness.offlineExpiresAt);
    const unsubscribe=refreshCoordinator.register('operational:'+selectedBusiness.businessId,{run:()=>store.resumeAfterOutletUpdate(),interval:60000,events:['outlets-updated','subscription-updated']});
    return ()=>{unsubscribe();store.stop();if(sharedSync.current===store)sharedSync.current=null;};
  // Collection changes are tracked by the effect below. Recreating this owner/sector
  // connection on every edit would discard its in-flight version baseline.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[authUser?.id,activeSector]);

  useEffect(()=>{
    const store=sharedSync.current;if(!store)return;
    if(store.setKinds(kindsForModule(activeTab)))void store.refresh(false);
  },[activeTab,activeSector]);

  useEffect(()=>{
    if(!authUser?.id)return;
    setCurrentUser(previous=>users.find(user=>user.id===previous.id&&user.status==='ACTIVE')||
      users.find(user=>user.id===authUser.id)||defaultOwnerUser);
  },[users,currentUser.id,authUser?.id]);

  useEffect(()=>{
    sharedSync.current?.setOutletId(/^[0-9a-f-]{36}$/i.test(settings.activeBranchId||'')
      ?settings.activeBranchId:undefined);
  },[settings.activeBranchId,activeSector]);

  useEffect(()=>{safeSetLocalStorage(getScopedKey('store_settings',storeOwnerId,activeSector),JSON.stringify(sharedSettings));},[sharedSettings,storeOwnerId,activeSector]);

  useEffect(()=>{
    const store=sharedSync.current;
    if(!store)return;
    store.track('categories',categories);store.track('products',syncProducts);store.track('tables',tables);
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
  },[categories,syncProducts,tables,customers,orders,heldOrders,inventoryLogs,
    promoCodes,stockItems,bundles,attendanceLogs,kdsTickets,
    carwashQueue,bookings,commissionRules,payrollSlips,staffMembers,
    sharedSettings,sentLifecycleHookIds,users,authUser?.id]);

  const needsFinancialWorkspace=['pos','tables','reports'].includes(activeTab);
  // Route-scoped reads never stop delivery of the separate durable queues.
  useEffect(()=>{
    if(!needsFinancialWorkspace)return;
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
        const {transactions:remote,shiftData:initialShift}=await fetchFinancialWorkspace(query,activeTab!=='reports',controller.signal);
        let shiftData=initialShift;
        if(activeTab==='pos'&&!shiftData.shift&&!shiftData.history?.length){
          const shiftResponse=await fetch('/api/v1/finance/shift/open',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
            body:JSON.stringify({sector:target.sector,outletId:target.outletId,clientShiftId:newId('shift'),cashierName:currentUser.name,initialCash:0})});
          const opened=await shiftResponse.json();if(!shiftResponse.ok||!opened.ok)throw new Error(opened.error||'SHIFT_OPEN_FAILED');
          shiftData={...shiftData,shift:opened.shift};
        }
        if(controller.signal.aborted)return;
        cache.current!.confirmFinancialHydration();
        const pendingIds=new Set(getPendingTransactions(target.businessId).map(row=>row.clientTxnId));
        if(remote)setOrders(previous=>{
          const pending=previous.filter(row=>pendingIds.has(row.id));
          const previousOperations=new Map(previous.map(row=>[row.id,orderOperations(row)]));
          const byId=new Map(remote.filter(row=>!pendingIds.has(row.id)).map(row=>[row.id,
            mergeOrderOperations(row,remoteOrderOperations.current.get(row.id)||previousOperations.get(row.id))]));
          for(const row of pending)byId.set(row.id,row);
          for(const row of previous.filter(row=>row.status==='HOLD'))if(!byId.has(row.id))byId.set(row.id,row);
          const next=[...byId.values()].sort((a,b)=>b.date.localeCompare(a.date));
          return JSON.stringify(previous)===JSON.stringify(next)?previous:next;
        });
        const nextShift=shiftData.shift||shiftData.history?.[0];
        if(nextShift)setShift(previous=>JSON.stringify(previous)===JSON.stringify(nextShift)?previous:nextShift);
        setShiftHistory(previous=>JSON.stringify(previous)===JSON.stringify(shiftData.history||[])?previous:shiftData.history||[]);
        markCloudRead(target.businessId,shiftData.generatedAt);
        try{saveVerifiedFinancialScope(storeOwnerId,selectedBusiness.businessId,target.outletId!);}catch{console.warn('[workspace] Offline financial scope cache unavailable; ledger unchanged');}
        setSyncStatus(financialStatus(target.businessId));
        setCloudState({scope:financialScopeKey,ready:true,error:null});
      }catch(error){if(!controller.signal.aborted){
        const message=error instanceof Error?error.message:'CLOUD_UNAVAILABLE';
        setCloudState(previous=>({...previous,scope:financialScopeKey,ready:message==='WORKSPACE_ACCESS_REVOKED'?false:previous.ready,error:message}));
        setSyncStatus(previous=>({...previous,lastError:message,failures:Math.max(1,previous.failures)}));
      }}finally{running=false;}
    };
    const unsubscribe=refreshCoordinator.register('financial-read:'+financialScopeKey,{run:refresh,interval:30000,events:['financial-updated','outlets-updated']});
    return()=>{controller.abort();unsubscribe();};
  },[authUser?.id,financialScopeKey,needsFinancialWorkspace,activeTab==='pos',activeTab==='reports']);

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
    const key=getGlobalUserKey('settings',uId),raw=JSON.stringify(settings);
    if(localStorage.getItem(key)!==raw)localStorage.setItem(key,raw);
  }, [settings, storeOwnerId]);

  useEffect(() => {
    const uId = storeOwnerId;
    const sec = settings.businessSector || 'FNB';
    safeSetLocalStorage(getScopedKey('customers', uId, sec), JSON.stringify(customers));
  }, [customers, storeOwnerId, settings.businessSector]);

  useEffect(() => {
    cache.current!.writeRoster(staffMembers);
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

  // Attendance/payroll share the durable revisioned outbox. Admin projections
  // are committed with each accepted record, not by a competing timed writer.
  // A stale selected staff member may not survive a business switch.
  const scopedSelectedStaff=selectedStaff&&belongsToBusiness(selectedStaff,tenant)?selectedStaff:null;

  const branches = settings.branches || INITIAL_BRANCHES;
  const activeBranch = branches.find((b) => b.id === settings.activeBranchId && b.isActive && b.businessId===selectedBusiness.businessId);

  const setActiveBranchId = (branchId: string) => {
    if (!branches.some(branch => branch.id === branchId && branch.isActive && branch.businessId===selectedBusiness.businessId)) throw new Error('OUTLET_NOT_ACTIVE_FOR_BUSINESS');
    if (isFreePlan(settings.subscription) && branchId !== settings.subscription?.freeSelection?.branchId) throw new Error('FREE_BRANCH_LOCKED');
    workspaceBusiness.select(selectedBusiness.businessId,branchId);
  };

  const saveBranch = async (branchToSave: StoreBranch) => {
    if (isFreePlan(settings.subscription) && branchToSave.id !== settings.subscription?.freeSelection?.branchId) throw new Error('FREE_BRANCH_LIMIT');
    const originalId = branchToSave.id;
    const business=await prepareOutletBusiness(branchToSave.businessSector || activeSector, settings.storeName,branchToSave.businessId||selectedBusiness.businessId);
    const response = await fetch('/api/v1/subscription/outlets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...branchToSave,businessId:business.merchantId, businessSector: branchToSave.businessSector || activeSector }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Outlet gagal disimpan');
    branchToSave = { ...branchToSave, id: result.outlet.id,businessId:result.outlet.merchant_id };
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
      body: JSON.stringify({ ...branch,businessId:branch.businessId||selectedBusiness.businessId, businessSector: branch.businessSector || activeSector, isActive: false }),
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
    safeSetLocalStorage(
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


  // Cart state/actions belong to the isolated cart domain.

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

  // Catalog CRUD belongs to the catalog domain; stock adjustment coordinates domains below.

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

  // Customer CRUD belongs to the customer domain.

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
    // A stale settings form may not switch the active business or its financial entitlement.
    setSettings(prev=>({...newSettings,businessSector:prev.businessSector,
      storeMode:BUSINESS_PRESETS[prev.businessSector||'FNB'].storeMode,
      subscription:prev.subscription,branches:prev.branches,activeBranchId:prev.activeBranchId}));
  };

  const activateBusinessSector = (sector: BusinessSector, _customStoreName?: string) => {
    const choices=workspaceBusiness.directory.businesses.filter(b=>b.status==="ACTIVE"&&b.sector===sector&&b.transportRef);
    if(choices.length===1)workspaceBusiness.select(choices[0].businessId);
    else navigateModule("businesses");
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



  const disbursePayrollCashMovement = (slipId: string, paymentMethod: string = 'TUNAI'): boolean => {
    const slip = payrollSlips.find((s) => s.id === slipId);
    if (!slip || slip.status==='PAID') return false;
    if(!Number.isFinite(slip.netSalary)||slip.netSalary<0)throw Error('INVALID_PAYROLL_AMOUNT');

    const updatedSlip: PayrollSlip = {
      ...slip,
      status: 'PAID',
      paidAt: new Date().toISOString(),
      paymentMethod,
    };
    if (paymentMethod.toUpperCase().includes('TUNAI') || paymentMethod.toUpperCase().includes('KAS')) {
      addCashMovement(
        'CASH_OUT',
        'OPERASIONAL',
        slip.netSalary,
        `Pembayaran Gaji & Komisi: ${slip.staffName} (${slip.periodMonth})`,
        slip.staffName
      );
    }
    // Cash outbox persistence must succeed before marking the operational slip
    // paid. A storage failure cannot leave a paid slip with no financial command.
    savePayrollSlip(updatedSlip);
    return true;
  };

  const markLifecycleHookSent = (hookId: string) => {
    setSentLifecycleHookIds((prev) => (prev.includes(hookId) ? prev : [...prev, hookId]));
  };

  const dismissLifecycleHook = (hookId: string) => {
    setSentLifecycleHookIds((prev) => (prev.includes(hookId) ? prev : [...prev, hookId]));
  };

  return (
    <POSDomainProvider
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
        disbursePayrollCashMovement: requireFinancialWritable(requireWritable(disbursePayrollCashMovement)),
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
    </POSDomainProvider>
  );
};

export const usePOS = () => {
  return usePOSSnapshot();
};
