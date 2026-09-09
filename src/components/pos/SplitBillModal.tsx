import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah } from '../../utils/formatters';
import { CartItem, PaymentMethod } from '../../types';
import {
  Users,
  Divide,
  Receipt,
  CheckCircle2,
  AlertCircle,
  X,
  CreditCard,
  Banknote,
  QrCode,
  ArrowRight,
  Plus,
  Minus,
} from 'lucide-react';

interface SplitBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentSuccess?: () => void;
}

export const SplitBillModal: React.FC<SplitBillModalProps> = ({
  isOpen,
  onClose,
  onPaymentSuccess,
}) => {
  const { cart, processPayment, selectedTable, selectedCustomer, clearCart, settings } = usePOS();
  const [splitMode, setSplitMode] = useState<'EQUAL' | 'BY_ITEM'>('EQUAL');

  // Equal Split State
  const [paxCount, setPaxCount] = useState<number>(2);
  const [paidPax, setPaidPax] = useState<number[]>([]);
  const [activePayingPax, setActivePayingPax] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');

  // By Item Split State
  // Map of cart item ID -> assigned person index (1, 2, 3...)
  const [itemAssignments, setItemAssignments] = useState<Record<string, number>>({});
  const [personCount, setPersonCount] = useState<number>(2);
  const [paidPersons, setPaidPersons] = useState<number[]>([]);
  const [activePayingPerson, setActivePayingPerson] = useState<number | null>(null);

  if (!isOpen) return null;

  const totalAmount = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const taxRate = settings.enableTax ? settings.taxRate : 0;
  const taxAmount = Math.round((totalAmount * taxRate) / 100);
  const serviceAmount = settings.enableService ? Math.round((totalAmount * settings.serviceRate) / 100) : 0;
  const grandTotal = totalAmount + taxAmount + serviceAmount;

  // EQUAL SPLIT CALCULATIONS
  const perPaxAmount = Math.ceil(grandTotal / paxCount);

  // BY ITEM SPLIT CALCULATIONS
  const getPersonSubtotal = (personIdx: number) => {
    let sub = 0;
    cart.forEach((item) => {
      const assigned = itemAssignments[item.id] || 1;
      if (assigned === personIdx) {
        sub += item.totalPrice;
      }
    });
    const tax = settings.enableTax ? Math.round((sub * taxRate) / 100) : 0;
    const srv = settings.enableService ? Math.round((sub * settings.serviceRate) / 100) : 0;
    return sub + tax + srv;
  };

  const handlePayEqualPax = (paxIndex: number) => {
    const nextPaid = [...paidPax, paxIndex];
    const isFinished = nextPaid.length >= paxCount;

    // Process payment for this pax
    const extraOptions = {
      isSplitBill: true,
      splitBillIndex: paxIndex,
      splitAmount: perPaxAmount,
      skipClearCart: !isFinished,
    };

    processPayment(paymentMethod, perPaxAmount, undefined, undefined, undefined, undefined, undefined, extraOptions);

    setPaidPax(nextPaid);
    setActivePayingPax(null);

    // If all pax paid, finish
    if (isFinished) {
      alert('Semua bagian split bill telah lunas dibayar!');
      clearCart();
      if (onPaymentSuccess) onPaymentSuccess();
      onClose();
    }
  };

  const handlePayPerson = (personIdx: number) => {
    const personTotal = getPersonSubtotal(personIdx);
    if (personTotal <= 0) return;

    const updated = [...paidPersons, personIdx];
    // Check if all persons paid
    let allPaid = true;
    for (let p = 1; p <= personCount; p++) {
      if (!updated.includes(p) && getPersonSubtotal(p) > 0) {
        allPaid = false;
        break;
      }
    }

    const personItems = cart.filter((item) => (itemAssignments[item.id] || 1) === personIdx);

    const extraOptions = {
      isSplitBill: true,
      splitBillIndex: personIdx,
      splitAmount: personTotal,
      splitItems: personItems,
      skipClearCart: !allPaid,
    };

    processPayment(paymentMethod, personTotal, undefined, undefined, undefined, undefined, undefined, extraOptions);

    setPaidPersons(updated);
    setActivePayingPerson(null);

    if (allPaid) {
      alert('Seluruh tagihan menu telah berhasil dilunasi!');
      clearCart();
      if (onPaymentSuccess) onPaymentSuccess();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-600 flex items-center justify-center">
              <Divide className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-lg text-slate-950">Split Bill (Pisah Tagihan)</h3>
              <p className="text-xs text-slate-500">
                {selectedTable ? `Meja ${selectedTable.name}` : 'Tagihan Kasir'} • Total:{' '}
                <span className="font-mono font-black text-slate-900">{formatRupiah(grandTotal)}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-100 rounded-2xl">
          <button
            onClick={() => setSplitMode('EQUAL')}
            className={`py-2.5 px-4 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center space-x-2 ${
              splitMode === 'EQUAL'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4 text-amber-500" />
            <span>Bagi Rata (Equal Split)</span>
          </button>
          <button
            onClick={() => setSplitMode('BY_ITEM')}
            className={`py-2.5 px-4 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center justify-center space-x-2 ${
              splitMode === 'BY_ITEM'
                ? 'bg-white text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Receipt className="w-4 h-4 text-amber-500" />
            <span>Pisah per Menu (By Item)</span>
          </button>
        </div>

        {/* ==================================================================== */}
        {/* MODE 1: EQUAL SPLIT                                                  */}
        {/* ==================================================================== */}
        {splitMode === 'EQUAL' && (
          <div className="space-y-5">
            {/* Pax Counter */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex items-center justify-between">
              <div>
                <span className="font-black text-sm text-slate-900 block">Jumlah Orang (Pax)</span>
                <span className="text-xs text-slate-500">Bagi total tagihan sama rata</span>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  disabled={paxCount <= 2}
                  onClick={() => setPaxCount(Math.max(2, paxCount - 1))}
                  className="w-9 h-9 rounded-xl border border-slate-300 bg-white flex items-center justify-center font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="font-mono font-black text-lg text-slate-950 w-8 text-center">
                  {paxCount}
                </span>
                <button
                  disabled={paxCount >= 10}
                  onClick={() => setPaxCount(Math.min(10, paxCount + 1))}
                  className="w-9 h-9 rounded-xl border border-slate-300 bg-white flex items-center justify-center font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Per Person Amount Display */}
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-center">
              <span className="text-xs font-bold text-amber-900 block">Nominal per Orang</span>
              <span className="font-mono font-black text-2xl text-slate-950 block mt-0.5">
                {formatRupiah(perPaxAmount)}
              </span>
              <span className="text-[11px] text-slate-500">
                ({formatRupiah(grandTotal)} dibagi {paxCount} orang)
              </span>
            </div>

            {/* List of Pax and Payment Triggers */}
            <div className="space-y-2.5">
              <span className="text-xs font-black text-slate-700 block">Daftar Pembayaran Orang</span>
              {Array.from({ length: paxCount }).map((_, idx) => {
                const pNum = idx + 1;
                const isPaid = paidPax.includes(pNum);
                const isPaying = activePayingPax === pNum;

                return (
                  <div
                    key={pNum}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      isPaid
                        ? 'bg-emerald-50/80 border-emerald-300'
                        : isPaying
                        ? 'bg-white border-amber-500 ring-2 ring-amber-200'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${
                            isPaid
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-900 text-white'
                          }`}
                        >
                          {isPaid ? '✓' : pNum}
                        </div>
                        <div>
                          <span className="font-black text-xs text-slate-950 block">
                            Orang ke-{pNum}
                          </span>
                          <span className="font-mono font-bold text-xs text-slate-600">
                            {formatRupiah(perPaxAmount)}
                          </span>
                        </div>
                      </div>

                      <div>
                        {isPaid ? (
                          <span className="px-3 py-1 rounded-xl bg-emerald-100 text-emerald-950 font-black text-xs border border-emerald-300 flex items-center space-x-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Lunas</span>
                          </span>
                        ) : isPaying ? (
                          <button
                            onClick={() => setActivePayingPax(null)}
                            className="px-3 py-1 text-xs font-bold text-slate-500 hover:text-slate-800"
                          >
                            Batal
                          </button>
                        ) : (
                          <button
                            onClick={() => setActivePayingPax(pNum)}
                            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-xs transition-all cursor-pointer flex items-center space-x-1.5"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Bayar Bagian Ini</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline Payment Method Form for This Pax */}
                    {isPaying && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                        <span className="text-[11px] font-bold text-slate-600 block">
                          Pilih Metode Bayar Orang ke-{pNum}:
                        </span>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('CASH')}
                            className={`p-2 rounded-xl border text-xs font-black flex items-center justify-center space-x-1.5 cursor-pointer ${
                              paymentMethod === 'CASH'
                                ? 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-300'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            <span>Tunai</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('QRIS')}
                            className={`p-2 rounded-xl border text-xs font-black flex items-center justify-center space-x-1.5 cursor-pointer ${
                              paymentMethod === 'QRIS'
                                ? 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-300'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>QRIS</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('DEBIT')}
                            className={`p-2 rounded-xl border text-xs font-black flex items-center justify-center space-x-1.5 cursor-pointer ${
                              paymentMethod === 'DEBIT'
                                ? 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-300'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Debit / Transfer</span>
                          </button>
                        </div>
                        <button
                          onClick={() => handlePayEqualPax(pNum)}
                          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black text-xs shadow-xs cursor-pointer flex items-center justify-center space-x-1.5"
                        >
                          <span>Konfirmasi Pembayaran ({formatRupiah(perPaxAmount)})</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* MODE 2: SPLIT BY ITEM                                                */}
        {/* ==================================================================== */}
        {splitMode === 'BY_ITEM' && (
          <div className="space-y-5">
            {/* Person Count Selector */}
            <div className="flex items-center justify-between bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <span className="text-xs font-bold text-slate-700">Jumlah Orang Pemesan:</span>
              <div className="flex items-center space-x-2">
                {[2, 3, 4, 5].map((cnt) => (
                  <button
                    key={cnt}
                    onClick={() => setPersonCount(cnt)}
                    className={`px-3 py-1.5 rounded-xl font-bold text-xs cursor-pointer ${
                      personCount === cnt
                        ? 'bg-slate-900 text-white font-black'
                        : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {cnt} Orang
                  </button>
                ))}
              </div>
            </div>

            {/* Menu Items Assignment Table */}
            <div className="space-y-2">
              <span className="text-xs font-black text-slate-700 block">Tentukan Pemilik Setiap Menu:</span>
              <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100">
                {cart.map((item) => {
                  const assignedTo = itemAssignments[item.id] || 1;
                  return (
                    <div
                      key={item.id}
                      className="p-3 bg-white flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <span className="font-black text-slate-900 block">{item.name}</span>
                        <span className="text-slate-500 font-mono text-[11px]">
                          {item.quantity}x @ {formatRupiah(item.unitPrice)}
                        </span>
                      </div>

                      <div className="flex items-center space-x-1.5 shrink-0">
                        <span className="text-[11px] text-slate-400 font-bold">Milik:</span>
                        <select
                          value={assignedTo}
                          onChange={(e) =>
                            setItemAssignments({
                              ...itemAssignments,
                              [item.id]: Number(e.target.value),
                            })
                          }
                          className="px-2.5 py-1.5 rounded-xl border border-slate-300 font-bold text-slate-900 bg-slate-50 focus:border-amber-500 outline-none text-xs"
                        >
                          {Array.from({ length: personCount }).map((_, i) => (
                            <option key={i + 1} value={i + 1}>
                              Orang ke-{i + 1}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary Per Person */}
            <div className="space-y-2.5">
              <span className="text-xs font-black text-slate-700 block">Tagihan per Orang:</span>
              {Array.from({ length: personCount }).map((_, idx) => {
                const pNum = idx + 1;
                const pSub = getPersonSubtotal(pNum);
                const isPaid = paidPersons.includes(pNum);
                const isPaying = activePayingPerson === pNum;

                return (
                  <div
                    key={pNum}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      isPaid
                        ? 'bg-emerald-50/80 border-emerald-300'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-black text-xs text-slate-950 block">
                          Orang ke-{pNum}
                        </span>
                        <span className="font-mono font-bold text-sm text-amber-700">
                          {formatRupiah(pSub)}
                        </span>
                      </div>

                      <div>
                        {isPaid ? (
                          <span className="px-3 py-1 rounded-xl bg-emerald-100 text-emerald-950 font-black text-xs border border-emerald-300 flex items-center space-x-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Lunas</span>
                          </span>
                        ) : isPaying ? (
                          <button
                            onClick={() => setActivePayingPerson(null)}
                            className="px-3 py-1 text-xs font-bold text-slate-500 hover:text-slate-800"
                          >
                            Batal
                          </button>
                        ) : (
                          <button
                            disabled={pSub <= 0}
                            onClick={() => setActivePayingPerson(pNum)}
                            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-xs transition-all cursor-pointer disabled:opacity-40"
                          >
                            Bayar Bagian Ini
                          </button>
                        )}
                      </div>
                    </div>

                    {isPaying && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                        <span className="text-[11px] font-bold text-slate-600 block">
                          Metode Bayar Orang ke-{pNum}:
                        </span>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('CASH')}
                            className={`p-2 rounded-xl border text-xs font-black flex items-center justify-center space-x-1.5 cursor-pointer ${
                              paymentMethod === 'CASH'
                                ? 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-300'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            <span>Tunai</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('QRIS')}
                            className={`p-2 rounded-xl border text-xs font-black flex items-center justify-center space-x-1.5 cursor-pointer ${
                              paymentMethod === 'QRIS'
                                ? 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-300'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>QRIS</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('DEBIT')}
                            className={`p-2 rounded-xl border text-xs font-black flex items-center justify-center space-x-1.5 cursor-pointer ${
                              paymentMethod === 'DEBIT'
                                ? 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-300'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Debit / Transfer</span>
                          </button>
                        </div>
                        <button
                          onClick={() => handlePayPerson(pNum)}
                          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black text-xs shadow-xs cursor-pointer flex items-center justify-center space-x-1.5"
                        >
                          <span>Selesaikan Tagihan Orang ke-{pNum} ({formatRupiah(pSub)})</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
