import type { ServerReportSummary, ServerTransaction } from '../lib/reports/types';
import { formatRupiah } from './formatters';
const html=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const csv=(v:unknown)=>'"'+String(v??'').replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';
export function exportCloudReport(summary:ServerReportSummary,rows:ServerTransaction[],storeName:string,format:'csv'|'pdf',reservedPopup?:Window|null){
  const s=summary.financialSummary;
  const metrics:[string,number][]=[['Transaksi valid',s.totalOrders],['Omzet valid',s.totalNetRevenue],['Retur',s.totalRefunds],['HPP snapshot',s.totalCOGS],['Pajak',s.totalTax],['Laba kotor',s.grossProfit]];
  const period=`${summary.scope.from||'Awal'} — ${summary.scope.to||'Sekarang'} (${summary.scope.timezone})`;
  if(format==='csv'){
    const content=[['Toko',storeName],['Periode',period],['Sumber','Cloud'],...metrics,[],['Nota','Waktu','Status','Metode','Nilai struk','Omzet valid','Retur'],
      ...rows.map(r=>[r.id,r.date,r.serverOrderStatus,r.paymentMethod,r.total,r.recognizedRevenue??0,r.refundTotal||0])].map(row=>row.map(csv).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+content],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');
    link.href=url;link.download='laporan-cloud.csv';link.click();URL.revokeObjectURL(url);return;
  }
  const popup=reservedPopup===undefined?window.open('','_blank'):reservedPopup;if(!popup){alert('Izinkan jendela cetak untuk menyimpan PDF.');return;}
  popup.document.write(`<!doctype html><html><head><title>Laporan ${html(storeName)}</title><style>body{font:13px Arial;color:#172238;padding:24px}table{width:100%;border-collapse:collapse;margin:18px 0}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}@media print{button{display:none}}</style></head><body><h1>${html(storeName)}</h1><p>${html(period)} · Cloud ${html(summary.generatedAt)}</p><table>${metrics.map(([label,value])=>`<tr><th>${html(label)}</th><td>${html(label==='Transaksi valid'?value:formatRupiah(value))}</td></tr>`).join('')}</table><table><thead><tr><th>Nota</th><th>Waktu</th><th>Status</th><th>Nilai struk</th><th>Omzet valid</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${html(r.id)}</td><td>${html(r.date)}</td><td>${html(r.serverOrderStatus)}</td><td>${html(formatRupiah(r.total))}</td><td>${html(formatRupiah(r.recognizedRevenue??0))}</td></tr>`).join('')}</tbody></table><button onclick="window.print()">Cetak / Simpan PDF</button></body></html>`);
  popup.document.close();popup.focus();popup.print();
}
