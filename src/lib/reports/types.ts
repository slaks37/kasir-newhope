import type { CashMovement, Order } from '../../types';

/** Financial amounts are calculated by the server from the canonical ledger. */
export interface FinancialSummary {
  totalOrders: number;
  totalGrossSales: number;
  totalDiscount: number;
  totalTax: number;
  totalServiceCharge: number;
  totalNetRevenue: number;
  totalRefunds: number;
  totalCOGS: number;
  grossProfit: number;
  netProfitMargin: number;
  avgOrderValue: number;
}

export interface CashSummary {
  initialCash: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expenseBahan: number;
  expenseOperasional: number;
  expenseKasbon: number;
  expectedCashInDrawer: number;
}

export interface TodayMetrics {
  totalOrders: number;
  todayGrossSales: number;
  todayDiscount: number;
  todayTax: number;
  todayNetRevenue: number;
  todayCashSales: number;
  todayQrisSales: number;
  todayCardSales: number;
  todayEWalletSales: number;
  todayCashIn: number;
  todayCashOut: number;
  todayExpenseBahan: number;
  todayExpenseOperasional: number;
  todayExpenseKasbon: number;
  initialCash: number;
  expectedCashInDrawer: number;
  avgOrderValue: number;
}

export interface ReportScope {
  tenantId: string;
  merchantId: string;
  outletId: string;
  sector: string;
  timezone: string;
  /** Inclusive local calendar dates; null means unbounded. */
  from: string | null;
  to: string | null;
}

export interface ServerReportSummary {
  overview: {
    grossSales:number;discountTotal:number;taxTotal:number;serviceChargeTotal:number;netRevenue:number;totalCOGS:number;
    grossProfit:number;netProfitMargin:number;averageOrderValue:number;itemsSold:number;cashSales:number;cashCount:number;
    cashPercent:number;cashlessSales:number;cashlessCount:number;cashlessPercent:number;orderCount:number;
    sortedMethods:Array<{key:string;name:string;count:number;total:number;percentage:number}>;
    mostUsedMethod:{key:string;name:string;count:number;total:number;percentage:number}|null;
  };
  ok: true;
  source: 'server';
  generatedAt: string;
  scope: ReportScope;
  financialSummary: FinancialSummary;
  todayMetrics: TodayMetrics;
  paymentBreakdown: Record<string, number>;
  topProductsBarData: Array<{ name: string; productId:string; qty: number; revenue: number; profit:number }>;
  areaChartData: Array<{ time: string; Omset: number }>;
  dailySales: Array<{ date: string; revenue: number; orders: number; profit:number }>;
  statusCounts: Record<string, number>;
  cashSummary: CashSummary;
  cashMovements: CashMovement[];
  cashMovementsTruncated: boolean;
}

export interface ServerTransaction extends Order {
  recognizedCOGS: number | null;
  serverId: string;
  clientTxnId: string | null;
  serverOrderStatus: string;
  /** Total after refunds from the canonical revenue view; null if not revenue. */
  recognizedRevenue: number | null;
  syncedAt: string;
}

export interface ServerTransactionsResponse {
  ok: true;
  source: 'server';
  generatedAt: string;
  scope: ReportScope;
  transactions: ServerTransaction[];
  /** Opaque keyset cursor. Fetch until null to obtain all matching transactions. */
  nextCursor: string | null;
}
