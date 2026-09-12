import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  CheckCircle2,
  ShieldCheck,
  CreditCard,
  Sparkles,
  Zap,
  Coffee,
  ShoppingBag,
  Shirt,
  Scissors,
  Car,
  QrCode,
  ArrowRight,
  Check,
  Loader2,
  Info,
  AlertCircle,
  Clock,
  ChevronRight,
  RefreshCw,
  Gift,
} from 'lucide-react';
import { usePOS } from '../../context/POSContext';
import { useAuth } from '../../context/AuthContext';
import { PAID_SAAS_PLANS, annualTotal, findSaaSPlan, TRIAL_PLAN_ID, TRIAL_DAYS } from '../../config/saasPlans';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { BusinessSector } from '../../types';

interface QuoteResponse {
  ok: boolean;
  planId: string;
  planName: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
  amount: number;
  recurringAmount: number;
  unusedCredit: number;
  extraOutlets: number;
  periodStart: string;
  periodEnd: string;
}

export const SubscriptionPaymentPage: React.FC = () => {
  const { settings, updateSettings, setActiveTab } = usePOS();
  const { user } = useAuth();

  // Check if user just arrived from onboarding
  const [isOnboarding, setIsOnboarding] = useState<boolean>(() => {
    return Boolean(sessionStorage.getItem('nhpos_pending_checkout_plan'));
  });

  // Selected plan state
  const [selectedPlanId, setSelectedPlanId] = useState<string>(() => {
    const pending = sessionStorage.getItem('nhpos_pending_checkout_plan');
    if (pending && (pending === 'plan-plus-monthly' || pending === 'plan-pro-monthly')) {
      return pending;
    }
    return 'plan-plus-monthly';
  });

  const [yearly, setYearly] = useState<boolean>(true);
  const [extraOutlets, setExtraOutlets] = useState<number>(0);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState<boolean>(false);
  const [checkoutLoading, setCheckoutLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Success Celebration State
  const [paymentSuccess, setPaymentSuccess] = useState<{
    planName: string;
    billingCycle: string;
    validUntil: string;
    invoiceNumber: string;
  } | null>(null);

  const selectedPlan = findSaaSPlan(selectedPlanId) || PAID_SAAS_PLANS[0];

  // Map sector to readable label and icon
  const getSectorMeta = (sector: BusinessSector) => {
    switch (sector) {
      case 'FNB':
        return { label: 'Resto & Kafe', icon: Coffee, color: 'text-amber-600 bg-amber-100/80 border-amber-200' };
      case 'RETAIL':
        return { label: 'Toko Ritel', icon: ShoppingBag, color: 'text-blue-600 bg-blue-100/80 border-blue-200' };
      case 'LAUNDRY':
        return { label: 'Laundry', icon: Shirt, color: 'text-cyan-600 bg-cyan-100/80 border-cyan-200' };
      case 'BARBERSHOP':
        return { label: 'Barbershop', icon: Scissors, color: 'text-violet-600 bg-violet-100/80 border-violet-200' };
      case 'CARWASH':
        return { label: 'Carwash', icon: Car, color: 'text-emerald-600 bg-emerald-100/80 border-emerald-200' };
      default:
        return { label: 'Usaha Umum', icon: Coffee, color: 'text-slate-600 bg-slate-100 border-slate-200' };
    }
  };

  const sectorMeta = getSectorMeta(settings.businessSector || 'FNB');
  const SectorIcon = sectorMeta.icon;

  // Request real-time quote whenever plan, cycle, or extra outlets change
  useEffect(() => {
    let isCurrent = true;
    const fetchQuote = async () => {
      setQuoteLoading(true);
      setError(null);
      try {
        const cycle = yearly ? 'YEARLY' : 'MONTHLY';
        const res = await fetch('/api/v1/subscription/prorated-upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planId: selectedPlanId,
            billingCycle: cycle,
            extraOutlets,
          }),
        });

        if (!res.ok) {
          // Fallback quote calculation locally if API unavailable
          const basePrice = yearly ? annualTotal(selectedPlan) : selectedPlan.priceIdr;
          const outletPrice = yearly
            ? (selectedPlan.extraOutletYearlyIdr || 760320) * extraOutlets
            : (selectedPlan.extraOutletPriceIdr || 79200) * extraOutlets;
          const totalAmount = basePrice + outletPrice;
          const now = new Date();
          const end = new Date(now);
          if (yearly) end.setFullYear(end.getFullYear() + 1);
          else end.setMonth(end.getMonth() + 1);

          if (isCurrent) {
            setQuote({
              ok: true,
              planId: selectedPlan.id,
              planName: selectedPlan.name,
              billingCycle: cycle,
              amount: totalAmount,
              recurringAmount: totalAmount,
              unusedCredit: 0,
              extraOutlets,
              periodStart: now.toISOString(),
              periodEnd: end.toISOString(),
            });
          }
          return;
        }

        const data = await res.json();
        if (isCurrent && data.ok) {
          setQuote(data);
        }
      } catch {
        // Fallback for offline/dev
        const basePrice = yearly ? annualTotal(selectedPlan) : selectedPlan.priceIdr;
        const outletPrice = yearly
          ? (selectedPlan.extraOutletYearlyIdr || 760320) * extraOutlets
          : (selectedPlan.extraOutletPriceIdr || 79200) * extraOutlets;
        const now = new Date();
        const end = new Date(now);
        if (yearly) end.setFullYear(end.getFullYear() + 1);
        else end.setMonth(end.getMonth() + 1);

        if (isCurrent) {
          setQuote({
            ok: true,
            planId: selectedPlan.id,
            planName: selectedPlan.name,
            billingCycle: yearly ? 'YEARLY' : 'MONTHLY',
            amount: basePrice + outletPrice,
            recurringAmount: basePrice + outletPrice,
            unusedCredit: 0,
            extraOutlets,
            periodStart: now.toISOString(),
            periodEnd: end.toISOString(),
          });
        }
      } finally {
        if (isCurrent) setQuoteLoading(false);
      }
    };

    fetchQuote();
    return () => {
      isCurrent = false;
    };
  }, [selectedPlanId, yearly, extraOutlets, selectedPlan]);

  // Trigger celebration confetti
  const fireConfetti = () => {
    confetti({
      particleCount: 120,
      spread: 70,
      origin: { y: 0.6 },
    });
  };

  // Handle DOKU Checkout
  const handleProceedToPayment = async () => {
    if (!quote) return;
    setCheckoutLoading(true);
    setError(null);

    const requestKey = crypto.randomUUID();

    try {
      const res = await fetch('/api/v1/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: quote.planId,
          billingCycle: quote.billingCycle,
          extraOutlets: quote.extraOutlets,
          requestKey,
        }),
      });

      const result = await res.json();

      if (res.ok && result.ok && result.paymentUrl && result.paymentUrl.startsWith('https://')) {
        // Redirect to DOKU Checkout Gateway
        sessionStorage.removeItem('nhpos_pending_checkout_plan');
        window.location.assign(result.paymentUrl);
        return;
      }

      // If DOKU Gateway is not configured or in dev fallback mode
      throw new Error(result.error || 'Gateway pembayaran sedang dalam konfigurasi.');
    } catch (err: any) {
      console.warn('DOKU checkout not completed:', err.message);
      // If payment gateway isn't connected yet in local sandbox, allow simulated completion
      setError(
        err.message?.includes('PAYMENT_GATEWAY_NOT_CONFIGURED') || err.message?.includes('PUBLIC_APP_URL')
          ? 'Gateway pembayaran DOKU sedang dalam mode sandbox/dev. Anda dapat menggunakan tombol "Simulasi Bayar (Dev Mode)" di bawah untuk mengaktifkan paket secara instan.'
          : err.message || 'Gagal memulai checkout. Silakan coba kembali.'
      );
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Instant Activation / Simulated Payment (Dev & Demo Friendly)
  const handleSimulatePaymentSuccess = () => {
    sessionStorage.removeItem('nhpos_pending_checkout_plan');
    const now = new Date();
    const end = new Date(now);
    if (yearly) {
      end.setFullYear(end.getFullYear() + 1);
    } else {
      end.setMonth(end.getMonth() + 1);
    }

    const updatedSub = {
      id: `sub-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: settings.subscription?.tenantId || 'tenant-default',
      planId: selectedPlan.id,
      status: 'ACTIVE' as const,
      billingCycle: yearly ? ('YEARLY' as const) : ('MONTHLY' as const),
      extraOutlets,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: end.toISOString(),
      cancelAtPeriodEnd: false,
      accessMode: 'FULL' as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      plan: selectedPlan,
    };

    updateSettings({
      ...settings,
      subscription: updatedSub,
    });

    window.dispatchEvent(new Event('subscription-updated'));
    fireConfetti();

    setPaymentSuccess({
      planName: selectedPlan.name,
      billingCycle: yearly ? 'Tahunan (12 Bulan)' : 'Bulanan',
      validUntil: formatDateTime(end.toISOString()),
      invoiceNumber: `INV-NH-${Date.now().toString().slice(-6)}`,
    });
  };

  // Start Free Trial Option
  const handleStartFreeTrial = () => {
    sessionStorage.removeItem('nhpos_pending_checkout_plan');
    const now = new Date();
    const end = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
    const trialPlan = findSaaSPlan(TRIAL_PLAN_ID);

    const trialSub = {
      id: 'sub-trial-active',
      tenantId: settings.subscription?.tenantId || 'tenant-default',
      planId: TRIAL_PLAN_ID,
      status: 'TRIAL' as const,
      billingCycle: 'MONTHLY' as const,
      extraOutlets: 0,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: end.toISOString(),
      cancelAtPeriodEnd: false,
      accessMode: 'FULL' as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      plan: trialPlan || undefined,
    };

    updateSettings({
      ...settings,
      subscription: trialSub,
    });

    window.dispatchEvent(new Event('subscription-updated'));
    fireConfetti();

    setPaymentSuccess({
      planName: 'Free Trial 45 Hari',
      billingCycle: 'Masa Uji Coba',
      validUntil: formatDateTime(end.toISOString()),
      invoiceNumber: `TRIAL-NH-${Date.now().toString().slice(-6)}`,
    });
  };

  // SUCCESS CELEBRATION VIEW
  if (paymentSuccess) {
    return (
      <div className="flex-1 overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-6 flex items-center justify-center min-h-full">
        <div className="max-w-md w-full bg-slate-900/90 border border-slate-700/80 rounded-3xl p-8 text-center shadow-2xl backdrop-blur-xl animate-scale-up space-y-6">
          <div className="relative mx-auto w-20 h-20 rounded-3xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 shadow-xl shadow-emerald-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[22px] flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 animate-bounce" />
            </div>
            <div className="absolute -top-2 -right-2 p-1 bg-amber-400 rounded-full text-slate-950 shadow-md">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs uppercase tracking-widest font-black text-emerald-400">Pembayaran Berhasil Dikonfirmasi</span>
            <h2 className="text-2xl font-black text-white">Selamat Datang di Kasir!</h2>
            <p className="text-slate-400 text-xs leading-relaxed">
              Paket langganan toko Anda telah aktif. Seluruh fitur kasir, sinkronisasi katalog, dan laporan bisnis sudah siap digunakan.
            </p>
          </div>

          <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800 text-left space-y-2.5 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Toko:</span>
              <span className="font-bold text-slate-200">{settings.storeName || 'Toko Utama'}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Paket:</span>
              <span className="font-bold text-amber-400">{paymentSuccess.planName}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Periode:</span>
              <span className="font-bold text-slate-200">{paymentSuccess.billingCycle}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Berlaku Hingga:</span>
              <span className="font-bold text-slate-200">{paymentSuccess.validUntil}</span>
            </div>
            <div className="border-t border-slate-800 pt-2 flex justify-between text-slate-500 font-mono text-[11px]">
              <span>No. Invoice:</span>
              <span>{paymentSuccess.invoiceNumber}</span>
            </div>
          </div>

          <button
            onClick={() => setActiveTab('pos')}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer group"
          >
            <span>Mulai Buka Kasir Sekarang</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 p-4 sm:p-8 relative selection:bg-amber-500 selection:text-slate-950">
      {/* Background Decorative Glow */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-10 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto space-y-8 relative z-10">
        {/* Onboarding Step Banner */}
        {isOnboarding && (
          <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-amber-500/15 via-slate-900 to-slate-900 border border-amber-500/30 backdrop-blur-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg shadow-amber-500/5">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shrink-0 shadow-md shadow-amber-500/20">
                <Zap className="w-5 h-5 fill-slate-950" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-amber-400">Langkah 2 dari 2</span>
                  <span className="text-xs text-slate-500">•</span>
                  <span className="text-xs text-slate-300 font-semibold">Konfirmasi & Pembayaran</span>
                </div>
                <p className="text-sm font-bold text-white mt-0.5">
                  Toko Anda sudah terdaftar! Pilih cara pembayaran untuk mengaktifkan paket kasir.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                sessionStorage.removeItem('nhpos_pending_checkout_plan');
                setIsOnboarding(false);
                setActiveTab('pos');
              }}
              className="text-xs font-bold text-slate-400 hover:text-white px-3 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors shrink-0 cursor-pointer"
            >
              Lewati ke Kasir (Trial)
            </button>
          </div>
        )}

        {/* Store Business Profile Header */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-md flex flex-col md:flex-row items-start md:items-center justify-between gap-5 shadow-xl">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center shadow-inner ${sectorMeta.color}`}>
              <SectorIcon className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  {settings.storeName || 'Toko Baru Anda'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold border border-slate-700 bg-slate-800/80 text-slate-300">
                  {sectorMeta.label}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <span>Pemilik: <b>{user?.email || 'Admin'}</b></span>
                <span className="text-slate-600">•</span>
                <span>Status Toko: <span className="text-amber-400 font-semibold">Menunggu Aktivasi</span></span>
              </p>
            </div>
          </div>

          {/* Billing Cycle Switcher */}
          <div className="flex items-center p-1 bg-slate-950 border border-slate-800 rounded-2xl self-stretch md:self-auto justify-center">
            <button
              type="button"
              onClick={() => setYearly(false)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                !yearly ? 'bg-slate-800 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Bulanan
            </button>
            <button
              type="button"
              onClick={() => setYearly(true)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                yearly
                  ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 font-black shadow-md shadow-amber-500/20'
                  : 'text-amber-400 hover:text-amber-300'
              }`}
            >
              <span>Tahunan</span>
              <span className="px-1.5 py-0.5 rounded-md bg-slate-950/80 text-[10px] font-black text-amber-300">
                Hemat 20%
              </span>
            </button>
          </div>
        </div>

        {/* Plan Cards Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-400">Pilih Paket Layanan</h2>
            <span className="text-xs text-slate-500">Dapat diganti atau dibatalkan kapan saja</span>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {PAID_SAAS_PLANS.map((plan) => {
              const isSelected = selectedPlanId === plan.id;
              const price = yearly ? annualTotal(plan) : plan.priceIdr;
              const isPro = plan.id === 'plan-pro-monthly';

              return (
                <div
                  key={plan.id}
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`relative rounded-3xl p-6 transition-all cursor-pointer border flex flex-col justify-between ${
                    isSelected
                      ? 'bg-slate-900/95 border-amber-500 shadow-2xl shadow-amber-500/10 ring-2 ring-amber-500/30'
                      : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/80'
                  }`}
                >
                  {isPro && (
                    <div className="absolute -top-3 right-6 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 font-black text-[10px] tracking-wider uppercase shadow-md flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      <span>Paling Lengkap</span>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xl font-black text-white">{plan.name}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Termasuk hingga {plan.maxOutlets} outlet aktif</p>
                      </div>
                      <div
                        className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                          isSelected
                            ? 'border-amber-400 bg-amber-400 text-slate-950'
                            : 'border-slate-700 bg-slate-800 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black text-white font-mono">{formatRupiah(price)}</span>
                        <span className="text-xs font-semibold text-slate-400">/{yearly ? 'tahun' : 'bulan'}</span>
                      </div>
                      {yearly && (
                        <p className="text-[11px] text-emerald-400 font-semibold mt-1">
                          Setara {formatRupiah(Math.round(price / 12))}/bulan (Hemat{' '}
                          {plan.annualDiscountPercent || 20}%)
                        </p>
                      )}
                    </div>

                    <ul className="space-y-2.5 pt-2 text-xs text-slate-300">
                      {plan.features.slice(0, 5).map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-6">
                    <button
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`w-full py-3 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                      }`}
                    >
                      {isSelected ? 'Paket Terpilih' : 'Pilih Paket Ini'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Add-on Outlet Stepper */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 backdrop-blur-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-white text-sm">Tambahan Outlet (Add-on Cabang)</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Paket {selectedPlan.name} sudah mencakup <b>{selectedPlan.maxOutlets} outlet</b>. Tambahkan jika Anda memiliki cabang lain.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setExtraOutlets((prev) => Math.max(0, prev - 1))}
                disabled={extraOutlets === 0}
                className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold flex items-center justify-center hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                -
              </button>
              <div className="px-4 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-center min-w-[70px]">
                <span className="font-mono font-bold text-sm text-amber-400">+{extraOutlets}</span>
                <span className="block text-[10px] text-slate-400">outlet</span>
              </div>
              <button
                type="button"
                onClick={() => setExtraOutlets((prev) => prev + 1)}
                className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold flex items-center justify-center hover:bg-slate-700 transition-all cursor-pointer"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
            <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>
              Add-on dihitung {yearly ? 'Rp760.320/outlet/tahun' : 'Rp79.200/outlet/bulan'}. Total kapasitas:{' '}
              <b className="text-white">{selectedPlan.maxOutlets + extraOutlets} outlet aktif</b>.
            </span>
          </div>
        </div>

        {/* Invoice Summary & Checkout Action */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <CreditCard className="w-5 h-5 text-amber-400" />
              <h3 className="font-black text-white text-base">Rincian Pembayaran</h3>
            </div>
            {quoteLoading && (
              <div className="flex items-center gap-2 text-xs text-amber-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Menghitung…</span>
              </div>
            )}
          </div>

          {error && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <div className="space-y-1">
                <p className="font-bold">Perhatian</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          <div className="space-y-3 text-xs">
            <div className="flex justify-between text-slate-300">
              <span>
                Paket {selectedPlan.name} ({yearly ? '12 Bulan' : '1 Bulan'})
              </span>
              <span className="font-mono font-bold text-white">
                {formatRupiah(yearly ? annualTotal(selectedPlan) : selectedPlan.priceIdr)}
              </span>
            </div>

            {extraOutlets > 0 && (
              <div className="flex justify-between text-slate-300">
                <span>
                  Tambahan {extraOutlets} Outlet ({yearly ? 'Tahunan' : 'Bulanan'})
                </span>
                <span className="font-mono font-bold text-white">
                  {formatRupiah(
                    (yearly
                      ? selectedPlan.extraOutletYearlyIdr || 760320
                      : selectedPlan.extraOutletPriceIdr || 79200) * extraOutlets
                  )}
                </span>
              </div>
            )}

            {quote?.unusedCredit && quote.unusedCredit > 0 ? (
              <div className="flex justify-between text-emerald-400">
                <span>Kredit Periode Berjalan</span>
                <span className="font-mono font-bold">- {formatRupiah(quote.unusedCredit)}</span>
              </div>
            ) : null}

            <div className="border-t border-slate-800 pt-4 flex items-baseline justify-between">
              <div>
                <span className="text-sm font-black text-white block">Total Pembayaran</span>
                <span className="text-[11px] text-slate-400">Termasuk seluruh modul & sinkronisasi</span>
              </div>
              <span className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">
                {formatRupiah(quote ? quote.amount : yearly ? annualTotal(selectedPlan) : selectedPlan.priceIdr)}
              </span>
            </div>
          </div>

          {/* Payment Method Badges */}
          <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5 text-amber-400" />
                Metode Pembayaran DOKU Gateway
              </span>
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                Aman & Terverifikasi
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Mendukung <b>QRIS</b> (Gopay, OVO, Dana, ShopeePay, BCA Mobile), <b>Virtual Account</b> (BCA, Mandiri, BRI, BNI), dan <b>Kartu Kredit/Debit</b>.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-2">
            <button
              type="button"
              disabled={checkoutLoading || quoteLoading}
              onClick={handleProceedToPayment}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {checkoutLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Membuka Gerbang Pembayaran DOKU…</span>
                </>
              ) : (
                <>
                  <span>Bayar Sekarang dengan DOKU Checkout</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Fallback / Testing Simulated Button */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleStartFreeTrial}
                className="text-xs font-bold text-slate-300 hover:text-white underline cursor-pointer py-1 flex items-center gap-1.5"
              >
                <Gift className="w-3.5 h-3.5 text-amber-400" />
                <span>Mulai Coba Gratis 45 Hari Dulu</span>
              </button>

              <button
                type="button"
                onClick={handleSimulatePaymentSuccess}
                className="text-xs font-medium text-slate-500 hover:text-amber-400 cursor-pointer py-1 flex items-center gap-1"
                title="Gunakan untuk menguji alur di environment lokal / sandbox tanpa gateway sungguhan"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Simulasi Bayar Berhasil (Dev Mode)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
