import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { Order, LaundryStage } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import {
  Waves,
  Wind,
  Shirt,
  PackageCheck,
  CheckCircle2,
  Clock,
  Tag,
  Printer,
  Phone,
  MessageCircle,
  Sparkles,
  ArrowRight,
  Filter,
  Search,
  Box,
  Layers,
  MessageSquare,
} from 'lucide-react';
import { WhatsAppLifecycleCenter } from '../whatsapp/WhatsAppLifecycleCenter';

const LAUNDRY_STAGES: { key: LaundryStage; label: string; icon: any; color: string }[] = [
  { key: 'ANTRIAN', label: 'Antrean Masuk', icon: Clock, color: 'border-slate-300 bg-slate-50' },
  { key: 'CUCI', label: 'Proses Cuci', icon: Waves, color: 'border-blue-300 bg-blue-50/50' },
  { key: 'KERING', label: 'Pengeringan', icon: Wind, color: 'border-amber-300 bg-amber-50/50' },
  { key: 'SETRIKA', label: 'Setrika Uap', icon: Shirt, color: 'border-purple-300 bg-purple-50/50' },
  { key: 'PACKING', label: 'Packing & Wangi', icon: Box, color: 'border-indigo-300 bg-indigo-50/50' },
  { key: 'SIAP_AMBIL', label: 'Siap di Rak Simpan', icon: PackageCheck, color: 'border-emerald-400 bg-emerald-50/70' },
  { key: 'SELESAI', label: 'Sudah Diambil', icon: CheckCircle2, color: 'border-slate-200 bg-white' },
];

export const LaundryPipelineView: React.FC = () => {
  const { orders, updateLaundryStage, settings } = usePOS();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrderForRack, setSelectedOrderForRack] = useState<Order | null>(null);
  const [rackInput, setRackInput] = useState('');
  const [printTicketOrder, setPrintTicketOrder] = useState<Order | null>(null);
  const [showLifecycleModal, setShowLifecycleModal] = useState(false);

  // Filter orders related to laundry
  const laundryOrders = orders.filter((o) => {
    const matchesSearch =
      String(o.orderNumber).includes(searchQuery) ||
      (o.customer?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (o.storageRack || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const handleUpdateStage = (orderId: string, nextStage: LaundryStage, rack?: string) => {
    updateLaundryStage(orderId, nextStage, rack);
  };

  const handleAssignRack = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderForRack) return;
    const rack = rackInput.trim() || 'RAK-A1';
    updateLaundryStage(selectedOrderForRack.id, selectedOrderForRack.laundryStage || 'SIAP_AMBIL', rack);
    setSelectedOrderForRack(null);
    setRackInput('');
  };

  const handleOpenWaNotification = (order: Order) => {
    const phone = order.customer?.phone || '';
    if (!phone) {
      alert('Nomor telepon pelanggan belum tercatat.');
      return;
    }
    const cleanPhone = phone.replace(/\D/g, '').replace(/^0/, '62');
    const rackName = order.storageRack || 'Rak B-03';
    const text = encodeURIComponent(
      `Halo Kak ${order.customer?.name || ''}! 🧺✨\nPakaianmu sudah selesai disetrika dan ada di ${rackName}.\nSiap diambil di ${settings.storeName} kapan saja. Total tagihan: ${formatRupiah(order.total)}. Terima kasih!`
    );
    window.open(`https://wa.me/${cleanPhone}?text=${text}`, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 text-white p-5 rounded-3xl shadow-xl flex flex-wrap items-center justify-between gap-4 border border-slate-800">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Waves className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-black text-white">Pipeline Pengerjaan Laundry</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-cyan-500 text-slate-950 uppercase">
                Weight &amp; Stage Engine
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Alur status pengerjaan (Cuci, Kering, Setrika, Packing) dan manajemen nomor rak simpan.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowLifecycleModal(true)}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer flex items-center space-x-1.5"
          >
            <MessageSquare className="w-4 h-4" />
            <span>WA Rak Siap Ambil</span>
          </button>

          {/* Search */}
          <div className="relative min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nota, nama, nomor rak..."
              className="w-full pl-9 pr-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 font-medium"
            />
          </div>
        </div>
      </div>

      {/* Kanban Pipeline Columns */}
      <div className="flex gap-4 overflow-x-auto pb-4 pt-1">
        {LAUNDRY_STAGES.map((col) => {
          const Icon = col.icon;
          const stageOrders = laundryOrders.filter(
            (o) => (o.laundryStage || 'ANTRIAN') === col.key
          );

          return (
            <div
              key={col.key}
              className="min-w-[280px] max-w-[280px] flex flex-col rounded-3xl bg-slate-100/90 border border-slate-200/80 p-3 space-y-3"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between px-2 pt-1">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-700 shadow-xs">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="font-black text-xs text-slate-900">{col.label}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-black bg-white text-slate-700 border border-slate-200">
                  {stageOrders.length}
                </span>
              </div>

              {/* Order Cards List */}
              <div className="flex-1 space-y-3 overflow-y-auto max-h-[650px] pr-0.5">
                {stageOrders.length === 0 ? (
                  <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-2xl text-[11px] text-slate-400 font-bold">
                    Kosong
                  </div>
                ) : (
                  stageOrders.map((order) => (
                    <div
                      key={order.id}
                      className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs hover:shadow-md transition-all space-y-2.5"
                    >
                      {/* Card Header */}
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="font-mono font-black text-xs text-slate-900 block">
                            #{order.orderNumber}
                          </span>
                          <span className="font-bold text-xs text-slate-800">
                            {order.customer?.name || 'Pelanggan Walk-In'}
                          </span>
                        </div>
                        {order.storageRack ? (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-950 border border-amber-300 rounded-lg text-[10px] font-black font-mono flex items-center space-x-1">
                            <Tag className="w-3 h-3 text-amber-700" />
                            <span>{order.storageRack}</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedOrderForRack(order);
                              setRackInput('RAK-');
                            }}
                            className="text-[10px] font-bold text-cyan-600 hover:underline"
                          >
                            + Beri Rak
                          </button>
                        )}
                      </div>

                      {/* Items info */}
                      <div className="text-[11px] text-slate-600 space-y-0.5 bg-slate-50 p-2 rounded-xl border border-slate-100 font-medium">
                        {order.items.slice(0, 2).map((it, i) => (
                          <div key={i} className="flex justify-between">
                            <span className="truncate max-w-[150px]">{it.name}</span>
                            <span className="font-mono font-bold">
                              {it.quantity} {it.itemNotes || 'item'}
                            </span>
                          </div>
                        ))}
                        {order.items.length > 2 && (
                          <div className="text-[10px] text-slate-400 italic">
                            +{order.items.length - 2} item lainnya...
                          </div>
                        )}
                      </div>

                      {/* Total & Date */}
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono font-black text-slate-950">
                          {formatRupiah(order.total)}
                        </span>
                        <span className="text-slate-400 font-medium text-[10px]">
                          {formatDateTime(order.date).split(' ')[1]}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5">
                        <div className="flex items-center space-x-1">
                          {order.customer?.phone && (
                            <button
                              onClick={() => handleOpenWaNotification(order)}
                              className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 cursor-pointer"
                              title="Kirim Notifikasi WhatsApp"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => setPrintTicketOrder(order)}
                            className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 cursor-pointer"
                            title="Cetak Tiket Rak Simpan"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Shift Stage Actions */}
                        {col.key === 'ANTRIAN' && (
                          <button
                            onClick={() => handleUpdateStage(order.id, 'CUCI')}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Mulai Cuci</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {col.key === 'CUCI' && (
                          <button
                            onClick={() => handleUpdateStage(order.id, 'KERING')}
                            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Keringkan</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {col.key === 'KERING' && (
                          <button
                            onClick={() => handleUpdateStage(order.id, 'SETRIKA')}
                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Setrika</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {col.key === 'SETRIKA' && (
                          <button
                            onClick={() => handleUpdateStage(order.id, 'PACKING')}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Packing</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {col.key === 'PACKING' && (
                          <button
                            onClick={() => {
                              setSelectedOrderForRack(order);
                              setRackInput(order.storageRack || 'RAK-A1');
                            }}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Simpan di Rak</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {col.key === 'SIAP_AMBIL' && (
                          <button
                            onClick={() => handleUpdateStage(order.id, 'SELESAI')}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Diambil</span>
                            <CheckCircle2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ====================================================================== */}
      {/* MODAL: ASSIGN STORAGE RACK                                             */}
      {/* ====================================================================== */}
      {selectedOrderForRack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <h4 className="font-black text-sm text-slate-950 flex items-center space-x-1.5">
                <Tag className="w-4 h-4 text-cyan-600" />
                <span>Beri Nomor Rak Simpan</span>
              </h4>
              <button
                onClick={() => setSelectedOrderForRack(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAssignRack} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Nomor Rak Simpan / Hanger:
                </label>
                <input
                  type="text"
                  required
                  value={rackInput}
                  onChange={(e) => setRackInput(e.target.value.toUpperCase())}
                  placeholder="Contoh: RAK-A1, RAK-B2, HANGER-04"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-black text-slate-950 focus:border-cyan-500 outline-none uppercase text-sm"
                />
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {['RAK-A1', 'RAK-A2', 'RAK-B1', 'RAK-B2', 'RAK-C1', 'HANGER-01'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRackInput(preset)}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-[11px] font-mono font-bold cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrderForRack(null)}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-black shadow-xs cursor-pointer"
                >
                  Simpan ke Rak
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL: PRINT STORAGE RACK TICKET                                       */}
      {/* ====================================================================== */}
      {printTicketOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-2">
              <h4 className="font-black text-sm text-slate-950 flex items-center space-x-1.5">
                <Printer className="w-4 h-4 text-cyan-600" />
                <span>Tiket Rak Simpan Laundry</span>
              </h4>
              <button
                onClick={() => setPrintTicketOrder(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {/* Thermal Ticket Preview */}
            <div className="p-4 bg-slate-50 border-2 border-dashed border-slate-300 rounded-2xl font-mono text-center space-y-2 text-xs">
              <div className="font-black text-sm tracking-widest uppercase">TIKET KLAIM RAK</div>
              <div className="text-[10px] text-slate-500">Laundry Clean &amp; Fresh</div>
              <div className="py-2 border-y border-dashed border-slate-300 space-y-1">
                <div className="text-[11px] text-slate-600">NOMOR RAK SIMPAN:</div>
                <div className="text-3xl font-black text-slate-950 bg-amber-200/80 py-1 rounded-xl">
                  {printTicketOrder.storageRack || 'RAK-UMUM'}
                </div>
              </div>
              <div className="text-left text-[11px] space-y-1 pt-1">
                <div>Nota: #{printTicketOrder.orderNumber}</div>
                <div>Pelanggan: {printTicketOrder.customer?.name || 'Walk-In'}</div>
                <div>Tanggal: {formatDateTime(printTicketOrder.date)}</div>
                <div>Total: {formatRupiah(printTicketOrder.total)}</div>
              </div>
              <div className="text-[10px] text-slate-400 pt-2 border-t border-dashed border-slate-300">
                Tempelkan tiket ini pada kantong laundry sebelum disimpan di rak.
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPrintTicketOrder(null)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => {
                  window.print();
                }}
                className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black shadow-xs cursor-pointer flex items-center space-x-1"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak Tiket</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Lifecycle Center Modal */}
      <WhatsAppLifecycleCenter
        isOpen={showLifecycleModal}
        onClose={() => setShowLifecycleModal(false)}
        initialFilter="LAUNDRY_READY"
      />
    </div>
  );
};
