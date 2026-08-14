import { Order, StoreSettings } from '../types';
import { formatRupiah, formatDateTime } from './formatters';

interface ExportReportOptions {
  orders: Order[];
  settings: StoreSettings;
  periodLabel: string;
  userName?: string;
}

/**
 * EXPORT KE MICROSOFT EXCEL (.xls / XML Spreadsheet 2003)
 * Mendukung format styling, multi-kolom pajak & service charge, dan formula total.
 */
export function exportOrdersToExcel({ orders, settings, periodLabel, userName = 'Administrator' }: ExportReportOptions) {
  const storeName = settings.storeName || 'New Hope POS';
  const taxRate = settings.taxRate || 0;
  const serviceRate = settings.serviceRate || 0;

  // Calculate totals
  const totalSubtotal = orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);
  const totalDiscount = orders.reduce((sum, o) => sum + (o.discountTotal || 0), 0);
  const totalTax = orders.reduce((sum, o) => sum + (o.taxTotal || 0), 0);
  const totalServiceCharge = orders.reduce((sum, o) => sum + (o.serviceChargeTotal || 0), 0);
  const grandTotal = orders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Payment Breakdown
  const paymentMap: Record<string, { count: number; total: number }> = {};
  orders.forEach((o) => {
    const m = o.paymentMethod || 'CASH';
    if (!paymentMap[m]) paymentMap[m] = { count: 0, total: 0 };
    paymentMap[m].count += 1;
    paymentMap[m].total += o.total;
  });

  const exportDate = formatDateTime(new Date());

  // Build Excel XML
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="Title">
   <Font ss:FontName="Calibri" ss:Size="16" ss:Bold="1" ss:Color="#0F172A"/>
  </Style>
  <Style ss:ID="Subtitle">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#475569"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1E293B" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="HeaderTax">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#D97706" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="HeaderService">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#2563EB" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="HeaderTotal">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#059669" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="DataCell">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
  <Style ss:ID="CurrencyCell">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <Alignment ss:Horizontal="Right"/>
   <NumberFormat ss:Format="#,##0"/>
  </Style>
  <Style ss:ID="TotalRow">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3" ss:Color="#0F172A"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0F172A"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#0F172A"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right"/>
   <NumberFormat ss:Format="#,##0"/>
  </Style>
  <Style ss:ID="TotalLabel">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="3" ss:Color="#0F172A"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0F172A"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#0F172A"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Laporan Penjualan &amp; Pajak">
  <Table ss:DefaultRowHeight="20">
   <Column ss:Width="40"/>
   <Column ss:Width="140"/>
   <Column ss:Width="120"/>
   <Column ss:Width="90"/>
   <Column ss:Width="100"/>
   <Column ss:Width="100"/>
   <Column ss:Width="100"/>
   <Column ss:Width="100"/>
   <Column ss:Width="110"/>
   <Column ss:Width="120"/>
   <Column ss:Width="120"/>
   <Column ss:Width="100"/>
   <Column ss:Width="90"/>

   <!-- Title Section -->
   <Row ss:Height="25">
    <Cell ss:StyleID="Title"><Data ss:Type="String">${storeName} — Laporan Penjualan, Pajak &amp; Layanan</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Subtitle"><Data ss:Type="String">Periode: ${periodLabel} | Dicetak: ${exportDate} | Oleh: ${userName}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Subtitle"><Data ss:Type="String">Tarif Pajak Toko: ${taxRate}% | Tarif Service Charge: ${serviceRate}%</Data></Cell>
   </Row>
   <Row ss:Height="10"/>

   <!-- Table Headers -->
   <Row ss:Height="24">
    <Cell ss:StyleID="Header"><Data ss:Type="String">No</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">No Faktur / Invoice</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Tanggal &amp; Jam</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Tipe Order</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Pelanggan</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Kasir</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Subtotal (Rp)</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Diskon (Rp)</Data></Cell>
    <Cell ss:StyleID="HeaderTax"><Data ss:Type="String">Pajak / PB1 (Rp)</Data></Cell>
    <Cell ss:StyleID="HeaderService"><Data ss:Type="String">Service Charge (Rp)</Data></Cell>
    <Cell ss:StyleID="HeaderTotal"><Data ss:Type="String">Total Akhir / Net (Rp)</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Metode Bayar</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Status</Data></Cell>
   </Row>

   <!-- Data Rows -->
   ${orders
     .map((o, idx) => {
       const sub = o.subtotal || o.total;
       const disc = o.discountTotal || 0;
       const tax = o.taxTotal || 0;
       const svc = o.serviceChargeTotal || 0;
       const tot = o.total;

       return `
   <Row>
    <Cell ss:StyleID="DataCell"><Data ss:Type="Number">${idx + 1}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${o.id}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${formatDateTime(o.date)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${o.orderType || 'DINE_IN'}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${o.customer?.name || '-'}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${o.cashierName || 'Kasir'}</Data></Cell>
    <Cell ss:StyleID="CurrencyCell"><Data ss:Type="Number">${sub}</Data></Cell>
    <Cell ss:StyleID="CurrencyCell"><Data ss:Type="Number">${disc}</Data></Cell>
    <Cell ss:StyleID="CurrencyCell"><Data ss:Type="Number">${tax}</Data></Cell>
    <Cell ss:StyleID="CurrencyCell"><Data ss:Type="Number">${svc}</Data></Cell>
    <Cell ss:StyleID="CurrencyCell"><Data ss:Type="Number">${tot}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${o.paymentMethod}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${o.status}</Data></Cell>
   </Row>`;
     })
     .join('')}

   <!-- Grand Total Summary Row -->
   <Row ss:Height="24">
    <Cell ss:StyleID="TotalLabel" ss:MergeAcross="5"><Data ss:Type="String">GRAND TOTAL RINGKASAN</Data></Cell>
    <Cell ss:StyleID="TotalRow"><Data ss:Type="Number">${totalSubtotal}</Data></Cell>
    <Cell ss:StyleID="TotalRow"><Data ss:Type="Number">${totalDiscount}</Data></Cell>
    <Cell ss:StyleID="TotalRow"><Data ss:Type="Number">${totalTax}</Data></Cell>
    <Cell ss:StyleID="TotalRow"><Data ss:Type="Number">${totalServiceCharge}</Data></Cell>
    <Cell ss:StyleID="TotalRow"><Data ss:Type="Number">${grandTotal}</Data></Cell>
    <Cell ss:StyleID="TotalLabel" ss:MergeAcross="1"><Data ss:Type="String">${orders.length} Transaksi</Data></Cell>
   </Row>

   <Row ss:Height="20"/>

   <!-- Tax & Service Charge Breakdown Card -->
   <Row ss:Height="22">
    <Cell ss:StyleID="HeaderTax" ss:MergeAcross="2"><Data ss:Type="String">REKAPITULASI PAJAK &amp; BIAYA LAYANAN</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="DataCell" ss:MergeAcross="1"><Data ss:Type="String">Total Pajak Terkumpul (PB1/PPN)</Data></Cell>
    <Cell ss:StyleID="CurrencyCell"><Data ss:Type="Number">${totalTax}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="DataCell" ss:MergeAcross="1"><Data ss:Type="String">Total Service Charge Terkumpul</Data></Cell>
    <Cell ss:StyleID="CurrencyCell"><Data ss:Type="Number">${totalServiceCharge}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="TotalLabel" ss:MergeAcross="1"><Data ss:Type="String">Total Pungutan Pajak &amp; Service</Data></Cell>
    <Cell ss:StyleID="TotalRow"><Data ss:Type="Number">${totalTax + totalServiceCharge}</Data></Cell>
   </Row>

   <Row ss:Height="20"/>

   <!-- Payment Methods Breakdown Card -->
   <Row ss:Height="22">
    <Cell ss:StyleID="Header" ss:MergeAcross="2"><Data ss:Type="String">REKAPITULASI METODE PEMBAYARAN</Data></Cell>
   </Row>
   ${Object.entries(paymentMap)
     .map(
       ([method, data]) => `
   <Row>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${method}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${data.count} Transaksi</Data></Cell>
    <Cell ss:StyleID="CurrencyCell"><Data ss:Type="Number">${data.total}</Data></Cell>
   </Row>`
     )
     .join('')}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xmlContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const sanitizedPeriod = periodLabel.replace(/\s+/g, '_');
  link.href = url;
  link.download = `Laporan_Keuangan_Pajak_${storeName.replace(/\s+/g, '_')}_${sanitizedPeriod}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * EXPORT KE PDF RESMI BERKUALITAS TINGGI
 * Membuka jendela pratinjau cetak PDF beresolusi tinggi dengan kop toko,
 * ringkasan finansial, tabel lengkap dengan kolom Pajak & Service Charge, dan tanda tangan.
 */
export function exportOrdersToPDF({ orders, settings, periodLabel, userName = 'Administrator' }: ExportReportOptions) {
  const storeName = settings.storeName || 'New Hope POS';
  const storePhone = settings.phone || '-';
  const storeAddress = settings.address || 'Indonesia';
  const taxRate = settings.taxRate || 0;
  const serviceRate = settings.serviceRate || 0;

  // Totals
  const totalSubtotal = orders.reduce((sum, o) => sum + (o.subtotal || o.total), 0);
  const totalDiscount = orders.reduce((sum, o) => sum + (o.discountTotal || 0), 0);
  const totalTax = orders.reduce((sum, o) => sum + (o.taxTotal || 0), 0);
  const totalServiceCharge = orders.reduce((sum, o) => sum + (o.serviceChargeTotal || 0), 0);
  const grandTotal = orders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Payment Breakdown
  const paymentMap: Record<string, { count: number; total: number }> = {};
  orders.forEach((o) => {
    const m = o.paymentMethod || 'CASH';
    if (!paymentMap[m]) paymentMap[m] = { count: 0, total: 0 };
    paymentMap[m].count += 1;
    paymentMap[m].total += o.total;
  });

  const exportDate = formatDateTime(new Date());

  const printWindow = window.open('', '_blank', 'width=1100,height=800');
  if (!printWindow) {
    alert('Pop-up terblokir oleh browser. Harap izinkan pop-up untuk mencetak / menyimpan PDF.');
    return;
  }

  const htmlContent = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Laporan Keuangan & Pajak - ${storeName}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm 10mm 12mm 10mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    body {
      color: #1e293b;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.4;
      padding: 15px;
    }
    .header-container {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2.5px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 15px;
    }
    .store-brand h1 {
      font-size: 20px;
      font-weight: 900;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: -0.5px;
    }
    .store-brand p {
      color: #64748b;
      font-size: 11px;
      margin-top: 2px;
    }
    .report-title {
      text-align: right;
    }
    .report-title h2 {
      font-size: 16px;
      font-weight: 800;
      color: #d97706;
      text-transform: uppercase;
    }
    .report-title p {
      font-size: 10.5px;
      color: #475569;
      margin-top: 2px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 10px;
      margin-bottom: 15px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .kpi-card.tax-card {
      background: #fffbeb;
      border-color: #fde68a;
    }
    .kpi-card.service-card {
      background: #eff6ff;
      border-color: #bfdbfe;
    }
    .kpi-card.total-card {
      background: #ecfdf5;
      border-color: #a7f3d0;
    }
    .kpi-label {
      font-size: 9.5px;
      text-transform: uppercase;
      font-weight: 700;
      color: #64748b;
    }
    .kpi-value {
      font-size: 14px;
      font-weight: 900;
      color: #0f172a;
      margin-top: 3px;
    }
    .kpi-card.tax-card .kpi-value { color: #b45309; }
    .kpi-card.service-card .kpi-value { color: #1d4ed8; }
    .kpi-card.total-card .kpi-value { color: #047857; }

    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
      font-size: 10px;
    }
    table.data-table th {
      background: #0f172a;
      color: #ffffff;
      padding: 7px 6px;
      text-align: left;
      font-weight: 700;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    table.data-table th.tax-th { background: #d97706; }
    table.data-table th.svc-th { background: #2563eb; }
    table.data-table th.tot-th { background: #059669; }
    table.data-table th.num-col, table.data-table td.num-col { text-align: right; }
    table.data-table td {
      padding: 6px 6px;
      border-bottom: 1px solid #e2e8f0;
      color: #334155;
    }
    table.data-table tr:nth-child(even) td {
      background: #f8fafc;
    }
    table.data-table tr.total-row td {
      background: #f1f5f9;
      font-weight: 800;
      border-top: 2px solid #0f172a;
      border-bottom: 2px solid #0f172a;
      color: #0f172a;
      font-size: 10.5px;
    }

    .bottom-section {
      display: grid;
      grid-template-columns: 1.2fr 1fr 1fr;
      gap: 15px;
      margin-top: 15px;
      page-break-inside: avoid;
    }
    .summary-box {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px;
      background: #fafafa;
    }
    .summary-box h3 {
      font-size: 11px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 6px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
      text-transform: uppercase;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      font-size: 10px;
      color: #475569;
    }
    .summary-row.bold {
      font-weight: 800;
      color: #0f172a;
      border-top: 1px dashed #cbd5e1;
      margin-top: 4px;
      padding-top: 4px;
    }

    .signature-container {
      display: flex;
      justify-content: space-between;
      margin-top: 25px;
      padding-top: 10px;
      page-break-inside: avoid;
    }
    .signature-box {
      text-align: center;
      width: 180px;
    }
    .signature-line {
      margin-top: 45px;
      border-bottom: 1px solid #475569;
    }
    .signature-title {
      font-size: 10px;
      color: #64748b;
      margin-top: 4px;
    }

    .no-print-toolbar {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #0f172a;
      padding: 10px 16px;
      border-radius: 50px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.3);
      display: flex;
      gap: 10px;
      z-index: 100;
    }
    .btn-print {
      background: #f59e0b;
      color: #0f172a;
      border: none;
      font-weight: 800;
      font-size: 12px;
      padding: 8px 16px;
      border-radius: 25px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-close {
      background: #334155;
      color: #ffffff;
      border: none;
      font-weight: 700;
      font-size: 12px;
      padding: 8px 14px;
      border-radius: 25px;
      cursor: pointer;
    }
    @media print {
      .no-print-toolbar { display: none !important; }
      body { padding: 0; }
    }
  </style>
</head>
<body>

  <!-- Floating Print Actions -->
  <div class="no-print-toolbar">
    <button class="btn-print" onclick="window.print()">🖨️ Cetak / Simpan PDF</button>
    <button class="btn-close" onclick="window.close()">✕ Tutup</button>
  </div>

  <!-- Header -->
  <div class="header-container">
    <div class="store-brand">
      <h1>${storeName}</h1>
      <p>${storeAddress} • Telp: ${storePhone}</p>
      <p style="font-size: 10px; color: #94a3b8; margin-top: 1px;">Sistem POS: New Hope Multi-Business v2.5</p>
    </div>
    <div class="report-title">
      <h2>Laporan Keuangan &amp; Pajak</h2>
      <p><b>Periode:</b> ${periodLabel}</p>
      <p><b>Dicetak:</b> ${exportDate} (Oleh: ${userName})</p>
      <p><b>Tarif Toko:</b> Pajak (PB1/PPN) ${taxRate}% | Service Charge ${serviceRate}%</p>
    </div>
  </div>

  <!-- KPI Summary Cards -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Total Transaksi</div>
      <div class="kpi-value">${orders.length} Transaksi</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Subtotal Kotor</div>
      <div class="kpi-value">${formatRupiah(totalSubtotal)}</div>
    </div>
    <div class="kpi-card tax-card">
      <div class="kpi-label">Pajak (PB1/PPN)</div>
      <div class="kpi-value">${formatRupiah(totalTax)}</div>
    </div>
    <div class="kpi-card service-card">
      <div class="kpi-label">Service Charge</div>
      <div class="kpi-value">${formatRupiah(totalServiceCharge)}</div>
    </div>
    <div class="kpi-card total-card">
      <div class="kpi-label">Omzet Bersih Diterima</div>
      <div class="kpi-value">${formatRupiah(grandTotal)}</div>
    </div>
  </div>

  <!-- Full Transaction Data Table -->
  <table class="data-table">
    <thead>
      <tr>
        <th style="width: 25px;">No</th>
        <th>No Faktur</th>
        <th>Waktu</th>
        <th>Tipe</th>
        <th>Pelanggan</th>
        <th>Kasir</th>
        <th class="num-col">Subtotal</th>
        <th class="num-col">Diskon</th>
        <th class="num-col tax-th">Pajak</th>
        <th class="num-col svc-th">Service</th>
        <th class="num-col tot-th">Total Akhir</th>
        <th style="text-align: center;">Metode</th>
        <th style="text-align: center;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${orders
        .map((o, idx) => {
          const sub = o.subtotal || o.total;
          const disc = o.discountTotal || 0;
          const tax = o.taxTotal || 0;
          const svc = o.serviceChargeTotal || 0;
          const tot = o.total;

          return `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td style="font-family: monospace; font-weight: 700;">${o.id}</td>
        <td>${formatDateTime(o.date)}</td>
        <td>${o.orderType || 'DINE_IN'}</td>
        <td>${o.customer?.name || '-'}</td>
        <td>${o.cashierName || 'Kasir'}</td>
        <td class="num-col">${formatRupiah(sub)}</td>
        <td class="num-col" style="color: #dc2626;">${disc > 0 ? `-${formatRupiah(disc)}` : '-'}</td>
        <td class="num-col" style="font-weight: 700; color: #b45309;">${formatRupiah(tax)}</td>
        <td class="num-col" style="font-weight: 700; color: #1d4ed8;">${formatRupiah(svc)}</td>
        <td class="num-col" style="font-weight: 900; color: #047857;">${formatRupiah(tot)}</td>
        <td style="text-align: center; font-weight: 700; font-size: 9px;">${o.paymentMethod}</td>
        <td style="text-align: center; font-size: 9px; color: #059669; font-weight: 700;">${o.status}</td>
      </tr>`;
        })
        .join('')}

      <!-- Total Summary Row -->
      <tr class="total-row">
        <td colspan="6" style="text-align: center; letter-spacing: 0.5px;">TOTAL KESELURUHAN (${orders.length} PESANAN)</td>
        <td class="num-col">${formatRupiah(totalSubtotal)}</td>
        <td class="num-col" style="color: #dc2626;">-${formatRupiah(totalDiscount)}</td>
        <td class="num-col" style="color: #b45309;">${formatRupiah(totalTax)}</td>
        <td class="num-col" style="color: #1d4ed8;">${formatRupiah(totalServiceCharge)}</td>
        <td class="num-col" style="color: #047857;">${formatRupiah(grandTotal)}</td>
        <td colspan="2" style="text-align: center; font-size: 9px;">LUNAS</td>
      </tr>
    </tbody>
  </table>

  <!-- Bottom Breakdown & Signatures -->
  <div class="bottom-section">
    <!-- Payment Breakdown -->
    <div class="summary-box">
      <h3>Rekapitulasi Pembayaran</h3>
      ${Object.entries(paymentMap)
        .map(
          ([method, data]) => `
      <div class="summary-row">
        <span>${method} (${data.count} tx)</span>
        <span style="font-weight: 700;">${formatRupiah(data.total)}</span>
      </div>`
        )
        .join('')}
      <div class="summary-row bold">
        <span>Total Pembayaran Masuk</span>
        <span>${formatRupiah(grandTotal)}</span>
      </div>
    </div>

    <!-- Tax & Service Breakdown -->
    <div class="summary-box">
      <h3>Rekapitulasi Pajak &amp; Layanan</h3>
      <div class="summary-row">
        <span>Pajak PB1 / PPN (${taxRate}%)</span>
        <span style="color: #b45309; font-weight: 700;">${formatRupiah(totalTax)}</span>
      </div>
      <div class="summary-row">
        <span>Biaya Layanan / Service (${serviceRate}%)</span>
        <span style="color: #1d4ed8; font-weight: 700;">${formatRupiah(totalServiceCharge)}</span>
      </div>
      <div class="summary-row bold">
        <span>Total Pungutan Tambahan</span>
        <span>${formatRupiah(totalTax + totalServiceCharge)}</span>
      </div>
    </div>

    <!-- Signatures -->
    <div class="summary-box" style="display: flex; flex-direction: column; justify-content: space-between;">
      <div style="font-size: 10px; color: #64748b; text-align: center;">
        Pengesahan Laporan Finansial Toko
      </div>
      <div style="display: flex; justify-content: space-around; margin-top: 15px;">
        <div class="signature-box" style="width: 100px;">
          <div class="signature-line"></div>
          <div class="signature-title">Dibuat Kasir</div>
        </div>
        <div class="signature-box" style="width: 100px;">
          <div class="signature-line"></div>
          <div class="signature-title">Manager / Owner</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Auto trigger print dialog after page rendering
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.print();
      }, 500);
    });
  </script>
</body>
</html>
`;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();
}
