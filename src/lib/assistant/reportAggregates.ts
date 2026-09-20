import type { IntentEntities, MerchantSnapshot } from './types';
import { computeAggregates } from './insights';
import { businessDate, businessTime, reportWindow, dayStart, DAY } from './periods';

/** Shared browser/server report. Historical HPP is not today's catalog cost. */
export function reportAggregates(snapshot: MerchantSnapshot, entities: IntentEntities = {}) {
  const now=businessTime(snapshot.generatedAt); const win=reportWindow(entities.period||'LAST_30',now,entities);
  const scoped=snapshot.orders.filter(o=>businessTime(o.date)>=win.start&&businessTime(o.date)<=win.end&&(o.status!=='COMPLETED'||o.paymentStatus==='PAID'));
  const earliest=scoped.length?Math.min(...scoped.map(o=>businessTime(o.date))):win.end;
  const windowDays=win.days||Math.max(1,Math.floor((dayStart(businessDate(win.end))-dayStart(businessDate(earliest)))/DAY)+1);
  const a=computeAggregates({...snapshot,orders:scoped},{now:new Date(win.end),windowDays});
  const paid=scoped.filter(o=>o.status==='COMPLETED'&&o.paymentStatus==='PAID');
  let netSales=0,cogs=0,knownQty=0,totalQty=0;
  for(const o of paid){
    netSales+=Math.max(0,o.subtotal-o.discountTotal);
    for(const i of o.items){totalQty+=i.quantity;if(Number.isFinite(i.unitCost)&&i.unitCost!>0){knownQty+=i.quantity;cogs+=i.unitCost!*i.quantity;}}
  }
  const today=dayStart(businessDate(now));
  const todayOrders=snapshot.orders.filter(o=>o.status==='COMPLETED'&&o.paymentStatus==='PAID'&&businessTime(o.date)>=today&&businessTime(o.date)<=now);
  const monthStart=dayStart(businessDate(now).slice(0,8)+'01');
  a.mtdRevenue=snapshot.orders.filter(o=>o.status==='COMPLETED'&&o.paymentStatus==='PAID'&&businessTime(o.date)>=monthStart&&businessTime(o.date)<=now).reduce((n,o)=>n+o.total,0);
  a.ordersToday=todayOrders.length;a.revenueToday=todayOrders.reduce((n,o)=>n+o.total,0);
  a.reportPeriod={startDate:win.startDate,endDate:win.endDate,label:win.label};
  a.netSales=netSales;a.cogs=cogs;a.costCoveragePct=totalQty?knownQty/totalQty*100:0;
  a.grossMarginPct=netSales>0&&a.costCoveragePct===100?(netSales-cogs)/netSales*100:0;
  return a;
}
