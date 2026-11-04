import type { Express } from "express";
import type { Db } from "../../../services/shared/db";
import { authenticateBearer } from "../../../services/shared/auth";
import {
  growthEnabled,
  growthDb,
  inWorkspace,
  GROWTH_WORKSPACE as W,
} from "./db";
import { hash, ownedTenant, CONSENT_VERSION } from "./integration";
import { uuid, fail, GrowthError } from "./service";
export function registerGrowthMerchantRoutes(
  app: Express,
  business: Db,
  authenticate = authenticateBearer,
  getTarget = growthDb,
) {
  for (const action of ["session", "claim", "withdraw"] as const)
    app.post("/api/v1/sync/growth/" + action, async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (!growthEnabled())
        return res.status(404).json({ ok: false, error: "GROWTH_DISABLED" });
      try {
        // Verify Supabase directly, never accept a client-supplied subject/tenant mapping.
        const principal = await authenticate(req);
        if (!principal || !principal.isEmailVerified)
          throw new GrowthError(401, "VERIFIED_AUTH_REQUIRED");
        if (action === "session") {
          if (process.env.GROWTH_CAPTURE_ENABLED !== "1")
            return res.json({ ok: true, skipped: true });
          if (
            !principal.authCreatedAt ||
            !Number.isFinite(Date.parse(principal.authCreatedAt))
          )
            fail("AUTH_SIGNUP_DATE_REQUIRED");
          await business.query(
            `INSERT INTO growth_source.outbox(id,source_id,tenant_ref,subject_ref,kind,payload,data_class,occurred_at)
      SELECT md5('signup:'||c.source_id::text||$1)::uuid,c.source_id,NULL,$1::text::uuid,'signal',jsonb_build_object('signal','signup'),c.data_class,$2::timestamptz FROM growth_source.config c WHERE c.enabled ON CONFLICT(id) DO NOTHING`,
            [principal.subject, principal.authCreatedAt],
          );
          return res.json({ ok: true, recorded: true });
        }
        if (
          !principal.reauthenticatedAt ||
          Date.now() / 1000 - principal.reauthenticatedAt > 600
        )
          fail("REAUTH_REQUIRED", 403);
        const target = await getTarget();
        if (action === "withdraw") {
          await inWorkspace(target, async (c) => {
            await c.query(
              `UPDATE growth.leads SET consent_email=false,consent_whatsapp=false,consent_ai=false,opted_out_at=now(),updated_at=now(),version=version+1 WHERE workspace_id=$1 AND id IN(SELECT lead_id FROM growth.link_invites WHERE workspace_id=$1 AND subject_ref=$2 AND revoked_at IS NULL)`,
              [W, principal.subject],
            );
            await c.query(
              "UPDATE growth.link_invites SET revoked_at=now() WHERE workspace_id=$1 AND subject_ref=$2 AND revoked_at IS NULL",
              [W, principal.subject],
            );
            await c.query(
              "INSERT INTO growth.audit(workspace_id,actor_id,action) VALUES($1,$2,'SUBJECT_WITHDREW_GROWTH_CONSENT')",
              [W, principal.subject],
            );
          });
          return res.json({ ok: true, withdrawn: true });
        }
        const tenant = uuid(req.body.tenantId);
        await ownedTenant(business, principal.subject, tenant);
        if (
          req.body.consentVersion !== CONSENT_VERSION ||
          req.body.consent !== true
        )
          fail("EXPLICIT_ANALYTICS_CONSENT_REQUIRED");
        if (
          typeof req.body.token !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(req.body.token)
        )
          fail("INVALID_INVITE");
        await inWorkspace(target, async (c) => {
          const r = await c.query(
            `UPDATE growth.link_invites i SET claimed_at=now(),subject_ref=$3,tenant_ref=$4,consent_version=$5 WHERE workspace_id=$1 AND token_hash=$2 AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at>now() AND EXISTS(SELECT 1 FROM growth.leads l WHERE l.workspace_id=i.workspace_id AND l.id=i.lead_id AND l.opted_out_at IS NULL AND l.anonymized_at IS NULL) RETURNING id`,
            [
              W,
              hash(req.body.token),
              principal.subject,
              tenant,
              CONSENT_VERSION,
            ],
          );
          if (!r.rowCount) fail("INVITE_EXPIRED_OR_USED", 409);
          await c.query(
            "INSERT INTO growth.audit(workspace_id,actor_id,action,target_id) VALUES($1,$2,'SUBJECT_CONFIRMED_LINK',$3)",
            [W, principal.subject, r.rows[0].id],
          );
        });
        res.json({ ok: true, status: "AWAITING_SUPERADMIN_REVIEW" });
      } catch (e) {
        res.status(e instanceof GrowthError ? e.status : 503).json({
          ok: false,
          error:
            e instanceof GrowthError
              ? e.code
              : "GROWTH_INTEGRATION_UNAVAILABLE",
        });
      }
    });
}
