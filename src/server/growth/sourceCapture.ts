import type { Db } from "../../../services/shared/db";
import { growthEnabled } from "./db";
/** Feature read observation; awaited only on a report endpoint, never a POS sale.
 * A DB error is not acknowledged as captured. One fact per owner/tenant/WIB day. */
export async function recordReportAdoption(
  db: Db,
  subject: string,
  tenant: string,
) {
  if (!growthEnabled() || process.env.GROWTH_CAPTURE_ENABLED !== "1") return;
  await db.query(
    `INSERT INTO growth_source.outbox(id,source_id,tenant_ref,subject_ref,kind,payload,data_class)
 SELECT md5(c.source_id::text||$1||$2||'report:'||(now() AT TIME ZONE 'Asia/Jakarta')::date::text)::uuid,c.source_id,t.id,$1::text::uuid,'signal','{"signal":"report_viewed"}'::jsonb,c.data_class FROM growth_source.config c JOIN internal.tenants t ON t.id=$2::uuid AND t.owner_user_ref=$1::text WHERE c.enabled AND t.is_active AND t.merged_into IS NULL ON CONFLICT(id) DO NOTHING`,
    [subject, tenant],
  );
}
