import type { AssistantAnswer, MerchantSnapshot } from './types';
import { buildBusinessBrain } from './businessBrain';
import { formatRupiah as rp } from '../../utils/formatters';
import { isFreePlan } from '../../config/freePlanPolicy';
import { parsePeriod } from './periods';
export function brainTopic(text: string): string | null {
  const t=text.toLowerCase();
  if(/outlet lain|usaha lain|semua outlet|lintas outlet|multi.?outlet/.test(t))return 'GROUP';
  if(/daily brief|brief harian|business brief|prioritas hari|pagi ini/.test(t))return 'BRIEF';
  if(/kenapa.*(om[sz]et|penjualan)|penyebab.*(turun|naik)|revenue intelligence/.test(t))return 'SALES';
  if(/demand|permintaan besok|forecast penjualan|prediksi permintaan/.test(t))return 'DEMAND';
  if(/procurement|perlu beli|rekomendasi pembelian|draft pembelian/.test(t))return 'PROCUREMENT';
  if(/menu engineering|produk star|produk puzzle|margin bocor|margin leak|simulasi harga/.test(t))return 'MENU';
  if(/customer intelligence|lifetime value|\bclv\b|segmentasi pelanggan|kampanye comeback/.test(t))return 'CRM';
  if(/anomali|fraud|cash shortage/.test(t))return 'ANOMALY';
  if(/promo apa|rekomendasi promo|simulasi promo/.test(t))return 'PROMO';
  if(/workforce|kebutuhan staf|butuh berapa (staf|pegawai)/.test(t))return 'WORKFORCE';
  return null;
}
export function answerBrain(topic: string, s: MerchantSnapshot, query=''): AssistantAnswer {
  const response=(title:string,lines:string[]):AssistantAnswer=>({source:'RULE_ENGINE',intent:'GET_INSIGHT_DIGEST',title,markdown:lines.join('\n'),costCredits:0});
  if(isFreePlan(s.settings.subscription))return response('AI tidak aktif di Free',['Upgrade paket untuk mengaktifkan Intelligence.']);
  if(!['ADMIN','MANAGER'].includes(s.userRole))return response('Akses dibatasi',['Analisis bisnis ini hanya tersedia bagi owner atau manager.']);
  const requested=parsePeriod(query,Date.parse(s.generatedAt));
  if(requested.clarification)return response('Perjelas periode',[requested.clarification]);
  if(requested.period && (topic==='SALES'?requested.period!=='YESTERDAY':!['BRIEF','GROUP'].includes(topic)))
    return response('Cakupan analisis',['Brief penjualan memakai kemarin; menu, promo dan anomali memakai 30 hari lengkap; forecast memakai 7 hari ke depan. Rentang khusus belum tersedia untuk analisis ini. Untuk angka penjualan per periode, tanyakan “omzet bulan lalu”.']);
  if(topic==='GROUP')return response('Group BI',['Gunakan tombol **Analisis lintas outlet**. Data setiap outlet diperiksa di server berdasarkan kepemilikan akun; tidak digabungkan dari penyimpanan perangkat.']);
  const b=buildBusinessBrain(s), v=b.sales;
  const note=`_Data perangkat · ${s.storeName} · diperbarui ${new Date(s.generatedAt).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB. Bukan gabungan seluruh terminal._`;
  const brief=[`**Omzet ${v.date}: ${rp(v.revenue)}** dari ${v.orders} transaksi.`,v.revenueChangePct===null?'Pembanding hari sejenis belum cukup (minimal empat).':`${v.revenueChangePct}% terhadap rata-rata ${v.baselineDays} hari sejenis.`,
    v.transactionEffect===null?'':`Perubahan terkait jumlah transaksi: ${rp(v.transactionEffect)}; nilai belanja: ${rp(v.basketEffect!)}. Ini dekomposisi angka, bukan bukti penyebab.`,
    v.projectedMonthEnd===null?'Proyeksi akhir bulan membutuhkan tujuh hari lengkap.':`Skenario laju saat ini: ${rp(v.projectedMonthEnd)} akhir bulan${v.monthlyTarget?`, target ${rp(v.monthlyTarget)}`:''}.`,
    ...b.actions.slice(0,3).map(a=>`- ${a.title}: ${a.reason}`)];
  let lines=brief,title='Business Daily Brief';
  if(topic==='SALES'){title='Revenue Intelligence';lines=[...brief,...(v.baselineDays>=4?v.hours.filter(h=>h.delta<0).slice(0,3).map(h=>`- Jam ${h.hour}:00: ${rp(h.current)} vs pembanding ${rp(h.baseline)}.`):[])];}
  if(topic==='DEMAND'){title='Prediksi permintaan tujuh hari';lines=b.demand.filter(f=>f.days.length).slice(0,5).map(f=>`- ${f.name}: ${f.days[0].expected} ${f.unit} besok; rentang indikatif ${f.days[0].low}–${f.days[0].high}. Uji historis MAE ${f.backtest?.mae??'belum cukup'}.`);lines.push('Belum memperhitungkan cuaca, efek promo, hari tutup dan stockout. Rentang bukan jaminan.');}
  if(topic==='PROCUREMENT'){title='Draft pembelian';lines=b.procurement.slice(0,10).map(p=>`- ${p.name}: ${p.suggestedQty} ${p.unit}; biaya ${p.estimatedCost===null?'HPP belum tersedia':rp(p.estimatedCost)}.`);lines.push('Cakupan tujuh hari dengan batas atas forecast. Konfirmasi supplier, pesanan masuk, lead time dan MOQ; belum membuat atau mengirim PO.');}
  if(topic==='MENU'){title='Menu & Margin Intelligence';lines=b.menu.slice(0,10).map(m=>`- ${m.name}: ${m.quadrant}; ${m.quantity} terjual; kontribusi ${m.contribution===null?'HPP belum lengkap':rp(m.contribution)}; margin katalog ${m.currentMarginPct??'belum tersedia'}%.`);lines.push('Buka Simulasi Harga untuk menghitung titik impas penurunan volume. Harga tidak diubah otomatis.');}
  if(topic==='CRM'){title='Customer Intelligence';lines=b.customers.slice(0,10).map(c=>`- ${c.name}: ${c.segment}, ${c.orders} transaksi teramati, ${rp(c.revenue)}; skenario nilai 12 bulan ${c.projected12m===null?'belum cukup riwayat':rp(c.projected12m)}.`);lines.push('Nilai 12 bulan adalah skenario laju pembelian, bukan CLV bersih atau probabilitas retensi. Kampanye memerlukan persetujuan owner dan izin pemasaran.');}
  if(topic==='ANOMALY'){title='Anomali untuk review';lines=b.anomalies.map(a=>`- ${a.title}: ${a.evidence}`);if(!lines.length)lines=['Belum ada flag yang memenuhi aturan dan jumlah sampel minimum. Ini bukan jaminan tidak ada masalah.'];}
  if(topic==='PROMO'){title='Promo Intelligence';lines=b.actions.filter(a=>a.kind==='PROMO').map(a=>`${a.title}\n${a.draft}`);if(!lines.length)lines=['Belum ada bundle yang memenuhi syarat asosiasi dan margin minimum. Lengkapi HPP serta riwayat keranjang terlebih dahulu.'];}
  if(topic==='WORKFORCE'){title='Workforce Intelligence';lines=[`Shift lengkap: ${b.workforce.completedShifts}. Transaksi/jam kasir: ${b.workforce.ordersPerHour??'data belum cukup'}.`,...b.actions.filter(a=>a.kind==='WORKFORCE').map(a=>a.draft),'Belum memperkirakan kehilangan omzet atau menambah jadwal otomatis; perlu jam kerja seluruh kru dan kapasitas layanan.'];}
  if(!lines.length)lines=['Data belum cukup untuk rekomendasi ini.'];
  return response(title,[note,'',...lines.filter(Boolean)]);
}
