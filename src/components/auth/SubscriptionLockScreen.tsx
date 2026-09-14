import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { Lock, ShieldAlert, CreditCard, RefreshCw, CheckCircle2 } from 'lucide-react';

export const SubscriptionLockScreen: React.FC<{ onRenewSuccess?: () => void }> = ({ onRenewSuccess }) => {
  const { settings, setActiveTab } = usePOS();
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isPending = settings.subscription?.status === 'PENDING_PAYMENT';
  const isExpired = settings.subscription?.status === 'EXPIRED' || settings.subscription?.accessMode === 'RESTRICTED';

  const checkStatus = async () => {
    setChecking(true);
    setNotice(null);
    try {
      const res = await fetch('/api/v1/subscription/verify');
      const data = await res.json();
      if (data.ok && (data.paid || data.status === 'ACTIVE')) {
        sessionStorage.removeItem('nhpos_pending_checkout_plan');
        sessionStorage.removeItem('nhpos_pending_checkout_cycle');
        localStorage.removeItem('nhpos_pending_checkout_plan');
        localStorage.removeItem('nhpos_pending_checkout_cycle');
        window.dispatchEvent(new CustomEvent('subscription-updated'));
        onRenewSuccess?.();
        setActiveTab('pos');
      } else {
        setNotice('Pembayaran belum terkonfirmasi lunas. Silakan lakukan pembayaran di DOKU Checkout.');
      }
    } catch {
      setNotice('Gagal memeriksa status pembayaran. Pastikan koneksi internet aktif.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in" role="dialog" aria-modal="true">
      <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-200 text-center space-y-5 animate-scale-up">
        <div className="w-16 h-16 rounded-3xl bg-amber-100 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto shadow-inner">
          <Lock className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <span className="text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
            {isPending ? 'Menunggu Pembayaran' : isExpired ? 'Masa Aktif Berakhir' : 'Akses Kasir Terkunci'}
          </span>
          <h3 className="text-xl font-black text-slate-900">
            {isPending ? 'Selesaikan Pembayaran DOKU' : 'Perpanjang Paket Langganan'}
          </h3>
          <p className="text-slate-500 text-xs leading-relaxed max-w-sm mx-auto">
            {isPending
              ? 'Anda telah memilih paket toko. Selesaikan pembayaran melalui DOKU Gateway untuk membuka kasir, cetak struk, dan transaksi.'
              : 'Masa aktif toko telah berakhir. Selesaikan pembayaran untuk melanjutkan operasional kasir.'}
          </p>
        </div>

        {notice && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium text-left">
            {notice}
          </div>
        )}

        <div className="space-y-2.5 pt-2">
          <button
            onClick={() => setActiveTab('payment')}
            className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <CreditCard className="w-4 h-4" />
            <span>Buka Halaman Pembayaran (DOKU)</span>
          </button>

          <button
            onClick={checkStatus}
            disabled={checking}
            className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>{checking ? 'Memeriksa...' : 'Periksa Status Pembayaran'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
