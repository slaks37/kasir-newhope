import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { Table } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { BUSINESS_PRESETS, BusinessSector } from '../../data/businessPresets';
import { newId } from '../../lib/ids';
import {
  LayoutGrid,
  Users,
  Clock,
  Plus,
  Trash2,
  Coffee,
  Shirt,
  ShoppingBag,
  Car,
  Scissors,
  Building2,
  Check,
  X,
  Sparkles,
  Info,
  Layers,
  Scale,
  Store,
} from 'lucide-react';

export const TableManager: React.FC = () => {
  const { tables, saveTable, deleteTable, settings, activateBusinessSector } = usePOS();

  const activeSectorKey: BusinessSector = settings.businessSector || 'FNB';
  const activePreset = BUSINESS_PRESETS[activeSectorKey] || BUSINESS_PRESETS.FNB;
  const layoutTerm = activePreset.layoutTerm;

  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('ALL');

  // Add Item Modal Form State
  const [itemName, setItemName] = useState('');
  const [itemCapacity, setItemCapacity] = useState(4);
  const [itemZone, setItemZone] = useState(layoutTerm.zones[0] || 'Main Zone');

  const sectorIcons: Record<BusinessSector, any> = {
    FNB: Coffee,
    LAUNDRY: Shirt,
    RETAIL: ShoppingBag,
    CARWASH: Car,
    BARBERSHOP: Scissors,
  };

  const HeaderIcon = sectorIcons[activeSectorKey] || LayoutGrid;

  // Filtered Tables
  const filteredTables = selectedZoneFilter === 'ALL'
    ? tables
    : tables.filter((t) => t.zone === selectedZoneFilter);

  const getStatusBadge = (status: Table['status']) => {
    switch (status) {
      case 'AVAILABLE':
        return (
          <span className="px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold">
            {layoutTerm.statusBadges.available}
          </span>
        );
      case 'OCCUPIED':
        return (
          <span className="px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold">
            {layoutTerm.statusBadges.occupied}
          </span>
        );
      case 'RESERVED':
        return (
          <span className="px-2.5 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-bold">
            {layoutTerm.statusBadges.reserved}
          </span>
        );
      case 'BILLING':
        return (
          <span className="px-2.5 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200 text-xs font-bold">
            {layoutTerm.statusBadges.billing}
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold">
            Standby
          </span>
        );
    }
  };

  const handleCreateTable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) return;

    const newTable: Table = {
      id: newId('slot'),
      name: itemName.trim(),
      capacity: itemCapacity,
      status: 'AVAILABLE',
      zone: itemZone,
      businessSector: activeSectorKey,
    };

    saveTable(newTable);
    setShowAddModal(false);
    setItemName('');
  };

  return (
    <div className="flex-1 bg-slate-50/70 p-4 lg:p-8 overflow-y-auto space-y-6 animate-fade-in">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
        <div className="flex items-start space-x-4">
          <div className={`p-3.5 rounded-2xl bg-gradient-to-br ${activePreset.bgGradient} text-white shadow-md shrink-0`}>
            <HeaderIcon className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider">
                Mode {activePreset.name}
              </span>
              <span className="text-xs text-slate-400 font-bold">• {tables.length} Total Slot</span>
            </div>
            <h2 className="font-extrabold text-2xl text-slate-900 mt-1">
              {layoutTerm.title}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl font-medium">
              {layoutTerm.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 shrink-0">
          <button
            onClick={() => {
              setItemZone(layoutTerm.zones[0] || 'Main Zone');
              setShowAddModal(true);
            }}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold px-5 py-3 rounded-2xl flex items-center space-x-2 shadow-sm text-xs transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{layoutTerm.addBtnText}</span>
          </button>
        </div>
      </div>

      {/* Sector Switcher Quick Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 flex items-center justify-between flex-wrap gap-2 text-xs">
        <span className="font-bold text-slate-600 flex items-center space-x-1.5 px-2">
          <Building2 className="w-4 h-4 text-amber-600" />
          <span>Sektor Terdeteksi:</span>
          <span className="text-amber-700 font-extrabold">{activePreset.name}</span>
        </span>

        <div className="flex items-center space-x-1.5 overflow-x-auto py-1">
          {(Object.keys(BUSINESS_PRESETS) as BusinessSector[]).map((secKey) => {
            const preset = BUSINESS_PRESETS[secKey];
            const isCurrent = activeSectorKey === secKey;
            return (
              <button
                key={secKey}
                onClick={() => activateBusinessSector(secKey)}
                className={`px-3 py-1.5 rounded-xl font-extrabold text-[11px] transition-all cursor-pointer whitespace-nowrap ${
                  isCurrent
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Zone Filter Tabs */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1">
        <button
          onClick={() => setSelectedZoneFilter('ALL')}
          className={`px-4 py-2 rounded-2xl font-extrabold text-xs transition-all cursor-pointer whitespace-nowrap ${
            selectedZoneFilter === 'ALL'
              ? 'bg-amber-500 text-slate-950 shadow-xs'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          Semua Area ({tables.length})
        </button>

        {layoutTerm.zones.map((zone) => {
          const count = tables.filter((t) => t.zone === zone).length;
          const isSelected = selectedZoneFilter === zone;

          return (
            <button
              key={zone}
              onClick={() => setSelectedZoneFilter(zone)}
              className={`px-4 py-2 rounded-2xl font-extrabold text-xs transition-all cursor-pointer whitespace-nowrap ${
                isSelected
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {zone} ({count})
            </button>
          );
        })}
      </div>

      {/* Tables / Slots Grid Layout */}
      {filteredTables.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 space-y-3">
          <Layers className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">Belum Ada Slot di Area Ini</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto font-medium">
            Silakan klik tombol "{layoutTerm.addBtnText}" di atas untuk menambahkan lokasi {layoutTerm.itemNoun} baru.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTables.map((tbl) => {
            const isOccupied = tbl.status === 'OCCUPIED';
            const isBilling = tbl.status === 'BILLING';

            return (
              <div
                key={tbl.id}
                onClick={() => setSelectedTable(tbl)}
                className={`p-5 rounded-3xl border transition-all cursor-pointer space-y-3 shadow-xs relative ${
                  isOccupied
                    ? 'bg-amber-50/80 border-amber-300 hover:border-amber-400'
                    : isBilling
                    ? 'bg-purple-50/80 border-purple-300 hover:border-purple-400'
                    : 'bg-white border-slate-200/90 hover:border-amber-400'
                }`}
              >
                <div className="flex items-start justify-between border-b border-slate-100 pb-2.5">
                  <div className="min-w-0 pr-2">
                    <h3 className="font-black text-base text-slate-900 truncate">{tbl.name}</h3>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mt-0.5">
                      {tbl.zone}
                    </span>
                  </div>
                  {getStatusBadge(tbl.status)}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-600 pt-0.5">
                  <span className="flex items-center space-x-1.5 font-bold text-slate-700">
                    <Users className="w-4 h-4 text-slate-400" />
                    <span>
                      {layoutTerm.capacityLabel}: {tbl.capacity} {layoutTerm.capacityUnit}
                    </span>
                  </span>

                  {tbl.activeOrder && (
                    <span className="font-extrabold text-amber-700 font-mono">
                      {formatRupiah(tbl.activeOrder.totalAmount)}
                    </span>
                  )}
                </div>

                {tbl.customerName && (
                  <p className="text-xs font-semibold text-slate-700 truncate bg-slate-100/80 px-2.5 py-1 rounded-xl">
                    Pelanggan: <span className="font-extrabold text-slate-900">{tbl.customerName}</span>
                  </p>
                )}

                {tbl.activeOrder ? (
                  <div className="p-3 bg-amber-100/70 rounded-2xl border border-amber-200/90 text-[11px] space-y-1">
                    <div className="font-bold text-slate-900 flex justify-between">
                      <span>Order #{tbl.activeOrder.id}</span>
                      <span className="text-amber-900 font-extrabold">{tbl.activeOrder.itemsCount} Item</span>
                    </div>
                    <div className="text-[10px] text-slate-600 flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>Aktif Sejak {tbl.activeOrder.startTime || '13:00'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="py-2.5 text-center text-[11px] text-slate-400 font-medium italic">
                    {layoutTerm.emptyText}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Table Detail Modal */}
      {selectedTable && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-sm w-full text-slate-900 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">{selectedTable.name}</h3>
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                  {selectedTable.zone} • {layoutTerm.capacityLabel}: {selectedTable.capacity} {layoutTerm.capacityUnit}
                </span>
              </div>
              {getStatusBadge(selectedTable.status)}
            </div>

            {selectedTable.activeOrder ? (
              <div className="space-y-3">
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-1.5">
                  <span className="text-slate-500 font-semibold block">ID Transaksi Tagihan Aktif:</span>
                  <span className="font-mono font-extrabold text-slate-900 text-sm block">
                    #{selectedTable.activeOrder.id}
                  </span>
                  {selectedTable.customerName && (
                    <span className="text-slate-600 font-bold block">
                      Nama: {selectedTable.customerName}
                    </span>
                  )}
                  <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-black text-amber-700">
                    <span>Total Tagihan:</span>
                    <span className="font-mono">
                      {formatRupiah(selectedTable.activeOrder.totalAmount)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    saveTable({ ...selectedTable, status: 'AVAILABLE', activeOrder: undefined, customerName: undefined });
                    setSelectedTable(null);
                  }}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-2xl shadow-sm transition-all active:scale-95 cursor-pointer"
                >
                  Kosongkan {layoutTerm.itemNoun} (Selesai Transaksi)
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                  {layoutTerm.itemNoun} ini sedang tidak memiliki transaksi tagihan aktif. Anda dapat mengaitkan transaksi kasir baru ke slot ini.
                </p>

                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      deleteTable(selectedTable.id);
                      setSelectedTable(null);
                    }}
                    className="flex-1 py-2.5 bg-rose-50 text-rose-700 border border-rose-200 font-bold text-xs rounded-2xl hover:bg-rose-100 flex items-center justify-center space-x-1 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Hapus</span>
                  </button>

                  <button
                    onClick={() => setSelectedTable(null)}
                    className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-bold text-xs rounded-2xl hover:bg-slate-200 cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Table / Slot Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-sm w-full text-slate-900 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-extrabold text-base text-slate-900">{layoutTerm.addBtnText}</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTable} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-700 font-bold">
                  Nama / Kode {layoutTerm.itemNoun} *
                </label>
                <input
                  type="text"
                  required
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder={`Contoh: ${activeSectorKey === 'FNB' ? 'Meja 12' : activeSectorKey === 'LAUNDRY' ? 'Rak A-05' : activeSectorKey === 'CARWASH' ? 'Bay 06' : activeSectorKey === 'BARBERSHOP' ? 'Kursi Barber 05' : 'Lorong 05'}`}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500 font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-700 font-bold">
                  {layoutTerm.capacityLabel} ({layoutTerm.capacityUnit})
                </label>
                <input
                  type="number"
                  min="1"
                  value={itemCapacity}
                  onChange={(e) => setItemCapacity(Number(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-700 font-bold">Pilih Area / Zonasi</label>
                <select
                  value={itemZone}
                  onChange={(e) => setItemZone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium"
                >
                  {layoutTerm.zones.map((zn) => (
                    <option key={zn} value={zn}>
                      {zn}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-xs cursor-pointer"
                >
                  Simpan Slot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
