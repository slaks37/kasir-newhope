import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { StaffCommissionRule } from '../../types';
import { formatRupiah } from '../../utils/formatters';
import {
  Percent,
  X,
  Plus,
  Save,
  Users,
  DollarSign,
  TrendingUp,
  Award,
  Calendar,
  CheckCircle2,
  Coins,
  ArrowRight,
} from 'lucide-react';

interface StaffCommissionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StaffCommissionModal: React.FC<StaffCommissionModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { staffMembers, commissionRules, saveCommissionRule, orders, setActiveTab } = usePOS();
  const [selectedStaffId, setSelectedStaffId] = useState(staffMembers[0]?.id || '');
  const [commissionType, setCommissionType] = useState<'PERCENTAGE' | 'FIXED_PER_ORDER'>('PERCENTAGE');
  const [rateValue, setRateValue] = useState(25);

  if (!isOpen) return null;

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId) return;

    const staff = staffMembers.find((s) => s.id === selectedStaffId);
    saveCommissionRule({
      staffId: selectedStaffId,
      staffName: staff?.name || '',
      staffMemberId: selectedStaffId,
      commissionType,
      rateValue,
      serviceCommissionPercent: commissionType === 'PERCENTAGE' ? rateValue : 0,
      fixedCommissionPerService: commissionType === 'FIXED_PER_ORDER' ? rateValue : 0,
      retailCommissionPercent: 5,
    });
    alert('Aturan komisi staf berhasil diperbarui!');
  };

  // Calculate commission recap per staff from completed orders
  const staffRecap = staffMembers.map((staff) => {
    const staffOrders = orders.filter((o) => {
      if (o.status !== 'COMPLETED') return false;
      return o.servedByStaffId === staff.id || (o.assignedCrew && o.assignedCrew.includes(staff.name));
    });

    const totalOrders = staffOrders.length;
    const totalSales = staffOrders.reduce((sum, o) => sum + o.total, 0);

    // Find rule for this staff
    const rule = commissionRules.find((r) => (r.staffId || r.staffMemberId) === staff.id);
    let totalCommission = 0;

    if (rule) {
      const type = rule.commissionType || (rule.serviceCommissionPercent ? 'PERCENTAGE' : 'FIXED_PER_ORDER');
      const val = rule.rateValue !== undefined ? rule.rateValue : (rule.serviceCommissionPercent || rule.fixedCommissionPerService || 20);
      if (type === 'PERCENTAGE') {
        totalCommission = Math.round((totalSales * val) / 100);
      } else {
        totalCommission = totalOrders * val;
      }
    } else {
      // Default 20%
      totalCommission = Math.round(totalSales * 0.2);
    }

    return {
      staff,
      rule,
      totalOrders,
      totalSales,
      totalCommission,
    };
  });

  const grandCommissionTotal = staffRecap.reduce((sum, s) => sum + s.totalCommission, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-600 flex items-center justify-center">
              <Percent className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-lg text-slate-950">Rekap &amp; Aturan Komisi Staf</h3>
              <p className="text-xs text-slate-500">
                Kalkulasi bagi hasil dan komisi per staf, stylist, atau kru pencuci
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Full Labor Module Link Banner */}
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-blue-900 font-bold">
            <Coins className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Smart Labor &amp; Commission Core aktif untuk seluruh modul</span>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              setActiveTab('labor');
            }}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center gap-1 shrink-0 transition-all shadow-2xs"
          >
            <span>Buka Modul Payroll Lengkap</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Rule Form */}
        <form onSubmit={handleSaveRule} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3 text-xs">
          <span className="font-black text-slate-800 block text-xs">
            Atur Persentase / Komisi Flat Per Staf:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="font-bold text-slate-600 block mb-1">Nama Staf</label>
              <select
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 bg-white focus:border-amber-500 outline-none"
              >
                {staffMembers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-600 block mb-1">Skema Komisi</label>
              <select
                value={commissionType}
                onChange={(e) => setCommissionType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 bg-white focus:border-amber-500 outline-none"
              >
                <option value="PERCENTAGE">Persen dari Omzet (%)</option>
                <option value="FIXED_PER_ORDER">Nominal Flat per Order (Rp)</option>
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-600 block mb-1">
                {commissionType === 'PERCENTAGE' ? 'Nilai Persen (%)' : 'Nominal Flat (Rp)'}
              </label>
              <div className="flex space-x-1.5">
                <input
                  type="number"
                  min={0}
                  value={rateValue}
                  onChange={(e) => setRateValue(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-black text-slate-900 bg-white focus:border-amber-500 outline-none"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl cursor-pointer shrink-0 shadow-xs"
                >
                  <Save className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Grand Total Summary */}
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xs text-amber-900 font-bold block">Total Akumulasi Komisi Staf</span>
              <span className="text-[11px] text-amber-700">Dihitung otomatis dari transaksi pesanan selesai</span>
            </div>
          </div>
          <div className="font-mono font-black text-xl text-amber-950">
            {formatRupiah(grandCommissionTotal)}
          </div>
        </div>

        {/* Staff Table */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 font-black uppercase text-[10px] border-b border-slate-200">
              <tr>
                <th className="p-3">Nama Staf</th>
                <th className="p-3">Peran</th>
                <th className="p-3 text-center">Aturan Komisi</th>
                <th className="p-3 text-center">Jml Order</th>
                <th className="p-3 text-right">Omzet Layanan</th>
                <th className="p-3 text-right">Hak Komisi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staffRecap.map((row) => (
                <tr key={row.staff.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-3 font-bold text-slate-900">{row.staff.name}</td>
                  <td className="p-3 text-slate-500 text-[11px]">{row.staff.role}</td>
                  <td className="p-3 text-center">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                      {row.rule
                        ? (row.rule.commissionType === 'PERCENTAGE' || row.rule.serviceCommissionPercent)
                          ? `${row.rule.rateValue || row.rule.serviceCommissionPercent}%`
                          : formatRupiah(row.rule.rateValue || row.rule.fixedCommissionPerService || 0)
                        : 'Default 20%'}
                    </span>
                  </td>
                  <td className="p-3 text-center font-mono font-black text-slate-900">
                    {row.totalOrders}
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-slate-600">
                    {formatRupiah(row.totalSales)}
                  </td>
                  <td className="p-3 text-right font-mono font-black text-emerald-700 text-sm">
                    {formatRupiah(row.totalCommission)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
