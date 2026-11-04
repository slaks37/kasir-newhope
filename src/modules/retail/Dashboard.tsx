import React from 'react';
import OperationalDashboard from '../../platform/modules/OperationalDashboard';
export default function Dashboard() {
  return <OperationalDashboard title="Kesehatan stok retail" description="Pantau produk tersinkron dan peringatan stok. Penjualan tetap melalui kasir dan ledger yang sama." labels={{"UNKNOWN": "Stok belum terverifikasi", "AVAILABLE": "Stok tersedia", "LOW_STOCK": "Stok menipis", "OUT_OF_STOCK": "Stok habis"}} />;
}
