import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext';
import {
  MessageSquare,
  Share2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  X,
  Sparkles,
  Scissors,
  Car,
  UtensilsCrossed,
  ShoppingBag,
  ExternalLink,
  Copy,
  Check,
  Filter,
  RefreshCw,
} from 'lucide-react';
import {
  generateLifecycleHooks,
  dispatchWhatsAppHook,
  formatWhatsAppPhone,
} from '../../utils/whatsappLifecycle';
import { WhatsAppLifecycleHook, LifecycleHookType } from '../../types';

interface WhatsAppLifecycleCenterProps {
  isOpen: boolean;
  onClose: () => void;
  initialFilter?: LifecycleHookType | 'ALL';
}

export const WhatsAppLifecycleCenter: React.FC<WhatsAppLifecycleCenterProps> = ({
  isOpen,
  onClose,
  initialFilter = 'ALL',
}) => {
  const {
    customers,
    orders,
    bookings,
    carwashQueue,
    settings,
    sentLifecycleHookIds,
    markLifecycleHookSent,
    dismissLifecycleHook,
  } = usePOS();

  const sector = settings.businessSector || 'FNB';

  const [activeFilter, setActiveFilter] = useState<LifecycleHookType | 'ALL'>(initialFilter);
  const [editingHook, setEditingHook] = useState<WhatsAppLifecycleHook | null>(null);
  const [editedMessage, setEditedMessage] = useState<string>('');
  const [copiedHookId, setCopiedHookId] = useState<string | null>(null);

  // Generate real-time lifecycle hooks
  const allHooks = useMemo(() => {
    return generateLifecycleHooks({
      customers,
      orders,
      bookings,
      carwashQueue,
      sector,
      storeName: settings.storeName,
      sentHookIds: sentLifecycleHookIds,
    });
  }, [customers, orders, bookings, carwashQueue, sector, settings.storeName, sentLifecycleHookIds]);

  // Filtered hooks based on active tab
  const filteredHooks = useMemo(() => {
    if (activeFilter === 'ALL') return allHooks;
    return allHooks.filter((h) => h.type === activeFilter);
  }, [allHooks, activeFilter]);

  if (!isOpen) return null;

  const handleCopy = (hook: WhatsAppLifecycleHook) => {
    navigator.clipboard.writeText(hook.message);
    setCopiedHookId(hook.id);
    setTimeout(() => setCopiedHookId(null), 2000);
  };

  const handleDispatch = (hook: WhatsAppLifecycleHook) => {
    dispatchWhatsAppHook(hook, (id) => markLifecycleHookSent(id));
  };

  const handleOpenEdit = (hook: WhatsAppLifecycleHook) => {
    setEditingHook(hook);
    setEditedMessage(hook.message);
  };

  const handleSaveEditAndSend = () => {
    if (!editingHook) return;
    const modifiedHook: WhatsAppLifecycleHook = {
      ...editingHook,
      message: editedMessage,
    };
    handleDispatch(modifiedHook);
    setEditingHook(null);
  };

  const getHookIcon = (type: LifecycleHookType) => {
    switch (type) {
      case 'LAUNDRY_READY':
        return Sparkles;
      case 'BARBERSHOP_RETENTION':
        return Scissors;
      case 'CARWASH_WEATHER':
        return Car;
      case 'FNB_LUNCH_PROMO':
        return UtensilsCrossed;
      case 'RETAIL_VIP':
      default:
        return ShoppingBag;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white shadow-inner">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-black text-lg text-white leading-tight">
                  Automated WhatsApp Lifecycle Center
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-400 text-slate-950 uppercase tracking-wide">
                  Smart Hooks
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-white/20 text-emerald-100 border border-white/25">
                  Sektor: {sector}
                </span>
              </div>
              <p className="text-xs text-emerald-100 font-medium">
                Pemicu proaktif retensi, milestone rak laundry, pasca hujan, dan promo makan siang.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="bg-white/15 backdrop-blur-md px-3 py-1 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 border border-white/20">
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
              <span>{allHooks.length} Hook Siap Kirim</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Navigation Bar */}
        <div className="px-5 pt-3 border-b border-slate-200 bg-slate-50/80 flex items-center gap-2 overflow-x-auto select-none">
          <button
            type="button"
            onClick={() => setActiveFilter('ALL')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
              activeFilter === 'ALL'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>Semua Trigger</span>
            <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px]">
              {allHooks.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('LAUNDRY_READY')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
              activeFilter === 'LAUNDRY_READY'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-600" />
            <span>Laundry (Selesai di Rak)</span>
            {allHooks.filter((h) => h.type === 'LAUNDRY_READY').length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-800 text-[10px] font-bold">
                {allHooks.filter((h) => h.type === 'LAUNDRY_READY').length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('BARBERSHOP_RETENTION')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
              activeFilter === 'BARBERSHOP_RETENTION'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Scissors className="w-3.5 h-3.5 text-indigo-600" />
            <span>Barbershop (Radar 3 Minggu)</span>
            {allHooks.filter((h) => h.type === 'BARBERSHOP_RETENTION').length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                {allHooks.filter((h) => h.type === 'BARBERSHOP_RETENTION').length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('CARWASH_WEATHER')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
              activeFilter === 'CARWASH_WEATHER'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Car className="w-3.5 h-3.5 text-sky-600" />
            <span>Car Wash (Pasca Hujan / Slot Kosong)</span>
            {allHooks.filter((h) => h.type === 'CARWASH_WEATHER').length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[10px] font-bold">
                {allHooks.filter((h) => h.type === 'CARWASH_WEATHER').length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('FNB_LUNCH_PROMO')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
              activeFilter === 'FNB_LUNCH_PROMO'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <UtensilsCrossed className="w-3.5 h-3.5 text-amber-600" />
            <span>F&amp;B (Promo Makan Siang)</span>
            {allHooks.filter((h) => h.type === 'FNB_LUNCH_PROMO').length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                {allHooks.filter((h) => h.type === 'FNB_LUNCH_PROMO').length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('RETAIL_VIP')}
            className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5 shrink-0 ${
              activeFilter === 'RETAIL_VIP'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
            <span>Retail (VIP Loyalty)</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/50">
          {filteredHooks.length === 0 ? (
            <div className="p-12 text-center text-slate-500 space-y-3 bg-white border border-slate-200 rounded-3xl">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
              <div className="font-bold text-slate-800 text-base">
                Tidak Ada WhatsApp Hook yang Pending
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Semua pelanggan terkini sudah mendapatkan notifikasi terbaru atau belum mencapai ambang batas retensi ({activeFilter === 'ALL' ? 'seluruh sektor' : activeFilter}).
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredHooks.map((hook) => {
                const IconComponent = getHookIcon(hook.type);

                return (
                  <div
                    key={hook.id}
                    className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs flex flex-col justify-between space-y-3 hover:border-emerald-300 transition-all group"
                  >
                    {/* Top Row: Customer Info & Urgency */}
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                            <IconComponent className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm leading-tight">
                              {hook.customerName}
                            </h4>
                            <p className="text-[11px] text-slate-400 font-mono">
                              {hook.customerPhone || 'Tanpa No. HP'}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${
                            hook.urgency === 'HIGH'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : hook.urgency === 'MEDIUM'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                        >
                          {hook.urgency} Urgency
                        </span>
                      </div>

                      {/* Trigger Reason Pill */}
                      <div className="text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-100 flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{hook.triggerReason}</span>
                      </div>

                      {/* WhatsApp Chat Bubble Preview */}
                      <div className="relative bg-emerald-50/50 border border-emerald-200/60 rounded-2xl p-3.5 text-xs text-slate-800 font-sans leading-relaxed whitespace-pre-line shadow-2xs">
                        {hook.message}
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        {/* Copy message */}
                        <button
                          type="button"
                          onClick={() => handleCopy(hook)}
                          title="Salin Teks Pesan"
                          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          {copiedHookId === hook.id ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>

                        {/* Edit before sending */}
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(hook)}
                          className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          Edit
                        </button>

                        {/* Dismiss */}
                        <button
                          type="button"
                          onClick={() => dismissLifecycleHook(hook.id)}
                          className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-rose-600 transition-colors"
                        >
                          Abaikan
                        </button>
                      </div>

                      {/* Direct WhatsApp Dispatch */}
                      <button
                        type="button"
                        onClick={() => handleDispatch(hook)}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-95"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Kirim WA</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>
              URL skema universal <code className="font-mono text-[10px] text-slate-700">wa.me</code> otomatis terhubung ke aplikasi WhatsApp Web / Desktop kasir.
            </span>
          </div>

          {filteredHooks.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  filteredHooks.forEach((h, index) => {
                    setTimeout(() => {
                      handleDispatch(h);
                    }, index * 800);
                  });
                }}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Kirim Semua ({filteredHooks.length})</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* EDIT MESSAGE MODAL */}
      {editingHook && (
        <div className="fixed inset-0 z-60 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Sesuaikan Pesan WhatsApp</h4>
                <p className="text-xs text-slate-500">
                  Kirim ke {editingHook.customerName} ({editingHook.customerPhone})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingHook(null)}
                className="text-slate-400 hover:text-slate-700 font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <textarea
                value={editedMessage}
                onChange={(e) => setEditedMessage(e.target.value)}
                rows={7}
                className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-900 font-sans focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 leading-relaxed"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingHook(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveEditAndSend}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Simpan &amp; Buka WhatsApp</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
