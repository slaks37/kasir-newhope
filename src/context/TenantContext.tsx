import React, { createContext, useContext } from 'react';
import { BusinessSector, PermissionFeature, StoreMode, UserRole } from '../types';

/**
 * TENANT CONTEXT — the single authority on "which business am I looking at".
 *
 * A merchant account can run several businesses (a cafe, a laundry, a
 * barbershop). Each of those is a separate BUSINESS UNIT with its own catalog,
 * transactions, customers, staff roster and AI insights. Nothing may cross
 * between them.
 *
 * `canonicalBusinessId` is the server UUID used for selection. `businessId`
 * retains the server-declared transport/cache ref, including exact legacy
 * owner_sector aliases. New same-sector businesses have distinct refs; sector
 * is not an identity. Financial IDs and original recovery keys stay unchanged.
 */

export interface TenantInfo {
  /** PARTITION KEY. Every scoped storage read/write and the AI cache use this. */
  businessId: string;
  /** Server UUID is selection identity; businessId remains a durable transport
   * alias so existing financial IDs and recovery keys are not rekeyed. */
  canonicalBusinessId?:string;
  legacyAlias?:string|null;
  /** The owning account. Also the SaaS tenant id today. */
  merchantId: string;
  tenantId: string;

  sector: BusinessSector;
  businessName: string;
  storeMode: StoreMode;
  /** Sector-aware noun for a floor-plan slot: Meja / Bay / Rak / Kursi. */
  slotNoun: string;

  userId: string;
  userName: string;
  userRole: UserRole;
  /** Feature permissions granted to `userRole`. */
  permissions: PermissionFeature[];
}

/** Legacy alias only. Never use this to identify a newly created business. */
export function makeBusinessId(userId: string, sector: BusinessSector): string {
  const u = userId || 'usr-admin';
  const s = sector || 'FNB';
  return `${u}_${s}`;
}

/**
 * Storage key for data owned by ONE business unit.
 * Never build this string by hand anywhere else.
 */
export function partitionKey(businessId: string, entity: string): string {
  return `newhope_data_${businessId}_${entity}`;
}

/**
 * Storage key for data owned by the ACCOUNT rather than one business unit.
 * Only `settings` (it holds the active sector, so scoping it per sector would
 * be circular) and `staff_members` (one roster, partitioned by a field — see
 * `belongsToBusiness`) may use this.
 */
export function accountKey(userId: string, entity: string): string {
  return `newhope_user_${userId || 'usr-admin'}_${entity}`;
}

/**
 * Field-level partition check for SHARED collections — rows that live in one
 * account-level list but belong to a single business unit.
 *
 * Prefers an explicit `businessId` stamped on the record; falls back to the
 * record's `sector` so rows written before this partition existed still resolve
 * correctly instead of vanishing from every business.
 */
export function belongsToBusiness(
  record: { businessId?: string; sector?: BusinessSector | string } | null | undefined,
  tenant: Pick<TenantInfo, 'businessId' | 'sector'>
): boolean {
  if (!record) return false;
  if (record.businessId) return record.businessId === tenant.businessId;
  // Sector-only legacy membership is valid only in its proven owner_sector
  // namespace, never in a second same-sector business.
  return /_(FNB|LAUNDRY|RETAIL|CARWASH|BARBERSHOP)$/.test(tenant.businessId)&&
    ((record.sector as BusinessSector) || 'FNB') === tenant.sector;
}

/** Stamps the partition key onto a record belonging to a shared collection. */
export function stampBusiness<T extends object>(record: T, tenant: Pick<TenantInfo, 'businessId' | 'sector'>): T & {
  businessId: string;
  sector: BusinessSector;
} {
  return { ...record, businessId: tenant.businessId, sector: tenant.sector };
}

/**
 * Compact descriptor handed to the AI layer. Everything the model is told about
 * *whose* data it is looking at — and nothing that identifies a real person.
 */
export interface TenantAiContext {
  businessId: string;
  merchantId: string;
  businessName: string;
  businessSector: BusinessSector;
  slotNoun: string;
  userRole: UserRole;
}

export function toAiContext(tenant: TenantInfo): TenantAiContext {
  return {
    businessId: tenant.businessId,
    merchantId: tenant.merchantId,
    businessName: tenant.businessName,
    businessSector: tenant.sector,
    slotNoun: tenant.slotNoun,
    userRole: tenant.userRole,
  };
}

const TenantCtx = createContext<TenantInfo | undefined>(undefined);

export const TenantProvider: React.FC<{ value: TenantInfo; children: React.ReactNode }> = ({
  value,
  children,
}) => <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>;

export function useTenant(): TenantInfo {
  const ctx = useContext(TenantCtx);
  if (!ctx) throw new Error('useTenant must be used within a POSProvider');
  return ctx;
}

export { TenantCtx as TenantContext };
