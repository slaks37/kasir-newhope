import React, { Suspense, lazy, useState } from 'react';
import { POSProvider } from './context/POSContext';
import {WorkspaceBusinessProvider,useWorkspaceBusiness} from './context/WorkspaceBusinessContext';
import { useWorkspaceShell } from './context/POSDomains';
import {navigate,useWorkspaceRoute} from './lib/navigation/workspaceRouter';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { MobileNavBar } from './components/MobileNavBar';
import { ProductGrid } from './components/pos/ProductGrid';
const VariantModal=lazy(()=>import('./components/pos/VariantModal').then(m=>({default:m.VariantModal})));
import { CartPanel } from './components/pos/CartPanel';
const CustomerSelectModal=lazy(()=>import('./components/pos/CustomerSelectModal').then(m=>({default:m.CustomerSelectModal})));
const CheckoutModal=lazy(()=>import('./components/pos/CheckoutModal').then(m=>({default:m.CheckoutModal})));
const ReceiptModal=lazy(()=>import('./components/pos/ReceiptModal').then(m=>({default:m.ReceiptModal})));
const HoldOrdersModal=lazy(()=>import('./components/pos/HoldOrdersModal').then(m=>({default:m.HoldOrdersModal})));
const RecentTransactionsModal=lazy(()=>import('./components/pos/RecentTransactionsModal').then(m=>({default:m.RecentTransactionsModal})));
const ShiftManagerModal=lazy(()=>import('./components/pos/ShiftManagerModal').then(m=>({default:m.ShiftManagerModal})));
const ClockInModal=lazy(()=>import('./components/pos/ClockInModal').then(m=>({default:m.ClockInModal})));
const SwitchUserModal=lazy(()=>import('./components/auth/SwitchUserModal').then(m=>({default:m.SwitchUserModal})));
const PinAuthorizationModal=lazy(()=>import('./components/auth/PinAuthorizationModal').then(m=>({default:m.PinAuthorizationModal})));
const SubscriptionLockScreen=lazy(()=>import('./components/auth/SubscriptionLockScreen').then(m=>({default:m.SubscriptionLockScreen})));
import { subscriptionAccess } from './config/subscriptionPolicy';
import { isFreePlan } from './config/freePlanPolicy';
const FreePlanSelection=lazy(()=>import('./components/auth/FreePlanSelection').then(m=>({default:m.FreePlanSelection})));
import { OutletSetupGate } from './components/auth/OutletSetupGate';
import { Product, ProductVariant, SelectedModifier, Order, PermissionFeature } from './types';
import { formatRupiah } from './utils/formatters';
import { Lock, ShieldAlert, KeyRound, ArrowLeft, RefreshCw, Loader2, ShoppingBag } from 'lucide-react';

/*
 * CODE SPLITTING
 *
 * The cashier opens on Home/POS and often never leaves them, but these four
 * tabs were dragging their whole dependency graph into the first paint:
 *   AIAssistant      -> the assistant engine (insights + intent router)
 *   ReportsDashboard -> recharts
 *   InventoryManager -> the largest screen in the app
 *   SettingsManager  -> subscription + RBAC + branch management
 *
 * Loading them on demand keeps the initial bundle to what a cashier actually
 * needs to take the first order. React.lazy needs a default export, hence the
 * .then() shim around each named export.
 */
const InventoryManager = lazy(() =>
  import('./components/inventory/InventoryManager').then((m) => ({ default: m.InventoryManager }))
);
const MyBusinesses=lazy(()=>import('./components/businesses/MyBusinesses').then(m=>({default:m.MyBusinesses})));
const OverviewPage=lazy(()=>import('./components/overview/OverviewPage').then(m=>({default:m.OverviewPage})));
const TableManager=lazy(()=>import('./components/tables/TableManager').then(m=>({default:m.TableManager})));
const CustomerManager=lazy(()=>import('./components/customers/CustomerManager').then(m=>({default:m.CustomerManager})));
const ReportsDashboard = lazy(() =>
  import('./components/reports/ReportsDashboard').then((m) => ({ default: React.memo(m.ReportsDashboard) }))
);
const AIAssistant = lazy(() =>
  import('./components/ai/AIAssistant').then((m) => ({ default: m.AIAssistant }))
);
const SettingsManager = lazy(() =>
  import('./components/settings/SettingsManager').then((m) => ({ default: m.SettingsManager }))
);
const SmartLaborManager = lazy(() =>
  import('./components/labor/SmartLaborManager').then((m) => ({ default: m.SmartLaborManager }))
);
const SubscriptionPaymentPage = lazy(() =>
  import('./components/payment/SubscriptionPaymentPage').then((m) => ({ default: m.SubscriptionPaymentPage }))
);

const TabLoading: React.FC = () => (
  <div className="flex-1 flex items-center justify-center bg-slate-50/70">
    <div className="flex items-center gap-2.5 text-slate-500 text-xs font-semibold">
      <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
      <span>Memuat halaman…</span>
    </div>
  </div>
);

/** Catches render errors in AIAssistant so the full app doesn't white-screen. */
class AIErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(err: unknown) {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-50/70 p-8 text-center">
          <ShieldAlert className="w-10 h-10 text-rose-400 mb-3" />
          <p className="font-bold text-slate-700">Smart Assistant mengalami kesalahan.</p>
          <p className="text-xs text-slate-500 mt-1 mb-4 max-w-sm">{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-sm flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Coba Lagi
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface POSAppContentProps {
  onGoToHome?: () => void;
  onLogout?: () => void;
}

const POSAppContent: React.FC<POSAppContentProps> = ({ onGoToHome, onLogout }) => {
  const route=useWorkspaceRoute();
  const checkoutIntent=new URLSearchParams(route.split('?')[1]||'').get('intent');
  const [editFreeSelection,setEditFreeSelection]=useState(false);
  const {
    activeTab,
    setActiveTab,
    cart,
    addToCart,
    settings,
    currentUser,
    hasPermission,
  } = useWorkspaceShell();

  // Modals state
  const [selectedProductForVariant, setSelectedProductForVariant] = useState<Product | null>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showHoldOrdersModal, setShowHoldOrdersModal] = useState(false);
  const [showRecentTransactionsModal, setShowRecentTransactionsModal] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showSwitchUserModal, setShowSwitchUserModal] = useState(false);
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [showNavAuthModal, setShowNavAuthModal] = useState(false);
  const [showMobileCartSheet, setShowMobileCartSheet] = useState(false);
  const [completedOrderForReceipt, setCompletedOrderForReceipt] = useState<Order | null>(null);

  const isTabAllowed = hasPermission(activeTab as PermissionFeature);

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCartAmount = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  const free = isFreePlan(settings.subscription);
  const isSubscriptionLocked = !free && (settings.subscription?.status === 'EXPIRED' ||
    settings.subscription?.status === 'PENDING_PAYMENT' ||
    settings.subscription?.accessMode === 'RESTRICTED');

  const isPaymentRequired = !free && isSubscriptionLocked;

  React.useEffect(() => {
    if (isPaymentRequired) {
      if (activeTab !== 'payment') {
        setActiveTab('payment');
      }
    }
  }, [isPaymentRequired, activeTab, setActiveTab]);

  const handleProductSelect = React.useCallback((product: Product) => {
    if (
      (product.variants && product.variants.length > 0) ||
      (product.modifierGroups && product.modifierGroups.length > 0)
    ) {
      setSelectedProductForVariant(product);
    } else {
      addToCart(product);
    }
  },[addToCart]);

  const handleAddToCartWithVariant = (
    product: Product,
    variant?: ProductVariant,
    selectedModifiers?: SelectedModifier[],
    quantity?: number,
    notes?: string
  ) => {
    addToCart(product, variant, selectedModifiers, quantity, notes);
  };

  const handlePaymentSuccess = (order: Order) => {
    setShowCheckoutModal(false);
    setCompletedOrderForReceipt(order);
  };

  return (
    <div className="nh-workspace flex flex-col h-[100dvh] w-screen overflow-hidden bg-slate-100/80 text-slate-900 font-sans select-none pb-14 lg:pb-0">
      {/* Top Header Bar */}
      <Header
        onOpenRecentTransactions={() => setShowRecentTransactionsModal(true)}
        onOpenHoldOrders={() => setShowHoldOrdersModal(true)}
        onOpenSwitchUser={() => setShowSwitchUserModal(true)}
        onOpenClockIn={() => setShowClockInModal(true)}
        onLogout={onLogout}
      />

      {/* Main Container */}
      {free && <div className="nh-free-banner">
        <span>Free selamanya · 10 produk · 1 cabang · Owner saja · Tanpa AI</span>
        <button onClick={()=>setEditFreeSelection(true)}>Ubah pilihan</button>
      </div>}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Navigation Sidebar (Desktop only) */}
        <div className="hidden lg:flex shrink-0">
          <Sidebar
            onOpenAiCopilot={() => setActiveTab('ai')}
            onOpenEndShift={() => setShowShiftModal(true)}
            onOpenClockIn={() => setShowClockInModal(true)}
            onGoToHome={onGoToHome}
            isPaymentRequired={isPaymentRequired}
          />
        </div>

        {/* View Switcher Container */}
        <main className="flex-1 min-w-0 flex overflow-hidden bg-slate-100/60 relative">
          {isPaymentRequired ? (
            <Suspense fallback={<TabLoading />}>
              <SubscriptionPaymentPage />
            </Suspense>
          ) : !isTabAllowed ? (
            /* RBAC Restricted Access View Guard */
            <div className="flex-1 flex items-center justify-center p-6 bg-slate-50">
              <div className="bg-white border border-slate-200 rounded-3xl p-8 max-w-lg w-full text-center shadow-xl space-y-5 animate-scale-up">
                <div className="w-16 h-16 rounded-3xl bg-rose-100 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto shadow-inner">
                  <Lock className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-black text-slate-900">Akses Modul Dibatasi</h3>
                  <p className="text-slate-500 text-xs leading-relaxed max-w-md mx-auto">
                    Pengguna <b>{currentUser.name}</b> dengan role <b>{currentUser.role}</b> tidak memiliki wewenang untuk mengakses modul <b>{activeTab.toUpperCase()}</b>.
                  </p>
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    onClick={() => setActiveTab('overview')}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition-all flex items-center justify-center space-x-1.5"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Kembali ke Overview</span>
                  </button>

                  <button
                    onClick={() => setShowNavAuthModal(true)}
                    className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-1.5"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>PIN Manager Override</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'home' && (
                <Suspense fallback={<TabLoading/>}><OverviewPage onBackToHome={onGoToHome} /></Suspense>
              )}

              {activeTab === 'overview' && (
                <Suspense fallback={<TabLoading/>}><OverviewPage onBackToHome={onGoToHome} /></Suspense>
              )}

              {activeTab === 'pos' && (
                <>
                  {/* Product Catalog & Search Column */}
                  <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-200 relative">
                    <ProductGrid onSelectProduct={handleProductSelect} />

                    {/* Mobile Floating Bottom Cart Bar */}
                    {totalCartCount > 0 && (
                      <div className="lg:hidden fixed bottom-16 left-3 right-3 z-30 animate-slide-up">
                        <button
                          onClick={() => setShowMobileCartSheet(true)}
                          className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 p-3 rounded-2xl shadow-xl flex items-center justify-between border border-amber-400 active:scale-[0.98] transition-all cursor-pointer"
                        >
                          <div className="flex items-center space-x-2.5">
                            <span className="w-6 h-6 rounded-full bg-slate-950 text-amber-400 text-xs font-black flex items-center justify-center">
                              {totalCartCount}
                            </span>
                            <span className="text-xs font-black text-slate-950">Lihat Keranjang</span>
                          </div>
                          <span className="font-mono font-black text-sm text-slate-950">
                            {formatRupiah(totalCartAmount)}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Desktop Right Cart Column */}
                    <CartPanel
                      onOpenCheckout={() => setShowCheckoutModal(true)}
                      onOpenCustomerSelect={() => setShowCustomerModal(true)}
                      onOpenHoldOrders={() => setShowHoldOrdersModal(true)}
                      onOpenRecentTransactions={() => setShowRecentTransactionsModal(true)}
                    />
                </>
              )}

              {activeTab === 'tables' && <Suspense fallback={<TabLoading/>}><TableManager /></Suspense>}

              {activeTab === 'inventory' && (
                <Suspense fallback={<TabLoading />}>
                  <InventoryManager />
                </Suspense>
              )}

              {activeTab === 'customers' && <Suspense fallback={<TabLoading/>}><CustomerManager /></Suspense>}

              {activeTab === 'reports' && (
                <Suspense fallback={<TabLoading />}>
                  <ReportsDashboard />
                </Suspense>
              )}

              {activeTab === 'ai' && free && <div className="p-6">AI tidak aktif pada paket Free. Upgrade ke Plus atau Pro untuk menggunakan AI.</div>}
              {activeTab === 'ai' && !free && (
                <AIErrorBoundary>
                  <Suspense fallback={<TabLoading />}>
                    <AIAssistant />
                  </Suspense>
                </AIErrorBoundary>
              )}

              {activeTab === 'settings' && (
                <Suspense fallback={<TabLoading />}>
                  <SettingsManager />
                </Suspense>
              )}
              {activeTab==='businesses'&&<Suspense fallback={<TabLoading/>}><MyBusinesses/></Suspense>}

              {activeTab === 'labor' && (
                <Suspense fallback={<TabLoading />}>
                  <SmartLaborManager />
                </Suspense>
              )}

              {activeTab === 'payment' && (
                <Suspense fallback={<TabLoading />}>
                  <SubscriptionPaymentPage key={checkoutIntent||'default'} />
                </Suspense>
              )}
            </>
          )}
        </main>
      </div>

      <Suspense fallback={<div role="status" className="fixed bottom-20 right-4 rounded-xl bg-white p-3 shadow">Memuat tindakan…</div>}>
      {/* Product Variant & Modifiers Modal */}
      {selectedProductForVariant && (
        <VariantModal
          product={selectedProductForVariant}
          onClose={() => setSelectedProductForVariant(null)}
          onAddToCart={handleAddToCartWithVariant}
        />
      )}

      {/* One responsive cart implementation for both desktop and mobile. */}
      {showMobileCartSheet && (
        <CartPanel
          isMobileModal
          onCloseMobile={() => setShowMobileCartSheet(false)}
          onOpenCheckout={() => { setShowMobileCartSheet(false); setShowCheckoutModal(true); }}
          onOpenCustomerSelect={() => { setShowMobileCartSheet(false); setShowCustomerModal(true); }}
          onOpenHoldOrders={() => { setShowMobileCartSheet(false); setShowHoldOrdersModal(true); }}
          onOpenRecentTransactions={() => { setShowMobileCartSheet(false); setShowRecentTransactionsModal(true); }}
        />
      )}

      {/* Mobile Bottom Navigation Bar */}
      <MobileNavBar
        onOpenAiCopilot={() => setActiveTab('ai')}
        onOpenEndShift={() => setShowShiftModal(true)}
        onOpenClockIn={() => setShowClockInModal(true)}
        onOpenSwitchUser={() => setShowSwitchUserModal(true)}
        onGoToHome={onGoToHome}
        isPaymentRequired={isPaymentRequired}
      />

      {showCustomerModal && (
        <CustomerSelectModal onClose={() => setShowCustomerModal(false)} />
      )}

      {showCheckoutModal && (
        <CheckoutModal
          onClose={() => setShowCheckoutModal(false)}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}

      {completedOrderForReceipt && (
        <ReceiptModal
          order={completedOrderForReceipt}
          settings={settings}
          onClose={() => setCompletedOrderForReceipt(null)}
        />
      )}

      {showHoldOrdersModal && (
        <HoldOrdersModal onClose={() => setShowHoldOrdersModal(false)} />
      )}

      {showRecentTransactionsModal && (
        <RecentTransactionsModal onClose={() => setShowRecentTransactionsModal(false)} />
      )}

      {free && (!settings.subscription?.freeSelection || settings.subscription.freeSelection.sector!==settings.businessSector || editFreeSelection) && <FreePlanSelection onClose={settings.subscription?.freeSelection?.sector===settings.businessSector?()=>setEditFreeSelection(false):undefined}/>}
      {!isPaymentRequired && ['pos','tables'].includes(activeTab) && <OutletSetupGate onManagePlan={intent=>navigate('/subscription'+(intent?'?intent='+intent:''))} />}
      {!free && activeTab !== 'payment' && (() => {
        const sub = settings.subscription;
        if (!sub) return null;
        const access = subscriptionAccess(sub);
        const isLocked = sub.status === 'EXPIRED' ||
          sub.accessMode === 'RESTRICTED' ||
          sub.status === 'PENDING_PAYMENT' ||
          access.accessMode === 'RESTRICTED';
        return isLocked ? <SubscriptionLockScreen onRenewSuccess={() => {}} /> : null;
      })()}

      {showShiftModal && (
        <ShiftManagerModal onClose={() => setShowShiftModal(false)} />
      )}

      {showSwitchUserModal && (
        <SwitchUserModal
          onClose={() => setShowSwitchUserModal(false)}
          onLogout={onLogout}
        />
      )}

      {showClockInModal && (
        <ClockInModal onClose={() => setShowClockInModal(false)} />
      )}

      {showNavAuthModal && (
        <PinAuthorizationModal
          title={`Buka Kunci Akses (${activeTab.toUpperCase()})`}
          description="Masukkan PIN Manager atau Admin untuk membuka akses halaman ini."
          requiredRoles={['ADMIN', 'MANAGER']}
          onClose={() => setShowNavAuthModal(false)}
          onAuthorized={() => {
            setShowNavAuthModal(false);
          }}
        />
      )}
      </Suspense>
    </div>
  );
};

export function Workspace({userId,onGoToHome,onLogout}:{userId:string;onGoToHome:()=>void;onLogout:()=>void}){
  return <WorkspaceBusinessProvider key={userId}><SelectedWorkspace onGoToHome={onGoToHome} onLogout={onLogout}/></WorkspaceBusinessProvider>;
}
function SelectedWorkspace({onGoToHome,onLogout}:{onGoToHome:()=>void;onLogout:()=>void}){
  const {business,outletId}=useWorkspaceBusiness();
  return <POSProvider key={business.businessId+':'+(outletId||'')}><Suspense fallback={<TabLoading/>}><POSAppContent onGoToHome={onGoToHome} onLogout={onLogout}/></Suspense></POSProvider>;
}
