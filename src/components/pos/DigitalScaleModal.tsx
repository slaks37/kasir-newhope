import React, { useState, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah } from '../../utils/formatters';
import {
  Scale,
  Cpu,
  RefreshCw,
  X,
  Check,
  AlertCircle,
  Plus,
  Minus,
  Zap,
  Activity,
  Sliders,
} from 'lucide-react';

interface DigitalScaleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DigitalScaleModal: React.FC<DigitalScaleModalProps> = ({ isOpen, onClose }) => {
  const { cart, updateCartQuantity, products, addToCart } = usePOS();
  const [weightKg, setWeightKg] = useState<number>(3.5);
  const [tareKg, setTareKg] = useState<number>(0);
  const [isStable, setIsStable] = useState<boolean>(true);
  const [isConnectedSerial, setIsConnectedSerial] = useState<boolean>(false);
  const [selectedCartItemId, setSelectedCartItemId] = useState<string>(
    cart[0]?.id || ''
  );
  const [scaleStatusText, setScaleStatusText] = useState<string>(
    'Simulasi Timbangan Digital Aktif (Auto-Sync)'
  );

  useEffect(() => {
    if (cart.length > 0 && !selectedCartItemId) {
      setSelectedCartItemId(cart[0].id);
    }
  }, [cart, selectedCartItemId]);

  if (!isOpen) return null;

  const netWeight = Math.max(0, Math.round((weightKg - tareKg) * 1000) / 1000);

  // Web Serial API Connection to USB Scale
  const handleConnectUsbScale = async () => {
    if ('serial' in navigator) {
      try {
        const port = await (navigator as any).serial.requestPort();
        await port.open({ baudRate: 9600 });
        setIsConnectedSerial(true);
        setScaleStatusText('Port Serial USB Terhubung (Baud 9600)');
      } catch (err: any) {
        setScaleStatusText(`Gagal sambung serial: ${err.message || 'Dibatalkan'}`);
      }
    } else {
      setScaleStatusText('Web Serial API tidak didukung browser ini. Menggunakan mode simulator.');
    }
  };

  const handleTare = () => {
    setTareKg(weightKg);
    setScaleStatusText('Tare diterapkan: Berat wadah dinolkan');
  };

  const handleZero = () => {
    setTareKg(0);
    setWeightKg(0);
    setScaleStatusText('Skala dinolkan (Zero Calibration)');
  };

  const handleApplyWeight = () => {
    if (netWeight <= 0) {
      alert('Berat timbangan harus lebih dari 0 kg.');
      return;
    }

    if (selectedCartItemId) {
      // Update existing item in cart
      updateCartQuantity(selectedCartItemId, netWeight);
    } else {
      // Find laundry kiloan product or pick first product
      const laundryProd =
        products.find(
          (p) =>
            p.name.toLowerCase().includes('kiloan') ||
            p.unit.toLowerCase().includes('kg')
        ) || products[0];

      if (laundryProd) {
        addToCart(laundryProd, undefined, undefined, netWeight);
      }
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl p-6 space-y-5">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 text-cyan-600 flex items-center justify-center">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-base text-slate-950">Integrasi Timbangan Digital</h3>
              <p className="text-xs text-slate-500">
                Hubungkan timbangan USB/RS232 atau atur berat pakaian laundry
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Digital Scale LED/LCD Display Screen */}
        <div className="bg-slate-950 rounded-3xl p-6 text-white border-4 border-slate-800 shadow-inner relative overflow-hidden">
          {/* Subtle reflection overlay */}
          <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />

          <div className="flex items-center justify-between text-xs text-slate-400 mb-2 font-mono">
            <span className="flex items-center space-x-1.5 text-cyan-400">
              <Activity className="w-3.5 h-3.5 animate-pulse" />
              <span>{isStable ? 'STABLE [ST]' : 'UNSTABLE'}</span>
            </span>
            <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-amber-300">
              {isConnectedSerial ? 'USB SERIAL CONNECTED' : 'SIMULATOR MODE'}
            </span>
          </div>

          <div className="flex items-baseline justify-center space-x-2 my-2">
            <span className="font-mono font-black text-6xl tracking-tight text-emerald-400 select-none drop-shadow-[0_0_12px_rgba(52,211,153,0.3)]">
              {netWeight.toFixed(3)}
            </span>
            <span className="font-mono font-bold text-2xl text-emerald-300">kg</span>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 text-[11px] font-mono text-slate-400">
            <span>GROSS: {weightKg.toFixed(3)} kg</span>
            <span>TARE: {tareKg.toFixed(3)} kg</span>
            <span>NET: {netWeight.toFixed(3)} kg</span>
          </div>
        </div>

        {/* Scale Controls: Tare, Zero, Simulator Presets */}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleTare}
              className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-black text-xs transition-all cursor-pointer text-center"
            >
              TARE (Nolkan Wadah)
            </button>
            <button
              type="button"
              onClick={handleZero}
              className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-black text-xs transition-all cursor-pointer text-center"
            >
              ZERO (Reset 0)
            </button>
            <button
              type="button"
              onClick={handleConnectUsbScale}
              className={`py-2.5 px-3 rounded-xl font-black text-xs transition-all cursor-pointer text-center flex items-center justify-center space-x-1 ${
                isConnectedSerial
                  ? 'bg-emerald-100 text-emerald-950 border border-emerald-300'
                  : 'bg-cyan-50 hover:bg-cyan-100 text-cyan-900 border border-cyan-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{isConnectedSerial ? 'USB Terhubung' : 'Sambung USB'}</span>
            </button>
          </div>

          {/* Quick Increment Buttons */}
          <div>
            <span className="text-[11px] font-bold text-slate-500 block mb-1.5">
              Simulasi Cepat Berat Timbangan:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[0.5, 1.0, 2.5, 3.5, 5.0, 7.5, 10.0].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setWeightKg(val)}
                  className={`px-3 py-1.5 rounded-xl font-mono text-xs font-black cursor-pointer transition-all ${
                    weightKg === val
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  +{val} kg
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Target Item in Cart */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
          <label className="text-xs font-black text-slate-800 block">
            Terapkan Berat Ke Item Keranjang:
          </label>
          {cart.length > 0 ? (
            <select
              value={selectedCartItemId}
              onChange={(e) => setSelectedCartItemId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-xs text-slate-900 bg-white focus:border-cyan-500 outline-none"
            >
              {cart.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} (Sekarang: {item.quantity} kg • {formatRupiah(item.unitPrice * netWeight)})
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[11px] text-slate-500 italic">
              Keranjang masih kosong. Berat ini akan otomatis dimasukkan sebagai pesanan Laundry Kiloan baru.
            </p>
          )}
        </div>

        {/* Status Line */}
        <div className="text-[11px] text-slate-500 flex items-center space-x-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
          <span className="truncate">{scaleStatusText}</span>
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={handleApplyWeight}
            className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-black shadow-xs cursor-pointer flex items-center space-x-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Masukkan Berat ({netWeight.toFixed(2)} kg)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
