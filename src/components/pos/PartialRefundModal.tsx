import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { useTranslation } from '../../i18n/LanguageContext';
import { Order, OrderRefund } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import {
  RotateCcw,
  AlertTriangle,
  Printer,
  CheckCircle2,
  X,
  Plus,
  Minus,
  Banknote,
  CreditCard,
  Share2,
  Receipt,
  FileText,
} from 'lucide-react';

interface PartialRefundModalProps {
  order: Order;
  isOpen: boolean;
  onClose: () => void;
  onRefundSuccess?: (refund: OrderRefund) => void;
}

export const PartialRefundModal: React.FC<PartialRefundModalProps> = ({
  order,
  isOpen,
  onClose,
  onRefundSuccess,
}) => {
  const { refundOrderItems, settings, shift } = usePOS();
  const { t } = useTranslation();

  const presetReasons = [
    t('refund.reasonDefective'),
    t('refund.reasonCancelPartial'),
    t('refund.reasonWrongOrder'),
    t('refund.reasonQuality'),
    t('refund.reasonOutOfStock'),
    t('refund.reasonOther'),
  ];

  // Selected quantities to refund by cartItemId
  const [refundQuantities, setRefundQuantities] = useState<Record<string, number>>({});
  const [selectedReason, setSelectedReason] = useState<string>(presetReasons[0]);
  const [customReason, setCustomReason] = useState<string>('');
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'ORIGINAL_METHOD'>('CASH');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [completedRefund, setCompletedRefund] = useState<OrderRefund | null>(null);
  const [thermalSize, setThermalSize] = useState<'58mm' | '80mm'>(settings.receiptPaperSize || '80mm');

  if (!isOpen) return null;

  const handleQtyChange = (cartItemId: string, delta: number, maxQty: number) => {
    setRefundQuantities((prev) => {
      const current = prev[cartItemId] || 0;
      const next = Math.max(0, Math.min(maxQty, current + delta));
      return { ...prev, [cartItemId]: next };
    });
  };

  // Calculate refund totals
  let calculatedSubtotal = 0;
  const itemsToRefund: { cartItemId: string; quantity: number; reason: string }[] = [];

  order.items.forEach((item) => {
    const qty = refundQuantities[item.id] || 0;
    if (qty > 0) {
      const unitRefund = item.totalPrice / item.quantity;
      const itemSubtotal = Math.round(unitRefund * qty);
      calculatedSubtotal += itemSubtotal;
      itemsToRefund.push({
        cartItemId: item.id,
        quantity: qty,
        reason: customReason.trim() || selectedReason,
      });
    }
  });

  const subtotalOriginal = order.subtotal || order.total;
  const ratio = subtotalOriginal > 0 ? calculatedSubtotal / subtotalOriginal : 0;
  const calculatedTaxRefund = order.taxTotal > 0 ? Math.round(order.taxTotal * ratio) : 0;
  const calculatedServiceRefund = order.serviceChargeTotal > 0 ? Math.round(order.serviceChargeTotal * ratio) : 0;
  const grandTotalRefund = calculatedSubtotal + calculatedTaxRefund + calculatedServiceRefund;

  const handleProcessRefund = () => {
    if (itemsToRefund.length === 0) {
      alert(t('refund.selectItemsPrompt'));
      return;
    }

    const finalReason = customReason.trim() || selectedReason;
    setIsProcessing(true);

    setTimeout(() => {
      const result = refundOrderItems(order.id, itemsToRefund, refundMethod);
      setIsProcessing(false);
      if (result) {
        setCompletedRefund(result);
        if (onRefundSuccess) onRefundSuccess(result);
      } else {
        alert(t('common.error'));
      }
    }, 400);
  };

  const handlePrintReturnReceipt = () => {
    window.print();
  };

  const handleShareWhatsApp = () => {
    if (!completedRefund) return;
    const phone = order.customer?.phone ? order.customer.phone.replace(/[^0-9]/g, '') : '';
    const formattedPhone = phone.startsWith('0') ? '62' + phone.slice(1) : phone;
    const storeName = settings.storeName || 'NewHope POS';

    const itemsText = completedRefund.items
      .map((i) => `• ${i.productName} (${i.quantity}x) - ${formatRupiah(i.totalRefundAmount)}`)
      .join('%0A');

    const msg =
      `*BUKTI RETUR / PENGEMBALIAN BARANG*%0A` +
      `*${storeName}*%0A%0A` +
      `No. Retur: *${completedRefund.id}*%0A` +
      `No. Invoice Asal: *${completedRefund.orderId}*%0A` +
      `Waktu: ${formatDateTime(completedRefund.timestamp)}%0A` +
      `Kasir: ${completedRefund.cashierName}%0A%0A` +
      `*Rincian Barang yang Diretur:*%0A${itemsText}%0A%0A` +
      `*Total Pengembalian Dana:* *${formatRupiah(completedRefund.totalRefund)}*%0A` +
      `Metode: ${completedRefund.refundMethod === 'CASH' ? 'Tunai / Cash' : 'Metode Asal'}%0A` +
      `Alasan: ${completedRefund.reason}%0A%0A` +
      `Terima kasih telah berbelanja di ${storeName}.`;

    const waUrl = formattedPhone ? `https://wa.me/${formattedPhone}?text=${msg}` : `https://wa.me/?text=${msg}`;
    window.open(waUrl, '_blank');
  };

  return (
    <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-xl w-full text-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-amber-50/70 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-500 text-slate-950 rounded-2xl shadow-xs">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-black text-base text-slate-900">
                  {completedRefund ? t('refund.refundSuccess') : t('refund.partialRefundTitle')}
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-200/80 text-amber-950 rounded-full">
                  #{order.orderNumber}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Invoice: <span className="font-mono font-bold text-slate-700">{order.id}</span> •{' '}
                {order.customer?.name ? `${t('pos.customerSelect')}: ${order.customer.name}` : t('pos.walkInCustomer')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-200/60 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {!completedRefund ? (
            <>
              {/* Info Box */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-start space-x-2.5 text-xs text-slate-600">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>
                  {t('refund.partialRefundTitle')}
                </p>
              </div>

              {/* Items List Stepper */}
              <div className="space-y-2.5">
                <label className="text-xs font-black uppercase text-slate-500 tracking-wider block">
                  {t('refund.returnItem')}:
                </label>

                <div className="space-y-2">
                  {order.items.map((item) => {
                    const alreadyRefunded = item.refundedQuantity || 0;
                    const maxRefundable = Math.max(0, item.quantity - alreadyRefunded);
                    const selectedQty = refundQuantities[item.id] || 0;
                    const isFullyRefunded = maxRefundable === 0;

                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                          selectedQty > 0
                            ? 'bg-amber-50/60 border-amber-300 shadow-2xs'
                            : isFullyRefunded
                            ? 'bg-slate-100/70 border-slate-200 opacity-60'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <h4 className="font-extrabold text-xs text-slate-900 truncate">{item.name}</h4>
                          <div className="flex items-center space-x-2 text-[11px] text-slate-500 mt-0.5">
                            <span>{item.quantity} unit</span>
                            {alreadyRefunded > 0 && (
                              <span className="text-rose-600 font-bold">
                                ({alreadyRefunded})
                              </span>
                            )}
                            <span className="font-mono font-bold text-slate-700">
                              @{formatRupiah(item.unitPrice)}
                            </span>
                          </div>
                        </div>

                        {/* Quantity Stepper */}
                        {isFullyRefunded ? (
                          <span className="px-2.5 py-1 bg-slate-200 text-slate-600 font-bold text-[10px] rounded-lg">
                            {t('refund.returnItem')}
                          </span>
                        ) : (
                          <div className="flex items-center space-x-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleQtyChange(item.id, -1, maxRefundable)}
                              disabled={selectedQty <= 0}
                              className="w-7 h-7 rounded-lg bg-slate-200 hover:bg-slate-300 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-700 font-bold"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>

                            <span className="w-8 text-center font-mono font-black text-sm text-slate-900">
                              {selectedQty}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleQtyChange(item.id, 1, maxRefundable)}
                              disabled={selectedQty >= maxRefundable}
                              className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-950 font-bold"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reason Selector */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-bold text-slate-700 block">{t('refund.refundReason')}:</label>
                <select
                  value={selectedReason}
                  onChange={(e) => setSelectedReason(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {presetReasons.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>

                {selectedReason === presetReasons[presetReasons.length - 1] && (
                  <input
                    type="text"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder={t('refund.refundReason')}
                    className="w-full mt-2 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                )}
              </div>

              {/* Refund Payment Method */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-bold text-slate-700 block">{t('refund.refundMethod')}:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRefundMethod('CASH')}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center space-x-2 transition-all ${
                      refundMethod === 'CASH'
                        ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Banknote className="w-4 h-4" />
                    <span>{t('refund.cashRefund')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRefundMethod('ORIGINAL_METHOD')}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center space-x-2 transition-all ${
                      refundMethod === 'ORIGINAL_METHOD'
                        ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>{t('refund.originalMethod')}</span>
                  </button>
                </div>
              </div>

              {/* Calculation Summary Box */}
              <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-mono font-bold text-slate-800">{formatRupiah(calculatedSubtotal)}</span>
                </div>
                {calculatedTaxRefund > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>{t('pos.tax')} ({settings.taxRate}%):</span>
                    <span className="font-mono font-bold text-slate-800">{formatRupiah(calculatedTaxRefund)}</span>
                  </div>
                )}
                {calculatedServiceRefund > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>{t('pos.service')} ({settings.serviceRate}%):</span>
                    <span className="font-mono font-bold text-slate-800">{formatRupiah(calculatedServiceRefund)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-amber-200 font-extrabold text-sm">
                  <span className="text-slate-900">{t('common.total')}:</span>
                  <span className="font-mono text-base text-rose-700">{formatRupiah(grandTotalRefund)}</span>
                </div>
              </div>
            </>
          ) : (
            /* Completed Return Receipt Preview */
            <div className="space-y-4">
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center space-x-2 text-xs text-emerald-900 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{t('refund.refundSuccess')}</span>
              </div>

              {/* Thermal Receipt Box */}
              <div
                id="thermal-return-receipt"
                className={`mx-auto bg-white border-2 border-dashed border-slate-300 rounded-2xl p-5 font-mono text-xs text-slate-900 shadow-sm ${
                  thermalSize === '58mm' ? 'max-w-[280px]' : 'max-w-[360px]'
                }`}
              >
                <div className="text-center space-y-1 border-b border-dashed border-slate-300 pb-3">
                  <h3 className="font-black text-sm uppercase">{settings.storeName || 'NEWHOPE POS'}</h3>
                  <p className="text-[10px] text-slate-500">{settings.address || 'Cabang Utama'}</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    *** {t('refund.returnReceipt')} ***
                  </p>
                </div>

                <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span>{t('refund.returnItem')}:</span>
                    <span className="font-bold">{completedRefund.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Invoice:</span>
                    <span>{completedRefund.orderId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('common.date')}:</span>
                    <span>{formatDateTime(completedRefund.timestamp)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('receipt.cashier')}:</span>
                    <span>{completedRefund.cashierName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('refund.refundReason')}:</span>
                    <span className="text-right">{completedRefund.reason}</span>
                  </div>
                </div>

                <div className="py-2.5 border-b border-dashed border-slate-300 space-y-2">
                  <div className="text-[10px] font-bold uppercase text-slate-500">{t('refund.returnItem')}:</div>
                  {completedRefund.items.map((it) => (
                    <div key={it.cartItemId} className="space-y-0.5">
                      <div className="font-bold">{it.productName}</div>
                      <div className="flex justify-between text-slate-600 text-[11px]">
                        <span>
                          {it.quantity} x {formatRupiah(it.unitPrice)}
                        </span>
                        <span>{formatRupiah(it.totalRefundAmount)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{formatRupiah(completedRefund.subtotalRefund)}</span>
                  </div>
                  {completedRefund.taxRefund > 0 && (
                    <div className="flex justify-between">
                      <span>{t('pos.tax')}:</span>
                      <span>{formatRupiah(completedRefund.taxRefund)}</span>
                    </div>
                  )}
                  {completedRefund.serviceRefund > 0 && (
                    <div className="flex justify-between">
                      <span>{t('pos.service')}:</span>
                      <span>{formatRupiah(completedRefund.serviceRefund)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-sm pt-1 border-t border-slate-200">
                    <span>{t('common.total')}:</span>
                    <span>{formatRupiah(completedRefund.totalRefund)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>{t('refund.refundMethod')}:</span>
                    <span>{completedRefund.refundMethod === 'CASH' ? t('refund.cashRefund') : t('refund.originalMethod')}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          {!completedRefund ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
              >
                {t('common.cancel')}
              </button>

              <button
                type="button"
                disabled={isProcessing || itemsToRefund.length === 0}
                onClick={handleProcessRefund}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-xs rounded-xl shadow-md flex items-center space-x-2 cursor-pointer transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                <span>
                  {isProcessing
                    ? t('common.loading')
                    : `${t('refund.processRefund')} (${formatRupiah(grandTotalRefund)})`}
                </span>
              </button>
            </>
          ) : (
            <div className="w-full flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-500">{t('receipt.paperSize')}:</span>
                <select
                  value={thermalSize}
                  onChange={(e) => setThermalSize(e.target.value as '58mm' | '80mm')}
                  className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-800"
                >
                  <option value="58mm">58 mm</option>
                  <option value="80mm">80 mm</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleShareWhatsApp}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-xs cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{t('refund.shareWhatsApp')}</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintReturnReceipt}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-xl flex items-center space-x-1.5 shadow-md cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('refund.printReturnReceipt')}</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl cursor-pointer"
                >
                  {t('common.done')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
