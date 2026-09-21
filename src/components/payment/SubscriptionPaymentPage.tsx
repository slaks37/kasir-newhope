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
} from 'lucide-react';
import { usePOS } from '../../context/POSContext';
import { useAuth } from '../../context/AuthContext';
import { PAID_SAAS_PLANS, annualTotal, findSaaSPlan, TRIAL_PLAN_ID, TRIAL_DAYS } from '../../config/saasPlans';
import { isFreePlan } from '../../config/freePlanPolicy';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { BusinessSector } from '../../types';
import { newId, newDocumentNumber } from '../../lib/ids';

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
  const { user, session } = useAuth();

  // Check if user just arrived from onboarding
  const [isOnboarding, setIsOnboarding] = useState<boolean>(() => {
    return Boolean(sessionStorage.getItem('nhpos_pending_checkout_plan') || localStorage.getItem('nhpos_pending_checkout_plan'));
  });

  // Check if trial has been used
  const hasUsedTrial = Boolean(
    settings.subscription?.hasUsedTrial ||
    settings.subscription?.trialStartedAt ||
    (settings.subscription?.status === 'TRIAL' && Date.parse(settings.subscription?.currentPeriodEnd) <= Date.now())
  );

  // Selected plan state
  const [selectedPlanId, setSelectedPlanId] = useState<string>(() => {
    const pending = sessionStorage.getItem('nhpos_pending_checkout_plan') || localStorage.getItem('nhpos_pending_checkout_plan');
    if (pending && (pending === 'plan-plus-monthly' || pending === 'plan-pro-monthly' || pending === TRIAL_PLAN_ID)) {
      return pending;
    }
    return !hasUsedTrial ? TRIAL_PLAN_ID : 'plan-plus-monthly';
  });

  const [yearly, setYearly] = useState<boolean>(() => {
    const cycle = sessionStorage.getItem('nhpos_pending_checkout_cycle') || localStorage.getItem('nhpos_pending_checkout_cycle');
    return cycle ? cycle === 'YEARLY' : true;
  });
  const [extraOutlets, setExtraOutlets] = useState<number>(0);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState<boolean>(false);
  const [checkoutLoading, setCheckoutLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Status verification state
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  // Success Celebration State
  const [paymentSuccess, setPaymentSuccess] = useState<{
    planName: string;
    billingCycle: string;
    validUntil: string;
    invoiceNumber: string;
  } | null>(null);

  const selectedPlan = findSaaSPlan(selectedPlanId) || findSaaSPlan(TRIAL_PLAN_ID) || PAID_SAAS_PLANS[0];
  const isTrial = selectedPlanId === TRIAL_PLAN_ID;

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
      if (selectedPlanId === TRIAL_PLAN_ID) {
        const now = new Date();
        const end = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
        if (isCurrent) {
          setQuote({
            ok: true,
            planId: TRIAL_PLAN_ID,
            planName: `Free Trial ${TRIAL_DAYS} Hari`,
            billingCycle: 'MONTHLY',
            amount: 0,
            recurringAmount: 0,
            unusedCredit: 0,
            extraOutlets: 0,
            periodStart: now.toISOString(),
            periodEnd: end.toISOString(),
          });
          setQuoteLoading(false);
          setError(null);
        }
        return;
      }

      setQuoteLoading(true);
      setError(null);
      try {
        const cycle = yearly ? 'YEARLY' : 'MONTHLY';
        const res = await fetch('/api/v1/subscription/prorated-upgrade', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
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

  // Check payment verification with server & DOKU
  const checkPaymentVerification = async (invId?: string, silent = false) => {
    if (!silent) {
      setVerifying(true);
      setVerifyNotice(null);
    }
    try {
      const url = invId
        ? `/api/v1/subscription/verify?invoiceId=${encodeURIComponent(invId)}`
        : '/api/v1/subscription/verify';
      const res = await fetch(url, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        if (!silent) {
          setVerifyNotice('Pembayaran belum terkonfirmasi oleh server. Jika Anda baru saja menyelesaikan transaksi di DOKU, mohon tunggu beberapa saat lalu coba periksa status kembali.');
        }
        return false;
      }
      const data = await res.json();
      if (data.ok && (data.paid || data.status === 'ACTIVE')) {
        sessionStorage.removeItem('nhpos_pending_checkout_plan');
        sessionStorage.removeItem('nhpos_pending_checkout_cycle');
        localStorage.removeItem('nhpos_pending_checkout_plan');
        localStorage.removeItem('nhpos_pending_checkout_cycle');
        window.dispatchEvent(new CustomEvent('subscription-updated'));
        fireConfetti();
        const activeSub = data.subscription || settings.subscription;
        setPaymentSuccess({
          planName: activeSub?.plan?.name || selectedPlan.name,
          billingCycle: activeSub?.billingCycle === 'YEARLY' ? 'Tahunan (12 Bulan)' : 'Bulanan',
          validUntil: activeSub?.currentPeriodEnd ? formatDateTime(activeSub.currentPeriodEnd) : 'Aktif',
          invoiceNumber: data.invoice?.invoiceNumber || (invId ? `NH-${invId}` : 'PAID'),
        });
        return true;
      } else {
        if (!silent) {
          setVerifyNotice('Pembayaran belum terkonfirmasi oleh server. Jika Anda baru saja menyelesaikan transaksi di DOKU, mohon tunggu beberapa saat lalu coba periksa status kembali.');
        }
        return false;
      }
    } catch (e) {
      if (!silent) {
        setVerifyNotice('Gagal memeriksa status pembayaran. Pastikan koneksi internet aktif.');
      }
      return false;
    } finally {
      if (!silent) setVerifying(false);
    }
  };

  // Check URL on mount / return from DOKU
  useEffect(() => {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const match = hash.match(/invoice=([a-zA-Z0-9_-]+)/) || search.match(/invoice=([a-zA-Z0-9_-]+)/);
    const invoiceId = match ? match[1] : undefined;

    if (invoiceId) {
      void checkPaymentVerification(invoiceId);
      let attempts = 0;
      const interval = window.setInterval(async () => {
        attempts++;
        if (attempts > 5) {
          window.clearInterval(interval);
          return;
        }
        const done = await checkPaymentVerification(invoiceId, true);
        if (done) {
          window.clearInterval(interval);
        }
      }, 3000);
      return () => window.clearInterval(interval);
    }
  }, []);

  // Handle DOKU Checkout or Free Trial
  const handleProceedToPayment = async () => {
    setError(null);
    setVerifyNotice(null);

    // Free Trial Activation Flow
    if (selectedPlanId === TRIAL_PLAN_ID) {
      if (hasUsedTrial) {
        setError('Masa Free Trial 45 Hari hanya dapat digunakan 1 kali per akun toko. Silakan pilih paket Tier Plus atau Tier Pro.');
        return;
      }
      setCheckoutLoading(true);
      try {
        let serverSub: any = null;
        try {
          const res = await fetch('/api/v1/subscription/start-trial', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({
              tenantId: settings.subscription?.tenantId || user?.id,
            }),
          });
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = await res.json().catch(() => null);
            if (res.ok && data?.ok && data.subscription) {
              serverSub = data.subscription;
            }
          }
        } catch (serverErr: any) {
          console.warn('Server trial sync warning (activating locally):', serverErr?.message);
        }

        const now = new Date();
        const end = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
        const trialSub = {
          ...settings.subscription,
          id: serverSub?.id || settings.subscription?.id || newId('sub-trial'),
          tenantId: serverSub?.tenantId || settings.subscription?.tenantId || user?.id || 'tenant-default',
          planId: TRIAL_PLAN_ID,
          status: 'TRIAL' as const,
          cancelAtPeriodEnd: false,
          billingCycle: 'MONTHLY' as const,
          extraOutlets: 0,
          currentPeriodStart: serverSub?.currentPeriodStart || now.toISOString(),
          currentPeriodEnd: serverSub?.currentPeriodEnd || end.toISOString(),
          accessMode: 'FULL' as const,
          hasUsedTrial: true,
          plan: findSaaSPlan(TRIAL_PLAN_ID) || undefined,
        };

        updateSettings({
          ...settings,
          subscription: trialSub,
        });

        sessionStorage.removeItem('nhpos_pending_checkout_plan');
        sessionStorage.removeItem('nhpos_pending_checkout_cycle');
        localStorage.removeItem('nhpos_pending_checkout_plan');
        localStorage.removeItem('nhpos_pending_checkout_cycle');

        window.dispatchEvent(new CustomEvent('subscription-updated'));
        fireConfetti();

        setPaymentSuccess({
          planName: `Free Trial ${TRIAL_DAYS} Hari`,
          billingCycle: 'Masa Uji Coba',
          validUntil: formatDateTime(trialSub.currentPeriodEnd),
          invoiceNumber: newDocumentNumber('TRIAL-NH'),
        });
      } catch (err: any) {
        console.warn('Free trial activation error:', err.message);
        setError(err.message || 'Gagal mengaktifkan Free Trial. Silakan coba kembali.');
      } finally {
        setCheckoutLoading(false);
      }
      return;
    }

    if (!quote) return;
    setCheckoutLoading(true);
    const requestKey = crypto.randomUUID();

    try {
      const res = await fetch('/api/v1/subscription/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          planId: quote.planId,
          billingCycle: quote.billingCycle,
          extraOutlets: quote.extraOutlets,
          requestKey,
        }),
      });

      let result: any = null;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          result = await res.json();
        } catch {
          result = null;
        }
      }

      if (!result) {
        const text = await res.text().catch(() => '');
        if (res.status === 401) {
          throw new Error('Sesi otentikasi diperlukan. Silakan login terlebih dahulu.');
        } else if (res.status === 404) {
          throw new Error('Layanan endpoint checkout tidak ditemukan di server (404). Silakan coba lagi setelah deployment selesai.');
        } else if (res.status === 503) {
          throw new Error('Database atau gateway pembayaran sedang tidak tersedia (503). Pastikan DATABASE_URL telah dikonfigurasi.');
        } else {
          throw new Error(text && text.length < 120 && !text.includes('<') ? text : `Terjadi kendala pada server (HTTP ${res.status}).`);
        }
      }

      if (res.ok && result.ok && result.paymentUrl) {
        if (result.paymentUrl.startsWith('https://') && !result.paymentUrl.includes('example.test')) {
          // Redirect to DOKU Checkout Gateway
          window.location.assign(result.paymentUrl);
          return;
        } else if (result.mockPayment || result.paymentUrl.includes('#payment') || result.paymentUrl.startsWith('/')) {
          // Local/Demo simulated checkout
          const invId = result.invoice?.invoiceNumber || result.invoice?.id;
          if (invId) {
            void checkPaymentVerification(invId);
          }
          return;
        }
      }

      const errMsg = result.message || result.error || result.detail;
      if (errMsg === 'AUTHENTICATION_REQUIRED') {
        throw new Error('Sesi otentikasi diperlukan. Silakan login terlebih dahulu.');
      }
      if (errMsg === 'PAYMENT_GATEWAY_NOT_CONFIGURED') {
        throw new Error('Kredensial DOKU belum aktif di Vercel Production. Pastikan DOKU_CLIENT_ID dan DOKU_SECRET_KEY sudah diisi dan disimpan di Environment Variables Vercel (centang Production).');
      }
      if (errMsg === 'PUBLIC_APP_URL_NOT_CONFIGURED') {
        throw new Error('PUBLIC_APP_URL belum dikonfigurasi di environment Vercel (contoh: https://kasir.newhope.space).');
      }
      if (errMsg === 'DATABASE_UNAVAILABLE') {
        throw new Error('Database server tidak dapat dihubungi. Pastikan DATABASE_URL telah dikonfigurasi di Vercel.');
      }
      if (errMsg === 'TENANT_NOT_PROVISIONED') {
        throw new Error('Toko belum terdaftar di database. Silakan lakukan sinkronisasi data kasir atau muat ulang halaman.');
      }

      throw new Error(errMsg || 'Gateway pembayaran sedang dalam konfigurasi.');
    } catch (err: any) {
      console.warn('DOKU checkout not completed:', err.message);
      setError(err.message || 'Gagal memulai checkout. Silakan coba kembali.');
    } finally {
      setCheckoutLoading(false);
    }
  };


  // SUCCESS CELEBRATION VIEW
  if (paymentSuccess) {
    return (
      <div className="nh-light-panel flex-1 overflow-y-auto bg-slate-50 p-6 flex items-center justify-center min-h-full">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 text-center shadow-lg animate-scale-up space-y-6">
          <div className="relative mx-auto w-20 h-20 rounded-3xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 shadow-xl shadow-emerald-500/20">
            <div className="w-full h-full bg-white rounded-[22px] flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 animate-bounce" />
            </div>
            <div className="absolute -top-2 -right-2 p-1 bg-amber-400 rounded-full text-slate-950 shadow-md">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs uppercase tracking-widest font-black text-emerald-600">Pembayaran Berhasil Dikonfirmasi</span>
            <h2 className="text-2xl font-black text-slate-900">Selamat Datang di Kasir!</h2>
            <p className="text-slate-600 text-xs leading-relaxed">
              Paket langganan toko Anda telah aktif. Seluruh fitur kasir, sinkronisasi katalog, dan laporan bisnis sudah siap digunakan.
            </p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 text-left space-y-2.5 text-xs">
            <div className="flex justify-between text-slate-500">
              <span>Toko:</span>
              <span className="font-bold text-slate-900">{settings.storeName || 'Toko Utama'}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Paket:</span>
              <span className="font-bold text-amber-600">{paymentSuccess.planName}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Periode:</span>
              <span className="font-bold text-slate-900">{paymentSuccess.billingCycle}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Berlaku Hingga:</span>
              <span className="font-bold text-slate-900">{paymentSuccess.validUntil}</span>
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between text-slate-400 font-mono text-[11px]">
              <span>No. Invoice:</span>
              <span>{paymentSuccess.invoiceNumber}</span>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => setActiveTab('pos')}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer group"
            >
              <span>Mulai Buka Kasir Sekarang</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="nh-light-panel flex-1 overflow-y-auto bg-[#f8fafc] text-slate-900 p-4 sm:p-8 relative selection:bg-amber-500 selection:text-slate-950">
      {/* Background Decorative Glow */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-10 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto space-y-8 relative z-10">
        {/* Onboarding Step Banner */}
        {isOnboarding && (
          <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-amber-50 via-white to-white border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shrink-0 shadow-md shadow-amber-500/20">
                <Zap className="w-5 h-5 fill-slate-950" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-amber-700">Langkah 2 dari 2</span>
                  <span className="text-xs text-slate-400">•</span>
                  <span className="text-xs text-slate-600 font-semibold">Konfirmasi & Pembayaran</span>
                </div>
                <p className="text-sm font-bold text-slate-900 mt-0.5">
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
              className="text-xs font-bold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors shrink-0 cursor-pointer bg-white"
            >
              Lewati ke Kasir (Trial)
            </button>
          </div>
        )}

        {/* Store Business Profile Header */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-5 shadow-xs">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center shadow-inner ${sectorMeta.color}`}>
              <SectorIcon className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  {settings.storeName || 'Toko Baru Anda'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold border border-slate-200 bg-slate-100 text-slate-700">
                  {sectorMeta.label}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                <span>Pemilik: <b>{user?.email || 'Admin'}</b></span>
                <span className="text-slate-300">•</span>
                <span>Status Toko: <span className="text-amber-600 font-semibold">{isFreePlan(settings.subscription) ? 'Free selamanya' : settings.subscription?.status === 'ACTIVE' ? 'Paket aktif' : settings.subscription?.status === 'TRIAL' ? 'Trial aktif' : 'Menunggu Aktivasi'}</span></span>
              </p>
            </div>
          </div>

          {/* Billing Cycle Switcher */}
          <div className="flex items-center p-1 bg-slate-100 border border-slate-200 rounded-2xl self-stretch md:self-auto justify-center">
            <button
              type="button"
              onClick={() => setYearly(false)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                !yearly ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bulanan
            </button>
            <button
              type="button"
              onClick={() => setYearly(true)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                yearly
                  ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 font-black shadow-xs'
                  : 'text-amber-700 hover:text-amber-800'
              }`}
            >
              <span>Tahunan</span>
              <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-[10px] font-black text-amber-800">
                Hemat 20%
              </span>
            </button>
          </div>
        </div>

        {/* Plan Cards Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">Pilih Paket Layanan</h2>
            <span className="text-xs text-slate-400">Dapat diganti atau dibatalkan kapan saja</span>
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            {/* Card 1: Free Trial 45 Hari */}
            {(() => {
              const trialPlan = findSaaSPlan(TRIAL_PLAN_ID);
              const isSelected = selectedPlanId === TRIAL_PLAN_ID;
              return (
                <div
                  key={TRIAL_PLAN_ID}
                  onClick={() => !hasUsedTrial && setSelectedPlanId(TRIAL_PLAN_ID)}
                  className={`relative rounded-3xl p-6 transition-all border flex flex-col justify-between ${
                    hasUsedTrial
                      ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                      : isSelected
                      ? 'bg-white border-amber-500 shadow-md ring-2 ring-amber-400/30 cursor-pointer'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs cursor-pointer'
                  }`}
                >
                  <div className="absolute -top-3 left-6 px-3 py-1 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 font-black text-[10px] tracking-wider uppercase shadow-md flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <span>{hasUsedTrial ? 'Sudah Digunakan' : 'Uji Coba Gratis'}</span>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xl font-black text-slate-900">{trialPlan?.name || 'Free Trial 45 Hari'}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Termasuk hingga 2 outlet aktif</p>
                      </div>
                      <div
                        className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                          isSelected && !hasUsedTrial
                            ? 'border-amber-500 bg-amber-500 text-slate-950'
                            : 'border-slate-300 bg-slate-100 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black text-slate-900 font-mono">Rp 0</span>
                        <span className="text-xs font-semibold text-slate-500">/ 45 hari</span>
                      </div>
                      <p className="text-[11px] text-emerald-600 font-semibold mt-1">
                        {hasUsedTrial ? 'Masa uji coba telah selesai digunakan' : 'Coba gratis 45 hari tanpa kartu kredit'}
                      </p>
                    </div>

                    <ul className="space-y-2.5 pt-2 text-xs text-slate-600">
                      {(trialPlan?.features || [
                        'Seluruh fitur Tier Pro selama 45 hari',
                        'Hingga 2 outlet aktif',
                        'Produk dan pengguna tidak terbatas',
                        'Kuota AI trial terbatas',
                        'Tanpa kartu kredit (berlaku 1x)',
                      ]).slice(0, 5).map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-6">
                    <button
                      type="button"
                      disabled={hasUsedTrial}
                      onClick={() => !hasUsedTrial && setSelectedPlanId(TRIAL_PLAN_ID)}
                      className={`w-full py-3 rounded-xl font-bold text-xs transition-all ${
                        hasUsedTrial
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : isSelected
                          ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20 cursor-pointer'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer'
                      }`}
                    >
                      {hasUsedTrial ? 'Sudah Digunakan (1x)' : isSelected ? 'Paket Terpilih' : 'Pilih Coba Gratis'}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Cards 2 & 3: PAID_SAAS_PLANS */}
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
                      ? 'bg-white border-amber-500 shadow-md ring-2 ring-amber-400/30'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
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
                        <h3 className="text-xl font-black text-slate-900">{plan.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Termasuk hingga {plan.maxOutlets} outlet aktif</p>
                      </div>
                      <div
                        className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                          isSelected
                            ? 'border-amber-500 bg-amber-500 text-slate-950'
                            : 'border-slate-300 bg-slate-100 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black text-slate-900 font-mono">{formatRupiah(price)}</span>
                        <span className="text-xs font-semibold text-slate-500">/{yearly ? 'tahun' : 'bulan'}</span>
                      </div>
                      {yearly && (
                        <p className="text-[11px] text-emerald-600 font-semibold mt-1">
                          Setara {formatRupiah(Math.round(price / 12))}/bulan (Hemat{' '}
                          {plan.annualDiscountPercent || 20}%)
                        </p>
                      )}
                    </div>

                    <ul className="space-y-2.5 pt-2 text-xs text-slate-600">
                      {plan.features.slice(0, 5).map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
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
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
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
        {isTrial ? (
          <div className="bg-white border border-slate-200 rounded-3xl p-5 text-xs text-slate-600 flex items-center gap-3 shadow-xs">
            <Info className="w-4 h-4 text-amber-500 shrink-0" />
            <span>Paket <b>Free Trial 45 Hari</b> mencakup hingga <b>2 outlet aktif</b> secara gratis. Tambahan cabang dapat diaktifkan setelah memilih paket Tier Plus atau Pro.</span>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Tambahan Outlet (Add-on Cabang)</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Paket {selectedPlan.name} sudah mencakup <b>{selectedPlan.maxOutlets} outlet</b>. Tambahkan jika Anda memiliki cabang lain.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setExtraOutlets((prev) => Math.max(0, prev - 1))}
                  disabled={extraOutlets === 0}
                  className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-bold flex items-center justify-center hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  -
                </button>
                <div className="px-4 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-center min-w-[70px]">
                  <span className="font-mono font-bold text-sm text-amber-600">+{extraOutlets}</span>
                  <span className="block text-[10px] text-slate-500">outlet</span>
                </div>
                <button
                  type="button"
                  onClick={() => setExtraOutlets((prev) => prev + 1)}
                  className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-bold flex items-center justify-center hover:bg-slate-200 transition-all cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-2 border-t border-slate-200">
              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>
                Add-on dihitung {yearly ? 'Rp760.320/outlet/tahun' : 'Rp79.200/outlet/bulan'}. Total kapasitas:{' '}
                <b className="text-slate-900">{selectedPlan.maxOutlets + extraOutlets} outlet aktif</b>.
              </span>
            </div>
          </div>
        )}

        {/* Invoice Summary & Checkout Action */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2.5">
              <CreditCard className="w-5 h-5 text-amber-500" />
              <h3 className="font-black text-slate-900 text-base">Rincian Pembayaran</h3>
            </div>
            {quoteLoading && (
              <div className="flex items-center gap-2 text-xs text-amber-600">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Menghitung…</span>
              </div>
            )}
          </div>

          {error && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <div className="space-y-1">
                <p className="font-bold">Perhatian</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          <div className="space-y-3 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>
                Paket {selectedPlan.name} ({yearly ? '12 Bulan' : '1 Bulan'})
              </span>
              <span className="font-mono font-bold text-slate-900">
                {formatRupiah(yearly ? annualTotal(selectedPlan) : selectedPlan.priceIdr)}
              </span>
            </div>

            {extraOutlets > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>
                  Tambahan {extraOutlets} Outlet ({yearly ? 'Tahunan' : 'Bulanan'})
                </span>
                <span className="font-mono font-bold text-slate-900">
                  {formatRupiah(
                    (yearly
                      ? selectedPlan.extraOutletYearlyIdr || 760320
                      : selectedPlan.extraOutletPriceIdr || 79200) * extraOutlets
                  )}
                </span>
              </div>
            )}

            {quote?.unusedCredit && quote.unusedCredit > 0 ? (
              <div className="flex justify-between text-emerald-600">
                <span>Kredit Periode Berjalan</span>
                <span className="font-mono font-bold">- {formatRupiah(quote.unusedCredit)}</span>
              </div>
            ) : null}

            <div className="border-t border-slate-200 pt-4 flex items-baseline justify-between">
              <div>
                <span className="text-sm font-black text-slate-900 block">Total Pembayaran</span>
                <span className="text-[11px] text-slate-500">
                  {isTrial ? 'Masa Uji Coba 45 Hari Tanpa Biaya' : 'Termasuk seluruh modul & sinkronisasi'}
                </span>
              </div>
              <span className="text-2xl sm:text-3xl font-black text-amber-600 font-mono">
                {isTrial
                  ? 'Gratis (Rp 0)'
                  : formatRupiah(quote ? quote.amount : yearly ? annualTotal(selectedPlan) : selectedPlan.priceIdr)}
              </span>
            </div>
          </div>

          {/* Payment Method Badges */}
          {isTrial ? (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span className="font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  Aktivasi Instan Tanpa Kartu Kredit
                </span>
                <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Masa Coba 45 Hari Resmi (1x Pakai)
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Buka kasir dan nikmati seluruh fitur Tier Pro, transaksi, resep bahan baku, QRIS dinamis, dan AI Copilot selama 45 hari tanpa biaya.
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span className="font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5 text-amber-600" />
                  Metode Pembayaran DOKU Gateway
                </span>
                <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Aman & Terverifikasi
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Mendukung <b>QRIS</b> (Gopay, OVO, Dana, ShopeePay, BCA Mobile), <b>Virtual Account</b> (BCA, Mandiri, BRI, BNI), dan <b>Kartu Kredit/Debit</b>.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3 pt-2">
            {verifyNotice && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2.5 animate-slide-up">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold">{verifyNotice}</p>
                </div>
              </div>
            )}

            {isTrial ? (
              <button
                type="button"
                disabled={checkoutLoading || verifying || hasUsedTrial}
                onClick={handleProceedToPayment}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {checkoutLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Mengaktifkan Free Trial 45 Hari…</span>
                  </>
                ) : hasUsedTrial ? (
                  <span>Masa Trial Telah Digunakan (Pilih Plus / Pro)</span>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Mulai Uji Coba Gratis 45 Hari Sekarang</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={checkoutLoading || quoteLoading || verifying}
                onClick={handleProceedToPayment}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
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
            )}

            {/* Anti-Bypass Secure Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-2">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Pembayaran aman terenkripsi & verifikasi server otomatis</span>
              </div>

              <button
                type="button"
                onClick={() => void checkPaymentVerification()}
                disabled={verifying}
                className="text-xs font-bold text-amber-700 hover:text-amber-800 cursor-pointer py-1.5 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-2xs ml-auto"
                title="Cek verifikasi status pembayaran real-time ke server"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />
                <span>{verifying ? 'Memverifikasi...' : 'Periksa Status Pembayaran'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
