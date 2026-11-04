import type { Db } from "../../../services/shared/db";
import { inWorkspace, GROWTH_WORKSPACE as W } from "./db";
/** Automatic TTL applies only to minimized analytics/transport records. Business
 * rows and CRM contacts are never deleted. Due contacts require owner review. */
export async function maintainRetention(source: Db, target: Db) {
  const removed = await inWorkspace(target, async (c) => {
    const r = await c.query(
      `DELETE FROM growth.events WHERE workspace_id=$1 AND ((lead_id IS NULL AND received_at<now()-interval '30 days') OR (lead_id IS NOT NULL AND received_at<now()-interval '180 days')) RETURNING id`,
      [W],
    );
    await c.query(
      `UPDATE growth.link_invites SET token_hash='expired:'||id::text,subject_ref=NULL,tenant_ref=NULL,revoked_at=coalesce(revoked_at,now()) WHERE workspace_id=$1 AND approved_at IS NULL AND expires_at<now()-interval '30 days'`,
      [W],
    );
    return r.rowCount;
  });
  const delivered = await source.query(
    "DELETE FROM growth_source.outbox WHERE delivered_at<now()-interval '30 days' RETURNING id",
  );
  return {
    expiredAnalytics: removed,
    expiredTransport: delivered.rowCount,
    contactsDeleted: 0,
    businessRecordsDeleted: 0,
  };
}
