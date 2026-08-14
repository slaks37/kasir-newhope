import React, { Suspense, lazy, useState } from 'react';
import { POSProvider, usePOS } from './context/POSContext';
import { useAuth } from './context/AuthContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { MobileNavBar } from './components/MobileNavBar';
import { ProductGrid } from './components/pos/ProductGrid';
import { VariantModal } from './components/pos/VariantModal';
import { CartPanel } from './components/pos/CartPanel';
import { CustomerSelectModal } from './components/pos/CustomerSelectModal';
import { CheckoutModal } from './components/pos/CheckoutModal';
import { ReceiptModal } from './components/pos/ReceiptModal';
import { HoldOrdersModal } from './components/pos/HoldOrdersModal';
import { RecentTransactionsModal } from './components/pos/RecentTransactionsModal';
import { ShiftManagerModal } from './components/pos/ShiftManagerModal';
import { ClockInModal } from './components/pos/ClockInModal';
import { LoginPage } from './components/auth/LoginPage';
import { HomePage } from './components/home/HomePage';
import { OverviewPage } from './components/overview/OverviewPage';
import { TableManager } from './components/tables/TableManager';
import { CustomerManager } from './components/customers/CustomerManager';
import { SwitchUserModal } from './components/auth/SwitchUserModal';
import { PinAuthorizationModal } from './components/auth/PinAuthorizationModal';
import { SubscriptionLockScreen } from './components/auth/SubscriptionLockScreen';
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
const ReportsDashboard = lazy(() =>
  import('./components/reports/ReportsDashboard').then((m) => ({ default: m.ReportsDashboard }))
);
const AIAssistant = lazy(() =>
  import('./components/ai/AIAssistant').then((m) => ({ default: m.AIAssistant }))
);
const SettingsManager = lazy(() =>
  import('./components/settings/SettingsManager').then((m) => ({ default: m.SettingsManager }))
);

const TabLoading: React.FC = () => (
  <div className="flex-1 flex items-center justify-center bg-slate-50/70">
    <div className="flex items-center gap-2.5 text-slate-500 text-xs font-semibold">
      <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
      <span>Memuat halaman…</span>
    </div>
  </div>
);

interface POSAppContentProps {
  onBackToHome?: () => void;
}

const POSAppContent: React.FC<POSAppContentProps> = ({ onBackToHome }) => {
  const {
    activeTab,
    setActiveTab,
    cart,
    addToCart,
    settings,
    currentUser,
    hasPermission,
  } = usePOS();

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

  const handleProductSelect = (product: Product) => {
    if (
      (product.variants && product.variants.length > 0) ||
      (product.modifierGroups && product.modifierGroups.length > 0)
    ) {
      setSelectedProductForVariant(product);
    } else {
      addToCart(product);
    }
  };

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
    <div className="flex flex-col h-[100dvh] w-screen overflow-hidden bg-slate-100/80 text-slate-900 font-sans select-none pb-14 lg:pb-0">
      {/* Top Header Bar */}
      <Header
        onOpenRecentTransactions={() => setShowRecentTransactionsModal(true)}
        onOpenHoldOrders={() => setShowHoldOrdersModal(true)}
        onOpenSwitchUser={() => setShowSwitchUserModal(true)}
        onOpenClockIn={() => setShowClockInModal(true)}
      />

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Navigation Sidebar (Desktop only) */}
        <div className="hidden lg:flex shrink-0">
          <Sidebar
            onOpenAiCopilot={() => setActiveTab('ai')}
            onOpenEndShift={() => setShowShiftModal(true)}
            onOpenClockIn={() => setShowClockInModal(true)}
            onGoToHome={onBackToHome}
          />
        </div>

        {/* View Switcher Container */}
        <main className="flex-1 flex overflow-hidden bg-slate-100/60 relative">
          {!isTabAllowed ? (
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
                <HomePage
                  onStartDemo={() => setActiveTab('pos')}
                  onOpenLogin={() => {}}
                />
              )}

              {activeTab === 'overview' && (
                <OverviewPage onBackToHome={onBackToHome} />
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
                          className="w-full bg-slate-900 text-white p-3 rounded-2xl shadow-xl flex items-center justify-between border border-slate-700/80 active:scale-[0.98] transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 font-extrabold text-xs flex items-center justify-center shadow-xs">
                              {totalCartCount}
                            </div>
                            <div className="text-left">
                              <span className="text-[10px] text-slate-400 block leading-tight">Total Pesanan</span>
                              <span className="text-sm font-extrabold text-amber-400 leading-tight">{formatRupiah(totalCartAmount)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs font-extrabold bg-amber-500 text-slate-950 px-3.5 py-1.5 rounded-xl shadow-xs">
                            <span>Buka Keranjang</span>
                            <span className="text-sm font-bold">➔</span>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Desktop Right Order Cart Panel */}
                  <CartPanel
                    onOpenCustomerSelect={() => setShowCustomerModal(true)}
                    onOpenCheckout={() => setShowCheckoutModal(true)}
                    onOpenHoldOrders={() => setShowHoldOrdersModal(true)}
                    onOpenRecentTransactions={() => setShowRecentTransactionsModal(true)}
                  />
                </>
              )}

              {activeTab === 'tables' && <TableManager />}
              {activeTab === 'customers' && <CustomerManager />}

              {/* Lazily loaded tabs — see the code-splitting note above. */}
              <Suspense fallback={<TabLoading />}>
                {activeTab === 'inventory' && <InventoryManager />}
                {activeTab === 'reports' && <ReportsDashboard />}
                {activeTab === 'ai' && <AIAssistant />}
                {activeTab === 'settings' && <SettingsManager />}
              </Suspense>
            </>
          )}
        </main>
      </div>

      {/* Global Modals */}
      {selectedProductForVariant && (
        <VariantModal
          product={selectedProductForVariant}
          onClose={() => setSelectedProductForVariant(null)}
          onAddToCart={handleAddToCartWithVariant}
        />
      )}

      {/* Mobile Cart Bottom Sheet Drawer */}
      {showMobileCartSheet && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-t-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-slide-up border-t border-slate-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-amber-500" />
                <h3 className="font-extrabold text-sm text-slate-900">Keranjang Pesanan ({totalCartCount})</h3>
              </div>
              <button
                onClick={() => setShowMobileCartSheet(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <CartPanel
                onOpenCustomerSelect={() => {
                  setShowMobileCartSheet(false);
                  setShowCustomerModal(true);
                }}
                onOpenCheckout={() => {
                  setShowMobileCartSheet(false);
                  setShowCheckoutModal(true);
                }}
                onOpenHoldOrders={() => {
                  setShowMobileCartSheet(false);
                  setShowHoldOrdersModal(true);
                }}
                onOpenRecentTransactions={() => {
                  setShowMobileCartSheet(false);
                  setShowRecentTransactionsModal(true);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar */}
      <MobileNavBar
        onOpenAiCopilot={() => setActiveTab('ai')}
        onOpenEndShift={() => setShowShiftModal(true)}
        onOpenClockIn={() => setShowClockInModal(true)}
        onOpenSwitchUser={() => setShowSwitchUserModal(true)}
        onGoToHome={onBackToHome}
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

      {settings.subscription?.status === 'EXPIRED' && (
        <SubscriptionLockScreen onRenewSuccess={() => {}} />
      )}

      {showShiftModal && (
        <ShiftManagerModal onClose={() => setShowShiftModal(false)} />
      )}

      {showSwitchUserModal && (
        <SwitchUserModal onClose={() => setShowSwitchUserModal(false)} />
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
    </div>
  );
};

export function App() {
  const { user, loading } = useAuth();
  const [guestMode, setGuestMode] = useState<boolean>(() => {
    return localStorage.getItem('newhope_pos_guest_mode') === 'true';
  });
  const [authView, setAuthView] = useState<'home' | 'login' | 'register'>(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'login' || hash === 'register') return hash;
    return 'home';
  });

  React.useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'login' || hash === 'register') {
        setAuthView(hash);
      } else if (hash === '') {
        setAuthView('home');
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleStartDemo = () => {
    localStorage.setItem('newhope_pos_guest_mode', 'true');
    setGuestMode(true);
  };

  const handleBackToHome = () => {
    localStorage.removeItem('newhope_pos_guest_mode');
    setGuestMode(false);
    setAuthView('home');
  };

  // Loading spinner saat mengecek sesi awal.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
          <p className="text-slate-400 text-sm font-semibold">Memuat New Hope POS…</p>
        </div>
      </div>
    );
  }

  // Jika belum login dan belum masuk mode demo kasir:
  if (!user && !guestMode) {
    if (authView === 'login' || authView === 'register') {
      return (
        <LoginPage
          onBackToLanding={() => { window.location.hash = ''; }}
          onStartDemo={handleStartDemo}
          initialMode={authView}
        />
      );
    }
    return (
      <POSProvider>
        <div className="min-h-screen bg-slate-50 flex flex-col">
          <HomePage
            isStandaloneLanding={true}
            onStartDemo={handleStartDemo}
            onOpenLogin={() => { window.location.hash = 'login'; }}
            onOpenRegister={() => { window.location.hash = 'register'; }}
          />
        </div>
      </POSProvider>
    );
  }

  return (
    <POSProvider>
      <POSAppContent onBackToHome={handleBackToHome} />
    </POSProvider>
  );
}

export default App;
