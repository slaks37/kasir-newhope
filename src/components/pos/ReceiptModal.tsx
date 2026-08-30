import React from 'react';
import { Order, StoreSettings } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { Printer, Share2, CheckCircle2, Download, ShoppingBag, X } from 'lucide-react';
import { bangunStruk } from '../../lib/peripheral/escpos';
import { Spooler } from '../../lib/peripheral/spooler';
import { pilihJalur } from '../../lib/peripheral/transport';

interface ReceiptModalProps {
  order: Order;
  settings: StoreSettings;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ order, settings, onClose }) => {
  const [paperSize, setPaperSize] = React.useState<'58mm' | '80mm'>(settings.receiptPaperSize || '80mm');

  const [statusCetak, setStatusCetak] = React.useState<string | null>(null);

  /**
   * MENCETAK.
   *
   * Sebelum ini isinya satu baris: `window.print()`. Itu dialog cetak
   * peramban — ia tidak memotong kertas, tidak membuka laci kasir, dan
   * hasilnya tidak pernah diperiksa. Kalau printer mati, kasir tetap melihat
   * "Pembayaran Sukses" dan tidak ada yang tahu strukmya tidak keluar.
   *
   * Sekarang strukmya dibangun sebagai byte ESC/POS lalu masuk ANTRIAN, yang
   * punya batas waktu dan percobaan ulang (src/lib/peripheral/spooler.ts).
   * Kegagalan tetap kegagalan, tapi ia terlihat dan bisa dicetak ulang.
   *
   * Jalur 'browser' tetap ada dan tetap dipakai sebagai cadangan — bukan
   * karena ia setara, melainkan karena struk lewat dialog lebih baik daripada
   * tidak ada struk sama sekali.
   */
  const cetak = React.useCallback(async () => {
    setStatusCetak('menyiapkan…');
    const jalurPilihan = settings.printerJalur || 'browser';

    // Laci hanya dibuka untuk pembayaran TUNAI. Membuka laci pada pembayaran
    // QRIS atau kartu memberi setiap staf alasan yang sah untuk membukanya
    // kapan saja, dan itu meniadakan gunanya laci terkunci.
    const bukaLaci = settings.bukaLaciSaatTunai !== false && order.paymentMethod === 'CASH';

    const bytes = bangunStruk(
      {
        namaToko: settings.storeName,
        alamat: settings.address,
        telepon: settings.phone,
        nomorStruk: order.id,
        tanggal: formatDateTime(order.date),
        kasir: order.cashierName,
        items: order.items.map((i) => ({
          nama: i.name,
          jumlah: i.quantity,
          hargaSatuan: i.unitPrice,
          total: i.totalPrice,
        })),
        subtotal: order.subtotal,
        diskon: order.discountTotal,
        pajak: order.taxTotal,
        serviceCharge: order.serviceChargeTotal || 0,
        total: order.total,
        metodePembayaran: order.paymentMethod,
        tunaiDiterima: order.cashReceived,
        kembalian: order.changeAmount,
        catatanKaki: settings.receiptFooter,
      },
      paperSize,
      bukaLaci
    );

    const { jalur, turunKe, alasan } = await pilihJalur(jalurPilihan, {
      lanUrl: settings.printerLanUrl,
    });

    const spooler = new Spooler(jalur.kirim);
    spooler.antre(bytes, order.id);
    const hasil = await spooler.jalankan();

    if (hasil.gagal > 0) {
      setStatusCetak(`gagal mencetak — struk tersimpan di antrian, coba lagi setelah printer siap`);
    } else if (turunKe) {
      // Penurunan jalur DIKATAKAN. Merchant yang mengira laci kasirnya bekerja
      // padahal strukmya lewat dialog peramban akan menemukan sendiri di depan
      // pelanggan.
      setStatusCetak(`dicetak lewat dialog peramban (${alasan}) — laci kasir tidak terbuka`);
    } else {
      setStatusCetak(`tercetak lewat ${jalur.nama}`);
    }
  }, [order, settings, paperSize]);

  React.useEffect(() => {
    if (settings.autoPrintReceipt) {
      const timer = setTimeout(() => { void cetak(); }, 300);
      return () => clearTimeout(timer);
    }
  }, [settings.autoPrintReceipt, cetak]);

  const handlePrint = () => { void cetak(); };

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
            <div>
              <h3 className="font-bold text-base text-slate-900 leading-tight">Pembayaran Sukses</h3>
              {/*
                * Hasil cetak DIKATAKAN, tidak diam.
                *
                * Sebelum ini `window.print()` dipanggil dan hasilnya tidak
                * pernah diperiksa: kasir melihat "Pembayaran Sukses" apa pun
                * yang terjadi pada printernya.
                */}
              <p className={`text-[10px] font-medium ${
                statusCetak?.startsWith('gagal') ? 'text-red-600'
                : statusCetak?.startsWith('dicetak lewat dialog') ? 'text-amber-700'
                : 'text-slate-500'
              }`}>
                {statusCetak || `Struk siap dicetak (Format Termal ${paperSize})`}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {/* Quick Paper Format Selector */}
            <div className="hidden sm:flex items-center space-x-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setPaperSize('80mm')}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all ${
                  paperSize === '80mm'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Ukuran Struk Standar Toko/Resto 80mm"
              >
                80mm
              </button>
              <button
                type="button"
                onClick={() => setPaperSize('58mm')}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all ${
                  paperSize === '58mm'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Ukuran Struk Mini / Bluetooth 58mm"
              >
                58mm
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Thermal Receipt Paper Layout */}
        <div className="p-5 overflow-y-auto flex-1 bg-slate-100 flex flex-col items-center">
          {/* Mobile size selector */}
          <div className="sm:hidden flex items-center justify-center space-x-1 bg-white p-1 rounded-xl border border-slate-200 mb-3 shadow-xs">
            <span className="text-[10px] text-slate-500 px-1 font-semibold">Format Nota:</span>
            <button
              type="button"
              onClick={() => setPaperSize('80mm')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                paperSize === '80mm'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              80mm (Standar)
            </button>
            <button
              type="button"
              onClick={() => setPaperSize('58mm')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                paperSize === '58mm'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              58mm (Mini)
            </button>
          </div>

          <div
            id="receipt-paper"
            className={`bg-white text-slate-900 font-mono ${
              paperSize === '58mm'
                ? 'paper-58mm w-64 text-[11px] p-4'
                : 'paper-80mm w-80 text-xs p-6'
            } space-y-3 leading-tight select-text rounded-xl shadow-md border border-slate-200 transition-all`}
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
