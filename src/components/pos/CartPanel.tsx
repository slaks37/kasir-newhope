import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah } from '../../utils/formatters';
import { BUSINESS_PRESETS } from '../../data/businessPresets';
import { newId } from '../../lib/ids';
import {
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  UserPlus,
  Grid2X2,
  Tag,
  CreditCard,
  PauseCircle,
  FileText,
  Percent,
  X,
  Check,
  History,
  UserCheck,
  Users,
  Scissors,
  Wrench,
} from 'lucide-react';

interface CartPanelProps {
  onOpenCustomerSelect: () => void;
  onOpenCheckout: () => void;
  onOpenHoldOrders: () => void;
  onOpenRecentTransactions?: () => void;
  isMobileModal?: boolean;
  onCloseMobile?: () => void;
}

export const CartPanel: React.FC<CartPanelProps> = ({
  onOpenCustomerSelect,
  onOpenCheckout,
  onOpenHoldOrders,
  onOpenRecentTransactions,
  isMobileModal = false,
  onCloseMobile,
}) => {
  const {
    cart,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    applyCartItemDiscount,
    updateCartItemNotes,
    orderType,
    setOrderType,
    selectedCustomer,
    setSelectedCustomer,
    selectedTable,
    setSelectedTable,
    guestCount,
    setGuestCount,
    settings,
    shift,
    holdOrder,
    staffMembers,
    selectedStaff,
    setSelectedStaff,
  } = usePOS();

  const [editingItemNotes, setEditingItemNotes] = useState<{ id: string; notes: string } | null>(null);
  const [editingItemDiscount, setEditingItemDiscount] = useState<{ id: string; percent: number; amount: number } | null>(null);
  const [showStaffModal, setShowStaffModal] = useState(false);

  // Dine In dan Event sama-sama duduk di tempat: keduanya punya meja dan
  // jumlah tamu. Takeaway/Delivery/Online tidak punya keduanya.
  const isSeatedSegment = orderType === 'DINE_IN' || orderType === 'EVENT';

  const activePreset = BUSINESS_PRESETS[settings.businessSector || 'FNB'] || BUSINESS_PRESETS.FNB;
  const slotNoun = activePreset.layoutTerm?.itemNoun || 'Meja';
  const sector = settings.businessSector || 'FNB';
  
  const staffRoleNoun = sector === 'BARBERSHOP' 
    ? 'Stylist / Kapster' 
    : sector === 'CARWASH' 
    ? 'Tim Pencuci / Operator' 
    : sector === 'LAUNDRY' 
    ? 'Operator Laundry' 
    : 'Petugas / Staf';

  // Totals Calculation
  const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const totalDiscount = cart.reduce((sum, item) => sum + item.discountAmount, 0);
  const taxTotal = settings.enableTax ? Math.round((subtotal * settings.taxRate) / 100) : 0;
  const serviceChargeTotal = settings.enableService ? Math.round((subtotal * settings.serviceRate) / 100) : 0;
  const grandTotal = subtotal + taxTotal + serviceChargeTotal;

  const handleSaveNotes = () => {
    if (editingItemNotes) {
      updateCartItemNotes(editingItemNotes.id, editingItemNotes.notes);
      setEditingItemNotes(null);
    }
  };

  const handleSaveDiscount = () => {
    if (editingItemDiscount) {
      applyCartItemDiscount(editingItemDiscount.id, editingItemDiscount.percent, editingItemDiscount.amount);
      setEditingItemDiscount(null);
    }
  };

  const cartContent = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Mobile Drawer Header */}
      {isMobileModal && (
        <div className="p-3 bg-slate-900 text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-2">
            <ShoppingBag className="w-5 h-5 text-amber-400" />
            <h3 className="font-extrabold text-sm text-white">Keranjang Pesanan ({cart.reduce((s, i) => s + i.quantity, 0)} Item)</h3>
          </div>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Header: Order Type & Customer/Table Details */}
      <div className="p-3 border-b border-slate-200 space-y-3 bg-white">
        {/* Order Type Tabs */}
        <div className="grid grid-cols-5 gap-1 bg-slate-100 p-1 rounded-xl">
          {[
            { id: 'DINE_IN', label: 'Dine In' },
            { id: 'TAKEAWAY', label: 'Takeaway' },
            { id: 'DELIVERY', label: 'Delivery' },
            { id: 'ONLINE', label: 'Online' },
            { id: 'EVENT', label: 'Event' },
          ].map((type) => (
            <button
              key={type.id}
              onClick={() => setOrderType(type.id as any)}
              className={`py-1.5 text-[11px] font-bold rounded-lg transition-all ${
                orderType === type.id
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        {/* Quick Recent Tx Shortcut Link */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Detail Pesanan
          </span>
          {onOpenRecentTransactions && (
            <button
              type="button"
              onClick={onOpenRecentTransactions}
              className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center space-x-1 hover:underline"
            >
              <History className="w-3.5 h-3.5" />
              <span>Transaksi Terakhir (Void)</span>
            </button>
          )}
        </div>

        {/* Customer & Table Selectors */}
        <div className="grid grid-cols-2 gap-2">
          {/* Table / Slot Selector */}
          <button
            onClick={() => {
              if (isSeatedSegment) {
                const promptName = prompt(`Nomor / Nama ${slotNoun} (cth: ${activePreset.tables[0]?.name || slotNoun + ' 01'}):`, selectedTable?.name || '');
                if (promptName) {
                  setSelectedTable({ id: newId('tbl'), name: promptName, capacity: 4, zone: activePreset.layoutTerm.zones[0] || 'Main Area', status: 'OCCUPIED' });
                }
              }
            }}
            disabled={!isSeatedSegment}
            className={`flex items-center space-x-2 p-2 rounded-xl border text-xs font-semibold transition-all ${
              selectedTable
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            } ${!isSeatedSegment ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <Grid2X2 className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate">{selectedTable ? selectedTable.name : `Pilih ${slotNoun}`}</span>
            {selectedTable && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedTable(null);
                }}
                className="ml-auto text-slate-400 hover:text-rose-600"
              >
                ✕
              </span>
            )}
          </button>

          {/* Customer Selector */}
          <button
            onClick={onOpenCustomerSelect}
            className={`flex items-center space-x-2 p-2 rounded-xl border text-xs font-semibold transition-all ${
              selectedCustomer
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <UserPlus className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate">
              {selectedCustomer ? selectedCustomer.name : 'Pilih Member'}
            </span>
            {selectedCustomer && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedCustomer(null);
                }}
                className="ml-auto text-slate-400 hover:text-rose-600"
              >
                ✕
              </span>
            )}
          </button>
        </div>

        {/* Covers / Jumlah Tamu — hanya untuk segmen yang duduk di tempat.
            Tanpa angka ini, laporan hanya tahu belanja per struk dan tidak
            pernah tahu belanja per orang. */}
        {isSeatedSegment && (
          <div className="flex items-center justify-between p-2 rounded-xl border border-slate-200 bg-slate-50">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-700">
              <Users className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Jumlah Tamu</span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                aria-label="Kurangi jumlah tamu"
                onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                disabled={guestCount <= 1}
                className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                aria-label="Jumlah tamu"
                value={guestCount}
                onChange={(e) => setGuestCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="w-12 text-center text-xs font-extrabold font-mono bg-white border border-slate-200 rounded-lg py-1.5 text-slate-900"
              />
              <button
                type="button"
                aria-label="Tambah jumlah tamu"
                onClick={() => setGuestCount(guestCount + 1)}
                className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Operator Selection */}
        <button
          onClick={() => setShowStaffModal(true)}
          className={`w-full flex items-center justify-between p-2 rounded-xl border text-xs font-semibold transition-all ${
            selectedStaff
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <div className="flex items-center space-x-2 truncate">
            <UserCheck className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate">
              {selectedStaff
                ? `Operator: ${selectedStaff.name}`
                : `Operator: ${shift?.cashierName || 'Kasir'} (Kasir)`}
            </span>
          </div>
          {selectedStaff ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setSelectedStaff(null);
              }}
              className="text-slate-400 hover:text-rose-600 font-bold ml-1"
            >
              ✕
            </span>
          ) : (
            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-bold">Ubah</span>
          )}
        </button>
      </div>

      {/* Cart Items List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 divide-y divide-slate-100">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center space-y-2 py-12">
            <ShoppingBag className="w-12 h-12 stroke-1 text-slate-300" />
            <p className="font-semibold text-slate-700 text-sm">Keranjang Masih Kosong</p>
            <p className="text-xs text-slate-400 max-w-[200px]">
              Klik menu di sebelah kiri untuk menambah pesanan pelanggan.
            </p>
          </div>
        ) : (
          cart.map((item) => (
            <div key={item.id} className="pt-2.5 first:pt-0 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-sm text-slate-900 leading-snug">{item.name}</h4>
                  {item.variantName && (
                    <span className="text-[11px] font-medium text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 mr-1">
                      {item.variantName}
                    </span>
                  )}
                  {item.selectedModifiers.length > 0 && (
                    <p className="text-[10px] text-slate-500">
                      {item.selectedModifiers.map((m) => m.optionName).join(', ')}
                    </p>
                  )}
                  {item.itemNotes && (
                    <p className="text-[11px] italic text-slate-500 mt-0.5">Note: "{item.itemNotes}"</p>
                  )}
                </div>

                <span className="font-bold text-sm text-amber-700 font-mono shrink-0">
                  {formatRupiah(item.totalPrice)}
                </span>
              </div>

              {/* Action Toolbar per Item */}
              <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() =>
                      setEditingItemNotes({ id: item.id, notes: item.itemNotes || '' })
                    }
                    className="flex items-center space-x-1 hover:text-amber-600 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span className="text-[10px]">Catatan</span>
                  </button>

                  <button
                    onClick={() =>
                      setEditingItemDiscount({
                        id: item.id,
                        percent: item.discountPercent,
                        amount: item.discountAmount,
                      })
                    }
                    className="flex items-center space-x-1 hover:text-amber-600 transition-colors"
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span className="text-[10px]">Diskon</span>
                  </button>
                </div>

                {/* Quantity Controls */}
                <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5">
                  <button
                    onClick={() => updateCartQuantity(item.id, item.quantity - 1)}
                    className="p-1 hover:bg-slate-200 text-slate-600 rounded transition-colors"
                  >
                    {item.quantity === 1 ? <Trash2 className="w-3.5 h-3.5 text-rose-500" /> : <Minus className="w-3.5 h-3.5" />}
                  </button>
                  <span className="px-2 font-bold text-xs text-slate-900 min-w-[20px] text-center font-mono">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateCartQuantity(item.id, item.quantity + 1)}
                    className="p-1 hover:bg-slate-200 text-slate-600 rounded transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer Payment Summary */}
      <div className="p-3 bg-slate-50/90 border-t border-slate-200 space-y-2">
        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal:</span>
            <span className="font-mono font-medium">{formatRupiah(subtotal)}</span>
          </div>

          {totalDiscount > 0 && (
            <div className="flex justify-between text-rose-600 font-semibold">
              <span>Diskon:</span>
              <span className="font-mono">-{formatRupiah(totalDiscount)}</span>
            </div>
          )}

          {settings.enableTax && (
            <div className="flex justify-between text-slate-600">
              <span>Pajak (PB1 {settings.taxRate}%):</span>
              <span className="font-mono">{formatRupiah(taxTotal)}</span>
            </div>
          )}

          {settings.enableService && (
            <div className="flex justify-between text-slate-600">
              <span>Biaya Layanan ({settings.serviceRate}%):</span>
              <span className="font-mono">{formatRupiah(serviceChargeTotal)}</span>
            </div>
          )}

          <div className="flex justify-between items-center text-sm font-bold text-slate-900 pt-1.5 border-t border-slate-200">
            <span>Total Bayar:</span>
            <span className="text-base text-amber-700 font-mono font-extrabold">
              {formatRupiah(grandTotal)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          {/* Hold Order */}
          <button
            disabled={cart.length === 0}
            onClick={() => holdOrder()}
            className="flex items-center justify-center space-x-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
          >
            <PauseCircle className="w-4 h-4 text-amber-600" />
            <span>Tahan</span>
          </button>

          {/* Clear Cart */}
          <button
            disabled={cart.length === 0}
            onClick={clearCart}
            className="flex items-center justify-center space-x-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
          >
            <Trash2 className="w-4 h-4 text-rose-600" />
            <span>Batal</span>
          </button>

          {/* Checkout Button */}
          <button
            disabled={cart.length === 0}
            onClick={onOpenCheckout}
            className="col-span-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold py-2.5 rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CreditCard className="w-4 h-4" />
            <span>Bayar</span>
          </button>
        </div>
      </div>

      {/* Edit Item Notes Modal */}
      {editingItemNotes && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 max-w-sm w-full space-y-3 text-slate-900 shadow-2xl">
            <h4 className="font-bold text-sm text-amber-700">Tambah Catatan Item</h4>
            <input
              type="text"
              autoFocus
              value={editingItemNotes.notes}
              onChange={(e) =>
                setEditingItemNotes({ ...editingItemNotes, notes: e.target.value })
              }
              placeholder="Cth: Kurangi gula, pedas banget..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setEditingItemNotes(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800"
              >
                Batal
              </button>
              <button
                onClick={handleSaveNotes}
                className="px-4 py-1.5 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-xs hover:bg-amber-600"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Item Discount Modal */}
      {editingItemDiscount && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 max-w-sm w-full space-y-3 text-slate-900 shadow-2xl">
            <h4 className="font-bold text-sm text-amber-700">Atur Diskon Item</h4>
            <div className="space-y-2">
              <label className="text-xs text-slate-500">Diskon Persen (%):</label>
              <input
                type="number"
                value={editingItemDiscount.percent}
                onChange={(e) =>
                  setEditingItemDiscount({
                    ...editingItemDiscount,
                    percent: Number(e.target.value),
                    amount: 0,
                  })
                }
                placeholder="0%"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setEditingItemDiscount(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800"
              >
                Batal
              </button>
              <button
                onClick={handleSaveDiscount}
                className="px-4 py-1.5 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-xs hover:bg-amber-600"
              >
                Terapkan
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Select Staff Modal */}
      {showStaffModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 max-w-md w-full space-y-4 text-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-amber-600" />
                  Pilih {staffRoleNoun} Bertugas
                </h3>
                <p className="text-xs text-slate-500">
                  Tentukan siapa yang melayani transaksi layanan ini
                </p>
              </div>
              <button
                onClick={() => setShowStaffModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg p-1"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1">
              {staffMembers.length === 0 && (
                <div className="text-center py-8 px-4 border border-dashed border-slate-300 rounded-2xl">
                  <UserCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="font-bold text-xs text-slate-700">
                    Belum ada {staffRoleNoun.toLowerCase()} terdaftar
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Daftar petugas dipisah per jenis usaha. Tambahkan staf untuk{' '}
                    <b>{activePreset.name}</b> lewat menu Pengaturan.
                  </p>
                </div>
              )}
              {/* Context already scopes this list to the active sector. */}
              {staffMembers.map((staff) => (
                  <button
                    key={staff.id}
                    onClick={() => {
                      setSelectedStaff(staff);
                      setShowStaffModal(false);
                    }}
                    className={`flex items-center justify-between p-3 rounded-2xl border text-left transition-all ${
                      selectedStaff?.id === staff.id
                        ? 'bg-amber-50 border-amber-400 text-amber-950 ring-2 ring-amber-500/30'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-full bg-amber-200 text-amber-800 font-bold flex items-center justify-center text-sm">
                        {staff.avatar ? (
                          <img src={staff.avatar} alt={staff.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          staff.name.charAt(0)
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-xs">{staff.name}</p>
                        <p className="text-[11px] text-slate-500">{staff.role}</p>
                      </div>
                    </div>
                    {selectedStaff?.id === staff.id ? (
                      <span className="text-amber-600 font-bold text-xs flex items-center gap-1 bg-amber-100 px-2 py-1 rounded-lg">
                        <Check className="w-3.5 h-3.5" /> Terpilih
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 hover:text-slate-600">Pilih</span>
                    )}
                  </button>
                ))}
            </div>

            <div className="pt-2 flex justify-between items-center border-t border-slate-100">
              <button
                onClick={() => {
                  setSelectedStaff(null);
                  setShowStaffModal(false);
                }}
                className="text-xs text-rose-600 hover:underline font-semibold"
              >
                Kosongkan Pilihan
              </button>
                <button
                  onClick={() => setShowStaffModal(false)}
                  className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl hover:bg-slate-800"
                >
                  Selesai
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );

  if (isMobileModal) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/60 backdrop-blur-xs animate-fade-in lg:hidden">
        {/* Backdrop click to close */}
        <div className="flex-1" onClick={onCloseMobile} />
        {/* Bottom Sheet Modal Body */}
        <div className="bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[88dvh] overflow-hidden animate-slide-up border-t border-slate-200">
          {cartContent}
        </div>
      </div>
    );
  }

  return (
    <aside className="hidden lg:flex lg:w-96 bg-white border-l border-slate-200 text-slate-900 flex-col h-full shrink-0 shadow-lg select-none">
      {cartContent}
    </aside>
  );
};
