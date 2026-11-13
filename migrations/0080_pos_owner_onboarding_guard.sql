-- Reuse the existing membership probes without granting their role or table access.
DO $$ BEGIN
  IF to_regrole('svc_pos') IS NOT NULL
    AND to_regprocedure('internal.is_staff_only_identity(text)') IS NOT NULL
    AND to_regprocedure('internal.has_active_staff_assignment(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION internal.is_staff_only_identity(text),
      internal.has_active_staff_assignment(text) TO svc_pos;
  END IF;
END $$;
