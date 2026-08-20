/**
 * Ajakan memperpanjang langganan — TIDAK memblokir kasir.
 *
 * MENGGANTIKAN SubscriptionLockScreen, yang layar penuhnya tidak pernah sekali
 * pun muncul: syaratnya `settings.subscription?.status === 'EXPIRED'`, sementara
 * `settings.subscription` hanya pernah diisi oleh layar kunci itu sendiri.
 * Lingkaran yang tidak punya titik awal — jadi paywall-nya tidak ada, dan tidak
 * ada galat yang memberi tahu siapa pun.
 *
 * Sekarang statusnya datang dari POSContext, sumber yang sama dengan
 * entitlement, jadi keduanya tidak bisa berbeda.
 *
 * KENAPA SPANDUK, BUKAN KUNCI. Langganan berbayar yang habis menurunkan
 * merchant ke tingkat Free, bukan mengunci kasirnya. Aplikasi kasir yang mati
 * di tengah pelayanan merugikan merchant jauh melebihi tagihan yang belum
 * dibayar — dan merchant yang kehilangan penjualan satu hari karena lupa
 * memperpanjang cenderung pindah ke pesaing, bukan membayar.
 */

import React from 'react';
import { usePOS } from '../../context/POSContext';
import { AlertTriangle, Clock, ArrowRight } from 'lucide-react';

interface Props {
  /** Membuka halaman Pengaturan -> Langganan. */
  onBuka: () => void;
}

export const SpandukLangganan: React.FC<Props> = ({ onBuka }) => {
  const { statusLangganan, planName } = usePOS();

  // Belum terbaca, atau memang sedang berjalan: tidak ada yang perlu dikatakan.
  if (statusLangganan !== 'EXPIRED' && statusLangganan !== 'PAST_DUE') return null;

  const tenggang = statusLangganan === 'PAST_DUE';

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs ${
        tenggang
          ? 'bg-amber-50 border-b border-amber-200 text-amber-900'
          : 'bg-rose-50 border-b border-rose-200 text-rose-900'
      }`}
    >
      <div className="flex items-center gap-2">
        {tenggang ? (
          <Clock className="w-4 h-4 shrink-0 text-amber-600" />
        ) : (
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
        )}
        <span className="font-semibold">
          {tenggang ? (
            <>
              Masa tenggang paket {planName ?? 'Anda'}. Perpanjang sekarang supaya fitur
              berbayar tidak terputus.
            </>
          ) : (
            <>
              Paket {planName ?? 'berbayar'} sudah berakhir. Kasir tetap bisa dipakai dengan
              batas Free — 1 outlet, 30 produk, tanpa AI Copilot.
            </>
          )}
        </span>
      </div>

      <button
        onClick={onBuka}
        className={`px-3 py-1.5 rounded-lg font-extrabold shrink-0 flex items-center gap-1.5 ${
          tenggang
            ? 'bg-amber-500 hover:bg-amber-600 text-slate-950'
            : 'bg-rose-600 hover:bg-rose-700 text-white'
        }`}
      >
        <span>Perpanjang — Bayar via QRIS</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
