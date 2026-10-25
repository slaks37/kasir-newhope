import React from 'react';
import OperationalDashboard from '../../platform/modules/OperationalDashboard';
export default function Dashboard() {
  return <OperationalDashboard title="Antrean & produktivitas bay" description="Kelola kendaraan, kru pencuci, progres pengerjaan, dan inspeksi dari antrean carwash." labels={{"ANTRIAN_BAY": "Antrean bay", "CUCI_BUSA": "Pencucian", "PENGERINGAN_VAKUM": "Kering & vakum", "INSPEKSI_SELESAI": "Inspeksi", "SIAP_KELUAR": "Siap keluar"}} />;
}
