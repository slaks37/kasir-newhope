import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { useTranslation } from '../../i18n/LanguageContext';
import { Order } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { PauseCircle, Play, Trash2, X, CreditCard, Clock } from 'lucide-react';
import { CheckoutModal } from './CheckoutModal';

interface HoldOrdersModalProps {
  onClose: () => void;
}

export const HoldOrdersModal: React.FC<HoldOrdersModalProps> = ({ onClose }) => {
  const { heldOrders, recallHoldOrder, cancelHoldOrder } = usePOS();
  const { t } = useTranslation();
  const [orderToPay, setOrderToPay] = useState<Order | null>(null);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full text-slate-900 overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <PauseCircle className="w-5 h-5 text-amber-600" />
            <h3 className="font-extrabold text-base text-slate-900">
              {t('holdOrders.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {heldOrders.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-2">
              <PauseCircle className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
              <p className="font-semibold text-slate-500 text-xs">
                {t('holdOrders.empty')}
              </p>
            </div>
          ) : (
            heldOrders.map((order) => (
              <div
                key={order.id}
                className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 hover:border-amber-400 transition-all shadow-xs"
              >
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div>
                    <div className="flex items-center space-x-1.5 mb-0.5">
                      <span className="font-bold text-sm text-amber-800 font-mono">{order.id}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-rose-100 text-rose-800 border border-rose-300">
                        {t('holdOrders.unpaid')}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 block font-mono">
                      {formatDateTime(order.date)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-extrabold text-sm text-slate-900 font-mono">
                      {formatRupiah(order.total)}
                    </span>
                    <span className="text-[10px] text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 block mt-0.5 font-medium">
                      {order.tableName || order.orderType}
                    </span>
                  </div>
                </div>

                {/* Items Summary */}
                <div className="text-xs text-slate-700 space-y-1">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-slate-600">
                      <span>
                        {item.quantity}x {item.name}
                      </span>
                      <span className="font-mono">{formatRupiah(item.totalPrice)}</span>
                    </div>
                  ))}
                </div>

                {/* Laundry Schedule Info if exists */}
                {(order.dropOffDate || order.completionDate || order.completionEstimate) && (
                  <div className="p-2 bg-indigo-50/70 rounded-xl border border-indigo-100/80 text-[10px] space-y-0.5">
                    {order.dropOffDate && (
                      <div className="text-slate-600 flex justify-between">
                        <span>📅 {t('holdOrders.dropOffDate')}:</span>
                        <span className="font-bold text-slate-800">{order.dropOffDate}</span>
                      </div>
                    )}
                    {(order.completionDate || order.completionEstimate) && (
                      <div className="text-indigo-900 flex justify-between font-bold">
                        <span>⏰ {t('holdOrders.completionEstimate')}:</span>
                        <span className="font-black text-indigo-700">
                          {order.completionDate || order.completionEstimate}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer Buttons */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    onClick={() => cancelHoldOrder(order.id)}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold flex items-center space-x-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t('common.delete')}</span>
                  </button>

                  <button
                    onClick={() => {
                      recallHoldOrder(order.id);
                      onClose();
                    }}
                    className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-slate-800" />
                    <span>{t('holdOrders.resumeOrder')}</span>
                  </button>

                  <button
                    onClick={() => setOrderToPay(order)}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black flex items-center space-x-1 shadow-md cursor-pointer"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>{t('holdOrders.payDirect')}</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Checkout Modal for Pending Order Payment */}
      {orderToPay && (
        <CheckoutModal
          pendingOrderToPay={orderToPay}
          onClose={() => setOrderToPay(null)}
          onPaymentSuccess={() => {
            setOrderToPay(null);
            onClose();
          }}
        />
      )}
    </div>
  );
};
