import React from 'react';
import OperationalDashboard from '../../platform/modules/OperationalDashboard';
export default function Dashboard() {
  return <OperationalDashboard title="Booking & layanan stylist" description="Pantau booking dan layanan tersinkron. Komisi mengikuti aturan keuangan yang sudah ada." labels={{"SCHEDULED": "Terjadwal", "CONFIRMED": "Dikonfirmasi", "IN_PROGRESS": "Sedang dilayani", "COMPLETED": "Selesai", "CANCELLED": "Dibatalkan"}} />;
}
