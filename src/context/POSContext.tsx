import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  getGlobalUserKey,
  getScopedKey,
  loadGlobalUserData,
  loadScopedData,
  simpanBerjenjang,
  usePenyimpananPOS,
} from './penyimpananPOS';
import {
  hitungDiskonBaris,
  hitungKembalian,
  hitungTotal,
  persenDari,
  rupiahPositif,
} from '../lib/money';
import { buatBuktiOtorisasi } from '../lib/auth/voidAuthorization';
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
  pushCatalog,
  type SyncStatus,
  type SyncTarget,
} from '../lib/sync/queue';
import {
  verifyPinHash,
  getPinLockoutStatus,
  recordFailedPinAttempt,
  resetPinAttempts,
} from '../lib/auth/pinSecurity';
import { useAuth } from './AuthContext';
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
} from '../data/initialData';
import { generateInvoiceNumber, playPOSSound } from '../utils/formatters';
import { newId } from '../lib/ids';

interface POSContextType {
  /**
   * The active business unit + signed-in user. Partition key for all scoped
   * data and the sole source of AI scoping. Also available via `useTenant()`.
   */
  tenant: TenantInfo;

  activeTab: 'home' | 'overview' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings';
  setActiveTab: (tab: 'home' | 'overview' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings') => void;
  
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
  saveBranch: (branch: StoreBranch) => void;
  deleteBranch: (branchId: string) => void;

  // Staff & Service Assignment & Attendance (Clock In / Out)
  /** Staff belonging to the ACTIVE business sector only. */
  staffMembers: StaffMember[];
  /** The whole cross-sector roster. Only for management/settings screens. */
  allStaffMembers: StaffMember[];
  selectedStaff: StaffMember | null;
  setSelectedStaff: (staff: StaffMember | null) => void;
  addStaffMember: (staff: Omit<StaffMember, 'id'>) => void;
  attendanceLogs: AttendanceRecord[];
  clockInStaff: (
    staffId: string,
    notes?: string,
    geoInfo?: GeoLocationInfo,
    branchInfo?: { id: string; name: string }
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

  // Product Bundles (Paket Promo & Bundling)
  bundles: ProductBundle[];
  saveBundle: (bundle: ProductBundle) => void;
  deleteBundle: (id: string) => void;

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
    completionDate?: string
  ) => Order | null;
  voidOrder: (
    orderId: string,
    reason?: string,
    /**
     * Manajer yang mengotorisasi. WAJIB agar server menerima pembatalannya —
     * lihat services/pos/staff.ts. Tanpa ini void hanya berlaku di perangkat
     * dan transaksinya tetap terhitung sebagai omzet di pusat.
     */
    authorizedBy?: { id: string; name: string; pinHash: string }
  ) => Promise<void>;
  /** Berapa transaksi yang masih menunggu terkirim, dan kapan terakhir berhasil. */
  syncStatus: SyncStatus;
  /** Memaksa pengiriman sekarang. Dipakai tombol "coba lagi". */
  forceSync: () => void;
  holdOrder: (notes?: string) => void;
  recallHoldOrder: (orderId: string) => void;
  cancelHoldOrder: (orderId: string) => void;
  updateOrderLaundryStatus: (orderId: string, status: 'PROSES_CUCI' | 'SELESAI_SIAP_AMBIL' | 'SUDAH_DIAMBIL') => void;
  sendLaundryWaNotification: (order: Order) => string;
  
  // Inventory & Catalog CRUD
  saveProduct: (product: Product) => void;
  deleteProduct: (productId: string) => void;
  saveCategory: (category: Category) => void;
  adjustStock: (productId: string, quantityChange: number, type: 'IN' | 'OUT' | 'ADJUSTMENT', reason: string) => void;
  
  // Customer & Table CRUD
  saveCustomer: (customer: Customer) => void;
  saveTable: (table: Table) => void;
  deleteTable: (tableId: string) => void;
  updateSettings: (newSettings: StoreSettings) => void;
  activateBusinessSector: (sector: BusinessSector, customStoreName?: string) => void;
  startShift: (cashierName: string, initialCash: number) => Shift;
  endShift: (actualCash: number, notes?: string) => Shift;
  
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
 * SECTOR-AWARE SEEDS
 */
const seedCustomersFor = (_sector: BusinessSector): Customer[] => [];

const seedPromosFor = (_sector: BusinessSector): PromoCode[] => [];

/** Attendance seed follows the staff member's own sector. */
const seedAttendanceFor = (_sector: BusinessSector): AttendanceRecord[] => [];

// Immediate cleanup of legacy dummy keys across browser storage
const purgeLegacyMockData = () => {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      // Do not touch credentials, local registered users or active auth sessions
      if (
        key.includes('supabase.auth') ||
        key === 'nhpos_local_auth_users' ||
        key === 'nhpos_local_session'
      ) {
        continue;
      }
      // Purge legacy fallback keys and mock user items
      if (
        key.startsWith('mokamajoo_') ||
        key === 'newhope_users' ||
        key === 'newhope_current_user' ||
        key === 'newhope_shift' ||
        key === 'newhope_settings' ||
        key === 'newhope_orders' ||
        key.includes('usr-1') ||
        key.includes('usr-2') ||
        key.includes('usr-3') ||
        key.includes('shift-001')
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    console.error('Failed to purge legacy mock data:', e);
  }
};
purgeLegacyMockData();

export const POSProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user: authUser } = useAuth();

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

  const [activeTab, setActiveTab] = useState<'home' | 'overview' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings'>('overview');

  // Users & RBAC state
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('newhope_users');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.filter((u) => u.name !== 'Budi Santoso' && u.email !== 'budi@newhope.id');
          if (cleaned.length > 0) return cleaned;
        }
      } catch {}
    }
    return [defaultOwnerUser];
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    const saved = localStorage.getItem('newhope_current_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name !== 'Budi Santoso' && parsed.email !== 'budi@newhope.id') {
          return parsed;
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
      setCurrentUser(updatedUser);
      setUsers((prev) => {
        const filtered = prev.filter((u) => u.name !== 'Budi Santoso' && u.email !== 'budi@newhope.id' && u.id !== authUser.id);
        return [updatedUser, ...filtered];
      });
    }
  }, [authUser]);

  const [settings, setSettings] = useState<StoreSettings>(() => {
    const uId = currentUser?.id || authUser?.id || 'usr-admin';
    const loaded = loadGlobalUserData('settings', uId, INITIAL_SETTINGS);
    const storeName = authUser?.user_metadata?.store_name || authUser?.user_metadata?.full_name;
    const sector = (authUser?.user_metadata?.business_sector || authUser?.user_metadata?.sector || loaded.businessSector || 'FNB') as BusinessSector;
    return {
      ...loaded,
      storeName: storeName || (loaded.storeName && loaded.storeName !== 'New Hope POS' ? loaded.storeName : 'Toko Saya'),
      businessSector: sector,
    };
  });

  const activeSector = settings.businessSector || 'FNB';
  const defaultPreset = BUSINESS_PRESETS[activeSector] || BUSINESS_PRESETS.FNB;

  /*
   * THE TENANT. Every scoped read/write, every shared-collection filter and the
   * whole AI context derive from this one object — so there is exactly one
   * definition of "which business am I looking at".
   */
  const tenant: TenantInfo = {
    businessId: makeBusinessId(currentUser.id, activeSector),
    merchantId: currentUser.id,
    tenantId: currentUser.id,
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
    sector: activeSector,
    storeName: settings.storeName,
    ownerRef: currentUser.id,
  };

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
    getSyncStatus(makeBusinessId(currentUser.id, activeSector))
  );

  /**
   * Menjalankan pengiriman lalu menyegarkan status di layar.
   *
   * Sengaja tidak pernah melempar: pemanggil terdekatnya adalah jalur
   * penyelesaian transaksi, dan sinkronisasi yang gagal tidak boleh
   * menjatuhkan penjualan yang sudah sah.
   */
  const runSync = React.useCallback(
    async (target: SyncTarget) => {
      try {
        setSyncStatus(getSyncStatus(target.businessId, true));
        const after = await flushSync(target);
        setSyncStatus(after);
      } catch {
        setSyncStatus(getSyncStatus(target.businessId));
      }
    },
    []
  );

  const bizId = tenant.businessId;
  const storeNameForSync = settings.storeName;

  useEffect(() => {
    const target: SyncTarget = {
      businessId: bizId,
      sector: activeSector,
      storeName: storeNameForSync,
      ownerRef: currentUser.id,
    };

    // Berpindah pengguna atau sektor berarti antrian yang berbeda.
    setSyncStatus(getSyncStatus(bizId));

    // 1. Saat dibuka — mengirim apa pun yang tertinggal dari sesi sebelumnya.
    void runSync(target);

    // 2. Saat jaringan kembali. Ini pemicu terpenting bagi kasir yang seharian
    //    offline lalu masuk area ber-WiFi.
    const onOnline = () => void runSync(target);
    window.addEventListener('online', onOnline);

    // 3. Denyut berkala sebagai jaring pengaman. Event 'online' tidak selalu
    //    menyala di semua perangkat, dan server bisa saja yang tadi mati.
    const timer = window.setInterval(() => void runSync(target), 60_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [bizId, activeSector, storeNameForSync, currentUser.id, runSync]);

  const [categories, setCategories] = useState<Category[]>(() => {
    return loadScopedData('categories', currentUser.id, activeSector, defaultPreset.categories);
  });

  const [products, setProducts] = useState<Product[]>(() => {
    return loadScopedData('products', currentUser.id, activeSector, defaultPreset.products);
  });

  const [tables, setTables] = useState<Table[]>(() => {
    return loadScopedData('tables', currentUser.id, activeSector, defaultPreset.tables);
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    return loadScopedData('customers', currentUser.id, activeSector, seedCustomersFor(activeSector));
  });

  const [orders, setOrders] = useState<Order[]>(() => {
    return loadScopedData('orders', currentUser.id, activeSector, []);
  });


  const [heldOrders, setHeldOrders] = useState<Order[]>(() => {
    return loadScopedData('held_orders', currentUser.id, activeSector, []);
  });

  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>(() => {
    return loadScopedData('inventory_logs', currentUser.id, activeSector, []);
  });

  const [cashMovements, setCashMovements] = useState<CashMovement[]>(() => {
    return loadScopedData('cash_movements', authUser?.id || currentUser.id, activeSector, []);
  });

  const [shift, setShift] = useState<Shift>(() => {
    const activeCashier = authUser?.user_metadata?.full_name || currentUser.name || 'Kasir';
    const loaded = loadScopedData('shift', authUser?.id || currentUser.id, activeSector, INITIAL_SHIFT);

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

  // Reconcile shift sales strictly against active shift's completed orders
  // and cash movements (cash in, cash out/belanja, modal awal).
  useEffect(() => {
    if (shift.status === 'OPEN') {
      const shiftOrders = orders.filter((o) => o.shiftId === shift.id && o.status === 'COMPLETED');
      let cSales = 0;
      let qSales = 0;
      let cardSales = 0;
      let eSales = 0;

      shiftOrders.forEach((o) => {
        if (o.paymentMethod === 'CASH') cSales += o.total;
        else if (o.paymentMethod === 'QRIS') qSales += o.total;
        else if (o.paymentMethod === 'DEBIT' || o.paymentMethod === 'CREDIT') cardSales += o.total;
        else eSales += o.total;
      });

      const shiftMovements = cashMovements.filter((m) => m.shiftId === shift.id);
      let totalCashIn = 0;
      let totalCashOut = 0;

      shiftMovements.forEach((m) => {
        if (m.category === 'MODAL_AWAL') return;
        if (m.type === 'CASH_IN') totalCashIn += m.amount;
        else if (m.type === 'CASH_OUT') totalCashOut += m.amount;
      });

      const computedTotal = cSales + qSales + cardSales + eSales;
      const expected = Math.max(0, (shift.initialCash || 0) + cSales + totalCashIn - totalCashOut);

      if (
        shift.totalSales !== computedTotal ||
        shift.cashSales !== cSales ||
        shift.qrisSales !== qSales ||
        shift.cardSales !== cardSales ||
        shift.eWalletSales !== eSales ||
        shift.totalCashIn !== totalCashIn ||
        shift.totalCashOut !== totalCashOut ||
        shift.expectedCash !== expected
      ) {
        setShift((prev) => ({
          ...prev,
          cashSales: cSales,
          qrisSales: qSales,
          cardSales: cardSales,
          eWalletSales: eSales,
          totalSales: computedTotal,
          totalCashIn,
          totalCashOut,
          expectedCash: expected,
        }));
      }
    }
  }, [orders, cashMovements, shift.id, shift.status, shift.initialCash]);

  const [shiftHistory, setShiftHistory] = useState<Shift[]>(() => {
    return loadScopedData('shift_history', currentUser.id, activeSector, []);
  });

  const [promoCodes, setPromoCodes] = useState<PromoCode[]>(() => {
    return loadScopedData('promo_codes', currentUser.id, activeSector, seedPromosFor(activeSector));
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
    return loadGlobalUserData('staff_members', currentUser.id, INITIAL_STAFF_MEMBERS);
  });
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);

  // Stock Items State
  const [stockItems, setStockItems] = useState<StockItem[]>(() => {
    return loadScopedData('stock_items', currentUser.id, activeSector, INITIAL_STOCK_ITEMS);
  });

  // Product Bundles State
  const [bundles, setBundles] = useState<ProductBundle[]>(() => {
    return loadScopedData('bundles', currentUser.id, activeSector, INITIAL_BUNDLES);
  });

  // Attendance Logs State (Clock In / Out)
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceRecord[]>(() => {
    return loadScopedData('attendance_logs', currentUser.id, activeSector, seedAttendanceFor(activeSector));
  });

  /*
   * PENYIMPANAN LOKAL.
   *
   * Seluruh aturannya — termasuk penjaga identitas yang menutup cacat
   * penghapus data — ada di ./penyimpananPOS.ts. Dulu ia berupa tiga belas
   * efek yang hampir identik di berkas ini, dan bentuk itulah yang melahirkan
   * cacatnya: setiap efek menulis ke kunci yang diturunkan dari
   * `currentUser.id`, dan id itu ada di daftar dependensinya, sehingga ketika
   * id berubah setiap efek menulis state pengguna LAMA ke kunci pengguna BARU.
   *
   * Sekarang satu-satunya jalan menulis ke penyimpanan ber-scope adalah lewat
   * `simpan`, dan `simpan` memeriksa identitasnya sendiri. Aturannya
   * struktural, bukan sesuatu yang harus diingat empat belas kali.
   */
  const simpan = usePenyimpananPOS(
    currentUser?.id || 'usr-admin',
    settings.businessSector || 'FNB',
    (uId, sec) => {
      const preset = BUSINESS_PRESETS[sec] || BUSINESS_PRESETS.FNB;
      setCategories(loadScopedData('categories', uId, sec, preset.categories));
      setProducts(loadScopedData('products', uId, sec, preset.products));
      setTables(loadScopedData('tables', uId, sec, preset.tables));
      setStockItems(loadScopedData('stock_items', uId, sec, INITIAL_STOCK_ITEMS));
      setBundles(loadScopedData('bundles', uId, sec, INITIAL_BUNDLES));
      setOrders(loadScopedData('orders', uId, sec, []));
      setHeldOrders(loadScopedData('held_orders', uId, sec, []));
      setInventoryLogs(loadScopedData('inventory_logs', uId, sec, []));
      setShift(loadScopedData('shift', uId, sec, INITIAL_SHIFT));
      setShiftHistory(loadScopedData('shift_history', uId, sec, []));
      setCustomers(loadScopedData('customers', uId, sec, seedCustomersFor(sec)));
      setAttendanceLogs(loadScopedData('attendance_logs', uId, sec, seedAttendanceFor(sec)));
      setPromoCodes(loadScopedData('promo_codes', uId, sec, seedPromosFor(sec)));
      setCashMovements(loadScopedData('cash_movements', uId, sec, []));
    }
  );

  const kunciSimpan = simpan.kunci;

  useEffect(() => { simpan.scoped('categories', categories); }, [categories, kunciSimpan]);
  useEffect(() => { simpan.scoped('tables', tables); }, [tables, kunciSimpan]);
  useEffect(() => { simpan.scoped('bundles', bundles); }, [bundles, kunciSimpan]);
  useEffect(() => { simpan.scoped('held_orders', heldOrders); }, [heldOrders, kunciSimpan]);
  useEffect(() => { simpan.scoped('shift', shift); }, [shift, kunciSimpan]);
  useEffect(() => { simpan.scoped('customers', customers); }, [customers, kunciSimpan]);
  useEffect(() => { simpan.scoped('attendance_logs', attendanceLogs); }, [attendanceLogs, kunciSimpan]);
  useEffect(() => { simpan.scoped('promo_codes', promoCodes); }, [promoCodes, kunciSimpan]);
  useEffect(() => { simpan.scoped('cash_movements', cashMovements); }, [cashMovements, kunciSimpan]);

  // Data milik AKUN, bukan unit usaha: satu daftar staf dan satu setelan
  // dipakai lintas seluruh usaha milik pemilik yang sama.
  useEffect(() => { simpan.global('settings', settings); }, [settings, currentUser.id]);
  useEffect(() => { simpan.global('staff_members', staffMembers); }, [staffMembers, currentUser.id]);

  /*
   * RIWAYAT YANG BISA TUMBUH — dibatasi, dengan jenjang mundur saat kuota
   * penuh. 500 order kira-kira 500 KB, jauh di dalam anggaran 5 MB, dan
   * menutupi hari tersibuk yang masuk akal untuk satu outlet. Rentang yang
   * lebih panjang dibaca dari server (src/lib/sync/riwayat.ts).
   *
   * TIDAK ditunda, tidak seperti katalog produk: penundaan berarti jendela di
   * mana penjualan yang baru dibayar belum ada di penyimpanan, dan tablet yang
   * mati di jendela itu kehilangan struk terakhirnya.
   */
  useEffect(() => {
    simpan.scopedTerbatas('orders', orders, [500, 200, 50]);
  }, [orders, kunciSimpan]);

  useEffect(() => {
    simpan.scopedTerbatas('inventory_logs', inventoryLogs, [500, 200, 50]);
  }, [inventoryLogs, kunciSimpan]);

  useEffect(() => {
    simpan.scopedTerbatas('shift_history', shiftHistory, [30, 10]);
  }, [shiftHistory, kunciSimpan]);

  /*
   * KATALOG DAN BAHAN BAKU DITUNDA 2 detik.
   *
   * Keduanya berubah pada SETIAP transaksi karena stoknya berkurang, dan
   * menulis katalog penuh ratusan kali dalam satu jam sibuk menahan kasir di
   * depan pelanggan. Boleh ditunda karena tulisan terakhir yang terlewat tidak
   * menghilangkan apa pun — berbeda dari penjualan.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => simpan.scoped('products', products), 2_000);
    return () => window.clearTimeout(timer);
  }, [products, kunciSimpan]);

  useEffect(() => {
    const timer = window.setTimeout(() => simpan.scoped('stock_items', stockItems), 2_000);
    return () => window.clearTimeout(timer);
  }, [stockItems, kunciSimpan]);

  /*
   * SINKRONISASI KATALOG.
   *
   * Dikirim utuh, bukan yang berubah saja — lihat alasannya di endpoint
   * /api/v1/sync/catalog. Tanpa ini, produk hanya sampai ke database kalau ia
   * TERJUAL, sehingga produk yang tidak pernah laku — justru yang paling perlu
   * diketahui pemilik — tidak akan pernah muncul di panel.
   *
   * Ditunda 8 detik dan di-reset setiap perubahan. `products` ikut berubah pada
   * SETIAP penjualan karena stoknya berkurang; tanpa penundaan, satu jam sibuk
   * akan mengirim ratusan katalog identik.
   */
  useEffect(() => {
    if (products.length === 0) return;

    const timer = window.setTimeout(() => {
      void pushCatalog(
        {
          businessId: makeBusinessId(currentUser.id, activeSector),
          sector: activeSector,
          storeName: settings.storeName,
          ownerRef: currentUser.id,
        },
        products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          costPrice: p.costPrice,
          unit: p.unit,
          description: p.description,
          categoryName: categories.find((c) => c.id === p.categoryId)?.name,
          isAvailable: p.isAvailable,
        }))
      );
    }, 8_000);

    return () => window.clearTimeout(timer);
  }, [products, categories, currentUser.id, activeSector, settings.storeName]);

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
    // Shared collection: stamp the partition key so the row can never be read
    // by another business unit.
    const newStaff: StaffMember = stampBusiness(
      { ...staff, sector: staff.sector || activeSector, id: newId('stf') },
      tenant
    );
    setStaffMembers((prev) => [newStaff, ...prev]);
    if (soundEnabled) playPOSSound('click');
  };

  const branches = settings.branches || INITIAL_BRANCHES;
  const activeBranch = branches.find((b) => b.id === settings.activeBranchId) || branches[0];

  const setActiveBranchId = (branchId: string) => {
    setSettings((prev) => ({ ...prev, activeBranchId: branchId }));
  };

  const saveBranch = (branchToSave: StoreBranch) => {
    setSettings((prev) => {
      const existing = prev.branches || INITIAL_BRANCHES;
      const idx = existing.findIndex((b) => b.id === branchToSave.id);
      let updated: StoreBranch[];
      if (idx >= 0) {
        updated = [...existing];
        updated[idx] = branchToSave;
      } else {
        updated = [branchToSave, ...existing];
      }
      return { ...prev, branches: updated };
    });
    if (soundEnabled) playPOSSound('click');
  };

  const deleteBranch = (branchId: string) => {
    setSettings((prev) => {
      const existing = prev.branches || INITIAL_BRANCHES;
      const updated = existing.filter((b) => b.id !== branchId);
      return { ...prev, branches: updated };
    });
    if (soundEnabled) playPOSSound('delete');
  };

  const clockInStaff = (
    staffId: string,
    notes?: string,
    geoInfo?: GeoLocationInfo,
    branchInfo?: { id: string; name: string }
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
  useEffect(() => { localStorage.setItem('newhope_users', JSON.stringify(users)); }, [users]);
  useEffect(() => { localStorage.setItem('newhope_current_user', JSON.stringify(currentUser)); }, [currentUser]);
  /*
   * `cash_movements` DULU ditulis dua kali: sekali bersama koleksi ber-scope
   * lainnya di bawah `currentUser.id`, dan sekali lagi di sini di bawah
   * `authUser?.id || currentUser.id`.
   *
   * Selama keduanya sama, yang kedua hanya mubazir. Ketika berbeda — dan
   * keduanya memang berbeda pada beberapa render pertama, sebelum sesi selesai
   * dimuat — kas tercatat di DUA kunci yang berbeda, dan yang dibaca kembali
   * hanya salah satunya. Penulisnya kini satu, dengan identitas yang sama
   * seperti seluruh koleksi lain.
   */

  const switchUser = (user: User) => {
    const oldUId = currentUser.id;
    const currentSec = settings.businessSector || 'FNB';

    // 1. Save old user's sector state before switching
    localStorage.setItem(getScopedKey('categories', oldUId, currentSec), JSON.stringify(categories));
    localStorage.setItem(getScopedKey('products', oldUId, currentSec), JSON.stringify(products));
    localStorage.setItem(getScopedKey('tables', oldUId, currentSec), JSON.stringify(tables));
    localStorage.setItem(getScopedKey('stock_items', oldUId, currentSec), JSON.stringify(stockItems));
    simpanBerjenjang(getScopedKey('orders', oldUId, currentSec), orders, [500, 200, 50]);
    localStorage.setItem(getScopedKey('held_orders', oldUId, currentSec), JSON.stringify(heldOrders));
    simpanBerjenjang(getScopedKey('inventory_logs', oldUId, currentSec), inventoryLogs, [500, 200, 50]);
    localStorage.setItem(getScopedKey('shift', oldUId, currentSec), JSON.stringify(shift));
    localStorage.setItem(getScopedKey('shift_history', oldUId, currentSec), JSON.stringify(shiftHistory.slice(0, 30)));
    localStorage.setItem(getScopedKey('customers', oldUId, currentSec), JSON.stringify(customers));
    localStorage.setItem(getScopedKey('attendance_logs', oldUId, currentSec), JSON.stringify(attendanceLogs));
    localStorage.setItem(getScopedKey('promo_codes', oldUId, currentSec), JSON.stringify(promoCodes));
    localStorage.setItem(getScopedKey('cash_movements', oldUId, currentSec), JSON.stringify(cashMovements));

    // 2. Set new user
    setCurrentUser(user);

    const newUId = user.id;
    const userSettings = loadGlobalUserData('settings', newUId, INITIAL_SETTINGS);
    const userSec = userSettings.businessSector || 'FNB';
    const preset = BUSINESS_PRESETS[userSec] || BUSINESS_PRESETS.FNB;

    setSettings(userSettings);
    setCategories(loadScopedData('categories', newUId, userSec, preset.categories));
    setProducts(loadScopedData('products', newUId, userSec, preset.products));
    setTables(loadScopedData('tables', newUId, userSec, preset.tables));
    setStockItems(loadScopedData('stock_items', newUId, userSec, INITIAL_STOCK_ITEMS));
    setOrders(loadScopedData('orders', newUId, userSec, []));
    setHeldOrders(loadScopedData('held_orders', newUId, userSec, []));
    setInventoryLogs(loadScopedData('inventory_logs', newUId, userSec, []));
    const loadedShift = loadScopedData('shift', newUId, userSec, INITIAL_SHIFT);
    setShift({
      ...loadedShift,
      cashierName: user.name,
    });
    setShiftHistory(loadScopedData('shift_history', newUId, userSec, []));

    setCustomers(loadScopedData('customers', newUId, userSec, seedCustomersFor(userSec)));
    setAttendanceLogs(loadScopedData('attendance_logs', newUId, userSec, seedAttendanceFor(userSec)));
    setPromoCodes(loadScopedData('promo_codes', newUId, userSec, seedPromosFor(userSec)));
    setCashMovements(loadScopedData('cash_movements', newUId, userSec, []));
    // Staff roster stays per-account (one roster across the merchant's
    // businesses); the exposed list is filtered to the active sector.
    setStaffMembers(loadGlobalUserData('staff_members', newUId, INITIAL_STAFF_MEMBERS));

    clearCart();
    if (soundEnabled) playPOSSound('click');
  };

  const saveUser = (userToSave: User) => {
    setUsers((prev) => {
      const exists = prev.some((u) => u.id === userToSave.id);
      if (exists) {
        return prev.map((u) => (u.id === userToSave.id ? userToSave : u));
      }
      return [...prev, userToSave];
    });
    if (userToSave.id === currentUser.id) {
      setCurrentUser(userToSave);
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
          totalPrice: rupiahPositif(unitPrice * newQty - item.discountAmount),
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
        totalPrice: rupiahPositif(unitPrice * quantity),
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
          // Seluruh aritmetika uang lewat src/lib/money.ts. Sebelumnya diskon
          // dihitung tanpa pembulatan di sini, sehingga satu baris berpecahan
          // merambat sampai ke kembalian yang diserahkan kasir.
          const { diskon, neto } = hitungDiskonBaris(
            item.unitPrice, newQty, item.discountPercent, item.discountAmount);
          return { ...item, quantity: newQty, discountAmount: diskon, totalPrice: neto };
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
          const { diskon, neto } = hitungDiskonBaris(
            item.unitPrice, item.quantity, discountPercent, discountAmount);
          return { ...item, discountPercent, discountAmount: diskon, totalPrice: neto };
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
    completionDate?: string
  ): Order | null => {
    if (cart.length === 0) return null;

    // Subtotal dijumlahkan dari baris yang SUDAH bulat, jadi hasilnya bulat.
    // hitungTotal membulatkan pajak dan service dengan aturan yang sama.
    const { subtotal, pajak: taxTotal, service: serviceChargeTotal, total: grandTotal } = hitungTotal({
      subtotal: cart.reduce((sum, item) => sum + item.totalPrice, 0),
      pakaiPajak: settings.enableTax,
      pajakPersen: settings.taxRate,
      pakaiService: settings.enableService,
      servicePersen: settings.serviceRate,
    });

    let changeAmount = 0;
    if (paymentMethod === 'CASH' && cashReceived) {
      changeAmount = hitungKembalian(cashReceived, grandTotal);
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
    const laundryDefaultCompletion = isLaundry ? 'Besok, 16:00 WIB' : undefined;

    const newOrder: Order = {
      id: invoiceNum,
      orderNumber: orders.length + 1,
      date: new Date().toISOString(),
      items: [...cart],
      orderType,
      onlineChannel: (orderType === 'ONLINE' || orderType === 'DELIVERY') ? channel : undefined,
      tableId: selectedTable?.id,
      tableName: selectedTable?.name,
      customer: selectedCustomer || undefined,
      servedByStaffId: selectedStaff?.id,
      servedByStaffName: selectedStaff?.name || shift.cashierName,
      subtotal,
      discountTotal: rupiahPositif(cart.reduce((sum, i) => sum + i.discountAmount, 0)),
      taxTotal,
      serviceChargeTotal,
      total: grandTotal,
      paymentMethod,
      paymentStatus: 'PAID',
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
    };

    // Track Dual-Event to PostHog Telemetry (Non-PII)
    posthogTelemetry.trackTransactionCompleted({
      transactionId: newOrder.id,
      totalAmount: newOrder.total,
      itemCount: newOrder.items.reduce((s, i) => s + i.quantity, 0),
      paymentMethod: newOrder.paymentMethod,
      orderType: newOrder.orderType,
      tenantId: currentUser.id,
      userRole: currentUser.role,
    });

    // 1. Update Product Stock & Add Inventory Log
    // Everything is computed up-front so the state updaters below stay pure
    // (React may invoke an updater more than once — side effects inside them
    // would duplicate the logs and double-deduct raw material stock).
    const soldQtyByProduct = new Map<string, number>();
    cart.forEach((item) => {
      soldQtyByProduct.set(item.productId, (soldQtyByProduct.get(item.productId) || 0) + item.quantity);
    });

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
    if (selectedTable) {
      setTables((prevTables) =>
        prevTables.map((t) => (t.id === selectedTable.id ? { ...t, status: 'AVAILABLE', currentOrderId: undefined } : t))
      );
    }

    // 4. Update Shift Sales Summary
    setShift((prevShift) => {
      let cashSales = prevShift.cashSales;
      let qrisSales = prevShift.qrisSales;
      let cardSales = prevShift.cardSales;
      let eWalletSales = prevShift.eWalletSales;

      if (paymentMethod === 'CASH') cashSales += grandTotal;
      else if (paymentMethod === 'QRIS') qrisSales += grandTotal;
      else if (paymentMethod === 'DEBIT' || paymentMethod === 'CREDIT') cardSales += grandTotal;
      else eWalletSales += grandTotal;

      const totalSales = cashSales + qrisSales + cardSales + eWalletSales;
      return {
        ...prevShift,
        cashSales,
        qrisSales,
        cardSales,
        eWalletSales,
        totalSales,
        expectedCash: prevShift.initialCash + cashSales,
      };
    });

    // 5. Add Order to list
    setOrders((prevOrders) => [newOrder, ...prevOrders]);

    // 6. Antrikan untuk sinkronisasi.
    //
    // enqueue() menulis ke localStorage secara sinkron SEBELUM baris berikutnya
    // berjalan — jadi kalau tab tertutup tepat setelah ini, transaksinya tetap
    // terkirim saat aplikasi dibuka lagi. Pengirimannya sendiri sengaja tidak
    // di-await: kasir tidak boleh menunggu jaringan untuk menyelesaikan
    // penjualan.
    enqueueSync(tenant.businessId, orderToPayload(newOrder, currentUser.role));
    setSyncStatus(getSyncStatus(tenant.businessId));
    void runSync(syncTarget);

    if (soundEnabled) playPOSSound('payment_success');

    clearCart();
    return newOrder;
  };

  // Void / Cancel Order
  const voidOrder = async (
    orderId: string,
    reason = 'Kesalahan Input Kasir',
    authorizedBy?: { id: string; name: string; pinHash: string }
  ) => {
    const targetOrder = orders.find((o) => o.id === orderId);
    if (!targetOrder || targetOrder.status === 'VOID') return;

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
    // Bukti otorisasi dibuat DI SINI, terikat ke clientTxnId transaksi ini.
    // PIN apa adanya tidak pernah masuk antrian — lihat
    // src/lib/auth/voidAuthorization.ts.
    const otorisasi = authorizedBy
      ? {
          authorizedByRef: authorizedBy.id,
          authorizationProof: await buatBuktiOtorisasi(authorizedBy.pinHash, targetOrder.id),
        }
      : undefined;

    enqueueSync(
      tenant.businessId,
      orderToPayload(
        { ...targetOrder, status: 'VOID', paymentStatus: 'CANCELLED' },
        currentUser.role,
        otorisasi
      )
    );
    setSyncStatus(getSyncStatus(tenant.businessId));
    void runSync(syncTarget);

    // 2. Restore Product Stock & Create Inventory Refund Log
    const returnedQtyByProduct = new Map<string, number>();
    targetOrder.items.forEach((item) => {
      returnedQtyByProduct.set(
        item.productId,
        (returnedQtyByProduct.get(item.productId) || 0) + item.quantity
      );
    });

    const refundTimestamp = new Date().toISOString();
    const refundLogs: InventoryLog[] = [];

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
    });

    setProducts((prevProducts) =>
      prevProducts.map((p) => {
        const totalQtyReturned = returnedQtyByProduct.get(p.id);
        return totalQtyReturned ? { ...p, stock: p.stock + totalQtyReturned } : p;
      })
    );

    if (refundLogs.length > 0) {
      setInventoryLogs((logs) => [...refundLogs, ...logs]);
    }

    // 3. Deduct from Shift Sales Summary if completed
    if (targetOrder.status === 'COMPLETED') {
      setShift((prevShift) => {
        let cashSales = prevShift.cashSales;
        let qrisSales = prevShift.qrisSales;
        let cardSales = prevShift.cardSales;
        let eWalletSales = prevShift.eWalletSales;

        if (targetOrder.paymentMethod === 'CASH') cashSales = Math.max(0, cashSales - targetOrder.total);
        else if (targetOrder.paymentMethod === 'QRIS') qrisSales = Math.max(0, qrisSales - targetOrder.total);
        else if (targetOrder.paymentMethod === 'DEBIT' || targetOrder.paymentMethod === 'CREDIT') cardSales = Math.max(0, cardSales - targetOrder.total);
        else eWalletSales = Math.max(0, eWalletSales - targetOrder.total);

        const totalSales = Math.max(0, cashSales + qrisSales + cardSales + eWalletSales);
        return {
          ...prevShift,
          cashSales,
          qrisSales,
          cardSales,
          eWalletSales,
          totalSales,
          expectedCash: Math.max(0, prevShift.initialCash + cashSales),
        };
      });
    }

    if (soundEnabled) playPOSSound('delete');
  };

  // Hold Order
  const holdOrder = (notes?: string) => {
    if (cart.length === 0) return;
    const subtotal = cart.reduce((sum, i) => sum + i.totalPrice, 0);
    const invoiceNum = generateInvoiceNumber(orders.length + heldOrders.length);

    const held: Order = {
      id: invoiceNum,
      orderNumber: orders.length + heldOrders.length + 1,
      date: new Date().toISOString(),
      items: [...cart],
      orderType,
      tableId: selectedTable?.id,
      tableName: selectedTable?.name,
      customer: selectedCustomer || undefined,
      subtotal,
      discountTotal: rupiahPositif(cart.reduce((s, i) => s + i.discountAmount, 0)),
      taxTotal: settings.enableTax ? persenDari(subtotal, settings.taxRate) : 0,
      serviceChargeTotal: settings.enableService ? persenDari(subtotal, settings.serviceRate) : 0,
      total: subtotal,
      paymentMethod: 'CASH',
      paymentStatus: 'PENDING',
      cashierName: shift.cashierName,
      shiftId: shift.id,
      status: 'HOLD',
      notes,
    };

    if (selectedTable) {
      setTables((prev) =>
        prev.map((t) => (t.id === selectedTable.id ? { ...t, status: 'OCCUPIED', currentOrderId: held.id } : t))
      );
    }

    setHeldOrders((prev) => [held, ...prev]);
    clearCart();
  };

  const recallHoldOrder = (orderId: string) => {
    const target = heldOrders.find((o) => o.id === orderId);
    if (!target) return;

    setCart(target.items);
    setOrderType(target.orderType);
    if (target.customer) setSelectedCustomer(target.customer);
    if (target.tableId) {
      const tbl = tables.find((t) => t.id === target.tableId);
      if (tbl) setSelectedTable(tbl);
    }

    setHeldOrders((prev) => prev.filter((o) => o.id !== orderId));
    setActiveTab('pos');
  };

  const cancelHoldOrder = (orderId: string) => {
    setHeldOrders((prev) => prev.filter((o) => o.id !== orderId));
  };

  // Save / Edit Product
  const saveProduct = (product: Product) => {
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
    const preset = BUSINESS_PRESETS[sector];
    if (!preset) return;

    const uId = currentUser.id;
    const currentSec = settings.businessSector || 'FNB';

    // 1. Save current sector state to its own scoped storage before switching
    localStorage.setItem(getScopedKey('categories', uId, currentSec), JSON.stringify(categories));
    localStorage.setItem(getScopedKey('products', uId, currentSec), JSON.stringify(products));
    localStorage.setItem(getScopedKey('tables', uId, currentSec), JSON.stringify(tables));
    localStorage.setItem(getScopedKey('stock_items', uId, currentSec), JSON.stringify(stockItems));
    simpanBerjenjang(getScopedKey('orders', uId, currentSec), orders, [500, 200, 50]);
    localStorage.setItem(getScopedKey('held_orders', uId, currentSec), JSON.stringify(heldOrders));
    simpanBerjenjang(getScopedKey('inventory_logs', uId, currentSec), inventoryLogs, [500, 200, 50]);
    localStorage.setItem(getScopedKey('shift', uId, currentSec), JSON.stringify(shift));
    localStorage.setItem(getScopedKey('shift_history', uId, currentSec), JSON.stringify(shiftHistory.slice(0, 30)));
    localStorage.setItem(getScopedKey('customers', uId, currentSec), JSON.stringify(customers));
    localStorage.setItem(getScopedKey('attendance_logs', uId, currentSec), JSON.stringify(attendanceLogs));
    localStorage.setItem(getScopedKey('promo_codes', uId, currentSec), JSON.stringify(promoCodes));
    localStorage.setItem(getScopedKey('cash_movements', uId, currentSec), JSON.stringify(cashMovements));

    // 2. Load target sector state
    const targetCategories = loadScopedData('categories', uId, sector, preset.categories);
    const targetProducts = loadScopedData('products', uId, sector, preset.products);
    const targetTables = loadScopedData('tables', uId, sector, preset.tables);
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

    const storeName = customStoreName || preset.defaultStoreName;

    const newSettings: StoreSettings = {
      ...settings,
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

    setSelectedCategory(targetCategories[0]?.id || 'ALL');
    clearCart();

    if (soundEnabled) playPOSSound('payment_success');
  };

  const startShift = (cashierName: string, initialCash: number): Shift => {
    const sId = newId('shift');
    const newShift: Shift = {
      id: sId,
      cashierName,
      startTime: new Date().toISOString(),
      initialCash,
      cashSales: 0,
      qrisSales: 0,
      cardSales: 0,
      eWalletSales: 0,
      totalSales: 0,
      totalCashIn: 0,
      totalCashOut: 0,
      expectedCash: initialCash,
      totalOrders: 0,
      status: 'OPEN',
    };
    setShift(newShift);

    if (initialCash > 0) {
      const initialLog: CashMovement = {
        id: newId('csh'),
        type: 'CASH_IN',
        category: 'MODAL_AWAL',
        amount: initialCash,
        description: `Modal Awal Kasir Shift (${cashierName})`,
        timestamp: new Date().toISOString(),
        cashierName,
        shiftId: sId,
        businessSector: activeSector,
        userId: authUser?.id || currentUser.id,
      };
      setCashMovements((prev) => [initialLog, ...prev]);
    }

    return newShift;
  };

  const endShift = (actualCash: number, notes?: string): Shift => {
    const shiftOrdersCount = orders.filter(
      (o) => o.shiftId === shift.id && o.status === 'COMPLETED'
    ).length;

    const shiftMovements = cashMovements.filter((m) => m.shiftId === shift.id);
    let totalCashIn = 0;
    let totalCashOut = 0;

    shiftMovements.forEach((m) => {
      if (m.category === 'MODAL_AWAL') return;
      if (m.type === 'CASH_IN') totalCashIn += m.amount;
      else if (m.type === 'CASH_OUT') totalCashOut += m.amount;
    });

    const endedShift: Shift = {
      ...shift,
      endTime: new Date().toISOString(),
      actualCash,
      totalCashIn,
      totalCashOut,
      difference: actualCash - shift.expectedCash,
      totalOrders: shiftOrdersCount,
      notes: notes || shift.notes,
      status: 'CLOSED',
    };
    setShift(endedShift);
    setShiftHistory((prev) => [endedShift, ...prev]);
    return endedShift;
  };

  const addCashMovement = (
    type: CashMovementType,
    category: CashMovementCategory,
    amount: number,
    description: string,
    recipientOrSource?: string
  ): CashMovement => {
    const activeCashier = authUser?.user_metadata?.full_name || currentUser.name || 'Kasir';
    const movement: CashMovement = {
      id: newId('csh'),
      type,
      category,
      amount: Math.abs(amount),
      description: description.trim(),
      timestamp: new Date().toISOString(),
      cashierName: activeCashier,
      shiftId: shift.id,
      businessSector: activeSector,
      userId: authUser?.id || currentUser.id,
      recipientOrSource: recipientOrSource?.trim(),
    };

    setCashMovements((prev) => [movement, ...prev]);

    if (category === 'MODAL_AWAL') {
      setShift((prev) => ({
        ...prev,
        initialCash: Math.abs(amount),
      }));
    }

    if (soundEnabled) playPOSSound('click');
    return movement;
  };

  const deleteCashMovement = (id: string) => {
    setCashMovements((prev) => prev.filter((m) => m.id !== id));
    if (soundEnabled) playPOSSound('delete');
  };

  const setInitialCash = (amount: number) => {
    const val = Math.max(0, amount);
    setShift((prev) => ({
      ...prev,
      initialCash: val,
    }));
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
        addPromoCode,
        branches,
        activeBranch,
        setActiveBranchId,
        saveBranch,
        deleteBranch,
        staffMembers: sectorStaffMembers,
        allStaffMembers: staffMembers,
        selectedStaff: scopedSelectedStaff,
        setSelectedStaff,
        addStaffMember,
        attendanceLogs,
        clockInStaff,
        clockOutStaff,
        getActiveAttendance,
        stockItems,
        saveStockItem,
        deleteStockItem,
        adjustStockItemQuantity,
        bundles,
        saveBundle,
        deleteBundle,
        users,
        currentUser,
        switchUser,
        saveUser,
        deleteUser,
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
        processPayment,
        voidOrder,
        syncStatus,
        forceSync: () => void runSync(syncTarget),
        holdOrder,
        recallHoldOrder,
        cancelHoldOrder,
        updateOrderLaundryStatus,
        sendLaundryWaNotification,
        saveProduct,
        deleteProduct,
        saveCategory,
        adjustStock,
        saveCustomer,
        saveTable,
        deleteTable,
        updateSettings,
        activateBusinessSector,
        startShift,
        endShift,
        cashMovements,
        addCashMovement,
        deleteCashMovement,
        setInitialCash,
      }}
    >
      {/* Anything below can read the active business unit via useTenant(). */}
      <TenantProvider value={tenant}>{children}</TenantProvider>
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
