import React, { useState, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { KDSTicket, KDSStatus } from '../../types';
import {
  ChefHat,
  Clock,
  CheckCircle2,
  AlertCircle,
  Volume2,
  VolumeX,
  Trash2,
  Sparkles,
  Flame,
  Utensils,
  ArrowRight,
  Filter,
} from 'lucide-react';

export const KitchenDisplaySystem: React.FC = () => {
  const { kdsTickets, updateKDSTicketStatus, clearCompletedKDSTickets } = usePOS();
  const [filterStatus, setFilterStatus] = useState<KDSStatus | 'ALL'>('ALL');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update timer every 15 seconds to update elapsed time badges
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const playBeep = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(650, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch {
      // AudioContext might be blocked until user gesture
    }
  };

  const filteredTickets = kdsTickets.filter((t) => {
    if (filterStatus === 'ALL') return true;
    return t.status === filterStatus;
  });

  const pendingCount = kdsTickets.filter((t) => t.status === 'PENDING').length;
  const preparingCount = kdsTickets.filter((t) => t.status === 'PREPARING').length;
  const readyCount = kdsTickets.filter((t) => t.status === 'READY').length;
  const servedCount = kdsTickets.filter((t) => t.status === 'SERVED').length;

  const getElapsedTimeText = (createdAt: string) => {
    const elapsedMinutes = Math.floor((currentTime - new Date(createdAt).getTime()) / 60000);
    if (elapsedMinutes < 1) return 'Baru saja';
    if (elapsedMinutes < 60) return `${elapsedMinutes}m lalu`;
    const hours = Math.floor(elapsedMinutes / 60);
    return `${hours}j ${elapsedMinutes % 60}m lalu`;
  };

  const getElapsedTimeColor = (createdAt: string, status: KDSStatus) => {
    if (status === 'SERVED') return 'text-slate-400 bg-slate-100 border-slate-200';
    const elapsedMinutes = Math.floor((currentTime - new Date(createdAt).getTime()) / 60000);
    if (elapsedMinutes >= 20) return 'text-rose-700 bg-rose-50 border-rose-200 animate-pulse';
    if (elapsedMinutes >= 10) return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Metric Badges */}
      <div className="bg-slate-900 text-white p-5 rounded-3xl shadow-xl flex flex-wrap items-center justify-between gap-4 border border-slate-800">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <ChefHat className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-black text-white">Kitchen Display System (KDS)</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-slate-950 uppercase">
                Real-Time Kitchen
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Monitor pesanan dapur, tiket varian/add-on, timer pengerjaan, dan status hidangan meja.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              if (!soundEnabled) playBeep();
            }}
            className={`p-2.5 rounded-2xl border transition-colors cursor-pointer flex items-center space-x-1.5 text-xs font-bold ${
              soundEnabled
                ? 'bg-slate-800 border-slate-700 text-amber-400 hover:bg-slate-700'
                : 'bg-slate-800/50 border-slate-800 text-slate-500 hover:bg-slate-800'
            }`}
            title="Toggle Audio Notifikasi Pesanan Baru"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Audio Aktif' : 'Mute'}</span>
          </button>

          {servedCount > 0 && (
            <button
              onClick={() => {
                if (confirm('Bersihkan semua tiket dapur yang sudah selesai disajikan?')) {
                  clearCompletedKDSTickets();
                }
              }}
              className="p-2.5 rounded-2xl bg-slate-800 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-800 text-slate-300 hover:text-rose-300 text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5"
            >
              <Trash2 className="w-4 h-4" />
              <span>Arsip Selesai ({servedCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-1.5 overflow-x-auto">
          <button
            onClick={() => setFilterStatus('ALL')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
              filterStatus === 'ALL'
                ? 'bg-slate-950 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Semua ({kdsTickets.length})
          </button>
          <button
            onClick={() => setFilterStatus('PENDING')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center space-x-1.5 ${
              filterStatus === 'PENDING'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Antrean Baru ({pendingCount})</span>
          </button>
          <button
            onClick={() => setFilterStatus('PREPARING')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center space-x-1.5 ${
              filterStatus === 'PREPARING'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Dimasak ({preparingCount})</span>
          </button>
          <button
            onClick={() => setFilterStatus('READY')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center space-x-1.5 ${
              filterStatus === 'READY'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Siap Saji ({readyCount})</span>
          </button>
          <button
            onClick={() => setFilterStatus('SERVED')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center space-x-1.5 ${
              filterStatus === 'SERVED'
                ? 'bg-slate-700 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Tersaji ({servedCount})</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 font-bold px-3 py-1 bg-slate-50 rounded-xl border border-slate-200">
          Total Tiket Aktif:{' '}
          <span className="text-slate-900 font-black">{pendingCount + preparingCount + readyCount}</span>
        </div>
      </div>

      {/* Ticket Grid */}
      {filteredTickets.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-12 text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
            <Utensils className="w-8 h-8" />
          </div>
          <h3 className="font-black text-base text-slate-800">Tidak ada tiket pesanan di dapur</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Setiap pesanan kasir F&amp;B dengan opsi &apos;Kirim ke Dapur&apos; akan muncul otomatis di layar ini secara real-time.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredTickets.map((ticket) => {
            const elapsedText = getElapsedTimeText(ticket.createdAt);
            const timeBadgeColor = getElapsedTimeColor(ticket.createdAt, ticket.status);

            return (
              <div
                key={ticket.id}
                className={`bg-white rounded-3xl border-2 transition-all shadow-sm flex flex-col justify-between overflow-hidden ${
                  ticket.status === 'PENDING'
                    ? 'border-rose-400 ring-2 ring-rose-100'
                    : ticket.status === 'PREPARING'
                    ? 'border-amber-400'
                    : ticket.status === 'READY'
                    ? 'border-emerald-500 bg-emerald-50/10'
                    : 'border-slate-200 opacity-70'
                }`}
              >
                {/* Ticket Top Header */}
                <div
                  className={`p-4 border-b flex items-center justify-between ${
                    ticket.status === 'PENDING'
                      ? 'bg-rose-50 border-rose-100'
                      : ticket.status === 'PREPARING'
                      ? 'bg-amber-50/80 border-amber-100'
                      : ticket.status === 'READY'
                      ? 'bg-emerald-50 border-emerald-100'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-black text-sm text-slate-900">
                        #{ticket.orderNumber}
                      </span>
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                          ticket.orderType === 'DINE_IN'
                            ? 'bg-blue-100 text-blue-900 border-blue-200'
                            : 'bg-purple-100 text-purple-900 border-purple-200'
                        }`}
                      >
                        {ticket.orderType === 'DINE_IN' ? 'Dine In' : 'Takeaway'}
                      </span>
                    </div>
                    <div className="font-black text-base text-slate-950">
                      {ticket.tableName || 'Meja Umum'}
                    </div>
                  </div>

                  <div className="text-right space-y-1">
                    <div
                      className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl text-xs font-black border ${timeBadgeColor}`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>{elapsedText}</span>
                    </div>
                    {ticket.customerName && (
                      <div className="text-[11px] font-bold text-slate-600 truncate max-w-[120px]">
                        {ticket.customerName}
                      </div>
                    )}
                  </div>
                </div>

                {/* Ticket Items List */}
                <div className="p-4 space-y-3 flex-1">
                  {ticket.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1"
                    >
                      <div className="flex items-start justify-between">
                        <span className="font-black text-xs text-slate-950 leading-tight">
                          {item.name || item.productName}
                        </span>
                        <span className="ml-2 font-mono font-black text-xs bg-slate-900 text-white px-2 py-0.5 rounded-lg shrink-0">
                          x{item.quantity}
                        </span>
                      </div>

                      {/* Variant badge */}
                      {item.variantName && (
                        <div className="text-[11px] font-bold text-amber-700">
                          Varian: <span className="font-black">{item.variantName}</span>
                        </div>
                      )}

                      {/* Modifiers / Add-ons */}
                      {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.selectedModifiers.map((mod, mIdx) => (
                            <span
                              key={mIdx}
                              className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-[10px] font-bold text-slate-700"
                            >
                              + {mod.optionName}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Notes / Special Instructions */}
                      {item.notes && (
                        <div className="mt-1 text-[11px] bg-rose-50 text-rose-800 p-1.5 rounded-lg font-bold border border-rose-200 flex items-center space-x-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                          <span>Catatan: {item.notes}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Ticket Action Footers */}
                <div className="p-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold text-slate-500">
                    Status:{' '}
                    <span
                      className={`font-black ${
                        ticket.status === 'PENDING'
                          ? 'text-rose-600'
                          : ticket.status === 'PREPARING'
                          ? 'text-amber-600'
                          : ticket.status === 'READY'
                          ? 'text-emerald-600'
                          : 'text-slate-500'
                      }`}
                    >
                      {ticket.status === 'PENDING'
                        ? 'Menunggu'
                        : ticket.status === 'PREPARING'
                        ? 'Sedang Dimasak'
                        : ticket.status === 'READY'
                        ? 'Siap Saji'
                        : 'Selesai'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    {ticket.status === 'PENDING' && (
                      <button
                        onClick={() => {
                          playBeep();
                          updateKDSTicketStatus(ticket.id, 'PREPARING');
                        }}
                        className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-xs transition-all cursor-pointer flex items-center space-x-1"
                      >
                        <Flame className="w-3.5 h-3.5" />
                        <span>Mulai Masak</span>
                      </button>
                    )}

                    {ticket.status === 'PREPARING' && (
                      <button
                        onClick={() => {
                          playBeep();
                          updateKDSTicketStatus(ticket.id, 'READY');
                        }}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-xs transition-all cursor-pointer flex items-center space-x-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Makanan Siap!</span>
                      </button>
                    )}

                    {ticket.status === 'READY' && (
                      <button
                        onClick={() => {
                          playBeep();
                          updateKDSTicketStatus(ticket.id, 'SERVED');
                        }}
                        className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs shadow-xs transition-all cursor-pointer flex items-center space-x-1"
                      >
                        <Utensils className="w-3.5 h-3.5" />
                        <span>Sajikan ke Meja</span>
                      </button>
                    )}

                    {ticket.status === 'SERVED' && (
                      <button
                        onClick={() => updateKDSTicketStatus(ticket.id, 'PREPARING')}
                        className="px-2.5 py-1.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-200 text-[11px] font-bold cursor-pointer"
                        title="Buka Kembali Tiket"
                      >
                        Kembalikan
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
