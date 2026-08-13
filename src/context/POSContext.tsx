import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
} from '../data/initialData';
import { generateInvoiceNumber, playPOSSound } from '../utils/formatters';
import { newId } from '../lib/ids';

interface POSContextType {
  /**
   * The active business unit + signed-in user. Partition key for all scoped
   * data and the sole source of AI scoping. Also available via `useTenant()`.
   */
  tenant: TenantInfo;

  activeTab: 'home' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings';
  setActiveTab: (tab: 'home' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings') => void;
  
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

  // RBAC & User Management
  users: User[];
  currentUser: User;
  switchUser: (user: User) => void;
  saveUser: (user: User) => void;
  deleteUser: (userId: string) => void;
  hasPermission: (feature: PermissionFeature) => boolean;
  verifyPin: (pin: string, requiredRoles?: UserRole[]) => { success: boolean; user?: User; message?: string };
  
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
  voidOrder: (orderId: string, reason?: string) => void;
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

const loadScopedData = <T,>(entity: string, userId: string, sector: BusinessSector, fallback: T): T => {
  try {
    const key = getScopedKey(entity, userId, sector);
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved);

    // Fallback migration check for FNB or initial legacy keys
    if (sector === 'FNB') {
      const legacy = localStorage.getItem(`newhope_${entity}`) || localStorage.getItem(`mokamajoo_${entity}`);
      if (legacy) return JSON.parse(legacy);
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

    const legacy = localStorage.getItem(`newhope_${entity}`) || localStorage.getItem(`mokamajoo_${entity}`);
    if (legacy) return JSON.parse(legacy);
  } catch (e) {
    console.error(`Failed to load global user data for ${entity}:`, e);
  }
  return fallback;
};

/*
 * SECTOR-AWARE SEEDS
 *
 * Customers, promo codes and attendance used to be stored per-user only, so a
 * cafe and a laundry run by the same merchant shared one list. Now that they are
 * sector-scoped, each sector needs its own starting point — otherwise every
 * sector would open with the identical demo rows and still *look* mixed.
 *
 * FNB is the default sector and keeps the demo data; other sectors start clean
 * and fill up from real transactions.
 */
const seedCustomersFor = (sector: BusinessSector): Customer[] =>
  sector === 'FNB' ? INITIAL_CUSTOMERS : [];

const seedPromosFor = (sector: BusinessSector): PromoCode[] =>
  sector === 'FNB' ? INITIAL_PROMO_CODES : [];

/** Attendance seed follows the staff member's own sector. */
const seedAttendanceFor = (sector: BusinessSector): AttendanceRecord[] =>
  INITIAL_ATTENDANCE_LOGS.filter((rec) => {
    const staff = INITIAL_STAFF_MEMBERS.find((s) => s.id === rec.staffId);
    return ((staff?.sector || rec.businessSector || 'FNB') as BusinessSector) === sector;
  });

/**
 * 12-Hour Demo Data Lifecycle
 *
 * Menghapus data demo lokal dan mengembalikan data ke kondisi default bersih
 * setiap 12 jam (43.200.000 ms) agar sesi demo pengunjung selalu segar.
 */
const DEMO_LIFECYCLE_HOURS = 12;
const DEMO_RESET_INTERVAL_MS = DEMO_LIFECYCLE_HOURS * 60 * 60 * 1000;
const DEMO_TIMESTAMP_KEY = 'newhope_demo_session_created_at';

const enforce12HourDemoReset = () => {
  try {
    const rawTimestamp = localStorage.getItem(DEMO_TIMESTAMP_KEY);
    const now = Date.now();

    if (!rawTimestamp) {
      localStorage.setItem(DEMO_TIMESTAMP_KEY, now.toString());
      return;
    }

    const createdAt = parseInt(rawTimestamp, 10);
    if (isNaN(createdAt) || now - createdAt >= DEMO_RESET_INTERVAL_MS) {
      console.warn(`[Demo Lifecycle] 12 jam telah tercapai. Mereset data demo ke default bersih.`);
      
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('newhope_') || key.startsWith('mokamajoo_') || key.startsWith('scoped_'))) {
          // Jangan hapus token Supabase Auth kalau ada
          if (!key.includes('supabase.auth')) {
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(DEMO_TIMESTAMP_KEY, now.toString());
    }
  } catch (e) {
    console.error('Failed to enforce 12-hour demo reset:', e);
  }
};

// Jalankan saat script dimuat
enforce12HourDemoReset();

export const POSProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(() => {
    // Cek berkala setiap 5 menit jika browser tetap terbuka
    const interval = setInterval(() => {
      enforce12HourDemoReset();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const [activeTab, setActiveTab] = useState<'home' | 'pos' | 'tables' | 'inventory' | 'customers' | 'reports' | 'ai' | 'settings'>('home');

  // Users & RBAC state
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('newhope_users');
    return saved ? JSON.parse(saved) : INITIAL_USERS;
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    const saved = localStorage.getItem('newhope_current_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse current user', e);
      }
    }
    return INITIAL_USERS[0];
  });

  const [settings, setSettings] = useState<StoreSettings>(() => {
    const uId = currentUser?.id || 'usr-admin';
    return loadGlobalUserData('settings', uId, INITIAL_SETTINGS);
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
    return loadScopedData('orders', currentUser.id, activeSector, INITIAL_HISTORICAL_ORDERS);
  });

  const [heldOrders, setHeldOrders] = useState<Order[]>(() => {
    return loadScopedData('held_orders', currentUser.id, activeSector, []);
  });

  const [inventoryLogs, setInventoryLogs] = useState<InventoryLog[]>(() => {
    return loadScopedData('inventory_logs', currentUser.id, activeSector, []);
  });

  const [shift, setShift] = useState<Shift>(() => {
    return loadScopedData('shift', currentUser.id, activeSector, INITIAL_SHIFT);
  });

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

  // Attendance Logs State (Clock In / Out)
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceRecord[]>(() => {
    return loadScopedData('attendance_logs', currentUser.id, activeSector, seedAttendanceFor(activeSector));
  });

  // Sync state to LocalStorage scoped per User and Sector
  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('categories', uId, sec), JSON.stringify(categories));
  }, [categories, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('products', uId, sec), JSON.stringify(products));
  }, [products, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('tables', uId, sec), JSON.stringify(tables));
  }, [tables, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('stock_items', uId, sec), JSON.stringify(stockItems));
  }, [stockItems, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('orders', uId, sec), JSON.stringify(orders));
  }, [orders, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('held_orders', uId, sec), JSON.stringify(heldOrders));
  }, [heldOrders, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('inventory_logs', uId, sec), JSON.stringify(inventoryLogs));
  }, [inventoryLogs, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('shift', uId, sec), JSON.stringify(shift));
  }, [shift, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('shift_history', uId, sec), JSON.stringify(shiftHistory));
  }, [shiftHistory, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    localStorage.setItem(getGlobalUserKey('settings', uId), JSON.stringify(settings));
  }, [settings, currentUser.id]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('customers', uId, sec), JSON.stringify(customers));
  }, [customers, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    localStorage.setItem(getGlobalUserKey('staff_members', uId), JSON.stringify(staffMembers));
  }, [staffMembers, currentUser.id]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('attendance_logs', uId, sec), JSON.stringify(attendanceLogs));
  }, [attendanceLogs, currentUser.id, settings.businessSector]);

  useEffect(() => {
    const uId = currentUser?.id || 'usr-admin';
    const sec = settings.businessSector || 'FNB';
    localStorage.setItem(getScopedKey('promo_codes', uId, sec), JSON.stringify(promoCodes));
  }, [promoCodes, currentUser.id, settings.businessSector]);

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
          stock: p.stock,
          minStockAlert: p.minStockAlert,
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

  const switchUser = (user: User) => {
    const oldUId = currentUser.id;
    const currentSec = settings.businessSector || 'FNB';

    // 1. Save old user's sector state before switching
    localStorage.setItem(getScopedKey('categories', oldUId, currentSec), JSON.stringify(categories));
    localStorage.setItem(getScopedKey('products', oldUId, currentSec), JSON.stringify(products));
    localStorage.setItem(getScopedKey('tables', oldUId, currentSec), JSON.stringify(tables));
    localStorage.setItem(getScopedKey('stock_items', oldUId, currentSec), JSON.stringify(stockItems));
    localStorage.setItem(getScopedKey('orders', oldUId, currentSec), JSON.stringify(orders));
    localStorage.setItem(getScopedKey('held_orders', oldUId, currentSec), JSON.stringify(heldOrders));
    localStorage.setItem(getScopedKey('inventory_logs', oldUId, currentSec), JSON.stringify(inventoryLogs));
    localStorage.setItem(getScopedKey('shift', oldUId, currentSec), JSON.stringify(shift));
    localStorage.setItem(getScopedKey('shift_history', oldUId, currentSec), JSON.stringify(shiftHistory));
    localStorage.setItem(getScopedKey('customers', oldUId, currentSec), JSON.stringify(customers));
    localStorage.setItem(getScopedKey('attendance_logs', oldUId, currentSec), JSON.stringify(attendanceLogs));
    localStorage.setItem(getScopedKey('promo_codes', oldUId, currentSec), JSON.stringify(promoCodes));

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
    setShift(loadScopedData('shift', newUId, userSec, INITIAL_SHIFT));
    setShiftHistory(loadScopedData('shift_history', newUId, userSec, []));

    setCustomers(loadScopedData('customers', newUId, userSec, seedCustomersFor(userSec)));
    setAttendanceLogs(loadScopedData('attendance_logs', newUId, userSec, seedAttendanceFor(userSec)));
    setPromoCodes(loadScopedData('promo_codes', newUId, userSec, seedPromosFor(userSec)));
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

  const verifyPin = (pinInput: string, requiredRoles?: UserRole[]) => {
    const matchedUser = users.find((u) => u.pin === pinInput && u.status === 'ACTIVE');
    if (!matchedUser) {
      return { success: false, message: 'PIN Salah atau akun pengguna tidak aktif!' };
    }
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(matchedUser.role)) {
      return {
        success: false,
        message: `Akses Ditolak! Memerlukan PIN dengan role: ${requiredRoles.join(' / ')}`,
      };
    }
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
    completionDate?: string
  ): Order | null => {
    if (cart.length === 0) return null;

    const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
    const taxTotal = settings.enableTax ? Math.round((subtotal * settings.taxRate) / 100) : 0;
    const serviceChargeTotal = settings.enableService ? Math.round((subtotal * settings.serviceRate) / 100) : 0;
    const grandTotal = subtotal + taxTotal + serviceChargeTotal;

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
      discountTotal: cart.reduce((sum, i) => sum + i.discountAmount, 0),
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
  const voidOrder = (orderId: string, reason = 'Kesalahan Input Kasir') => {
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
    enqueueSync(
      tenant.businessId,
      orderToPayload({ ...targetOrder, status: 'VOID', paymentStatus: 'CANCELLED' }, currentUser.role)
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
      discountTotal: cart.reduce((s, i) => s + i.discountAmount, 0),
      taxTotal: settings.enableTax ? Math.round((subtotal * settings.taxRate) / 100) : 0,
      serviceChargeTotal: settings.enableService ? Math.round((subtotal * settings.serviceRate) / 100) : 0,
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
    localStorage.setItem(getScopedKey('orders', uId, currentSec), JSON.stringify(orders));
    localStorage.setItem(getScopedKey('held_orders', uId, currentSec), JSON.stringify(heldOrders));
    localStorage.setItem(getScopedKey('inventory_logs', uId, currentSec), JSON.stringify(inventoryLogs));
    localStorage.setItem(getScopedKey('shift', uId, currentSec), JSON.stringify(shift));
    localStorage.setItem(getScopedKey('shift_history', uId, currentSec), JSON.stringify(shiftHistory));
    localStorage.setItem(getScopedKey('customers', uId, currentSec), JSON.stringify(customers));
    localStorage.setItem(getScopedKey('attendance_logs', uId, currentSec), JSON.stringify(attendanceLogs));
    localStorage.setItem(getScopedKey('promo_codes', uId, currentSec), JSON.stringify(promoCodes));

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

    setSelectedCategory(targetCategories[0]?.id || 'ALL');
    clearCart();

    if (soundEnabled) playPOSSound('payment_success');
  };

  const startShift = (cashierName: string, initialCash: number): Shift => {
    const newShift: Shift = {
      id: newId('shift'),
      cashierName,
      startTime: new Date().toISOString(),
      initialCash,
      cashSales: 0,
      qrisSales: 0,
      cardSales: 0,
      eWalletSales: 0,
      totalSales: 0,
      expectedCash: initialCash,
      totalOrders: 0,
      status: 'OPEN',
    };
    setShift(newShift);
    return newShift;
  };

  const endShift = (actualCash: number, notes?: string): Shift => {
    const shiftOrdersCount = orders.filter(
      (o) => o.shiftId === shift.id && o.status === 'COMPLETED'
    ).length;

    const endedShift: Shift = {
      ...shift,
      endTime: new Date().toISOString(),
      actualCash,
      difference: actualCash - shift.expectedCash,
      totalOrders: shiftOrdersCount,
      notes: notes || shift.notes,
      status: 'CLOSED',
    };
    setShift(endedShift);
    setShiftHistory((prev) => [endedShift, ...prev]);
    return endedShift;
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
