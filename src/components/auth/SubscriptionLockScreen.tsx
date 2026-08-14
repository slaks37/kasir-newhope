import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { getDeviceId } from '../../utils/fingerprint';
import { formatRupiah } from '../../utils/formatters';
import {
  CreditCard,
  Zap,
  Lock,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Store,
  PhoneCall,
} from 'lucide-react';

interface SubscriptionLockScreenProps {
  onRenewSuccess: () => void;
}

export const SubscriptionLockScreen: React.FC<SubscriptionLockScreenProps> = ({ onRenewSuccess }) => {
  const { settings, updateSettings, currentUser } = usePOS();
  const [isProcessing, setIsProcessing] = useState(false);

  const sub = settings.subscription;

  const handleSimulatePayment = async () => {
    setIsProcessing(true);
    try {
      const deviceId = await getDeviceId();
      const res = await fetch('/api/v1/subscription/simulate-payment', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-device-id': deviceId 
        },
        body: JSON.stringify({
          tenantId: currentUser?.id || 'tenant-default',
          targetPlanId: sub?.planId || 'plan-pro-monthly',
        }),
      });

      const data = await res.json();
      setIsProcessing(false);

      if (data.success && data.subscription) {
        updateSettings({ ...settings, subscription: data.subscription });
        alert(data.message);
        onRenewSuccess();
      } else {
        alert('Gagal memperbarui status berlangganan.');
      }
    } catch (err) {
      setIsProcessing(false);
      alert('Terjadi kendala koneksi saat memproses pembayaran.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full text-slate-900 overflow-hidden shadow-2xl p-8 space-y-6 text-center animate-scale-up">
        <div className="w-16 h-16 rounded-3xl bg-rose-100 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto shadow-inner">
          <Lock className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <span className="px-3 py-1 bg-rose-100 text-rose-800 rounded-full font-extrabold text-[10px] uppercase tracking-wider border border-rose-200">
            Akses POS Dikunci (Expired)
          </span>
          <h3 className="font-extrabold text-2xl text-slate-900">
            Masa Berlangganan Berakhir
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed max-w-md mx-auto">
            Masa aktif paket langganan POS untuk toko <b>{settings.storeName}</b> telah kedaluwarsa. Lakukan pembayaran untuk membuka kunci transaksi kasir & akses sistem.
          </p>
        </div>

        {/* Invoice Summary Box */}
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-left text-xs space-y-2 font-mono">
          <div className="flex justify-between text-slate-600">
            <span>Toko / Tenant:</span>
            <span className="font-bold text-slate-800 font-sans">{settings.storeName}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Paket Langganan:</span>
            <span className="font-bold text-amber-700 font-sans">Pro Growth (Bulanan)</span>
          </div>
          <div className="flex justify-between text-slate-900 font-extrabold text-sm border-t border-slate-200 pt-2 font-sans">
            <span>Total Tagihan Renewal:</span>
            <span className="text-amber-600">Rp 349.000 / bulan</span>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <button
            onClick={handleSimulatePayment}
            disabled={isProcessing}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-sm rounded-2xl shadow-lg flex items-center justify-center space-x-2 transition-all transform hover:scale-[1.02]"
          >
            <Zap className="w-5 h-5" />
            <span>{isProcessing ? 'Memproses Pembayaran...' : 'Perpanjang & Buka Kunci Kasir'}</span>
          </button>

          <div className="flex items-center justify-center space-x-2 text-xs text-slate-500 font-medium">
            <PhoneCall className="w-3.5 h-3.5 text-slate-400" />
            <span>Butuh Bantuan? Hubungi Tim Support VIP New Hope POS</span>
          </div>
        </div>
      </div>
    </div>
  );
};
