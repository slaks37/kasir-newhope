import React, { useState, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { PaymentMethod, Order, RevenueImpact } from '../../types';
import { formatRupiah } from '../../utils/formatters';
import {
  Banknote,
  QrCode,
  CreditCard,
  Smartphone,
  CheckCircle2,
  X,
  RefreshCw,
  Receipt,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { PinAuthorizationModal } from '../auth/PinAuthorizationModal';

interface CheckoutModalProps {
  onClose: () => void;
  onPaymentSuccess: (order: Order) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({ onClose, onPaymentSuccess }) => {
  const {
    cart,
    selectedCustomer,
    selectedTable,
    settings,
    processPayment,
    orderType,
    guestCount,
    revenueImpact,
    setRevenueImpact,
  } = usePOS();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cashReceivedInput, setCashReceivedInput] = useState<string>('');
  const [qrisRefInput, setQrisRefInput] = useState<string>('');

  // Datetime-local helpers
  const toDatetimeLocalStr = (d: Date): string => {
    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const mins = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${mins}`;
  };

  const formatIsoToIndoStr = (str: string): string => {
    if (!str) return '';
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const now = new Date();
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  tomorrow.setHours(16, 0, 0, 0);

  const [dropOffDateIso, setDropOffDateIso] = useState<string>(toDatetimeLocalStr(now));
  const [completionDateIso, setCompletionDateIso] = useState<string>(toDatetimeLocalStr(tomorrow));
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  /** Penanda bill non-omzet yang sedang menunggu persetujuan Manager. */
  const [pendingImpact, setPendingImpact] = useState<RevenueImpact | null>(null);

  // Totals Calculation
  const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const taxTotal = settings.enableTax ? Math.round((subtotal * settings.taxRate) / 100) : 0;
  const serviceChargeTotal = settings.enableService ? Math.round((subtotal * settings.serviceRate) / 100) : 0;
  const grandTotal = subtotal + taxTotal + serviceChargeTotal;

  const cashReceivedNumber = Number(cashReceivedInput) || 0;
  const changeAmount = Math.max(0, cashReceivedNumber - grandTotal);
  const isCashSufficient = cashReceivedNumber >= grandTotal;

  // Auto set exact cash on paymentMethod change
  useEffect(() => {
    if (paymentMethod === 'CASH') {
      setCashReceivedInput(String(grandTotal));
    }
  }, [paymentMethod, grandTotal]);

  // Quick cash nomination buttons
  const quickCashNominals = [
    grandTotal,
    Math.ceil(grandTotal / 10000) * 10000,
    Math.ceil(grandTotal / 20000) * 20000,
    Math.ceil(grandTotal / 50000) * 50000,
    Math.ceil(grandTotal / 100000) * 100000,
    100000,
    200000,
  ].filter((v, i, a) => a.indexOf(v) === i && v >= grandTotal);

  const handlePay = () => {
    if (paymentMethod === 'CASH' && !isCashSufficient) {
      alert('Uang tunai yang diterima masih kurang!');
      return;
    }

    if (settings.businessSector === 'LAUNDRY' && !completionDateIso) {
      alert('Mohon pilih Tanggal & Jam Selesai / Jadi cucian dari kalender sebelum bayar!');
      return;
    }

    setIsProcessing(true);

    // Drop-off / completion scheduling only applies to laundry-style orders,
    // otherwise the receipt would show "Tgl Masuk / Cuci" on a coffee order.
    const isLaundry = settings.businessSector === 'LAUNDRY';
    const dropOffIndo = isLaundry ? formatIsoToIndoStr(dropOffDateIso) : undefined;
    const completionIndo = isLaundry ? formatIsoToIndoStr(completionDateIso) : undefined;

    setTimeout(() => {
      const order = processPayment(
        paymentMethod,
        paymentMethod === 'CASH' ? cashReceivedNumber : undefined,
        qrisRefInput ? `RRN: ${qrisRefInput}` : undefined,
        completionIndo,
        undefined,
        dropOffIndo,
        completionIndo
      );

      setIsProcessing(false);

      if (order) {
        try {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch (e) {}

        onPaymentSuccess(order);
      }
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full text-slate-900 overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h3 className="font-extrabold text-lg text-amber-900">Proses Pembayaran</h3>
              <span className="px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-amber-100 text-amber-900 border border-amber-300 uppercase tracking-wide">
                {orderType === 'DINE_IN'
                  ? `Dine In (${selectedTable ? selectedTable.name : 'Meja Kasir'})`
                  : orderType === 'EVENT'
                  ? `Event (${selectedTable ? selectedTable.name : 'Tanpa Meja'})`
                  : orderType === 'TAKEAWAY'
                  ? 'Takeaway / Bungkus'
                  : orderType === 'ONLINE'
                  ? 'Online / Marketplace'
                  : 'Delivery / Kirim'}
              </span>
              {(orderType === 'DINE_IN' || orderType === 'EVENT') && (
                <span className="px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-slate-100 text-slate-700 border border-slate-300 uppercase tracking-wide">
                  {guestCount} Tamu
                </span>
              )}
              {revenueImpact !== 'SALE' && (
                <span className="px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-rose-600 text-white border border-rose-600 uppercase tracking-wide flex items-center gap-1">
                  <Receipt className="w-3 h-3" />
                  {revenueImpact === 'HOUSE_USE' ? 'House Use' : 'Compliment'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {cart.length} item pesanan • Total Tagihan:{' '}
              <span className="font-extrabold font-mono text-amber-800">{formatRupiah(grandTotal)}</span>
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Left Column: Payment Method Selection */}
          <div className="md:col-span-5 space-y-3">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              Metode Pembayaran:
            </label>

            <div className="space-y-2">
              {[
                { id: 'CASH', label: 'Tunai / Cash', icon: Banknote, color: 'text-emerald-600' },
                { id: 'QRIS', label: 'QRIS (Scan Toko)', icon: QrCode, color: 'text-rose-600' },
                { id: 'DEBIT', label: 'Kartu Debit / EDC', icon: CreditCard, color: 'text-indigo-600' },
                { id: 'SHOPEEPAY', label: 'E-Wallet ShopeePay/OVO', icon: Smartphone, color: 'text-amber-600' },
              ].map((method) => {
                const Icon = method.icon;
                const isSelected = paymentMethod === method.id;

                return (
                  <button
                    key={method.id}
                    onClick={() => setPaymentMethod(method.id as PaymentMethod)}
                    className={`w-full p-3 rounded-2xl border text-left flex items-center space-x-3 transition-all ${
                      isSelected
                        ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${method.color}`} />
                    <span className="text-xs">{method.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Klasifikasi Bill (House Use / Compliment).
                Ada di sini, bukan di daftar metode pembayaran, karena ini soal
                apakah bill dihitung sebagai omzet — bukan soal dari mana
                uangnya datang. Menandainya sebagai metode bayar akan tetap
                menggelembungkan laporan penjualan. */}
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                Klasifikasi Bill:
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'SALE', label: 'Penjualan' },
                    { id: 'HOUSE_USE', label: 'House Use' },
                    { id: 'COMPLIMENT', label: 'Compliment' },
                  ] as { id: RevenueImpact; label: string }[]
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      // Kembali ke penjualan normal tidak perlu izin; menandai
                      // bill jadi bukan-omzet perlu PIN Manager.
                      if (option.id === 'SALE') setRevenueImpact('SALE');
                      else if (revenueImpact !== option.id) setPendingImpact(option.id);
                    }}
                    className={`py-1.5 text-[10px] font-extrabold rounded-lg border transition-all ${
                      revenueImpact === option.id
                        ? option.id === 'SALE'
                          ? 'bg-amber-500 border-amber-500 text-slate-950'
                          : 'bg-rose-600 border-rose-600 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {revenueImpact !== 'SALE' && (
                <p className="text-[10px] font-semibold text-rose-700 leading-relaxed">
                  Bill ini tidak dihitung sebagai omzet dan tidak menambah kas shift. Stok
                  bahan tetap terpotong dan transaksinya tetap tercatat untuk audit.
                </p>
              )}
            </div>

            {/* Total Summary Block */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <span className="text-xs text-slate-500 block">Total Tagihan:</span>
              <span className="text-2xl font-extrabold text-amber-800 font-mono block">
                {formatRupiah(grandTotal)}
              </span>
              {selectedCustomer && (
                <div className="text-[11px] text-emerald-700 font-semibold pt-1 border-t border-slate-200">
                  + {Math.floor(grandTotal / settings.loyaltyEarnRate)} Poin Member ({selectedCustomer.name})
                </div>
              )}
            </div>

            {/* Laundry Drop-Off & Completion Date Settings */}
            {settings.businessSector === 'LAUNDRY' && (
              <div className="p-4 bg-indigo-50/90 border border-indigo-200 rounded-2xl space-y-3 text-indigo-950">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs flex items-center gap-1.5 text-indigo-900">
                    🧺 Jadwal Pengerjaan Cucian
                  </span>
                  <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                    Wajib Diisi
                  </span>
                </div>

                {/* Tanggal Masuk / Tanggal Cuci */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 block flex items-center justify-between">
                    <span>📅 Tanggal Masuk / Cuci:</span>
                    <span className="text-[10px] font-normal text-slate-500">
                      {formatIsoToIndoStr(dropOffDateIso)}
                    </span>
                  </label>
                  <input
                    type="datetime-local"
                    value={dropOffDateIso}
                    onChange={(e) => setDropOffDateIso(e.target.value)}
                    className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs cursor-pointer"
                  />
                </div>

                {/* Tanggal Selesai / Tanggal Jadi */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-indigo-950 block flex items-center justify-between">
                    <span>⏰ Tanggal Selesai / Jadi (Estimasi Ambil):</span>
                    <span className="text-[10px] font-extrabold text-indigo-700">
                      {formatIsoToIndoStr(completionDateIso)}
                    </span>
                  </label>

                  {/* Preset Shortcuts */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      {
                        label: 'Express 3 Jam',
                        calc: () => toDatetimeLocalStr(new Date(Date.now() + 3 * 3600 * 1000)),
                      },
                      {
                        label: 'Hari Ini 20:00',
                        calc: () => toDatetimeLocalStr(new Date(new Date().setHours(20, 0, 0, 0))),
                      },
                      {
                        label: 'Besok 16:00',
                        calc: () => toDatetimeLocalStr(new Date(new Date(Date.now() + 24 * 3600 * 1000).setHours(16, 0, 0, 0))),
                      },
                      {
                        label: '2 Hari Lagi (16:00)',
                        calc: () => toDatetimeLocalStr(new Date(new Date(Date.now() + 48 * 3600 * 1000).setHours(16, 0, 0, 0))),
                      },
                    ].map((preset) => {
                      const presetVal = preset.calc();
                      const isSelected = completionDateIso === presetVal;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setCompletionDateIso(presetVal)}
                          className={`px-2 py-1.5 rounded-xl border text-[11px] font-bold transition-all ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                              : 'bg-white text-indigo-900 border-indigo-200 hover:bg-indigo-100'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Datetime-local Calendar & Time Picker */}
                  <div className="relative">
                    <input
                      type="datetime-local"
                      value={completionDateIso}
                      onChange={(e) => setCompletionDateIso(e.target.value)}
                      className="w-full bg-white border border-indigo-300 rounded-xl px-3 py-2 text-xs text-indigo-950 font-extrabold focus:outline-none focus:ring-2 focus:ring-indigo-600 shadow-xs cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Payment Details */}
          <div className="md:col-span-7 space-y-4">
            {paymentMethod === 'CASH' && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Uang Tunai Diterima (Rp):
                  </label>
                  <input
                    type="number"
                    autoFocus
                    value={cashReceivedInput}
                    onChange={(e) => setCashReceivedInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-lg font-bold font-mono text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* Quick Nominal Buttons */}
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-500">Nominal Cepat:</span>
                  <div className="flex flex-wrap gap-2">
                    {quickCashNominals.map((nom) => (
                      <button
                        key={nom}
                        onClick={() => setCashReceivedInput(String(nom))}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-bold font-mono transition-all ${
                          cashReceivedNumber === nom
                            ? 'bg-amber-500 text-slate-950 border-amber-500'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {nom === grandTotal ? 'Uang Pas' : formatRupiah(nom)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Kembalian Display */}
                <div
                  className={`p-4 rounded-2xl border ${
                    isCashSufficient
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <span className="text-xs font-semibold block">Uang Kembalian:</span>
                  <span className="text-2xl font-extrabold font-mono">
                    {formatRupiah(changeAmount)}
                  </span>
                  {!isCashSufficient && (
                    <p className="text-[11px] text-rose-600 font-medium mt-1">
                      * Kurang {formatRupiah(grandTotal - cashReceivedNumber)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {paymentMethod === 'QRIS' && (
              <div className="p-5 bg-gradient-to-b from-amber-50/60 to-slate-50 rounded-2xl border border-amber-200/80 space-y-4">
                <div className="flex items-start space-x-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500 text-slate-950 flex items-center justify-center shrink-0 shadow-md">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-900">Scan QRIS Fisik Toko</h4>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Silakan minta pelanggan melakukan scan pada <b>Akrilik / Stiker QRIS Fisik</b> yang sudah tersedia di meja / kasir toko.
                    </p>
                  </div>
                </div>

                {/* Step-by-step cashier checklist */}
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2 text-xs text-slate-700 shadow-xs">
                  <div className="flex items-center space-x-2 font-bold text-amber-900 pb-1.5 border-b border-slate-100">
                    <Smartphone className="w-4 h-4 text-amber-600" />
                    <span>Petunjuk Transaksi QRIS Kasir:</span>
                  </div>
                  <ul className="space-y-1.5 text-[11px] text-slate-600 list-disc list-inside">
                    <li>Pelanggan membuka m-Banking (BCA, Mandiri, BRI, BNI, dll) atau E-Wallet (Gopay, OVO, Dana, ShopeePay).</li>
                    <li>Pelanggan melakukan **Scan QR Code pada Akrilik / Stiker QRIS** toko.</li>
                    <li>Pastikan pelanggan menginput nominal tagihan yang sesuai: <b className="text-amber-800 font-mono text-xs">{formatRupiah(grandTotal)}</b></li>
                    <li>Periksa layar HP pelanggan untuk konfirmasi status transaksi berhasil.</li>
                  </ul>
                </div>

                {/* RRN / Ref Input */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 block">
                    Nomor Referensi / Kode RRN QRIS (Opsional):
                  </label>
                  <input
                    type="text"
                    value={qrisRefInput}
                    onChange={(e) => setQrisRefInput(e.target.value)}
                    placeholder="Contoh RRN: 10839201..."
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* Ready indicator */}
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900 font-semibold">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Siap Konfirmasi Pelunasan Kasir</span>
                  </div>
                  <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-md font-extrabold font-mono">
                    {formatRupiah(grandTotal)}
                  </span>
                </div>
              </div>
            )}

            {(paymentMethod === 'DEBIT' || paymentMethod === 'SHOPEEPAY') && (
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-3">
                <CreditCard className="w-12 h-12 text-indigo-600 mx-auto" />
                <h4 className="font-bold text-sm text-slate-900">
                  {paymentMethod === 'DEBIT' ? 'Gesek / Tap Kartu Pada Mesin EDC' : 'Minta Customer Scan Kode QR ShopeePay'}
                </h4>
                <p className="text-xs text-slate-500">
                  Pastikan nominal <span className="text-amber-800 font-bold">{formatRupiah(grandTotal)}</span> sudah sesuai pada terminal transaksi.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Confirm Payment */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/90 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-2xl"
          >
            Batal
          </button>

          <button
            disabled={isProcessing || (paymentMethod === 'CASH' && !isCashSufficient)}
            onClick={handlePay}
            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-sm rounded-2xl shadow-md flex items-center space-x-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Memproses Transaksi...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>Konfirmasi Lunas ({formatRupiah(grandTotal)})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Step-Up Authorization: menandai bill jadi bukan-omzet adalah cara
          tercepat menghilangkan penjualan dari laporan, jadi butuh PIN
          Manager persis seperti VOID. */}
      {pendingImpact && (
        <PinAuthorizationModal
          title="Otorisasi Bill Non-Omzet"
          description={
            pendingImpact === 'HOUSE_USE'
              ? 'Menandai bill sebagai House Use mengeluarkannya dari omzet dan dari kas shift. Perlu PIN Manager atau Admin.'
              : 'Menandai bill sebagai Compliment mengeluarkannya dari omzet dan dari kas shift. Perlu PIN Manager atau Admin.'
          }
          onClose={() => setPendingImpact(null)}
          onAuthorized={() => {
            setRevenueImpact(pendingImpact);
            setPendingImpact(null);
          }}
        />
      )}
    </div>
  );
};
