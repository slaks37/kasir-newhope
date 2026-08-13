import React from 'react';
import { Order, StoreSettings } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { Printer, Share2, CheckCircle2, Download, ShoppingBag, X } from 'lucide-react';

interface ReceiptModalProps {
  order: Order;
  settings: StoreSettings;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ order, settings, onClose }) => {
  const handlePrint = () => {
    window.print();
  };

  const handleShareWhatsApp = () => {
    const text = `*STRUK PEMBAYARAN ${settings.storeName.toUpperCase()}*\nFaktur: ${order.id}\nTanggal: ${formatDateTime(
      order.date
    )}\n--------------------------\n${order.items
      .map((i) => `${i.quantity}x ${i.name} (${formatRupiah(i.totalPrice)})`)
      .join('\n')}\n--------------------------\nSubtotal: ${formatRupiah(
      order.subtotal
    )}\nTOTAL BAYAR: ${formatRupiah(order.total)}\nStatus: LUNAS (${order.paymentMethod})\n\nTerima Kasih!`;

    const url = `https://wa.me/${
      order.customer?.phone || ''
    }?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full text-slate-900 overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-base text-slate-900">Pembayaran Sukses</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thermal Receipt Paper Layout */}
        <div className="p-5 overflow-y-auto flex-1 bg-slate-100 flex justify-center">
          <div
            id="receipt-paper"
            className="bg-white text-slate-900 font-mono text-xs p-6 rounded-xl shadow-md w-72 space-y-3 leading-tight select-text border border-slate-200 print:w-full print:shadow-none"
          >
            {/* Header Store */}
            <div className="text-center space-y-1 pb-2 border-b border-dashed border-slate-300">
              {settings.logoUrl && (
                <div className="flex justify-center mb-1">
                  <img
                    src={settings.logoUrl}
                    alt="Logo"
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 object-cover rounded-xl border border-slate-200"
                  />
                </div>
              )}
              <h2 className="font-extrabold text-sm uppercase tracking-wide">{settings.storeName}</h2>
              <p className="text-[10px] text-slate-600">{settings.address}</p>
              <p className="text-[10px] text-slate-600">Telp: {settings.phone}</p>
            </div>

            {/* Receipt Meta */}
            <div className="space-y-0.5 text-[10px] text-slate-700 py-1 border-b border-dashed border-slate-300">
              <div className="flex justify-between">
                <span>No. Faktur:</span>
                <span className="font-bold">{order.id}</span>
              </div>
              <div className="flex justify-between">
                <span>Tanggal:</span>
                <span>{formatDateTime(order.date)}</span>
              </div>
              <div className="flex justify-between">
                <span>Kasir:</span>
                <span>{order.cashierName}</span>
              </div>
              {order.servedByStaffName && (
                <div className="flex justify-between font-bold text-amber-900">
                  <span>Dilayani Oleh:</span>
                  <span>{order.servedByStaffName}</span>
                </div>
              )}
              {order.dropOffDate && (
                <div className="flex justify-between font-semibold text-blue-900 bg-blue-50 p-1 rounded">
                  <span>Tgl Masuk / Cuci:</span>
                  <span>{order.dropOffDate}</span>
                </div>
              )}
              {(order.completionDate || order.completionEstimate) && (
                <div className="flex justify-between font-bold text-indigo-900 bg-indigo-50 p-1 rounded">
                  <span>Tgl Selesai / Jadi:</span>
                  <span>{order.completionDate || order.completionEstimate}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Tipe Order:</span>
                <span className="font-bold">{order.orderType}</span>
              </div>
              {order.tableName && (
                <div className="flex justify-between">
                  <span>Meja:</span>
                  <span className="font-bold">{order.tableName}</span>
                </div>
              )}
              {order.customer && (
                <div className="flex justify-between">
                  <span>Member:</span>
                  <span className="font-bold">{order.customer.name}</span>
                </div>
              )}
            </div>

            {/* Items Breakdown */}
            <div className="space-y-1.5 py-1 border-b border-dashed border-slate-300 text-[11px]">
              {order.items.map((item, idx) => (
                <div key={idx} className="space-y-0.5">
                  <div className="flex justify-between font-semibold">
                    <span>{item.name}</span>
                    <span>{formatRupiah(item.totalPrice)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-600 pl-2">
                    <span>
                      {item.quantity} x {formatRupiah(item.unitPrice)}
                      {item.variantName ? ` (${item.variantName})` : ''}
                    </span>
                  </div>
                  {item.selectedModifiers.length > 0 && (
                    <p className="text-[9px] text-slate-500 pl-2">
                      + {item.selectedModifiers.map((m) => m.optionName).join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Price Totals */}
            <div className="space-y-1 text-[11px] pt-1">
              <div className="flex justify-between text-slate-700">
                <span>Subtotal:</span>
                <span>{formatRupiah(order.subtotal)}</span>
              </div>

              {order.discountTotal > 0 && (
                <div className="flex justify-between text-slate-700">
                  <span>Diskon:</span>
                  <span>-{formatRupiah(order.discountTotal)}</span>
                </div>
              )}

              {order.taxTotal > 0 && (
                <div className="flex justify-between text-slate-700">
                  <span>Pajak (PB1):</span>
                  <span>{formatRupiah(order.taxTotal)}</span>
                </div>
              )}

              {order.serviceChargeTotal > 0 && (
                <div className="flex justify-between text-slate-700">
                  <span>Layanan:</span>
                  <span>{formatRupiah(order.serviceChargeTotal)}</span>
                </div>
              )}

              <div className="flex justify-between font-extrabold text-sm pt-1 border-t border-slate-900 text-slate-900">
                <span>TOTAL:</span>
                <span>{formatRupiah(order.total)}</span>
              </div>

              <div className="flex justify-between text-[10px] text-slate-700 pt-1">
                <span>Metode Pembayaran:</span>
                <span className="font-bold">{order.paymentMethod}</span>
              </div>

              {order.cashReceived && (
                <>
                  <div className="flex justify-between text-[10px] text-slate-700">
                    <span>Tunai Diterima:</span>
                    <span>{formatRupiah(order.cashReceived)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-700 font-bold">
                    <span>Kembalian:</span>
                    <span>{formatRupiah(order.changeAmount || 0)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Footer Tagline */}
            <div className="text-center pt-3 border-t border-dashed border-slate-300 space-y-1 text-[9px] text-slate-600">
              <p className="whitespace-pre-line">{settings.receiptHeader}</p>
              <p className="whitespace-pre-line pt-1">{settings.receiptFooter}</p>
              <p className="font-bold pt-1 text-slate-800">*** New Hope POS ***</p>
            </div>
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <button
              onClick={handleShareWhatsApp}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 shadow-xs"
            >
              <Share2 className="w-4 h-4" />
              <span>Kirim WA</span>
            </button>

            <button
              onClick={handlePrint}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 shadow-xs"
            >
              <Printer className="w-4 h-4" />
              <span>Cetak Struk</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-md"
          >
            Selesai & Transaksi Baru
          </button>
        </div>
      </div>
    </div>
  );
};
