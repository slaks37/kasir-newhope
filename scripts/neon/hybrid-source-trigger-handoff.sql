-- PREPARED ONLY. Run on SOURCE only within an explicitly approved cutover
-- after writer freeze and final consistent DB/auth-metadata checkpoint.
-- Never execute this file as a staging migration.
-- Caller must set a real approved window reference; no baked-in approval.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$BEGIN
 IF coalesce(current_setting('newhope.approved_cutover_window',true),'')='' THEN
  RAISE EXCEPTION 'EXPLICIT_SOURCE_CUTOVER_WINDOW_REQUIRED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
   AND tgname='provision_verified_auth_business' AND tgenabled='O') THEN
  RAISE EXCEPTION 'SOURCE_SIGNUP_TRIGGER_STATE_REVIEW_REQUIRED';
 END IF;
END$$;
-- Auth continues verifying users/passwords/MFA; business provisioning moves to
-- the verified-source-UUID Neon endpoint after final watermark/inventory review.
ALTER TABLE auth.users DISABLE TRIGGER provision_verified_auth_business;
COMMIT;
-- Rollback BEFORE Neon business writes/new signup provisioning: restore the old
-- deployment/env and ENABLE this trigger within the approved freeze.
-- AFTER Neon writes/new verified signups: first reconcile every new business
-- UUID/owner/membership/credit/subscription into the chosen source, then enable.
-- Never replay email verification or customer passwords to create business rows.
