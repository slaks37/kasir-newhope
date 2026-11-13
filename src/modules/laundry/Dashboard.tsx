import React from 'react';
import OperationalDashboard from '../../platform/modules/OperationalDashboard';
export default function Dashboard() {
  return <OperationalDashboard title="Produksi & pengambilan" description="Pisahkan tahap pengerjaan cucian dari pelunasan pembayaran pelanggan." labels={{"ANTRIAN": "Diterima", "CUCI": "Pencucian", "KERING": "Pengeringan", "SETRIKA": "Setrika", "PACKING": "Packing", "SIAP_AMBIL": "Siap ambil", "SELESAI": "Diambil"}} />;
}
