import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { CarwashQueueItem, CarwashStage } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import {
  Car,
  Users,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  MessageCircle,
  ArrowRight,
  ShieldCheck,
  Search,
  Filter,
  MessageSquare,
} from 'lucide-react';
import { WhatsAppLifecycleCenter } from '../whatsapp/WhatsAppLifecycleCenter';

const CARWASH_STAGES: { key: CarwashStage; label: string; color: string }[] = [
  { key: 'ANTRIAN_BAY', label: 'Antrean Bay', color: 'border-slate-300 bg-slate-50' },
  { key: 'CUCI_BUSA', label: 'Bay Cuci (Shampoo/Salju)', color: 'border-blue-400 bg-blue-50/60' },
  { key: 'PENGERINGAN_VAKUM', label: 'Bay Kering & Vacuum', color: 'border-amber-400 bg-amber-50/60' },
  { key: 'INSPEKSI_SELESAI', label: 'Finishing & Semir Ban', color: 'border-purple-400 bg-purple-50/60' },
  { key: 'SIAP_KELUAR', label: 'Selesai / Siap Keluar', color: 'border-emerald-400 bg-emerald-50/70' },
];

export const CarwashPipelineView: React.FC = () => {
  const {
    carwashQueue,
    addCarwashQueue,
    updateCarwashStage,
    removeCarwashQueue,
    staffMembers,
  } = usePOS();

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showLifecycleModal, setShowLifecycleModal] = useState(false);

  // Form states for new Carwash entry
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [serviceName, setServiceName] = useState('Cuci Mobil Reguler + Vacuum');
  const [bayName, setBayName] = useState('Bay 1');
  const [assignedCrew, setAssignedCrew] = useState<string[]>([]);
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);

  const filteredQueue = carwashQueue.filter((item) => {
    const q = searchQuery.toLowerCase();
    const plate = (item.vehiclePlate || '').toLowerCase();
    const model = (item.vehicleModel || '').toLowerCase();
    const cust = (item.customerName || '').toLowerCase();
    const bay = (item.bayName || item.assignedBayName || '').toLowerCase();
    return plate.includes(q) || model.includes(q) || cust.includes(q) || bay.includes(q);
  });

  const handleToggleCrew = (name: string) => {
    if (assignedCrew.includes(name)) {
      setAssignedCrew(assignedCrew.filter((c) => c !== name));
    } else {
      setAssignedCrew([...assignedCrew, name]);
    }
  };

  const handleCreateQueueItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehiclePlate) return;

    addCarwashQueue({
      vehiclePlate: vehiclePlate.toUpperCase().trim(),
      vehicleModel: vehicleModel.trim() || 'Mobil',
      customerName: customerName.trim() || 'Pelanggan',
      customerPhone: customerPhone.trim(),
      serviceName,
      bayName,
      assignedBayName: bayName,
      assignedCrew: assignedCrew.length > 0 ? assignedCrew : ['Kru Reguler'],
      stage: 'ANTRIAN_BAY',
      estimatedMinutes,
    });

    // Reset
    setVehiclePlate('');
    setVehicleModel('');
    setCustomerName('');
    setCustomerPhone('');
    setAssignedCrew([]);
    setShowAddModal(false);
  };

  const handleSendWaAlert = (item: CarwashQueueItem) => {
    if (!item.customerPhone) {
      alert('Nomor HP pelanggan belum tercatat.');
      return;
    }
    const cleanPhone = item.customerPhone.replace(/\D/g, '').replace(/^0/, '62');
    const msg = encodeURIComponent(
      `Halo Kak ${item.customerName}, kendaraan Anda [${item.vehiclePlate} - ${item.vehicleModel}] sudah SELESAI dikerjakan di ${item.bayName} dan bersih mengkilap. Silakan melakukan pengambilan kendaraan di kasir car wash kami. Terima kasih!`
    );
    window.open(`https://wa.me/${cleanPhone}?text=${msg}`, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 text-white p-5 rounded-3xl shadow-xl flex flex-wrap items-center justify-between gap-4 border border-slate-800">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <Car className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-black text-white">Manajemen Bay &amp; Antrean Car Wash</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-500 text-slate-950 uppercase">
                Bay Capacity Pipeline
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Pelacakan nomor plat kendaraan, alokasi bay cuci, penugasan kru cuci, dan progres pengerjaan.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setShowLifecycleModal(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-2xl shadow-xs transition-all cursor-pointer flex items-center space-x-1.5"
            title="Kirim broadcast slot cuci kosong pasca hujan"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Broadcast Pasca Hujan</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-2xl shadow-xs transition-all cursor-pointer flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Antrean Kendaraan</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nomor plat (Cth: B 1234 XYZ), model mobil, nama kru..."
            className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 font-medium"
          />
        </div>
        <div className="text-xs font-bold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
          Total Unit: <span className="text-slate-950 font-black">{carwashQueue.length} Kendaraan</span>
        </div>
      </div>

      {/* Kanban Pipeline Columns */}
      <div className="flex gap-4 overflow-x-auto pb-4 pt-1">
        {CARWASH_STAGES.map((col) => {
          const stageItems = filteredQueue.filter((item) => item.stage === col.key);

          return (
            <div
              key={col.key}
              className="min-w-[280px] max-w-[280px] flex flex-col rounded-3xl bg-slate-100/90 border border-slate-200 p-3 space-y-3"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between px-2 pt-1">
                <span className="font-black text-xs text-slate-900">{col.label}</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-black bg-white text-slate-700 border border-slate-200">
                  {stageItems.length}
                </span>
              </div>

              {/* Vehicle Cards List */}
              <div className="flex-1 space-y-3 overflow-y-auto max-h-[650px] pr-0.5">
                {stageItems.length === 0 ? (
                  <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-2xl text-[11px] text-slate-400 font-bold">
                    Bay Kosong
                  </div>
                ) : (
                  stageItems.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs hover:shadow-md transition-all space-y-2.5"
                    >
                      {/* Vehicle Plate Card Header */}
                      <div className="flex items-start justify-between">
                        <div>
                          {/* Plate Badge */}
                          <div className="inline-block px-2.5 py-1 bg-slate-950 text-white rounded-lg font-mono font-black text-sm tracking-wider shadow-xs border border-slate-800">
                            {item.vehiclePlate}
                          </div>
                          <div className="font-bold text-xs text-slate-800 mt-1">
                            {item.vehicleModel}
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-900 border border-blue-200 rounded-md text-[10px] font-black">
                            {item.bayName}
                          </span>
                          <div className="text-[10px] text-slate-400 font-medium mt-1">
                            Est. {item.estimatedMinutes}m
                          </div>
                        </div>
                      </div>

                      {/* Service & Customer */}
                      <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-xl border border-slate-100 space-y-0.5">
                        <div className="font-bold text-slate-900">{item.serviceName}</div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>Cust: {item.customerName}</span>
                          {item.customerPhone && (
                            <span className="font-mono">{item.customerPhone}</span>
                          )}
                        </div>
                      </div>

                      {/* Assigned Wash Crew */}
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 flex items-center space-x-1">
                          <Users className="w-3 h-3 text-slate-500" />
                          <span>Kru Cuci Bertugas:</span>
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {item.assignedCrew.map((crew, cIdx) => (
                            <span
                              key={cIdx}
                              className="px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-200 rounded-md text-[10px] font-bold"
                            >
                              {crew}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
                        <div className="flex items-center space-x-1">
                          {item.customerPhone && (
                            <button
                              onClick={() => handleSendWaAlert(item)}
                              className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 cursor-pointer"
                              title="Kirim Notifikasi WhatsApp"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (confirm(`Hapus antrean untuk plat ${item.vehiclePlate}?`)) {
                                removeCarwashQueue(item.id);
                              }
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                            title="Hapus Antrean"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Shift Stage Buttons */}
                        {col.key === 'ANTRIAN_BAY' && (
                          <button
                            onClick={() => updateCarwashStage(item.id, 'CUCI_BUSA')}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Mulai Cuci</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {col.key === 'CUCI_BUSA' && (
                          <button
                            onClick={() => updateCarwashStage(item.id, 'PENGERINGAN_VAKUM')}
                            className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Keringkan</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {col.key === 'PENGERINGAN_VAKUM' && (
                          <button
                            onClick={() => updateCarwashStage(item.id, 'INSPEKSI_SELESAI')}
                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Detailing</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                        {col.key === 'INSPEKSI_SELESAI' && (
                          <button
                            onClick={() => updateCarwashStage(item.id, 'SIAP_KELUAR')}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Siap Keluar</span>
                            <Sparkles className="w-3 h-3" />
                          </button>
                        )}
                        {col.key === 'SIAP_KELUAR' && (
                          <button
                            onClick={() => removeCarwashQueue(item.id)}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-black text-[10px] flex items-center space-x-1 cursor-pointer"
                          >
                            <span>Selesai &amp; Keluar</span>
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
      {/* MODAL: ADD VEHICLE QUEUE ENTRY                                         */}
      {/* ====================================================================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-black text-base text-slate-950 flex items-center space-x-2">
                <Car className="w-5 h-5 text-blue-600" />
                <span>Tambah Antrean Kendaraan Baru</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateQueueItem} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Nomor Plat Kendaraan *
                  </label>
                  <input
                    type="text"
                    required
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                    placeholder="Contoh: B 1234 ABC"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-black text-slate-950 focus:border-blue-500 outline-none uppercase text-sm"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Tipe / Model Mobil</label>
                  <input
                    type="text"
                    value={vehicleModel}
                    onChange={(e) => setVehicleModel(e.target.value)}
                    placeholder="Contoh: Avanza Hitam / Honda HR-V"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Nama Pemilik / Supir</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Contoh: Pak Hendra"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">No. WhatsApp Pelanggan</label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="0812xxxxxxxx"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-slate-950 focus:border-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Paket Layanan</label>
                  <select
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-blue-500 outline-none"
                  >
                    <option value="Cuci Mobil Reguler + Vacuum">Cuci Mobil Reguler + Vacuum</option>
                    <option value="Cuci Hidrolik Salju + Kolong">Cuci Hidrolik Salju + Kolong</option>
                    <option value="Paket Wax & Poles Bodi Mobil">Paket Wax &amp; Poles Bodi Mobil</option>
                    <option value="Cuci Motor Reguler">Cuci Motor Reguler</option>
                    <option value="Full Detailing & Interior Cleaning">Full Detailing &amp; Interior</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Alokasi Bay / Pit</label>
                  <select
                    value={bayName}
                    onChange={(e) => setBayName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-950 focus:border-blue-500 outline-none"
                  >
                    <option value="Bay 1">Bay 1 (Utama)</option>
                    <option value="Bay 2">Bay 2 (Hidrolik)</option>
                    <option value="Bay 3">Bay 3 (Express)</option>
                    <option value="Bay 4">Bay 4 (Detailing)</option>
                  </select>
                </div>
              </div>

              {/* Assign Wash Crew */}
              <div className="space-y-1.5 pt-1">
                <label className="font-bold text-slate-700 block">
                  Pilih Kru Cuci Yang Ditugaskan:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(staffMembers.length > 0
                    ? staffMembers.map((s) => s.name)
                    : ['Kru A (Budi)', 'Kru B (Agus)', 'Kru C (Joko)', 'Kru D (Rian)']
                  ).map((crewName) => {
                    const isSelected = assignedCrew.includes(crewName);
                    return (
                      <button
                        key={crewName}
                        type="button"
                        onClick={() => handleToggleCrew(crewName)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-blue-600 text-white font-black shadow-xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {isSelected ? `✓ ${crewName}` : `+ ${crewName}`}
                      </button>
                    );
                  })}
                </div>
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
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black shadow-xs cursor-pointer"
                >
                  Masukkan ke Antrean Bay
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Automated WhatsApp Lifecycle Center Modal */}
      <WhatsAppLifecycleCenter
        isOpen={showLifecycleModal}
        onClose={() => setShowLifecycleModal(false)}
        initialFilter="CARWASH_WEATHER"
      />
    </div>
  );
};
