import React from 'react';
import OperationalDashboard from '../../platform/modules/OperationalDashboard';
export default function Dashboard() {
  return <OperationalDashboard title="Dapur & layanan restoran" description="Pantau tiket dapur tersinkron, lalu buka KDS untuk mengerjakan pesanan." labels={{"PENDING": "Menunggu dapur", "PREPARING": "Sedang dimasak", "READY": "Siap disajikan", "SERVED": "Sudah disajikan"}} />;
}
