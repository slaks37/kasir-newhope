import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { AppointmentBooking, BookingStatus } from '../../types';
import { newId } from '../../lib/ids';
import { formatRupiah } from '../../utils/formatters';
import {
  Calendar,
  Clock,
  Scissors,
  User,
  Phone,
  MessageCircle,
  CheckCircle2,
  Plus,
  Trash2,
  AlertCircle,
  Percent,
  Check,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ShoppingBag,
  Coins,
  MessageSquare,
} from 'lucide-react';
import { StaffCommissionModal } from './StaffCommissionModal';
import { WhatsAppLifecycleCenter } from '../whatsapp/WhatsAppLifecycleCenter';

export const BarbershopBookingView: React.FC = () => {
  const {
    bookings,
    saveBooking,
    deleteBooking,
    updateBookingStatus,
    sendBookingWaReminder,
    staffMembers,
    setSelectedStaff,
    products,
    addToCart,
    setActiveTab,
  } = usePOS();

  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [selectedStylistId, setSelectedStylistId] = useState<string>('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCommissionModal, setShowCommissionModal] = useState(false);
  const [showLifecycleModal, setShowLifecycleModal] = useState(false);

  // Form states
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [serviceName, setServiceName] = useState('Gentleman Haircut + Wash');
  const [staffId, setStaffId] = useState(staffMembers[0]?.id || 'staff-1');
  const [startTime, setStartTime] = useState('10:00');
  const [notes, setNotes] = useState('');

  const TIME_SLOTS = [
    '09:00',
    '10:00',
    '11:00',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
    '17:00',
    '18:00',
    '19:00',
    '20:00',
  ];

  const filteredBookings = bookings.filter((b) => {
    const bDate = b.date || b.bookingDate;
    const bStaff = b.staffId || b.staffMemberId;
    const matchesDate = bDate === selectedDate;
    const matchesStylist = selectedStylistId === 'ALL' || bStaff === selectedStylistId;
    return matchesDate && matchesStylist;
  });

  const handleCreateBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName) return;

    const staff = staffMembers.find((s) => s.id === staffId);
    saveBooking({
      id: newId('book'),
      customerName: custName.trim(),
      customerPhone: custPhone.trim(),
      staffId: staffId,
      staffName: staff?.name || 'Stylist',
      staffMemberId: staffId,
      staffMemberName: staff?.name || 'Stylist',
      serviceName,
      date: selectedDate,
      bookingDate: selectedDate,
      timeSlot: startTime,
      startTime,
      durationMinutes: 45,
      status: 'CONFIRMED',
      notes: notes.trim() || undefined,
    });

    setCustName('');
    setCustPhone('');
    setNotes('');
    setShowAddModal(false);
  };

  const handleCheckInToCart = (booking: AppointmentBooking) => {
    // 1. Select staff
    const staff = staffMembers.find((s) => s.id === (booking.staffId || booking.staffMemberId));
    if (staff) {
      setSelectedStaff(staff);
    }
    // 2. Find product
    const haircutProd =
      products.find((p) => p.name.toLowerCase().includes('haircut')) || products[0];
    if (haircutProd) {
      addToCart(haircutProd, undefined, undefined, 1, `Booking: ${booking.customerName}`);
    }
    // 3. Update booking status to IN_PROGRESS
    updateBookingStatus(booking.id, 'IN_PROGRESS');
    alert(`Pelanggan ${booking.customerName} telah check-in ke kasir dengan Stylist ${booking.staffName || booking.staffMemberName}!`);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 text-white p-5 rounded-3xl shadow-xl flex flex-wrap items-center justify-between gap-4 border border-slate-800">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Scissors className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-black text-white">Kalender Booking &amp; Kapster</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-slate-950 uppercase">
                Time-Slot Engine
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Alokasi jam booking per stylist/kapster, kirim reminder WhatsApp otomatis, dan rekap komisi staf.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setShowLifecycleModal(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-2xl shadow-xs transition-all cursor-pointer flex items-center space-x-1.5"
            title="Follow-up pelanggan yang 3 minggu belum cukur rambut"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Radar 3 Minggu</span>
          </button>
          <button
            onClick={() => setActiveTab('labor')}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-300 font-black text-xs rounded-2xl border border-slate-700 shadow-xs transition-all cursor-pointer flex items-center space-x-1.5"
          >
            <Coins className="w-4 h-4 text-amber-400" />
            <span>Gaji &amp; Komisi Kapster</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-2xl shadow-xs transition-all cursor-pointer flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Buat Janji Temu</span>
          </button>
        </div>
      </div>

      {/* Date & Stylist Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        {/* Date Selector */}
        <div className="flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-300 font-bold text-xs text-slate-900 bg-slate-50 focus:border-amber-500 outline-none cursor-pointer"
          />
        </div>

        {/* Stylist Filter */}
        <div className="flex items-center space-x-1.5 overflow-x-auto">
          <button
            onClick={() => setSelectedStylistId('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              selectedStylistId === 'ALL'
                ? 'bg-slate-950 text-white font-black shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Semua Kapster
          </button>
          {staffMembers.map((staff) => (
            <button
              key={staff.id}
              onClick={() => setSelectedStylistId(staff.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                selectedStylistId === staff.id
                  ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>{staff.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Time-Slot Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {TIME_SLOTS.map((slot) => {
          const slotBookings = filteredBookings.filter((b) => (b.timeSlot || b.startTime) === slot);

          return (
            <div
              key={slot}
              className="bg-white rounded-3xl border border-slate-200 p-4 space-y-3 shadow-xs"
            >
              {/* Slot Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center font-mono font-black text-xs">
                    {slot}
                  </div>
                  <span className="font-bold text-xs text-slate-700">Slot Jam {slot}</span>
                </div>
                <span className="text-[11px] font-bold text-slate-400">
                  {slotBookings.length > 0 ? `${slotBookings.length} Janji` : 'Tersedia'}
                </span>
              </div>

              {/* Slot Content */}
              {slotBookings.length === 0 ? (
                <div className="py-5 text-center text-[11px] text-slate-400 font-medium italic border-2 border-dashed border-slate-100 rounded-2xl">
                  Slot kosong — Belum ada booking
                </div>
              ) : (
                slotBookings.map((b) => (
                  <div
                    key={b.id}
                    className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-black text-sm text-slate-950 block">
                          {b.customerName}
                        </span>
                        <span className="text-xs text-amber-700 font-bold">
                          ✂ Stylist: {b.staffName || b.staffMemberName}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border ${
                          b.status === 'CONFIRMED'
                            ? 'bg-blue-100 text-blue-900 border-blue-200'
                            : b.status === 'IN_PROGRESS'
                            ? 'bg-amber-100 text-amber-950 border-amber-300'
                            : b.status === 'COMPLETED'
                            ? 'bg-emerald-100 text-emerald-950 border-emerald-300'
                            : 'bg-rose-100 text-rose-950 border-rose-300'
                        }`}
                      >
                        {b.status === 'CONFIRMED'
                          ? 'Dikonfirmasi'
                          : b.status === 'IN_PROGRESS'
                          ? 'Sedang Dilayani'
                          : b.status === 'COMPLETED'
                          ? 'Selesai'
                          : 'Batal'}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 font-medium">
                      Layanan: <span className="font-bold">{b.serviceName}</span>
                    </div>

                    {/* Actions */}
                    <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-1">
                      <div className="flex items-center space-x-1">
                        {b.customerPhone && (
                          <button
                            onClick={() => sendBookingWaReminder(b)}
                            className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 cursor-pointer"
                            title="Kirim Reminder Janji Temu via WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm(`Hapus booking untuk ${b.customerName}?`)) {
                              deleteBooking(b.id);
                            }
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                          title="Hapus Booking"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {b.status === 'CONFIRMED' && (
                        <button
                          onClick={() => handleCheckInToCart(b)}
                          className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black text-xs shadow-xs cursor-pointer flex items-center space-x-1"
                        >
                          <ShoppingBag className="w-3.5 h-3.5" />
                          <span>Check-in Kasir</span>
                        </button>
                      )}

                      {b.status === 'IN_PROGRESS' && (
                        <button
                          onClick={() => updateBookingStatus(b.id, 'COMPLETED')}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-xs shadow-xs cursor-pointer flex items-center space-x-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Selesai</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>

      {/* ====================================================================== */}
      {/* MODAL: ADD APPOINTMENT BOOKING                                         */}
      {/* ====================================================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-black text-base text-slate-950 flex items-center space-x-2">
                <Scissors className="w-5 h-5 text-amber-600" />
                <span>Buat Janji Temu Barbershop</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Nama Pelanggan *</label>
                <input
                  type="text"
                  required
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="Contoh: Mas Rizky"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">No. WhatsApp Pelanggan</label>
                <input
                  type="tel"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="0812xxxxxxxx"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-slate-950 focus:border-amber-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Pilih Kapster / Stylist</label>
                  <select
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                  >
                    {staffMembers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Jam Janji Temu</label>
                  <select
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-slate-950 focus:border-amber-500 outline-none"
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Paket Layanan</label>
                <select
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-amber-500 outline-none"
                >
                  <option value="Gentleman Haircut + Wash">Gentleman Haircut + Wash</option>
                  <option value="Premium Shaving & Hot Towel">Premium Shaving &amp; Hot Towel</option>
                  <option value="Kids Haircut">Kids Haircut</option>
                  <option value="Hair Coloring & Bleaching">Hair Coloring &amp; Bleaching</option>
                  <option value="Creambath & Head Massage">Creambath &amp; Head Massage</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Catatan Khusus</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Fade tipis, langganan..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium text-slate-950 focus:border-amber-500 outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-xs cursor-pointer"
                >
                  Simpan Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Staff Commission Modal */}
      <StaffCommissionModal
        isOpen={showCommissionModal}
        onClose={() => setShowCommissionModal(false)}
      />

      {/* WhatsApp Lifecycle Center Modal */}
      <WhatsAppLifecycleCenter
        isOpen={showLifecycleModal}
        onClose={() => setShowLifecycleModal(false)}
        initialFilter="BARBERSHOP_RETENTION"
      />
    </div>
  );
};
