import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { useTranslation } from '../../i18n/LanguageContext';
import { Order } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { ReceiptModal } from './ReceiptModal';
import { CheckoutModal } from './CheckoutModal';
import { PartialRefundModal } from './PartialRefundModal';
import {
  History,
  X,
  Search,
  RotateCcw,
  Printer,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  User,
  CreditCard,
  Building2,
  Calendar,
  Download,
  FileSpreadsheet,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Clock,
  Play,
  AlertCircle,
} from 'lucide-react';
import { PinAuthorizationModal } from '../auth/PinAuthorizationModal';

interface RecentTransactionsModalProps {
  onClose: () => void;
}

export const RecentTransactionsModal: React.FC<RecentTransactionsModalProps> = ({ onClose }) => {
  const {
    orders,
    heldOrders,
    voidOrder,
    recallHoldOrder,
    cancelHoldOrder,
    settings,
    hasPermission,
    sendLaundryWaNotification,
    updateOrderLaundryStatus,
  } = usePOS();
  const { t } = useTranslation();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'COMPLETED' | 'VOID'>('ALL');
  
  // Void modal state
  const [voidingOrder, setVoidingOrder] = useState<Order | null>(null);
  const [voidReason, setVoidReason] = useState('Salah Input Menu / Kasir');
  const [customReason, setCustomReason] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Receipt preview state
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);

  // Pay pending order modal state
  const [orderToPay, setOrderToPay] = useState<Order | null>(null);

  // Partial refund modal state
  const [refundingOrder, setRefundingOrder] = useState<Order | null>(null);

  // Quick Preset Reasons
  const presetReasons = [
    'Salah Input Menu / Kasir',
    'Pelanggan Batal Pesan',
    'Ganti Metode Pembayaran',
    'Menu Habis / Kosong',
    'Sistem Error / Double Input',
  ];

  // Combine orders and heldOrders so that no pending transaction is ever lost
  const allOrdersMap = new Map<string, Order>();
  orders.forEach((o) => allOrdersMap.set(o.id, o));
  heldOrders.forEach((o) => allOrdersMap.set(o.id, o));
  const allTransactions = Array.from(allOrdersMap.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Filtered orders list
  const filteredOrders = allTransactions.filter((o) => {
    const isVoid = o.status === 'VOID';
    const isPending = (o.status === 'HOLD' || o.paymentStatus === 'PENDING') && !isVoid;
    const isCompleted = o.status === 'COMPLETED' && !isPending && !isVoid;

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'PENDING' && isPending) ||
      (statusFilter === 'COMPLETED' && isCompleted) ||
      (statusFilter === 'VOID' && isVoid);

    const query = searchQuery.toLowerCase().trim();
    const matchesQuery =
      !query ||
      o.id.toLowerCase().includes(query) ||
      (o.customer?.name && o.customer.name.toLowerCase().includes(query)) ||
      (o.tableName && o.tableName.toLowerCase().includes(query)) ||
      o.items.some((item) => item.name.toLowerCase().includes(query));

    return matchesStatus && matchesQuery;
  });

  const totalPendingOrders = allTransactions.filter(
    (o) => (o.status === 'HOLD' || o.paymentStatus === 'PENDING') && o.status !== 'VOID'
  );
  const totalPendingCount = totalPendingOrders.length;
  const totalPendingAmount = totalPendingOrders.reduce((sum, o) => sum + o.total, 0);

  const totalCompletedOrders = allTransactions.filter(
    (o) => o.status === 'COMPLETED' && o.paymentStatus !== 'PENDING'
  );
  const totalCompletedCount = totalCompletedOrders.length;
  const totalCompletedAmount = totalCompletedOrders.reduce((sum, o) => sum + o.total, 0);

  const totalVoidOrders = allTransactions.filter((o) => o.status === 'VOID');
  const totalVoidCount = totalVoidOrders.length;

  const handleDownloadCSV = () => {
    if (filteredOrders.length === 0) {
      alert('Tidak ada data transaksi untuk diexport.');
      return;
    }

    const headers = [
      'No Invoice',
      'Tanggal & Waktu',
      'Status Transaksi',
      'Kasir',
      'Tipe Pesanan',
      'Meja',
      'Pelanggan / Member',
      'Daftar Menu & Qty',
      'Metode Pembayaran',
      'Subtotal (Rp)',
      'Pajak (Rp)',
      'Layanan (Rp)',
      'Diskon (Rp)',
      'Total Akhir (Rp)',
      'Catatan',
    ];

    const rows = filteredOrders.map((o) => {
      const isVoid = o.status === 'VOID';
      const isPending = (o.status === 'HOLD' || o.paymentStatus === 'PENDING') && !isVoid;
      const statusText = isVoid ? 'VOID / BATAL' : isPending ? 'BELUM LUNAS' : 'LUNAS / COMPLETED';

      const itemsStr = o.items.map((i) => `${i.name} (${i.quantity}x)`).join('; ');
      const subtotal = o.subtotal || o.total;

      return [
        `"${o.id}"`,
        `"${formatDateTime(o.date)}"`,
        `"${statusText}"`,
        `"${o.cashierName || '-'}"`,
        `"${o.orderType}"`,
        `"${o.tableName || '-'}"`,
        `"${o.customer?.name || 'Umum'}"`,
        `"${itemsStr}"`,
        `"${o.paymentMethod}"`,
        subtotal,
        o.taxTotal || 0,
        o.serviceChargeTotal || 0,
        o.discountTotal || 0,
        o.total,
        `"${o.notes || ''}"`,
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `transaksi_newhope_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const executeVoidTransaction = () => {
    if (!voidingOrder) return;
    const finalReason = customReason.trim() || voidReason;
    voidOrder(voidingOrder.id, finalReason);
    setVoidingOrder(null);
    setVoidReason('Salah Input Menu / Kasir');
    setCustomReason('');
    setShowAuthModal(false);
  };

  const handleConfirmVoid = () => {
    if (!voidingOrder) return;
    if (!hasPermission('void_order')) {
      setShowAuthModal(true);
      return;
    }
    executeVoidTransaction();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-4xl w-full text-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-600 rounded-2xl">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-extrabold text-base sm:text-lg text-slate-900 leading-tight">
                {t('recentTransactions.title')}
              </h3>
              <p className="text-xs text-slate-500">
                {t('recentTransactions.subtitle')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-slate-100/70 border-b border-slate-200 text-xs shrink-0">
          <div className="bg-white border border-slate-200 rounded-2xl p-2.5 flex items-center justify-between shadow-2xs">
            <div>
              <span className="text-[10px] text-slate-500 font-semibold block uppercase tracking-wider">
                {t('recentTransactions.completed')}
              </span>
              <span className="font-extrabold text-slate-900 text-sm font-mono">
                {totalCompletedCount}
              </span>
            </div>
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-2.5 flex items-center justify-between shadow-2xs">
            <div>
              <span className="text-[10px] text-slate-500 font-semibold block uppercase tracking-wider">
                {t('recentTransactions.amount')}
              </span>
              <span className="font-extrabold text-emerald-700 text-sm font-mono">
                {formatRupiah(totalCompletedAmount)}
              </span>
            </div>
            <CreditCard className="w-5 h-5 text-emerald-600" />
          </div>

          <div
            onClick={() => setStatusFilter('PENDING')}
            className={`rounded-2xl p-2.5 flex items-center justify-between cursor-pointer transition-all shadow-2xs border ${
              totalPendingCount > 0
                ? 'bg-amber-50/90 border-amber-300 ring-2 ring-amber-400/20 hover:bg-amber-100/80'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] text-amber-900 font-bold block uppercase tracking-wider">
                  {t('recentTransactions.pending')}
                </span>
                {totalPendingCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping inline-block" />
                )}
              </div>
              <span className="font-extrabold text-amber-800 text-sm font-mono block">
                {totalPendingCount} ({formatRupiah(totalPendingAmount)})
              </span>
            </div>
            <Clock className="w-5 h-5 text-amber-600" />
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-2.5 flex items-center justify-between shadow-2xs">
            <div>
              <span className="text-[10px] text-slate-500 font-semibold block uppercase tracking-wider">
                {t('recentTransactions.void')}
              </span>
              <span className="font-extrabold text-rose-600 text-sm font-mono">
                {totalVoidCount}
              </span>
            </div>
            <XCircle className="w-5 h-5 text-rose-600" />
          </div>
        </div>

        {/* Immutability Security Audit Notice */}
        <div className="px-4 py-2 bg-emerald-50/80 border-b border-emerald-100 flex items-center justify-between text-xs text-emerald-900 shrink-0">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold text-[11px]">
              <strong>{t('common.status')}:</strong> {t('recentTransactions.subtitle')}
            </span>
          </div>
          <span className="text-[10px] text-emerald-800 bg-emerald-100/90 font-mono font-bold px-2 py-0.5 rounded-md border border-emerald-300 shrink-0 hidden sm:inline-flex items-center space-x-1">
            <Lock className="w-3 h-3 text-emerald-700" />
            <span>Audit-Protected</span>
          </span>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="p-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('recentTransactions.searchPlaceholder')}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
            />
          </div>

          <div className="flex items-center space-x-2 flex-wrap gap-2">
            <div className="flex bg-slate-100 p-1 rounded-xl space-x-1 text-xs font-bold">
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('recentTransactions.all')} ({allTransactions.length})
              </button>
              <button
                onClick={() => setStatusFilter('PENDING')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center space-x-1.5 cursor-pointer ${
                  statusFilter === 'PENDING'
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : totalPendingCount > 0
                    ? 'text-amber-800 bg-amber-100/70 hover:bg-amber-100 font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>{t('recentTransactions.pending')} ({totalPendingCount})</span>
              </button>
              <button
                onClick={() => setStatusFilter('COMPLETED')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  statusFilter === 'COMPLETED'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('recentTransactions.completed')} ({totalCompletedCount})
              </button>
              <button
                onClick={() => setStatusFilter('VOID')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  statusFilter === 'VOID'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t('recentTransactions.void')} ({totalVoidCount})
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadCSV}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-extrabold transition-all shadow-2xs hover:shadow-xs flex items-center space-x-1.5 shrink-0 cursor-pointer"
              title="Export data transaksi yang difilter ke format CSV"
            >
              <Download className="w-4 h-4" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* Orders List Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/60">
          {filteredOrders.length === 0 ? (
            <div className="text-center py-12 space-y-2 text-slate-400">
              <History className="w-12 h-12 stroke-1 mx-auto text-slate-300" />
              <p className="font-bold text-slate-700 text-sm">Tidak Ada Transaksi Ditemukan</p>
              <p className="text-xs text-slate-400">
                Cobalah mengubah kata kunci pencarian atau filter status transaksi.
              </p>
            </div>
          ) : (
            filteredOrders.map((order) => {
              const isVoid = order.status === 'VOID';
              const isPending = (order.status === 'HOLD' || order.paymentStatus === 'PENDING') && !isVoid;

              return (
                <div
                  key={order.id}
                  className={`bg-white border rounded-2xl p-4 transition-all shadow-xs space-y-3 ${
                    isVoid
                      ? 'border-rose-200 bg-rose-50/30'
                      : isPending
                      ? 'border-amber-300 bg-amber-50/20 hover:border-amber-400'
                      : 'border-slate-200 hover:border-amber-300'
                  }`}
                >
                  {/* Top Bar: Invoice, Date, Badge */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="flex items-center space-x-2.5">
                      <span className="font-mono font-extrabold text-slate-900 text-sm bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-lg">
                        {order.id}
                      </span>

                      <span className="text-xs text-slate-500 font-mono flex items-center space-x-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatDateTime(order.date)}</span>
                      </span>

                      <span
                        className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                          order.orderType === 'DINE_IN'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : order.orderType === 'TAKEAWAY'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-purple-100 text-purple-800 border border-purple-200'
                        }`}
                      >
                        {order.orderType}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {isVoid ? (
                        <span className="bg-rose-100 text-rose-800 border border-rose-300 text-xs font-extrabold px-2.5 py-1 rounded-xl flex items-center space-x-1">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{t('recentTransactions.void').toUpperCase()}</span>
                        </span>
                      ) : isPending ? (
                        <span className="bg-amber-100 text-amber-900 border border-amber-300 text-xs font-black px-2.5 py-1 rounded-xl flex items-center space-x-1.5 shadow-2xs animate-pulse">
                          <Clock className="w-3.5 h-3.5 text-amber-700" />
                          <span>{t('recentTransactions.pending').toUpperCase()}</span>
                        </span>
                      ) : (
                        <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-extrabold px-2.5 py-1 rounded-xl flex items-center space-x-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{t('recentTransactions.completed').toUpperCase()}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Customer, Table, Cashier & Staff info */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span className="flex items-center space-x-1">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{t('recentTransactions.cashier')}: <strong className="text-slate-800">{order.cashierName}</strong></span>
                    </span>

                    {order.servedByStaffName && (
                      <span className="flex items-center space-x-1 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        <User className="w-3.5 h-3.5 text-amber-700" />
                        <span>Staff: <strong className="text-amber-900">{order.servedByStaffName}</strong></span>
                      </span>
                    )}

                    {order.tableName && (
                      <span className="flex items-center space-x-1">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        <span>Meja: <strong className="text-amber-800">{order.tableName}</strong></span>
                      </span>
                    )}

                    {order.customer && (
                      <span className="flex items-center space-x-1">
                        <User className="w-3.5 h-3.5 text-amber-600" />
                        <span>{t('recentTransactions.customer')}: <strong className="text-slate-800">{order.customer.name} ({order.customer.phone})</strong></span>
                      </span>
                    )}

                    {order.dropOffDate && (
                      <span className="flex items-center space-x-1 bg-blue-50 text-blue-900 px-2 py-0.5 rounded border border-blue-200 font-medium">
                        <span>📅 {t('holdOrders.dropOffDate')}: <strong>{order.dropOffDate}</strong></span>
                      </span>
                    )}

                    {(order.completionDate || order.completionEstimate) && (
                      <span className="flex items-center space-x-1 bg-indigo-50 text-indigo-900 px-2 py-0.5 rounded border border-indigo-200 font-bold">
                        <span>⏰ {t('holdOrders.completionEstimate')}: <strong>{order.completionDate || order.completionEstimate}</strong></span>
                      </span>
                    )}
                  </div>

                  {/* Items Summary list */}
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 space-y-1 text-xs">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center text-slate-700">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-amber-800">{item.quantity}x</span>
                          <span className="font-medium text-slate-900">{item.name}</span>
                          {item.variantName && (
                            <span className="text-[10px] bg-amber-100 text-amber-900 px-1 py-0.5 rounded font-semibold">
                              {item.variantName}
                            </span>
                          )}
                          {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                            <span className="text-[10px] text-slate-500">
                              ({item.selectedModifiers.map((m) => m.optionName).join(', ')})
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-slate-800">{formatRupiah(item.totalPrice)}</span>
                      </div>
                    ))}

                    {order.notes && (
                      <p className="text-[11px] text-rose-700 font-medium italic pt-1 border-t border-slate-200">
                        {t('common.notes')}: {order.notes}
                      </p>
                    )}
                  </div>

                  {/* Bottom Bar: Total & Action Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center space-x-3">
                      <span className="text-xs font-semibold text-slate-500">{t('recentTransactions.paymentMethod')}:</span>
                      <span className={`px-2.5 py-1 font-mono font-bold text-xs rounded-lg border ${
                        isPending 
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-slate-100 text-slate-900 border border-slate-200'
                      }`}>
                        {isPending ? t('recentTransactions.pending').toUpperCase() : order.paymentMethod}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">{t('common.total')}:</span>
                      <span className={`font-mono font-extrabold text-base ${
                        isVoid 
                          ? 'text-slate-400 line-through' 
                          : isPending 
                          ? 'text-rose-700' 
                          : 'text-amber-700'
                      }`}>
                        {formatRupiah(order.total)}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {/* If pending: Call to Cart & Pay Now buttons */}
                      {isPending && (
                        <>
                          <button
                            onClick={() => {
                              recallHoldOrder(order.id);
                              onClose();
                            }}
                            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer"
                          >
                            <span>{t('holdOrders.resumeOrder')}</span>
                          </button>
                          <button
                            onClick={() => setOrderToPay(order)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer"
                          >
                            <span>{t('holdOrders.payDirect')}</span>
                          </button>
                        </>
                      )}

                      {/* Laundry Ready WA Notif shortcut */}
                      {settings.businessSector === 'LAUNDRY' && !isVoid && (
                        <button
                          onClick={() => sendLaundryWaNotification(order)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shadow-2xs ${
                            order.laundryStatus === 'SELESAI_SIAP_AMBIL'
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                              : 'bg-emerald-100 text-emerald-900 border border-emerald-300 hover:bg-emerald-200'
                          }`}
                        >
                          <span>💬 WA</span>
                        </button>
                      )}

                      {/* Partial Refund / Retur Item */}
                      {!isVoid && !isPending && (
                        <button
                          onClick={() => setRefundingOrder(order)}
                          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shadow-2xs hover:shadow-xs cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                          <span>{t('recentTransactions.partialRefund')}</span>
                        </button>
                      )}

                      {/* Reprint Receipt */}
                      <button
                        onClick={() => setReceiptOrder(order)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5 text-slate-600" />
                        <span>{t('recentTransactions.reprintReceipt')}</span>
                      </button>

                      {/* Void / Cancel Button */}
                      {!isVoid && (
                        <button
                          onClick={() => setVoidingOrder(order)}
                          className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-xl text-xs font-extrabold transition-all flex items-center space-x-1.5 shadow-2xs hover:shadow-xs cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-rose-600" />
                          <span>{t('recentTransactions.voidTransaction')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Confirmation Void Dialog */}
      {voidingOrder && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-rose-200 rounded-3xl p-6 max-w-md w-full space-y-4 text-slate-900 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="p-3 bg-rose-100 rounded-2xl">
                <AlertTriangle className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h4 className="font-extrabold text-base text-rose-900">
                  {t('recentTransactions.confirmVoid')}
                </h4>
                <p className="text-xs text-rose-700 font-mono font-bold">{voidingOrder.id}</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">{t('recentTransactions.voidReason')}:</label>
              <div className="space-y-1.5">
                {presetReasons.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setVoidReason(preset);
                      setCustomReason('');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
                      voidReason === preset && !customReason
                        ? 'bg-rose-50 text-rose-900 border-rose-300 font-bold'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="pt-1">
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder={t('recentTransactions.voidReason')}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setVoidingOrder(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
              >
                {t('common.back')}
              </button>
              <button
                onClick={handleConfirmVoid}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <XCircle className="w-4 h-4" />
                <span>{t('recentTransactions.voidTransaction')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout Modal for Pending Order Payment */}
      {orderToPay && (
        <CheckoutModal
          pendingOrderToPay={orderToPay}
          onClose={() => setOrderToPay(null)}
          onPaymentSuccess={(completed) => {
            setOrderToPay(null);
            setReceiptOrder(completed);
          }}
        />
      )}

      {/* Receipt Modal Preview */}
      {receiptOrder && (
        <ReceiptModal
          order={receiptOrder}
          settings={settings}
          onClose={() => setReceiptOrder(null)}
        />
      )}

      {/* Partial Refund Modal */}
      {refundingOrder && (
        <PartialRefundModal
          order={refundingOrder}
          isOpen={!!refundingOrder}
          onClose={() => setRefundingOrder(null)}
        />
      )}

      {/* PIN Authorization Modal for Void Override */}
      {showAuthModal && (
        <PinAuthorizationModal
          title="Otorisasi Pembatalan Order (Manager / Admin)"
          description="Aksi pembatalan transaksi kasir memerlukan PIN Manager atau Admin."
          requiredRoles={['ADMIN', 'MANAGER']}
          onClose={() => setShowAuthModal(false)}
          onAuthorized={(role, name) => {
            executeVoidTransaction();
          }}
        />
      )}
    </div>
  );
};

