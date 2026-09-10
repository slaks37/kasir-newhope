import type { StoreBranch } from '../../types';

export function mergeServerOutlets(local: StoreBranch[], rows: any[]): StoreBranch[] {
  const remote = rows.map((row): StoreBranch => ({
    ...local.find(branch => branch.id === row.id),
    id: row.id, name: row.name, address: row.address || '',
    latitude: Number(row.latitude), longitude: Number(row.longitude),
    allowedRadiusMeters: Number(row.radius_meters),
    businessSector: row.business_sector, isActive: row.is_active,
  }));
  const ids = new Set(remote.map(branch => branch.id));
  // Replace only the untouched starter card; preserve customized offline drafts.
  const drafts = local.filter(branch => !ids.has(branch.id) && !(rows.length &&
    branch.id === 'branch-main' && branch.name === 'Cabang Utama' && !branch.address &&
    branch.latitude === -6.2088 && branch.longitude === 106.8456 &&
    branch.allowedRadiusMeters === 200 && branch.businessSector === 'FNB' &&
    branch.isActive && (!branch.notes || branch.notes === 'Cabang Utama')));
  return [...remote, ...drafts];
}
