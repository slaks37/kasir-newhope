import { BUSINESS_PRESETS } from '../../data/businessPresets';
import { belongsToBusiness } from '../../context/TenantContext';
import { MerchantSnapshot, SnapshotInput } from './types';

/**
 * Adapter that turns whatever the app currently holds (POS context state in the
 * browser, or SQL query results in a Node cron job) into the single data shape
 * every assistant layer reads.
 *
 * This is also the LAST LINE OF DEFENCE for tenant isolation. The caller is
 * expected to pass data already scoped to the business unit, but shared
 * collections (the staff roster) are partitioned by a field rather than by a
 * storage key, so they are re-filtered here. A leak at this point would feed
 * another business's data straight into the AI prompt.
 */
export function buildSnapshot(input: SnapshotInput): MerchantSnapshot {
  const sector = input.settings.businessSector || 'FNB';
  const preset = BUSINESS_PRESETS[sector] || BUSINESS_PRESETS.FNB;
  const tenantRef = { businessId: input.businessId, sector };

  return {
    businessId: input.businessId,
    merchantId: input.merchantId,
    tenantId: input.tenantId || input.merchantId,
    userRole: input.userRole,
    generatedAt: (input.now || new Date()).toISOString(),
    businessSector: sector,
    storeName: input.settings.storeName,
    slotNoun: preset.layoutTerm?.itemNoun || 'Meja',

    categories: input.categories,
    products: input.products,
    stockItems: input.stockItems,
    inventoryLogs: input.inventoryLogs,
    orders: input.orders,
    customers: input.customers,
    tables: input.tables,
    // Shared collection — partitioned by field, so verify rather than trust.
    staff: input.staff.filter((s) => belongsToBusiness(s, tenantRef)),
    attendance: input.attendance,
    shifts: input.shifts,
    currentShift: input.currentShift,
    promoCodes: input.promoCodes,
    settings: input.settings,
  };
}
