import type { Db } from '../shared/db';
import { assertAiAvailable } from '../ai/entitlement';

export const MCP_SCOPE = 'pos:read';
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const page = { type: 'integer', minimum: 0, maximum: 10000, default: 0 };
export const mcpTools = [
  { name: 'business_info', description: 'Read the business explicitly approved by the owner for this connection.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_products', description: 'Read a page of product names, prices and stock. Data is synchronized POS data, not necessarily live device stock.', inputSchema: { type: 'object', properties: { offset: page }, additionalProperties: false } },
  { name: 'low_stock', description: 'Read products at or below their stock alert threshold. Paginated; no customer or staff data.', inputSchema: { type: 'object', properties: { offset: page }, additionalProperties: false } },
  { name: 'sales_summary', description: 'Sum completed, paid sales for a UTC interval (end exclusive, maximum 93 days). Includes taxes and service charges. Not profit or net settlement.', inputSchema: { type: 'object', properties: { start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' } }, required: ['start', 'end'], additionalProperties: false } },
  { name: 'list_transactions', description: 'Read a page of transaction IDs, dates, totals and statuses in a UTC interval (maximum 93 days). No customer details, cashier names or payment credentials.', inputSchema: { type: 'object', properties: { start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' }, offset: page }, required: ['start', 'end'], additionalProperties: false } },
].map(tool => ({ ...tool, annotations, securitySchemes: [{ type: 'oauth2', scopes: [MCP_SCOPE] }] }));

export function validateArguments(name: string, args: unknown): Record<string, any> {
  const tool = mcpTools.find(t => t.name === name);
  if (!tool || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('INVALID_TOOL_ARGUMENTS');
  const a = args as Record<string, any>;
  if (Object.keys(a).some(k => !(k in tool.inputSchema.properties))) throw new Error('INVALID_TOOL_ARGUMENTS');
  if (a.offset !== undefined && (!Number.isInteger(a.offset) || a.offset < 0 || a.offset > 10000)) throw new Error('INVALID_TOOL_ARGUMENTS');
  if (name === 'sales_summary' || name === 'list_transactions') {
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
    if (typeof a.start !== 'string' || typeof a.end !== 'string' || !iso.test(a.start) || !iso.test(a.end)) throw new Error('INVALID_DATE_RANGE');
    const start = Date.parse(a.start), end = Date.parse(a.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 93 * 86400000) throw new Error('INVALID_DATE_RANGE');
  }
  return a;
}

/** Revalidate current ownership and plan on EVERY call, including after refresh. */
export async function authorizedBusiness(db: Db, subject: string, businessId: string) {
  const business = (await db.query(`SELECT m.id,m.tenant_id,m.external_ref AS business_id,m.name,m.business_sector
    FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
    WHERE m.external_ref=$1 AND t.owner_user_ref=$2 AND m.is_active=true`, [businessId, subject])).rows[0];
  if (!business) throw new Error('BUSINESS_ACCESS_DENIED');
  await assertAiAvailable(db, business.tenant_id);
  return business;
}

export async function runMcpTool(db: Db, subject: string, businessId: string, name: string, args: unknown) {
  const a = validateArguments(name, args);
  const b = await authorizedBusiness(db, subject, businessId);
  const base = { business: b.name, business_id: businessId, source: 'synchronized_pos_database', retrieved_at: new Date().toISOString() };
  if (name === 'business_info') return { ...base, sector: b.business_sector, currency: 'IDR' };
  if (name === 'sales_summary') {
    const row = (await db.query(`SELECT count(*)::int AS paid_completed_transactions,COALESCE(sum(total_amount),0) AS gross_collected_idr
      FROM contract.transaction_log WHERE merchant_id=$1 AND created_at >= $2 AND created_at < $3
      AND payment_status='PAID' AND order_status='COMPLETED'`, [b.id, a.start, a.end])).rows[0];
    return { ...base, start: a.start, end_exclusive: a.end, ...row, definition: 'Completed paid order totals including tax/service; not profit, refunds-adjusted revenue, or settlement.' };
  }
  const offset = a.offset || 0;
  const rows = name === 'list_transactions'
    ? (await db.query(`SELECT id,created_at,total_amount,payment_status,order_status FROM contract.transaction_log
        WHERE merchant_id=$1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at DESC,id LIMIT 51 OFFSET $4`, [b.id, a.start, a.end, offset])).rows
    : (await db.query(`SELECT c.id,c.sku,c.name,c.price,
        CASE WHEN inventory.known THEN c.stock ELSE NULL END AS stock,
        CASE WHEN inventory.known THEN c.min_stock_alert ELSE NULL END AS min_stock_alert,
        c.unit,c.is_available,inventory.known AS stock_known
        FROM contract.intelligence_catalog c JOIN pos.products p ON p.id=c.id AND p.merchant_id=c.merchant_id
        CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM pos.inventory_balances b
          WHERE b.inventory_item_id=p.inventory_item_id AND b.merchant_id=c.merchant_id) AS known) inventory
        WHERE c.merchant_id=$1 ${name === 'low_stock' ? 'AND inventory.known AND c.stock <= c.min_stock_alert AND c.is_available=true' : ''}
        ORDER BY c.id LIMIT 51 OFFSET $2`, [b.id, offset])).rows;
  return { ...base, items: rows.slice(0, 50), next_offset: rows.length > 50 && offset < 10000 ? Math.min(offset + 50, 10000) : null,
    truncated_by_safety_limit: rows.length > 50 && offset >= 10000 };
}
