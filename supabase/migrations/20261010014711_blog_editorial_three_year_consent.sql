-- Owner explicitly authorized a three-year editorial grant on 2026-10-10.
-- Applies to new grants only; existing grants and role/security checks are unchanged.
ALTER TABLE blog_mcp_private.connections
  ALTER COLUMN expires_at SET DEFAULT now()+interval '3 years';
