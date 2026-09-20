import type { CartItem, Order, Product } from '../../types';
import type { MerchantSnapshot } from './types';
import { addDate, businessDate, businessHour, businessTime, DAY, dayStart, weekday } from './periods';

// Deterministic business intelligence. No network, model, writes or hidden data.
export const BRAIN_VERSION = '1.0.0';
const n = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const sum = <T>(rows: T[], get: (row: T) => number) => rows.reduce((a, r) => a + get(r), 0);
const mean = (xs: number[]) => xs.length ? sum(xs, x => x) / xs.length : 0;
const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
const median = (xs: number[]) => { const s = [...xs].sort((a,b)=>a-b); return s.length ? (s[Math.floor((s.length-1)/2)] + s[Math.floor(s.length/2)]) / 2 : 0; };
const paid = (o: Order) => o.status === 'COMPLETED' && o.paymentStatus === 'PAID';
const netSales = (o: Order) => Math.max(0, n(o.subtotal) - n(o.discountTotal));
const change = (current: number, prior: number) => prior > 0 ? round((current / prior - 1) * 100) : null;

export interface DemandForecast {
  productId: string; name: string; unit: string; historyDays: number; observations: number;
  method: 'WEEKDAY' | 'DAILY_MEAN' | 'INSUFFICIENT';
  days: { date: string; expected: number; low: number; high: number }[];
  backtest: { mae: number; baselineMae: number; points: number } | null;
  limitations: string[];
}
export interface ProcurementLine {
  itemId: string; name: string; unit: string; demand: number; onHand: number; suggestedQty: number;
  estimatedCost: number | null; coverageDays: number | null; supplier: null;
}
export interface MenuProduct {
  productId: string; name: string; quantity: number; revenue: number; contribution: number | null;
  unitContribution: number | null; costCoveragePct: number; currentCost: number | null;
  currentMarginPct: number | null; targetMarginPct: number | null;
  quadrant: 'STAR' | 'PUZZLE' | 'PLOWHORSE' | 'DOG' | 'UNKNOWN';
}
export interface CustomerValue {
  id: string; name: string; orders: number; revenue: number; avgBasket: number; recencyDays: number;
  expectedCycleDays: number; segment: 'CHAMPION'|'LOYAL'|'POTENTIAL'|'AT_RISK'|'HIBERNATING'|'LOST'|'NEW';
  projected12m: number | null; historyDays: number; favourite: string | null;
}
export interface BrainAction {
  id: string; kind: 'PROCUREMENT'|'CRM'|'PRICING'|'WORKFORCE'|'REVIEW'|'PROMO';
  title: string; reason: string; draft: string; metric: 'revenue'|'orders'|'stockCritical';
}
export interface BusinessBrain {
  version: string; businessId: string; generatedAt: string; source: 'CLIENT'|'DATABASE';
  period: { from: string; to: string }; limitations: string[];
  sales: {
    date: string; revenue: number; orders: number; basket: number; baselineDays: number; baselineRevenue: number;
    revenueChangePct: number | null; transactionEffect: number | null; basketEffect: number | null;
    hours: { hour: number; current: number; baseline: number; delta: number }[];
    channels: { name: string; current: number; baseline: number; delta: number }[];
    mtdRevenue: number; projectedMonthEnd: number | null; monthlyTarget: number | null; dailyNeeded: number | null;
  };
  demand: DemandForecast[]; procurement: ProcurementLine[]; menu: MenuProduct[]; customers: CustomerValue[];
  offers: { aId: string; bId: string; aName: string; bName: string; confidence: number; lift: number; support: number; count: number }[];
  anomalies: { id: string; title: string; evidence: string; severity: 'REVIEW'|'WATCH' }[];
  workforce: { completedShifts: number; excludedShifts: number; ordersPerHour: number | null; peakHour: number | null; suggestedStaff: number | null };
  sector: { title: string; metrics: { label: string; value: string }[]; missing: string[] };
  actions: BrainAction[];
}

/** A scenario, not a demand elasticity prediction. Maximum volume loss that
 * preserves contribution at the same unit cost (before fixed expenses). */
export function simulatePrice(price: number, cost: number, newPrice: number, quantity: number, volumeLossPct = 0) {
  if (![price,cost,newPrice,quantity,volumeLossPct].every(Number.isFinite) || price <= 0 || cost < 0 || newPrice <= cost || quantity < 0 || volumeLossPct < 0 || volumeLossPct > 100) return null;
  const before = (price-cost)*quantity;
  const after = (newPrice-cost)*quantity*(1-volumeLossPct/100);
  return { before: round(before), after: round(after), delta: round(after-before), marginPct: round((newPrice-cost)/newPrice*100),
    breakEvenVolumeLossPct: price > cost ? round((1-(price-cost)/(newPrice-cost))*100) : null };
}

function currentCost(p: Product): number | null {
  if (p.recipeIngredients?.length) {
    if (p.recipeIngredients.some(i => !Number.isFinite(i.costPerUnit) || i.costPerUnit <= 0 || i.quantity <= 0)) return null;
    return sum(p.recipeIngredients, i => i.quantity*i.costPerUnit);
  }
  return Number.isFinite(p.costPrice) && p.costPrice > 0 ? p.costPrice : null;
}

function predict(series: { date: string; qty: number }[], date: string, method: 'WEEKDAY'|'DAILY_MEAN') {
  const samples = method === 'WEEKDAY' ? series.filter(d=>weekday(d.date)===weekday(date)).slice(-8) : series.slice(-28);
  const values = samples.map(d=>d.qty);
  const expected = mean(values);
  const deviation = values.length > 1 ? Math.sqrt(sum(values, v=>(v-expected)**2)/(values.length-1)) : 0;
  // Approximate prediction range, not a promised probability. Sparse samples
  // use a wider multiplier and are explicitly labelled below.
  const radius = (values.length < 10 ? 2.5 : 2) * deviation * Math.sqrt(1+1/Math.max(1,values.length));
  return { date, expected: round(expected), low: Math.max(0, Math.floor(expected-radius)), high: Math.ceil(expected+radius) };
}

export function forecastDemand(p: Product, orders: Order[], today: string): DemandForecast {
  const quantities = new Map<string,number>();
  for (const o of orders) for (const i of o.items) if (i.productId === p.id) {
    const date = businessDate(o.date);
    quantities.set(date,(quantities.get(date)||0)+Math.max(0,n(i.quantity)));
  }
  const first = [...quantities.keys()].sort()[0];
  const from = first && first > addDate(today,-84) ? first : addDate(today,-84);
  const historyDays = first ? Math.max(0,Math.round((dayStart(today)-dayStart(from))/DAY)) : 0;
  const series = Array.from({length: historyDays},(_,i)=>({date:addDate(from,i),qty:quantities.get(addDate(from,i))||0}));
  let method: DemandForecast['method'] = historyDays >= 28 ? 'WEEKDAY' : historyDays >= 14 ? 'DAILY_MEAN' : 'INSUFFICIENT';
  let backtest: DemandForecast['backtest'] = null;
  if (historyDays >= 35) {
    const errors: number[]=[]; const baseline: number[]=[];
    for(let i=Math.max(28,historyDays-14);i<historyDays;i++) {
      const training=series.slice(0,i); const actual=series[i];
      errors.push(Math.abs(predict(training,actual.date,'WEEKDAY').expected-actual.qty));
      baseline.push(Math.abs(predict(training,actual.date,'DAILY_MEAN').expected-actual.qty));
    }
    backtest={mae:round(mean(errors)),baselineMae:round(mean(baseline)),points:errors.length};
    if(backtest.mae > backtest.baselineMae) {method='DAILY_MEAN';backtest.mae=backtest.baselineMae;}
  }
  return { productId:p.id,name:p.name,unit:p.unit,historyDays,observations:quantities.size,method,backtest,
    days:method==='INSUFFICIENT'?[]:Array.from({length:7},(_,i)=>predict(series,addDate(today,i+1),method as 'WEEKDAY'|'DAILY_MEAN')),
    limitations:['Rentang indikatif, bukan jaminan probabilitas. Hari tanpa penjualan dihitung nol; hari tutup dan stockout belum dipisahkan.',
      'Belum memasukkan cuaca, efek kausal promo, atau musim tahunan; perlu data tambahan.'] };
}

/** Converts explicit compatible recipe units only. Unknown units never guessed. */
function unitFactor(from: string, to: string): number | null {
  const units: Record<string,[string,number]>={g:['mass',1],gram:['mass',1],kg:['mass',1000],kilogram:['mass',1000],ml:['volume',1],liter:['volume',1000],l:['volume',1000],pcs:['count',1],pc:['count',1]};
  if(from.toLowerCase()===to.toLowerCase()) return 1;
  const a=units[from.toLowerCase()],b=units[to.toLowerCase()];
  return a&&b&&a[0]===b[0]?a[1]/b[1]:null;
}

export function buildBusinessBrain(s: MerchantSnapshot, source: BusinessBrain['source']='CLIENT'): BusinessBrain {
  const now=businessTime(s.generatedAt); const today=businessDate(now); const yesterday=addDate(today,-1);
  const valid=s.orders.filter(o=>Number.isFinite(businessTime(o.date))&&businessTime(o.date)<=now);
  const sales=valid.filter(paid); const closed=sales.filter(o=>businessDate(o.date)<today);
  const recent=closed.filter(o=>businessDate(o.date)>=addDate(today,-30));
  const yesterdayOrders=closed.filter(o=>businessDate(o.date)===yesterday);
  const firstDate=closed.map(o=>businessDate(o.date)).sort()[0];
  const baselineDates=Array.from({length:8},(_,i)=>addDate(yesterday,-7*(i+1))).filter(d=>firstDate&&d>=firstDate);
  const baseline=closed.filter(o=>baselineDates.includes(businessDate(o.date)));
  const k=baselineDates.length; const baseOrders=k?baseline.length/k:0;
  const baseRevenue=k?sum(baseline,o=>n(o.total))/k:0; const baseBasket=baseOrders?baseRevenue/baseOrders:0;
  const revenue=sum(yesterdayOrders,o=>n(o.total)); const basket=yesterdayOrders.length?revenue/yesterdayOrders.length:0;
  const enough=k>=4;
  // Symmetric (Shapley) decomposition, including cross-term: effects sum
  // exactly to revenue delta. Association only, not proof of a cause.
  const transactionEffect=enough?(yesterdayOrders.length-baseOrders)*(basket+baseBasket)/2:null;
  const basketEffect=enough?(basket-baseBasket)*(yesterdayOrders.length+baseOrders)/2:null;
  const hours=Array.from({length:24},(_,hour)=>{
    const current=sum(yesterdayOrders.filter(o=>businessHour(o.date)===hour),o=>n(o.total));
    const prior=k?sum(baseline.filter(o=>businessHour(o.date)===hour),o=>n(o.total))/k:0;
    return {hour,current:round(current),baseline:round(prior),delta:round(current-prior)};
  }).sort((a,b)=>a.delta-b.delta);
  const channels=[...new Set([...baseline,...yesterdayOrders].map(o=>o.orderType))].map(name=>{
    const current=sum(yesterdayOrders.filter(o=>o.orderType===name),o=>n(o.total));
    const prior=k?sum(baseline.filter(o=>o.orderType===name),o=>n(o.total))/k:0;
    return {name,current:round(current),baseline:round(prior),delta:round(current-prior)};
  }).sort((a,b)=>a.delta-b.delta);
  const monthStart=today.slice(0,8)+'01';
  const mtd=sum(sales.filter(o=>businessDate(o.date)>=monthStart),o=>n(o.total));
  const completedDays=Number(today.slice(8))-1;
  const monthDays=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).getUTCDate();
  const closedMtd=sum(closed.filter(o=>businessDate(o.date)>=monthStart),o=>n(o.total));
  const target=n(s.settings.monthlyRevenueTarget)||null;
  const projected=completedDays>=7?round(closedMtd/completedDays*monthDays):null;
  const menu: MenuProduct[]=s.products.filter(p=>p.isAvailable).map(p=>{
    const lines=recent.flatMap(o=>o.items.filter(i=>i.productId===p.id).map(i=>({i,discountFactor:n(o.subtotal)>0?Math.max(0,1-n(o.discountTotal)/n(o.subtotal)):1})));
    const qty=sum(lines,l=>n(l.i.quantity)); const lineRevenue=sum(lines,l=>n(l.i.totalPrice)*l.discountFactor);
    const known=lines.filter(l=>Number.isFinite(l.i.unitCost)&&n(l.i.unitCost)>0);
    const coverage=qty>0?sum(known,l=>n(l.i.quantity))/qty*100:0;
    const contribution=coverage===100?lineRevenue-sum(known,l=>n(l.i.unitCost)*n(l.i.quantity)):null;
    const cost=currentCost(p);
    return {productId:p.id,name:p.name,quantity:qty,revenue:round(lineRevenue),contribution:contribution===null?null:round(contribution),
      unitContribution:contribution!==null&&qty>0?round(contribution/qty):null,costCoveragePct:round(coverage),currentCost:cost,
      currentMarginPct:cost!==null&&p.price>0?round((p.price-cost)/p.price*100):null,targetMarginPct:p.targetMarginPercent||null,quadrant:'UNKNOWN'};
  });
  const knownMenu=menu.filter(m=>m.unitContribution!==null);
  const popularity=mean(menu.map(m=>m.quantity)); const margin=median(knownMenu.map(m=>m.unitContribution!));
  for(const m of menu) if(m.unitContribution!==null&&recent.length>=20) m.quadrant=m.quantity>=popularity?(m.unitContribution>=margin?'STAR':'PLOWHORSE'):(m.unitContribution>=margin?'PUZZLE':'DOG');
  menu.sort((a,b)=>b.revenue-a.revenue);
  const demand=s.products.filter(p=>p.isAvailable).map(p=>forecastDemand(p,closed,today));
  const required=new Map<string,{name:string;unit:string;demand:number;stock:number;cost:number|null}>();
  const limitations=['Cakupan satu unit usaha; tidak menyimpulkan usaha atau outlet lain dari data ini.',
    'Omzet memakai total struk; margin kontribusi memakai penjualan setelah diskon, sebelum pajak, service charge dan beban operasional.',
    'Pola historis menunjukkan keterkaitan, bukan membuktikan penyebab atau efek suatu tindakan.'];
  for(const f of demand.filter(d=>d.days.length)) {
    const p=s.products.find(p=>p.id===f.productId)!; const need=sum(f.days,d=>d.high);
    if(p.recipeIngredients?.length) for(const ingredient of p.recipeIngredients) {
      const stock=s.stockItems.find(i=>i.id===ingredient.ingredientId); const factor=stock?unitFactor(ingredient.unit,stock.unit):null;
      if(!stock||factor===null) { limitations.push(`Kebutuhan ${ingredient.ingredientName} belum dihitung: bahan atau konversi satuan belum lengkap.`); continue; }
      const row=required.get(stock.id)||{name:stock.name,unit:stock.unit,demand:0,stock:stock.stock,cost:stock.costPrice>0?stock.costPrice:null};
      row.demand+=need*ingredient.quantity*factor;required.set(stock.id,row);
    } else if(p.linkedStockItemId) {
      const stock=s.stockItems.find(i=>i.id===p.linkedStockItemId);
      if(!stock||!(p.recipeQty!>0)) {limitations.push(`Resep ${p.name} belum lengkap untuk pembelian.`);continue;}
      const row=required.get(stock.id)||{name:stock.name,unit:stock.unit,demand:0,stock:stock.stock,cost:stock.costPrice>0?stock.costPrice:null};
      row.demand+=need*p.recipeQty!; required.set(stock.id,row);
    } else required.set(p.id,{name:p.name,unit:p.unit,demand:need,stock:p.stock,cost:currentCost(p)});
  }
  const procurement: ProcurementLine[]=[...required].map(([itemId,r])=>{
    const qty=Math.max(0,Math.ceil((r.demand-r.stock)*100)/100);
    return {itemId,name:r.name,unit:r.unit,demand:round(r.demand),onHand:r.stock,suggestedQty:qty,
      estimatedCost:r.cost===null?null:round(qty*r.cost),coverageDays:r.demand>0?round((r.stock+qty)/(r.demand/7)):null,supplier:null};
  }).filter(r=>r.suggestedQty>0).sort((a,b)=>(b.estimatedCost||0)-(a.estimatedCost||0));
  const defaultCycle={FNB:14,RETAIL:30,LAUNDRY:14,CARWASH:21,BARBERSHOP:35}[s.businessSector];
  const customers: CustomerValue[]=s.customers.map(c=>{
    const visits=sales.filter(o=>o.customer?.id===c.id).sort((a,b)=>businessTime(a.date)-businessTime(b.date));
    const historyDays=visits.length?Math.max(1,(now-businessTime(visits[0].date))/DAY):0;
    const recency=visits.length?Math.floor((now-businessTime(visits[visits.length-1].date))/DAY):Number.isFinite(businessTime(c.lastVisit))?Math.floor((now-businessTime(c.lastVisit))/DAY):0;
    const gaps=visits.slice(1).map((o,i)=>(businessTime(o.date)-businessTime(visits[i].date))/DAY).filter(g=>g>0);
    const cycle=gaps.length>=3?Math.max(1,median(gaps)):defaultCycle;
    const value=sum(visits,o=>n(o.total));
    const count=new Map<string,number>(); for(const o of visits) for(const i of o.items) count.set(i.name,(count.get(i.name)||0)+i.quantity);
    let segment: CustomerValue['segment']=visits.length<=1?'NEW':visits.length>=5?'LOYAL':'POTENTIAL';
    if(visits.length>=10&&recency<=cycle) segment='CHAMPION';
    if(visits.length>=2&&recency>cycle*2) segment='AT_RISK';
    if(visits.length>=2&&recency>cycle*3) segment='HIBERNATING';
    if(visits.length>=2&&recency>cycle*5) segment='LOST';
    return {id:c.id,name:c.name,orders:visits.length,revenue:round(value),avgBasket:visits.length?round(value/visits.length):0,recencyDays:recency,
      expectedCycleDays:round(cycle),segment,historyDays:Math.floor(historyDays),favourite:[...count].sort((a,b)=>b[1]-a[1])[0]?.[0]||null,
      // Explicit observed-rate scenario, not a probabilistic lifetime model.
      projected12m:historyDays>=90&&visits.length>=5?round(value/historyDays*365):null};
  }).sort((a,b)=>b.revenue-a.revenue);
  const offers=basketOffers(recent,s.products);
  const anomalies: BusinessBrain['anomalies']=[];
  const prior=valid.filter(o=>businessDate(o.date)>=addDate(today,-60)&&businessDate(o.date)<addDate(today,-30));
  const allRecent=valid.filter(o=>businessDate(o.date)>=addDate(today,-30)&&businessDate(o.date)<today);
  for(const [label,predicate] of [['Void',(o:Order)=>o.status==='VOID'],['Refund',(o:Order)=>o.paymentStatus==='REFUNDED']] as const) {
    const count=allRecent.filter(predicate).length; const rate=allRecent.length?count/allRecent.length:0;
    const priorRate=prior.length?prior.filter(predicate).length/prior.length:0;
    if(allRecent.length>=20&&prior.length>=20&&count>=3&&rate>priorRate*2&&rate-priorRate>0.03) anomalies.push({id:label,title:`Lonjakan ${label.toLowerCase()} perlu ditinjau`,evidence:`${count}/${allRecent.length} transaksi (${round(rate*100)}%) vs ${round(priorRate*100)}% periode pembanding. Bukan tuduhan fraud.`,severity:'REVIEW'});
  }
  const highDiscount=allRecent.filter(o=>o.subtotal>0&&o.discountTotal/o.subtotal>=0.3);
  if(highDiscount.length>=3) anomalies.push({id:'discount',title:'Diskon besar berulang',evidence:`${highDiscount.length} transaksi memakai diskon minimal 30%. Periksa otorisasi dan tujuan promo.`,severity:'REVIEW'});
  const shifts=s.shifts.filter(sh=>sh.endTime&&Number.isFinite(businessTime(sh.endTime))&&businessTime(sh.endTime)<=now&&businessTime(sh.startTime)>=dayStart(addDate(today,-30)));
  const timed=shifts.map(sh=>({sh,hours:(businessTime(sh.endTime!)-businessTime(sh.startTime))/3_600_000})).filter(x=>x.hours>0&&x.hours<=24);
  const staffedHours=sum(timed,x=>x.hours); const served=sum(timed,x=>closed.filter(o=>o.shiftId===x.sh.id).length);
  const productivity=timed.length>=5&&staffedHours>0?served/staffedHours:null;
  const peak=[...Array(24)].map((_,hour)=>({hour,count:recent.filter(o=>businessHour(o.date)===hour).length})).sort((a,b)=>b.count-a.count)[0];
  const variances=timed.filter(x=>Math.abs(n(x.sh.difference))>10000);
  if(variances.length>=3) anomalies.push({id:'cash',title:'Selisih kas berulang',evidence:`${variances.length} shift memiliki selisih kas di atas Rp10.000. Verifikasi uang awal, kembalian dan rekonsiliasi; bukan tuduhan.`,severity:'REVIEW'});
  const occupied=s.tables.filter(t=>['OCCUPIED','BILLING'].includes(t.status)).length;
  const sector: BusinessBrain['sector']={title:`Intelligence ${s.businessSector}`,metrics:[],missing:[]};
  if(s.businessSector==='FNB') {sector.metrics=[{label:'Produk dengan resep',value:String(s.products.filter(p=>p.recipeIngredients?.length).length)},{label:'Meja terisi saat ini',value:`${occupied}/${s.tables.length}`}];sector.missing=['Durasi stockout dan food waste memerlukan pencatatan kejadian.'];}
  if(s.businessSector==='RETAIL') {sector.metrics=[{label:'SKU tanpa penjualan 30 hari',value:String(menu.filter(p=>p.quantity===0).length)}];sector.missing=['Kecepatan penjualan belum membedakan hari toko tutup.'];}
  if(s.businessSector==='LAUNDRY') {const pending=valid.filter(o=>o.status!=='VOID'&&o.laundryStage&&o.laundryStage!=='SELESAI');sector.metrics=[{label:'Pekerjaan belum selesai',value:String(pending.length)},{label:'Lewat estimasi valid',value:String(pending.filter(o=>o.completionEstimate&&Number.isFinite(businessTime(o.completionEstimate))&&businessTime(o.completionEstimate)<now).length)}];sector.missing=['Perkiraan selesai berupa teks bebas tidak dihitung sebagai tanggal.'];}
  if(s.businessSector==='CARWASH'||s.businessSector==='BARBERSHOP') {sector.metrics=[{label:s.businessSector==='CARWASH'?'Bay terisi saat ini':'Kursi terisi saat ini',value:`${occupied}/${s.tables.length}`}];sector.missing=['Prediksi waktu antre membutuhkan timestamp mulai dan selesai layanan.'];}
  const actions: BrainAction[]=[];
  if(procurement.length) actions.push({id:'procurement',kind:'PROCUREMENT',title:'Tinjau draft pembelian 7 hari',reason:`${procurement.length} bahan/produk membutuhkan tambahan berdasarkan batas atas perkiraan.`,draft:procurement.map(p=>`${p.name}: ${p.suggestedQty} ${p.unit}; estimasi biaya ${p.estimatedCost===null?'belum ada HPP':p.estimatedCost}`).join('\n')+'\nSupplier, MOQ, jadwal kedatangan dan pesanan masuk perlu dikonfirmasi. Belum dikirim.',metric:'stockCritical'});
  const risk=customers.filter(c=>c.segment==='AT_RISK');
  if(risk.length) actions.push({id:'crm',kind:'CRM',title:`Draft comeback untuk ${risk.length} pelanggan`,reason:`Pendapatan historis teramati ${round(sum(risk,c=>c.revenue))}; bukan estimasi uang yang pasti hilang.`,draft:`Audiens (ID): ${risk.map(c=>c.id).join(', ')}\nPesan: Halo, sudah lama tidak bertemu! Yuk mampir lagi untuk menikmati pilihan favoritmu.\nPeriksa persetujuan pemasaran dan promo sebelum mengirim.`,metric:'orders'});
  const leak=menu.find(m=>m.currentMarginPct!==null&&m.targetMarginPct&&m.currentMarginPct<m.targetMarginPct);
  if(leak) actions.push({id:`price:${leak.productId}`,kind:'PRICING',title:`Simulasikan harga ${leak.name}`,reason:`Margin saat ini ${leak.currentMarginPct}% di bawah target ${leak.targetMarginPct}%.`,draft:'Gunakan simulasi harga. Harga katalog tidak diubah otomatis; elastisitas permintaan belum diketahui.',metric:'revenue'});
  if(offers.length) {const o=offers[0];const a=s.products.find(p=>p.id===o.aId)!,b=s.products.find(p=>p.id===o.bId)!;const ca=currentCost(a),cb=currentCost(b);const normal=a.price+b.price;const proposed=Math.round(normal*0.95);const margin=ca!==null&&cb!==null?(proposed-ca-cb)/proposed*100:null;
    if(margin!==null&&margin>=Math.max(a.targetMarginPercent||30,b.targetMarginPercent||30))actions.push({id:'promo',kind:'PROMO',title:`Simulasi bundle ${a.name} + ${b.name}`,reason:`Terbeli bersama ${o.count} kali; lift ${o.lift}. Uplift belum terbukti.`,draft:`Harga normal ${normal}; simulasi diskon 5%: ${proposed}. Margin kontribusi estimasi ${round(margin)}%. Tidak otomatis membuat diskon.`,metric:'revenue'});
  }
  if(productivity&&peak.count)actions.push({id:'workforce',kind:'WORKFORCE',title:'Tinjau kapasitas jam ramai',reason:`Jam ${peak.hour}:00 paling ramai; kapasitas berasal dari ${timed.length} shift kasir lengkap.`,draft:'Periksa jadwal dan jenis pekerjaan bersama supervisor. Data shift kasir bukan total jam kerja seluruh kru; belum dapat menetapkan jumlah pegawai optimal.',metric:'orders'});
  for(const a of anomalies) actions.push({id:`review:${a.id}`,kind:'REVIEW',title:a.title,reason:a.evidence,draft:'Tinjau struk dan rekonsiliasi bersama penanggung jawab. Catat hasil pemeriksaan; jangan menyimpulkan pelanggaran dari flag statistik saja.',metric:'revenue'});
  if(!enough)limitations.push('Pembanding omzet membutuhkan minimal empat hari sejenis sebelumnya.');
  if(source==='CLIENT')limitations.push('Data perangkat ini; kelengkapan sinkronisasi dan terminal lain belum diverifikasi.');
  limitations.push('Proyeksi nilai pelanggan 12 bulan adalah skenario laju historis, bukan CLV bersih atau prediksi retensi terkalibrasi.');
  return {version:BRAIN_VERSION,businessId:s.businessId,generatedAt:s.generatedAt,source,period:{from:addDate(today,-30),to:yesterday},limitations:[...new Set(limitations)],
    sales:{date:yesterday,revenue:round(revenue),orders:yesterdayOrders.length,basket:round(basket),baselineDays:k,baselineRevenue:round(baseRevenue),revenueChangePct:enough?change(revenue,baseRevenue):null,
      transactionEffect:transactionEffect===null?null:round(transactionEffect),basketEffect:basketEffect===null?null:round(basketEffect),hours,channels,mtdRevenue:round(mtd),projectedMonthEnd:projected,monthlyTarget:target,
      dailyNeeded:target?round(Math.max(0,target-mtd)/(monthDays-completedDays)):null},demand,procurement,menu,customers,offers,anomalies,
    workforce:{completedShifts:timed.length,excludedShifts:s.shifts.length-timed.length,ordersPerHour:productivity===null?null:round(productivity),peakHour:peak.count?peak.hour:null,suggestedStaff:null},sector,actions};
}

function basketOffers(orders: Order[], products: Product[]): BusinessBrain['offers'] {
  const baskets=orders.map(o=>new Set(o.items.map(i=>i.productId))); const offers: BusinessBrain['offers']=[];
  if(baskets.length>=20) {
    const counts=new Map<string,number>(); const pairs=new Map<string,[string,string,number]>();
    for(const basket of baskets) {const ids=[...basket].sort(); for(const id of ids)counts.set(id,(counts.get(id)||0)+1);
      for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const key=JSON.stringify([ids[i],ids[j]]);const old=pairs.get(key);pairs.set(key,[ids[i],ids[j],(old?.[2]||0)+1]);}}
    for(const [left,right,count] of pairs.values()) for(const [aId,bId] of [[left,right],[right,left]]) {
      const confidence=count/counts.get(aId)!; const support=count/baskets.length; const lift=confidence/(counts.get(bId)!/baskets.length);
      const a=products.find(p=>p.id===aId),b=products.find(p=>p.id===bId);
      if(a&&b&&b.isAvailable&&b.stock>0&&count>=5&&support>=0.05&&confidence>=0.2&&lift>1.05) offers.push({aId,bId,aName:a.name,bName:b.name,count,confidence:round(confidence,4),support:round(support,4),lift:round(lift)});
    }
  }
  offers.sort((a,b)=>b.lift-a.lift||b.count-a.count);
  return offers;
}

/** POS hot path: no forecasts, CRM scans, or staffing calculations. */
export function recentBasketOffers(s: MerchantSnapshot) {
  const now=businessTime(s.generatedAt), today=businessDate(now), from=addDate(today,-30);
  return basketOffers(s.orders.filter(o=>paid(o)&&businessTime(o.date)<=now&&businessDate(o.date)>=from&&businessDate(o.date)<today),s.products);
}

export function nextBestOffers(brain: Pick<BusinessBrain,'offers'>, cart: Pick<CartItem,'productId'>[], products: Product[]) {
  const ids=new Set(cart.map(i=>i.productId)); const result=new Map<string,BusinessBrain['offers'][number]>();
  for(const offer of brain.offers) if(ids.has(offer.aId)&&!ids.has(offer.bId)&&products.some(p=>p.id===offer.bId&&p.isAvailable&&p.stock>0)) {
    if(!result.has(offer.bId))result.set(offer.bId,offer);
  }
  return [...result.values()].slice(0,3);
}
