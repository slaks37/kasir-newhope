export const FREE_PLAN_ID = 'plan-free-lifetime';
export const FREE_PRODUCT_LIMIT = 10;
export interface FreeSelection { productIds: string[]; branchId: string; sector: string }
export function isFreePlan(sub: {status: string; planId?: string; currentPeriodEnd: string;isActive?:boolean} | undefined, now = Date.now()): boolean {
  if (!sub || sub.isActive===false || ['SUSPENDED', 'CANCELED', 'CANCELLED'].includes(sub.status)) return false;
  if (sub.status === 'FREE' || sub.planId === FREE_PLAN_ID) return true;
  const trial = ['TRIAL', 'TRIALING'].includes(sub.status) || (sub.planId === 'plan-free' && ['EXPIRED', 'PAST_DUE'].includes(sub.status));
  const end = Date.parse(sub.currentPeriodEnd);
  return trial && Number.isFinite(end) && now >= end;
}
export function validateFreeSelection(value: unknown): FreeSelection {
  const v = value as Partial<FreeSelection> | null;
  const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 160;
  if (!v || !Array.isArray(v.productIds) || v.productIds.length > FREE_PRODUCT_LIMIT ||
    !v.productIds.every(validId) || new Set(v.productIds).size !== v.productIds.length || !validId(v.branchId) ||
    !['FNB','RETAIL','LAUNDRY','BARBERSHOP','CARWASH'].includes(v.sector || '')) throw new Error('INVALID_FREE_SELECTION');
  return { productIds: [...v.productIds], branchId: v.branchId, sector: v.sector! };
}
export function freeProductAllowed(selection: FreeSelection | undefined, productId: string, sector: string) {
  return !!selection && selection.sector === sector && selection.productIds.includes(productId);
}
