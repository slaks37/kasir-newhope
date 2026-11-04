import { randomBytes } from "node:crypto";
import type { Db } from "../../../services/shared/db";
import { GROWTH_WORKSPACE as W } from "./db";
import { sourceDb } from "./sourceDb";
import {
  drainOutbox,
  hash,
  ownedTenant,
  linkedLifecycle,
  productMetrics,
} from "./integration";
import { audit, fail, findLead, uuid } from "./service";
type Register = (
  method: "get" | "post" | "patch" | "put",
  path: string,
  fn: (r: any, c: Db) => Promise<any>,
  write?: boolean,
  superOnly?: boolean,
) => void;
export function registerProductRoutes(route: Register, getSource = sourceDb) {
  route("get", "/integration", async (_r, c) => ({
    integration: await productMetrics(c),
  }));
  // Drain outside the CRM transaction: different pools can point at the same DB.
  // Registered by the caller via a separate middleware, not this route helper.
  route(
    "post",
    "/leads/:id/link-invites",
    async (r, c) => {
      const l = await findLead(c, uuid(r.params.id));
      if (l.opted_out_at || l.anonymized_at) fail("CONTACT_RESTRICTED", 409);
      const token = randomBytes(32).toString("base64url");
      const invite = (
        await c.query(
          "INSERT INTO growth.link_invites(workspace_id,lead_id,token_hash,created_by) VALUES($1,$2,$3,$4) RETURNING id,expires_at",
          [W, l.id, hash(token), r.internal.id],
        )
      ).rows[0];
      return { invite, token, shareManually: true };
    },
    true,
    true,
  );
  route(
    "get",
    "/identity-links",
    async (_r, c) => ({
      links: (
        await c.query(
          "SELECT id,lead_id,subject_ref,tenant_ref,claimed_at,approved_at,revoked_at,expires_at,consent_version FROM growth.link_invites WHERE workspace_id=$1 ORDER BY expires_at DESC LIMIT 100",
          [W],
        )
      ).rows,
    }),
    false,
    true,
  );
  route(
    "post",
    "/identity-links/:id/approve",
    async (r, c) => {
      const link = (
        await c.query(
          "SELECT * FROM growth.link_invites WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [W, uuid(r.params.id)],
        )
      ).rows[0];
      if (
        !link?.claimed_at ||
        link.approved_at ||
        link.revoked_at ||
        new Date(link.expires_at) < new Date()
      )
        fail("CLAIM_REVIEW_REQUIRED", 409);
      if (
        r.body.confirmSubject !== link.subject_ref ||
        r.body.confirmTenant !== link.tenant_ref
      )
        fail("EXACT_OWNERSHIP_CONFIRMATION_REQUIRED");
      await ownedTenant(await getSource(), link.subject_ref, link.tenant_ref);
      const lead = await findLead(c, link.lead_id);
      if (lead.opted_out_at || lead.anonymized_at)
        fail("CONTACT_RESTRICTED", 409);
      await c.query(
        "UPDATE growth.link_invites SET approved_at=now(),approved_by=$3 WHERE workspace_id=$1 AND id=$2",
        [W, link.id, r.internal.id],
      );
      await c.query(
        "UPDATE growth.events SET lead_id=$2 WHERE workspace_id=$1 AND subject_ref=$3 AND (tenant_ref=$4 OR (tenant_ref IS NULL AND signal='signup')) AND lead_id IS NULL AND verified AND source_event_id IS NOT NULL",
        [W, link.lead_id, link.subject_ref, link.tenant_ref],
      );
      await audit(c, r.internal.id, "IDENTITY_LINK_APPROVED", link.id);
      return {
        linked: true,
        identityMerged: false,
        merchantAccessChanged: false,
      };
    },
    true,
    true,
  );
  route(
    "post",
    "/identity-links/:id/revoke",
    async (r, c) => {
      await c.query(
        "UPDATE growth.link_invites SET revoked_at=now() WHERE workspace_id=$1 AND id=$2",
        [W, uuid(r.params.id)],
      );
      return { revoked: true };
    },
    true,
    true,
  );
  route("get", "/leads/:id/lifecycle", async (r, c) => ({
    lifecycle: await linkedLifecycle(c, uuid(r.params.id)),
  }));
  route("get", "/retention", async (_r, c) => ({
    policy: {
      contactDays: 180,
      unlinkedEventDays: 30,
      linkedEventDays: 180,
      requiresReview: true,
      financialRecordsDeleted: false,
    },
    due: (
      await c.query(
        "SELECT id,company,retention_until,opted_out_at FROM growth.leads WHERE workspace_id=$1 AND anonymized_at IS NULL AND retention_until<now() ORDER BY retention_until LIMIT 100",
        [W],
      )
    ).rows,
  }));
  route(
    "post",
    "/leads/:id/anonymize",
    async (r, c) => {
      const id = uuid(r.params.id);
      const l = await findLead(c, id);
      if (
        r.body.confirm !== true ||
        (!l.opted_out_at && new Date(l.retention_until ?? 0) > new Date())
      )
        fail("RETENTION_REVIEW_REQUIRED", 409);
      await c.query(
        "UPDATE growth.leads SET company='Kontak dianonimkan',contact_name='',email=NULL,phone=NULL,city='',tools='',challenges='',consent_email=false,consent_whatsapp=false,consent_ai=false,consent_basis='',next_followup=NULL,opted_out_at=coalesce(opted_out_at,now()),anonymized_at=now(),updated_at=now(),version=version+1 WHERE workspace_id=$1 AND id=$2",
        [W, id],
      );
      await c.query(
        "UPDATE growth.activities SET body='Dihapus sesuai kebijakan retensi' WHERE workspace_id=$1 AND lead_id=$2",
        [W, id],
      );
      await c.query(
        "UPDATE growth.recommendations SET document='{}'::jsonb WHERE workspace_id=$1 AND lead_id=$2",
        [W, id],
      );
      await c.query(
        "UPDATE growth.identity_reviews SET evidence='Dihapus sesuai kebijakan retensi' WHERE workspace_id=$1 AND lead_id=$2",
        [W, id],
      );
      await c.query(
        "UPDATE growth.link_invites SET revoked_at=now(),subject_ref=NULL,tenant_ref=NULL WHERE workspace_id=$1 AND lead_id=$2",
        [W, id],
      );
      await c.query(
        "UPDATE growth.events SET subject_ref=NULL,tenant_ref=NULL WHERE workspace_id=$1 AND lead_id=$2",
        [W, id],
      );
      await audit(c, r.internal.id, "CONTACT_ANONYMIZED", id);
      return { anonymized: true, businessDataChanged: false };
    },
    true,
    true,
  );
}
export { drainOutbox };
