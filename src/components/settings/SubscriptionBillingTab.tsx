import React, { useState, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { getDeviceId } from '../../utils/fingerprint';
import { SaaSPlan, SaaSSubscription, SaaSInvoice, SubscriptionStatus } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import {
  CreditCard,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ShieldCheck,
  Building2,
  Bot,
  Layers,
  Sparkles,
  FileText,
  ExternalLink,
  RefreshCw,
  XCircle,
  HelpCircle,
} from 'lucide-react';

export const SubscriptionBillingTab: React.FC = () => {
  const { settings, updateSettings, currentUser } = usePOS();

  const [plans, setPlans] = useState<SaaSPlan[]>([]);
  const [subscription, setSubscription] = useState<SaaSSubscription | null>(null);
  const [invoices, setInvoices] = useState<SaaSInvoice[]>([]);
  const [daysLeft, setDaysLeft] = useState<number>(90);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isProcessingPayment, setIsProcessingPayment] = useState<boolean>(false);
  const [isYearly, setIsYearly] = useState<boolean>(false);

  // Proration Modal state
  const [showProrationModal, setShowProrationModal] = useState<boolean>(false);
  const [selectedPlanForUpgrade, setSelectedPlanForUpgrade] = useState<SaaSPlan | null>(null);
  const [prorationData, setProrationData] = useState<any>(null);

  const fetchSubscriptionData = async () => {
    setIsLoading(true);
    try {
      // Fetch Plans
      const plansRes = await fetch('/api/v1/subscription/plans');
      const plansJson = await plansRes.json();
      if (plansJson.plans) setPlans(plansJson.plans);

      // Fetch Status
      const deviceId = await getDeviceId();
      const statusRes = await fetch(`/api/v1/subscription/status?tenantId=${currentUser?.id || 'tenant-default'}`, {
        headers: {
          'x-device-id': deviceId
        }
      });
      const statusJson = await statusRes.json();

      if (statusJson.subscription) {
        setSubscription(statusJson.subscription);
        setDaysLeft(statusJson.daysLeft || 0);
        if (statusJson.invoices) setInvoices(statusJson.invoices);

        // Sync local settings subscription
        updateSettings({ ...settings, subscription: statusJson.subscription });
      }
    } catch (err) {
      console.error('Gagal memuat data langganan SaaS:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscriptionData();
  }, []);

  const handleSelectUpgradePlan = async (plan: SaaSPlan) => {
    setSelectedPlanForUpgrade(plan);
    try {
      const deviceId = await getDeviceId();
      const res = await fetch('/api/v1/subscription/prorated-upgrade', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-device-id': deviceId
        },
        body: JSON.stringify({
          tenantId: currentUser?.id || 'tenant-default',
          targetPlanId: plan.id,
        }),
      });
      const data = await res.json();
      setProrationData(data);
      setShowProrationModal(true);
    } catch (err) {
      console.error('Gagal menghitung kalkulasi prorasi:', err);
    }
  };

  const handleDokuCheckout = async (planId?: string, isProrated = false) => {
    setIsProcessingPayment(true);
    try {
      const targetPlanId = planId || selectedPlanForUpgrade?.id || subscription?.planId || 'plan-pro-monthly';
      const deviceId = await getDeviceId();

      let data: any;
      if (isProrated && prorationData?.paymentUrl) {
        data = prorationData;
      } else if (isProrated) {
        const res = await fetch('/api/v1/subscription/prorated-upgrade', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-id': deviceId,
          },
          body: JSON.stringify({
            tenantId: currentUser?.id || 'tenant-default',
            targetPlanId,
          }),
        });
        data = await res.json();
      } else {
        const res = await fetch('/api/v1/subscription/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-device-id': deviceId,
          },
          body: JSON.stringify({
            tenantId: currentUser?.id || 'tenant-default',
            planId: targetPlanId,
            billingCycle: isYearly ? 'YEARLY' : 'MONTHLY',
          }),
        });
        data = await res.json();
      }

      setIsProcessingPayment(false);
      setShowProrationModal(false);

      if (data.ok && data.paymentUrl) {
        if (data.paymentUrl.startsWith('https://checkout.example.test')) {
          // Fallback lokal ketika kredensial DOKU belum diisi di .env
          if (confirm(`[Mode Dev] DOKU_CLIENT_ID belum dikonfigurasi di .env.\nApakah ingin langsung mensimulasikan pembayaran lunas?`)) {
            await handleSimulatePayment(targetPlanId, data.invoice?.id);
          }
        } else {
          // Buka halaman pembayaran DOKU Checkout
          window.location.href = data.paymentUrl;
        }
      } else if (data.ok && data.invoice) {
        alert('Invoice berhasil dibuat!');
        fetchSubscriptionData();
      } else {
        alert('Gagal memproses checkout: ' + (data.detail || data.error || 'Terjadi kesalahan'));
      }
    } catch (err) {
      setIsProcessingPayment(false);
      console.error('Gagal checkout DOKU:', err);
      alert('Terjadi kesalahan koneksi saat memproses checkout.');
    }
  };

  const handleSimulatePayment = async (planId?: string, invoiceId?: string) => {
    setIsProcessingPayment(true);
    try {
      const deviceId = await getDeviceId();
      const targetId = planId || selectedPlanForUpgrade?.id || subscription?.planId || 'plan-pro-monthly';
      const res = await fetch('/api/v1/subscription/simulate-payment', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-device-id': deviceId
        },
        body: JSON.stringify({
          tenantId: currentUser?.id || 'tenant-default',
          targetPlanId: targetId,
          invoiceId,
        }),
      });
      const data = await res.json();
      setIsProcessingPayment(false);
      setShowProrationModal(false);

      if (data.success) {
        alert(data.message);
        fetchSubscriptionData();
      }
    } catch (err) {
      setIsProcessingPayment(false);
      alert('Terjadi kesalahan saat memproses pembayaran.');
    }
  };

  const getStatusBadge = (status?: SubscriptionStatus) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <span className="px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-full font-extrabold text-xs flex items-center space-x-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>LANGGANAN AKTIF</span>
          </span>
        );
      case 'TRIAL':
        return (
          <span className="px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-full font-extrabold text-xs flex items-center space-x-1">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>TRIAL GRATIS (90 HARI)</span>
          </span>
        );
      case 'PAST_DUE':
        return (
          <span className="px-3 py-1 bg-orange-100 text-orange-900 border border-orange-300 rounded-full font-extrabold text-xs flex items-center space-x-1 animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
            <span>MASA TENGGANG (PAST DUE)</span>
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="px-3 py-1 bg-rose-100 text-rose-900 border border-rose-300 rounded-full font-extrabold text-xs flex items-center space-x-1">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>KEDALUWARSA (EXPIRED)</span>
          </span>
        );
      default:
        return (
          <span className="px-3 py-1 bg-slate-100 text-slate-700 border border-slate-300 rounded-full font-bold text-xs">
            {status || 'TRIAL'}
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 text-center space-y-3">
        <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto" />
        <p className="text-xs text-slate-500 font-semibold">Memuat data langganan SaaS...</p>
      </div>
    );
  }

  const currentPlan = subscription?.plan || plans[1] || plans[0];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Active Subscription Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-6 rounded-3xl shadow-xl border border-slate-700 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
              <CreditCard className="w-7 h-7 text-amber-400" />
            </div>

            <div>
              <div className="flex items-center space-x-3">
                <h3 className="text-xl font-extrabold tracking-wide">
                  Paket {currentPlan?.name || 'Pro Growth'}
                </h3>
                {getStatusBadge(subscription?.status)}
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Akses penuh fitur kasir, manajemen stok, dan laporan multi-tenant
              </p>
            </div>
          </div>

          <div className="bg-slate-800/90 border border-slate-700 px-5 py-3 rounded-2xl text-right">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Masa Aktif Berakhir:
            </div>
            <div className="text-base font-extrabold text-amber-400 font-mono">
              {subscription ? formatDateTime(subscription.currentPeriodEnd).split(',')[0] : '90 hari'}
            </div>
            <div className="text-[11px] font-semibold text-slate-300">
              Sisa {daysLeft} Hari Lagi
            </div>
          </div>
        </div>

        {/* Status Warning Banner for Past Due / Expired */}
        {subscription?.status === 'PAST_DUE' && (
          <div className="bg-orange-500/20 border border-orange-400/50 p-4 rounded-2xl flex items-center justify-between text-xs text-orange-200">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0" />
              <span>
                <b>Masa Tenggang Pembayaran (Grace Period)!</b> Akses akan dikunci pada{' '}
                <b>{formatDateTime(subscription.gracePeriodEnd || '').split(',')[0]}</b> jika belum diperpanjang.
              </span>
            </div>
            <button
              onClick={() => handleDokuCheckout(currentPlan.id)}
              disabled={isProcessingPayment}
              className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold rounded-xl shadow-xs shrink-0 disabled:opacity-50"
            >
              Bayar Perpanjangan (DOKU)
            </button>
          </div>
        )}

        {subscription?.status === 'EXPIRED' && (
          <div className="bg-rose-500/20 border border-rose-400/50 p-4 rounded-2xl flex items-center justify-between text-xs text-rose-200">
            <div className="flex items-center space-x-2">
              <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>
                <b>Langganan Kedaluwarsa!</b> Akses transaksi kasir POS saat ini dikunci. Lakukan pembayaran untuk mengaktifkan kembali.
              </span>
            </div>
            <button
              onClick={() => handleDokuCheckout(currentPlan.id)}
              disabled={isProcessingPayment}
              className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold rounded-xl shadow-xs shrink-0 disabled:opacity-50"
            >
              Aktifkan Kembali (DOKU)
            </button>
          </div>
        )}

        {/* Quick Action Button Bar */}
        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-4 text-slate-300">
            <span className="flex items-center space-x-1 font-medium">
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Maksimal {currentPlan?.maxOutlets || 5} Outlet / Cabang</span>
            </span>
            <span className="flex items-center space-x-1 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tier Level {currentPlan?.tierLevel || 2}</span>
            </span>
          </div>

          <button
            onClick={() => handleDokuCheckout(currentPlan.id)}
            disabled={isProcessingPayment}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold rounded-xl shadow-md flex items-center space-x-2 transition-all disabled:opacity-50"
          >
            <Zap className="w-4 h-4" />
            <span>{isProcessingPayment ? 'Memproses...' : 'Perpanjang Paket Sekarang'}</span>
          </button>
        </div>
      </div>

      {/* Plans Comparison Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-lg text-slate-900 flex items-center space-x-2">
              <Zap className="w-5 h-5 text-amber-600" />
              <span>Pilihan Paket Langganan POS (SaaS Tier Plans)</span>
            </h3>
            <p className="text-xs text-slate-500">
              Pilih paket yang paling sesuai dengan kebutuhan skala bisnis dan jumlah cabang Anda.
            </p>
          </div>
          {/* Annual Toggle */}
          <div className="flex items-center space-x-3 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                !isYearly ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Bulanan
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 ${
                isYearly ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span>Tahunan</span>
              <span className="px-1.5 py-0.5 bg-rose-500 text-white rounded text-[9px] uppercase leading-none animate-pulse">
                Hemat 20%
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((p) => {
            const isCurrent = subscription?.planId === p.id;
            const price = isYearly && p.priceYearlyIdr !== undefined ? p.priceYearlyIdr : p.priceIdr;
            
            return (
              <div
                key={p.id}
                className={`bg-white p-6 rounded-3xl border transition-all flex flex-col justify-between space-y-6 ${
                  isCurrent
                    ? 'border-amber-500 ring-2 ring-amber-500/20 shadow-lg'
                    : 'border-slate-200 shadow-xs hover:shadow-md'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                        Tier Level {p.tierLevel}
                      </span>
                      <h4 className="font-extrabold text-xl text-slate-900 mt-1">{p.name}</h4>
                    </div>
                    {isCurrent && (
                      <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-full font-bold text-[10px]">
                        PAKET AKTIF
                      </span>
                    )}
                  </div>

                  <div className="border-b border-slate-100 pb-4">
                    <div className="flex items-baseline space-x-1">
                      <span className="text-2xl font-black font-mono text-slate-900">
                        {price === 0 ? 'Gratis' : formatRupiah(price)}
                      </span>
                      {price !== 0 && <span className="text-xs text-slate-500 font-bold">/ bulan</span>}
                    </div>
                    {isYearly && price > 0 && (
                      <div className="text-[10px] text-slate-400 font-medium mt-1">
                        Ditagih {formatRupiah(price * 12)} / tahun
                      </div>
                    )}
                  </div>

                  {/* Feature Bullets */}
                  <ul className="space-y-2.5 text-xs text-slate-700">
                    {p.features.map((f, idx) => (
                      <li key={idx} className="flex items-start space-x-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                    {p.extraOutletPriceIdr && (
                      <li className="flex items-start space-x-2 mt-4 pt-4 border-t border-slate-100">
                        <Building2 className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                        <span className="text-slate-500 italic">
                          Tersedia Add-on Tambah Outlet ({formatRupiah(p.extraOutletPriceIdr)}/outlet/bln)
                        </span>
                      </li>
                    )}
                  </ul>
                </div>

                <button
                  onClick={() => handleSelectUpgradePlan(p)}
                  disabled={isCurrent}
                  className={`w-full py-2.5 rounded-xl font-extrabold text-xs flex items-center justify-center space-x-2 transition-all ${
                    isCurrent
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                      : p.tierLevel > (currentPlan?.tierLevel || 1)
                      ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md'
                      : 'bg-slate-800 hover:bg-slate-900 text-white shadow-xs'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>
                    {isCurrent
                      ? 'Paket Saat Ini'
                      : p.tierLevel > (currentPlan?.tierLevel || 1)
                      ? 'Upgrade Paket Prorasi'
                      : 'Pilih Paket Ini'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invoice Transactions History Table */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-lg text-slate-900 flex items-center space-x-2">
            <FileText className="w-5 h-5 text-amber-600" />
            <span>Riwayat Tagihan & Invoice Langganan</span>
          </h3>
          <span className="text-xs text-slate-500 font-mono">Total {invoices.length} Invoice</span>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-2xl">
          <table className="w-full text-left text-xs font-sans">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-500 font-extrabold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">No. Invoice</th>
                <th className="py-3 px-4">Paket Langganan</th>
                <th className="py-3 px-4">Tanggal Buat</th>
                <th className="py-3 px-4">Jumlah (Rp)</th>
                <th className="py-3 px-4">Ref. Payment Gateway</th>
                <th className="py-3 px-4 text-right">Status Bayar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400 font-sans">
                    Belum ada riwayat invoice langganan.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-slate-900">{inv.id}</td>
                    <td className="py-3 px-4 text-slate-700 font-sans font-semibold">
                      {inv.planName}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{formatDateTime(inv.createdAt)}</td>
                    <td className="py-3 px-4 font-extrabold text-amber-800">
                      {formatRupiah(inv.amount)}
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                      {inv.paymentGatewayRef || 'SIM-TEST-REF'}
                    </td>
                    <td className="py-3 px-4 text-right font-sans">
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-extrabold text-[10px] ${
                          inv.paymentStatus === 'PAID'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}
                      >
                        {inv.paymentStatus === 'PAID' ? 'LUNAS (PAID)' : 'MENUNGGU BAYAR'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Proration & Upgrade Modal */}
      {showProrationModal && selectedPlanForUpgrade && prorationData && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl animate-scale-up text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-extrabold text-lg text-slate-900 flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-amber-600" />
                <span>Kalkulasi Prorasi Upgrade Paket</span>
              </h3>
              <button
                onClick={() => setShowProrationModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Paket Lama:</span>
                <span className="font-bold text-slate-800">{prorationData.currentPlan.name}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Paket Baru Target:</span>
                <span className="font-bold text-amber-700">{prorationData.targetPlan.name}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Sisa Hari Berjalan:</span>
                <span className="font-bold">{prorationData.remainingDays} Hari</span>
              </div>
              <div className="flex justify-between text-slate-600 border-t border-slate-200 pt-2">
                <span>Kredit Sisa Paket Lama:</span>
                <span className="font-bold text-emerald-600">
                  - {formatRupiah(prorationData.unusedCredit)}
                </span>
              </div>
              <div className="flex justify-between text-slate-900 font-extrabold text-sm border-t border-slate-300 pt-2">
                <span>Total Selisih Prorasi Dibayar:</span>
                <span className="text-amber-600">
                  {formatRupiah(prorationData.netProratedAmount)}
                </span>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowProrationModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl"
              >
                Batal
              </button>
              <button
                onClick={() => handleDokuCheckout(selectedPlanForUpgrade.id, true)}
                disabled={isProcessingPayment}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs flex items-center space-x-1.5 disabled:opacity-50"
              >
                <Zap className="w-4 h-4" />
                <span>{isProcessingPayment ? 'Memproses...' : 'Bayar Upgrade (DOKU)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
