import React from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { PauseCircle, Play, Trash2, X } from 'lucide-react';

interface HoldOrdersModalProps {
  onClose: () => void;
}

export const HoldOrdersModal: React.FC<HoldOrdersModalProps> = ({ onClose }) => {
  const { heldOrders, recallHoldOrder, cancelHoldOrder } = usePOS();

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full text-slate-900 overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <PauseCircle className="w-5 h-5 text-amber-600" />
            <h3 className="font-bold text-base text-slate-900">Daftar Pesanan Tertahan (Hold)</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100"
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
                Tidak ada pesanan yang ditahan.
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
                    <span className="font-bold text-sm text-amber-800">{order.id}</span>
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

                {/* Footer Buttons */}
                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
                  <button
                    onClick={() => cancelHoldOrder(order.id)}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold flex items-center space-x-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus</span>
                  </button>

                  <button
                    onClick={() => {
                      recallHoldOrder(order.id);
                      onClose();
                    }}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-bold flex items-center space-x-1 shadow-md"
                  >
                    <Play className="w-3.5 h-3.5 fill-slate-950" />
                    <span>Panggil Ke Cart</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
