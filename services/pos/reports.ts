import type { Express, Request } from 'express';
import type { Db } from '../shared/db';
import { trustedPrincipal } from '../shared/auth';
import { SECTORS } from './activity';
import type { CashMovement, Order, PaymentMethod, PaymentStatus } from '../../src/types';
import type { CashSummary, FinancialSummary, ReportScope, ServerReportSummary, ServerTransaction } from '../../src/lib/reports/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENT_METHODS = new Set(['CASH','QRIS','QRIS_DYNAMIC','QRIS_STATIC','DEBIT','CREDIT','DEBIT_CARD','CREDIT_CARD','CARD','TRANSFER','E_WALLET','EWALLET','OTHER','SHOPEEPAY','GOPAY','OVO','DANA','SPLIT']);
const numeric = (value: unknown): number => Number(value ?? 0);
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const iso = (value: unknown): string => new Date(String(value)).toISOString();

export class ReportRequestError extends Error {
  constructor(readonly status: number, code: string) { super(code); }
}

interface ReportFilter {
  outletId: string;
  merchantId: string | null;
  tenantId: string | null;
  sector: string | null;
  from: string | null;
  to: string | null;
  timezone: string;
  timezoneExplicit?: boolean;
  paymentMethod: string | null;
  search: string | null;
}

function stringQuery(value: unknown, name: string): string | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new ReportRequestError(400, `INVALID_${name}`);
  return value.trim() || null;
}

function dateQuery(value: unknown, name: string): string | null {
  const date = stringQuery(value, name);
  if (!date) return null;
  if (!DATE.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new ReportRequestError(400, `INVALID_${name}`);
  }
  return date;
}

export function parseReportFilter(query: Request['query']): ReportFilter {
  const outletId = stringQuery(query.outletId, 'OUTLET_ID');
  if (!outletId || !UUID.test(outletId)) throw new ReportRequestError(400, 'INVALID_OUTLET_ID');
  const merchantId = stringQuery(query.merchantId, 'MERCHANT_ID');
  const tenantId = stringQuery(query.tenantId, 'TENANT_ID');
  if ((merchantId && !UUID.test(merchantId)) || (tenantId && !UUID.test(tenantId))) throw new ReportRequestError(400, 'INVALID_SCOPE');
  const sector = stringQuery(query.sector, 'SECTOR');
  if (sector && !(SECTORS as readonly string[]).includes(sector)) throw new ReportRequestError(400, 'INVALID_SECTOR');
  const from = dateQuery(query.from, 'FROM_DATE');
  const to = dateQuery(query.to, 'TO_DATE');
  if (from && to && from > to) throw new ReportRequestError(400, 'INVALID_DATE_RANGE');
  const requestedZone = stringQuery(query.timezone, 'TIMEZONE') || 'Asia/Jakarta';
  let timezone: string;
  try {
    // IANA names only: offset strings accepted by newer runtimes are not Postgres zones.
    if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(requestedZone) || requestedZone.length > 100) throw new Error();
    timezone = new Intl.DateTimeFormat('en', { timeZone: requestedZone }).resolvedOptions().timeZone;
  } catch { throw new ReportRequestError(400, 'INVALID_TIMEZONE'); }
  const paymentMethod = stringQuery(query.paymentMethod, 'PAYMENT_METHOD');
  if (paymentMethod && paymentMethod !== 'ALL' && !PAYMENT_METHODS.has(paymentMethod)) throw new ReportRequestError(400, 'INVALID_PAYMENT_METHOD');
  const search = stringQuery(query.search, 'SEARCH');
  if (search && search.length > 120) throw new ReportRequestError(400, 'SEARCH_TOO_LONG');
  return { outletId, merchantId, tenantId, sector, from, to, timezone, timezoneExplicit:Boolean(query.timezone),
    paymentMethod: paymentMethod === 'ALL' ? null : paymentMethod, search };
}

async function scopeFor(db: Db, subject: string, filter: ReportFilter): Promise<ReportScope> {
  // The browser selects a branch; ownership and both parent IDs are resolved in SQL.
  // Historical reports remain readable after a branch is deactivated.
  const { rows } = await db.query(`SELECT o.tenant_id,o.merchant_id,o.id AS outlet_id,m.business_sector,ms.timezone
    FROM internal.outlets o
    JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    JOIN internal.tenants t ON t.id=o.tenant_id
    LEFT JOIN internal.merchant_settings ms ON ms.merchant_id=m.id
    WHERE o.id=$1 AND t.owner_user_ref=$2
      AND ($3::uuid IS NULL OR m.id=$3) AND ($4::uuid IS NULL OR t.id=$4)
      AND ($5::text IS NULL OR m.business_sector=$5)`,
  [filter.outletId, subject, filter.merchantId, filter.tenantId, filter.sector]);
  if (!rows.length) throw new ReportRequestError(403, 'REPORT_SCOPE_FORBIDDEN');
  const row = rows[0];
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [row.tenant_id, row.merchant_id]);
  return { tenantId: row.tenant_id, merchantId: row.merchant_id, outletId: row.outlet_id,
    sector: row.business_sector, from: filter.from, to: filter.to, timezone: filter.timezoneExplicit?filter.timezone:row.timezone||'Asia/Jakarta' };
}

function parameters(scope: ReportScope, filter: ReportFilter) {
  return [scope.tenantId, scope.merchantId, scope.outletId, filter.from, filter.to,
    filter.timezone, filter.paymentMethod, filter.search];
}

/** Keep the timestamp bare so tenant/outlet/time indexes remain usable. */
const inPeriod = (alias: string, column = 'created_at') => `
  ${alias}.tenant_id=$1 AND ${alias}.merchant_id=$2 AND ${alias}.outlet_id=$3
  AND ($4::date IS NULL OR ${alias}.${column} >= ($4::date::timestamp AT TIME ZONE $6))
  AND ($5::date IS NULL OR ${alias}.${column} < (($5::date + 1)::timestamp AT TIME ZONE $6))`;

const transactionFilters = (alias: string) => `
  AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM pos.payments fp
    WHERE fp.transaction_id=${alias}.id AND fp.tenant_id=$1 AND fp.merchant_id=$2
      AND fp.payment_method=$7 AND fp.payment_status IN ('PAID','SETTLED','REFUNDED')))
  AND ($8::text IS NULL OR POSITION(lower($8) IN lower(COALESCE(${alias}.invoice_number,'')))>0
    OR EXISTS (SELECT 1 FROM pos.users fu WHERE fu.id=${alias}.cashier_user_id
      AND fu.tenant_id=$1 AND POSITION(lower($8) IN lower(fu.name))>0))`;

// Pos.transactions supplies identity/search fields, never a competing revenue formula.
const revenueCTE = `WITH revenue AS (
  SELECT r.*,x.cashier_user_id
  FROM contract.merchant_revenue r
  JOIN pos.transactions x ON x.id=r.id AND x.tenant_id=r.tenant_id AND x.merchant_id=r.merchant_id
  WHERE ${inPeriod('r')} ${transactionFilters('x')}
)`;

function financial(row: any): FinancialSummary {
  const totalNetRevenue = numeric(row.net_revenue);
  const totalCOGS = numeric(row.cogs);
  const totalTax = numeric(row.tax);
  const totalOrders = numeric(row.orders);
  const grossProfit = money(totalNetRevenue - totalTax - totalCOGS);
  return { totalOrders, totalGrossSales: numeric(row.gross_sales), totalDiscount: numeric(row.discount),
    totalTax, totalServiceCharge: numeric(row.service), totalNetRevenue,
    totalRefunds: numeric(row.refunds), totalCOGS, grossProfit,
    netProfitMargin: totalNetRevenue ? money(grossProfit / totalNetRevenue * 100) : 0,
    avgOrderValue: totalOrders ? money(totalNetRevenue / totalOrders) : 0 };
}

async function revenueSummary(db: Db, params: unknown[]): Promise<FinancialSummary> {
  const { rows } = await db.query(`${revenueCTE}
    SELECT count(*)::int AS orders,COALESCE(sum(r.subtotal-COALESCE(f.subtotal,0)),0) AS gross_sales,
      COALESCE(sum(r.discount_amount-COALESCE(f.discount,0)),0) AS discount,COALESCE(sum(r.tax_amount-COALESCE(f.tax,0)),0) AS tax,
      COALESCE(sum(r.service_charge_amount-COALESCE(f.service,0)),0) AS service,COALESCE(sum(r.total_amount),0) AS net_revenue,
      COALESCE(sum(r.refund_amount),0) AS refunds,COALESCE(sum(r.cogs_amount),0) AS cogs
    FROM revenue r LEFT JOIN LATERAL(SELECT SUM(subtotal_amount) AS subtotal,SUM(discount_amount) AS discount,
      SUM(tax_amount) AS tax,SUM(service_amount) AS service FROM pos.transaction_refunds WHERE transaction_id=r.id) f ON true`, params);
  return financial(rows[0]);
}

async function cashSummary(db: Db, params: unknown[]): Promise<CashSummary> {
  const { rows } = await db.query(`SELECT
    COALESCE(sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='OPENING' OR c.category='MODAL_AWAL'),0) AS initial_cash,
    COALESCE(sum(c.amount) FILTER (WHERE c.event_type IN ('SALE','VOID')),0) AS cash_sales,
    COALESCE(-sum(c.amount) FILTER (WHERE c.event_type='REFUND'),0) AS cash_refunds,
    COALESCE(sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_IN'),0) AS cash_in,
    COALESCE(-sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT'),0) AS cash_out,
    COALESCE(-sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT' AND c.category='BELANJA_BAHAN'),0) AS bahan,
    COALESCE(-sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT' AND c.category='OPERASIONAL'),0) AS operasional,
    COALESCE(-sum(c.amount) FILTER (WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT' AND c.category='KASBON'),0) AS kasbon,
    COALESCE(sum(c.amount),0) AS balance
    FROM pos.cash_ledger c LEFT JOIN pos.cash_ledger original ON c.event_type='REVERSAL' AND c.reference_id=original.id::text AND c.tenant_id=original.tenant_id
    WHERE ${inPeriod('c','occurred_at')}`, params.slice(0,6));
  const row = rows[0];
  return { initialCash: numeric(row.initial_cash), cashSales: numeric(row.cash_sales),
    cashRefunds: numeric(row.cash_refunds), cashIn: numeric(row.cash_in), cashOut: numeric(row.cash_out),
    expenseBahan: numeric(row.bahan), expenseOperasional: numeric(row.operasional),
    expenseKasbon: numeric(row.kasbon), expectedCashInDrawer: numeric(row.balance) };
}

async function paymentBreakdown(db: Db, params: unknown[]): Promise<Record<string, number>> {
  // Allocate recognized net revenue across the actual settled tenders. A split
  // payment contributes once to revenue, even when several successful rows exist.
  const { rows } = await db.query(`${revenueCTE}, tenders AS (
    SELECT r.id,r.total_amount,p.payment_method,p.amount,
      sum(p.amount) OVER (PARTITION BY r.id) AS tender_total
    FROM revenue r JOIN pos.payments p ON p.transaction_id=r.id AND p.tenant_id=r.tenant_id
      AND p.merchant_id=r.merchant_id AND p.payment_status IN ('PAID','SETTLED')
  ) SELECT payment_method,COALESCE(sum(total_amount * amount / NULLIF(tender_total,0)),0) AS amount
    FROM tenders GROUP BY payment_method ORDER BY payment_method`, params);
  return Object.fromEntries(rows.map(row => [row.payment_method, money(numeric(row.amount))]));
}

function localDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function cashMovement(row: any): CashMovement {
  return { id:row.client_event_id || row.id, type:numeric(row.amount) < 0 ? 'CASH_OUT' : 'CASH_IN',
    category:row.category || (row.event_type==='OPENING'?'MODAL_AWAL':numeric(row.amount)<0?'PENGELUARAN_LAIN':'PENDAPATAN_LAIN'),
    amount:Math.abs(numeric(row.amount)), description:row.note || row.event_type,
    timestamp:iso(row.occurred_at), cashierName:row.actor_name || row.actor_ref || 'Kasir',
    shiftId:row.shift_ref || undefined,recipientOrSource:row.recipient_or_source || undefined };
}

export async function serverReportSummary(db: Db, subject: string, filter: ReportFilter): Promise<ServerReportSummary> {
  return db.tx(async c => {
    // One response must describe one committed financial snapshot.
    await c.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const scope = await scopeFor(c, subject, filter);
    filter={...filter,timezone:scope.timezone};
    const params = parameters(scope, filter);
    const today = localDate(filter.timezone);
    const todayParams = parameters(scope, { ...filter, from:today, to:today, paymentMethod:null, search:null });
    const financialSummary = await revenueSummary(c, params);
    const todayFinancial = await revenueSummary(c, todayParams);
    const cash = await cashSummary(c, params);
    const todayCash = await cashSummary(c, todayParams);
    const breakdown = await paymentBreakdown(c, params);
    const todayPayment = await paymentBreakdown(c, todayParams);
    const top = await c.query(`${revenueCTE} SELECT i.product_name AS name,MIN(COALESCE(p.external_ref,p.id::text)) AS product_id,
      sum(GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ri.qty,0),0)) AS qty,
      sum(GREATEST(i.total_price-COALESCE(ri.amount,0),0)) AS revenue,
      sum(GREATEST(i.total_price-COALESCE(ri.amount,0),0)-i.unit_cost*GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ri.qty,0),0)) AS profit
      FROM revenue r JOIN pos.transaction_items i ON i.transaction_id=r.id AND i.tenant_id=r.tenant_id
      LEFT JOIN pos.products p ON p.id=i.product_id AND p.tenant_id=i.tenant_id
      LEFT JOIN LATERAL (SELECT sum(ri.quantity) AS qty,sum(ri.amount) AS amount
        FROM pos.transaction_refund_items ri JOIN pos.transaction_refunds rf ON rf.id=ri.refund_id
        WHERE ri.transaction_item_id=i.id AND rf.tenant_id=$1 AND rf.merchant_id=$2) ri ON TRUE
      GROUP BY i.product_name ORDER BY qty DESC,i.product_name LIMIT 5`, params);
    const daily = await c.query(`${revenueCTE} SELECT to_char(created_at AT TIME ZONE $6,'YYYY-MM-DD') AS date,
      sum(total_amount) AS revenue,SUM(total_amount-net_tax_amount-cogs_amount) AS profit,count(*)::int AS orders FROM revenue GROUP BY 1 ORDER BY 1`, params);
    const hourly = await c.query(`${revenueCTE} SELECT extract(hour FROM created_at AT TIME ZONE $6)::int AS hour,
      sum(total_amount) AS revenue FROM revenue GROUP BY 1 ORDER BY 1`, params);
    const statuses = await c.query(`SELECT x.order_status,count(*)::int AS n FROM pos.transactions x
      WHERE ${inPeriod('x')} ${transactionFilters('x')} GROUP BY x.order_status`, params);
    const movements = await c.query(`SELECT * FROM pos.cash_ledger c WHERE ${inPeriod('c','occurred_at')}
      AND event_type IN ('CASH_IN','CASH_OUT','OPENING')
      AND NOT EXISTS(SELECT 1 FROM pos.cash_ledger rev WHERE rev.reference_id=c.id::text AND rev.tenant_id=c.tenant_id AND rev.event_type='REVERSAL')
      ORDER BY occurred_at DESC,id DESC LIMIT 1001`, params.slice(0,6));
    const counts=await c.query(`${revenueCTE} SELECT p.payment_method,COUNT(DISTINCT r.id)::int AS count
      FROM revenue r JOIN pos.payments p ON p.transaction_id=r.id AND p.payment_status IN('PAID','SETTLED') GROUP BY p.payment_method`,params);
    const itemCount=(await c.query(`${revenueCTE} SELECT COALESCE(SUM(GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ret.qty,0),0)),0) AS qty
      FROM revenue r JOIN pos.transaction_items i ON i.transaction_id=r.id
      LEFT JOIN LATERAL(SELECT SUM(quantity) AS qty FROM pos.transaction_refund_items WHERE transaction_item_id=i.id) ret ON true`,params)).rows[0];
    const sortedMethods=Object.entries(breakdown).map(([key,total])=>({key,name:key,count:numeric(counts.rows.find(row=>row.payment_method===key)?.count),total,percentage:financialSummary.totalNetRevenue?money(total/financialSummary.totalNetRevenue*100):0})).sort((a,b)=>b.total-a.total);
    const cashSales=breakdown.CASH||0,cashCount=numeric(counts.rows.find(row=>row.payment_method==='CASH')?.count);
    const sumMethods = (methods: string[]) => methods.reduce((sum,method)=>sum+(todayPayment[method]||0),0);
    const todayQrisSales = sumMethods(['QRIS','QRIS_DYNAMIC','QRIS_STATIC']);
    const todayCardSales = sumMethods(['CARD','DEBIT','CREDIT','DEBIT_CARD','CREDIT_CARD']);
    const todayCashSales = todayPayment.CASH || 0;
    return { ok:true,source:'server',generatedAt:new Date().toISOString(),scope,financialSummary,
      overview:{grossSales:financialSummary.totalGrossSales,discountTotal:financialSummary.totalDiscount,taxTotal:financialSummary.totalTax,
        serviceChargeTotal:financialSummary.totalServiceCharge,netRevenue:financialSummary.totalNetRevenue,totalCOGS:financialSummary.totalCOGS,
        grossProfit:financialSummary.grossProfit,netProfitMargin:financialSummary.netProfitMargin,averageOrderValue:financialSummary.avgOrderValue,
        itemsSold:numeric(itemCount.qty),cashSales,cashCount,cashPercent:financialSummary.totalNetRevenue?money(cashSales/financialSummary.totalNetRevenue*100):0,
        cashlessSales:money(financialSummary.totalNetRevenue-cashSales),cashlessCount:financialSummary.totalOrders-cashCount,
        cashlessPercent:financialSummary.totalNetRevenue?money((financialSummary.totalNetRevenue-cashSales)/financialSummary.totalNetRevenue*100):0,
        orderCount:financialSummary.totalOrders,sortedMethods,mostUsedMethod:sortedMethods[0]||null},
      todayMetrics:{totalOrders:todayFinancial.totalOrders,todayGrossSales:todayFinancial.totalGrossSales,
        todayDiscount:todayFinancial.totalDiscount,todayTax:todayFinancial.totalTax,todayNetRevenue:todayFinancial.totalNetRevenue,
        todayCashSales,todayQrisSales,todayCardSales,
        todayEWalletSales:money(todayFinancial.totalNetRevenue-todayCashSales-todayQrisSales-todayCardSales),
        todayCashIn:todayCash.cashIn,todayCashOut:todayCash.cashOut,todayExpenseBahan:todayCash.expenseBahan,
        todayExpenseOperasional:todayCash.expenseOperasional,todayExpenseKasbon:todayCash.expenseKasbon,
        initialCash:todayCash.initialCash,expectedCashInDrawer:todayCash.expectedCashInDrawer,avgOrderValue:todayFinancial.avgOrderValue},
      paymentBreakdown:breakdown,topProductsBarData:top.rows.map(row=>({name:row.name,productId:row.product_id,qty:numeric(row.qty),revenue:numeric(row.revenue),profit:numeric(row.profit)})),
      areaChartData:Array.from({length:24},(_,hour)=>({time:`${String(hour).padStart(2,'0')}:00`,
        Omset:numeric(hourly.rows.find(row=>numeric(row.hour)===hour)?.revenue)})),
      dailySales:daily.rows.map(row=>({date:row.date,revenue:numeric(row.revenue),orders:numeric(row.orders),profit:numeric(row.profit)})),
      statusCounts:Object.fromEntries(statuses.rows.map(row=>[row.order_status,numeric(row.n)])),
      cashSummary:cash,cashMovements:movements.rows.slice(0,1000).map(cashMovement),cashMovementsTruncated:movements.rows.length>1000 };
  });
}

interface Cursor { createdAt: string; id: string }
function cursorFor(value: unknown): Cursor | null {
  const raw = stringQuery(value,'CURSOR');
  if (!raw) return null;
  try {
    if (raw.length>300) throw new Error();
    const cursor=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
    if (!UUID.test(cursor.id) || typeof cursor.createdAt!=='string' || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
    return {createdAt:new Date(cursor.createdAt).toISOString(),id:cursor.id};
  } catch { throw new ReportRequestError(400,'INVALID_CURSOR'); }
}

export async function serverTransactions(db: Db, subject: string, filter: ReportFilter, cursor: Cursor | null, limit=100) {
  return db.tx(async c => {
    await c.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const scope=await scopeFor(c,subject,filter);
    filter={...filter,timezone:scope.timezone};
    const params=[...parameters(scope,filter),cursor?.createdAt||null,cursor?.id||null,limit+1];
    const {rows}=await c.query(`SELECT x.*,u.name AS cashier_name,r.total_amount AS recognized_revenue,r.cogs_amount AS recognized_cogs,
      COALESCE(r.refund_amount,rf.refund_amount,0) AS refund_total
      FROM pos.transactions x LEFT JOIN pos.users u ON u.id=x.cashier_user_id AND u.tenant_id=x.tenant_id
      LEFT JOIN contract.merchant_revenue r ON r.id=x.id AND r.tenant_id=x.tenant_id
      LEFT JOIN LATERAL (SELECT sum(amount) AS refund_amount FROM pos.transaction_refunds rf
        WHERE rf.transaction_id=x.id AND rf.tenant_id=x.tenant_id) rf ON TRUE
      WHERE ${inPeriod('x')} ${transactionFilters('x')}
        AND ($9::timestamptz IS NULL OR (x.created_at,x.id)<($9::timestamptz,$10::uuid))
      ORDER BY x.created_at DESC,x.id DESC LIMIT $11`,params);
    const page=rows.slice(0,limit);
    const items=page.length ? (await c.query(`SELECT i.*,COALESCE(i.quantity_exact,i.quantity) AS quantity,p.external_ref AS product_ref,
      COALESCE(ri.quantity,0) AS refunded_quantity FROM pos.transaction_items i
      LEFT JOIN pos.products p ON p.id=i.product_id AND p.tenant_id=i.tenant_id
      LEFT JOIN LATERAL (SELECT sum(ri.quantity) AS quantity FROM pos.transaction_refund_items ri
        JOIN pos.transaction_refunds rf ON rf.id=ri.refund_id
        WHERE ri.transaction_item_id=i.id AND rf.tenant_id=$1) ri ON TRUE
      WHERE i.tenant_id=$1 AND i.transaction_id=ANY($2::uuid[]) ORDER BY i.id`,[scope.tenantId,page.map(r=>r.id)])).rows : [];
    const tenders=page.length?(await c.query(`SELECT * FROM pos.payments WHERE tenant_id=$1 AND transaction_id=ANY($2::uuid[])
      AND client_payment_id IS NOT NULL AND payment_status IN('PAID','SETTLED') ORDER BY created_at,id`,[scope.tenantId,page.map(r=>r.id)])).rows:[];
    const transactions:ServerTransaction[]=page.map(row=>({
      id:row.client_txn_id || row.invoice_number || row.id,serverId:row.id,clientTxnId:row.client_txn_id || null,
      invoiceNumber:row.invoice_number,orderNumber:0,branchId:row.outlet_id,date:iso(row.created_at),orderType:row.order_type as Order['orderType'],
      subtotal:numeric(row.subtotal),discountTotal:numeric(row.discount_amount),taxTotal:numeric(row.tax_amount),
      serviceChargeTotal:numeric(row.service_charge_amount),total:numeric(row.total_amount),
      paymentMethod:row.payment_method as PaymentMethod,paymentStatus:(['VOIDED','CANCELLED'].includes(row.order_status)?'CANCELLED':row.recognized_revenue!==null?'PAID':'PENDING') as PaymentStatus,
      cashierName:row.cashier_name || 'Kasir',shiftId:row.client_shift_id || row.shift_id || '',
      ...(tenders.some(t=>t.transaction_id===row.id)?{paymentTenders:tenders.filter(t=>t.transaction_id===row.id).map(t=>({clientPaymentId:t.client_payment_id,method:t.payment_method as PaymentMethod,amount:numeric(t.amount),createdAt:iso(t.created_at)}))}:{}),
      status:['VOIDED','CANCELLED'].includes(row.order_status)?'VOID':['OPEN','PENDING_PAYMENT','IN_FULFILLMENT'].includes(row.order_status)?'HOLD':'COMPLETED',
      serverOrderStatus:row.order_status,refundTotal:numeric(row.refund_total),
      recognizedRevenue:row.recognized_revenue===null?null:numeric(row.recognized_revenue),recognizedCOGS:row.recognized_cogs===null?null:numeric(row.recognized_cogs),syncedAt:new Date().toISOString(),
      items:items.filter(i=>i.transaction_id===row.id).map(i=>({id:i.client_item_id || i.id,selectedModifiers:[],productId:i.product_ref || i.product_id,
        name:i.product_name,unitPrice:numeric(i.unit_price),unitCost:numeric(i.unit_cost),quantity:numeric(i.quantity),
        discountPercent:0,discountAmount:0,totalPrice:numeric(i.total_price),refundedQuantity:numeric(i.refunded_quantity)})),
    }));
    const last=page[page.length-1];
    return {ok:true as const,source:'server' as const,generatedAt:new Date().toISOString(),scope,transactions,
      nextCursor:rows.length>limit && last?Buffer.from(JSON.stringify({createdAt:iso(last.created_at),id:last.id})).toString('base64url'):null};
  });
}

export function registerReportRoutes(app: Express, db: Db) {
  for (const route of ['summary','transactions'] as const) app.get(`/api/v1/reports/${route}`,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const principal=trustedPrincipal(req);
    if (!principal || principal.subject==='local-development') return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
    try {
      const filter=parseReportFilter(req.query);
      if(route==='summary') return res.json(await serverReportSummary(db,principal.subject,filter));
      const rawLimit=stringQuery(req.query.limit,'LIMIT');
      const limit=rawLimit===null?100:Number(rawLimit);
      if(!Number.isInteger(limit)||limit<1||limit>500)throw new ReportRequestError(400,'INVALID_LIMIT');
      return res.json(await serverTransactions(db,principal.subject,filter,cursorFor(req.query.cursor),limit));
    } catch(error) {
      if(!(error instanceof ReportRequestError)){
        const diagnostic=error as {code?:string;constraint?:string;table?:string;column?:string};
        console.error('[reports] read failed',{route,code:diagnostic.code,constraint:diagnostic.constraint,table:diagnostic.table,column:diagnostic.column});
      }
      return res.status(error instanceof ReportRequestError?error.status:503).json({ok:false,
        error:error instanceof ReportRequestError?error.message:'REPORT_UNAVAILABLE'});
    }
  });
}
