import type {Db} from '../shared/db';
import {hasSchemaFeature} from '../shared/schemaFeatures';

export async function ownerOnboardingStaffStatus(db:Db,subject:string) {
  if(!await hasSchemaFeature(db,'posOwnerOnboardingGuard'))return null;
  const {rows}=await db.query<{staffOnly:boolean;hasStaffAssignment:boolean}>(`SELECT
    internal.is_staff_only_identity($1) AS "staffOnly",
    internal.has_active_staff_assignment($1) AS "hasStaffAssignment"`,[subject]);
  return rows[0];
}
