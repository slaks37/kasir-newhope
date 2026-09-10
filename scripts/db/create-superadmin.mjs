// Disabled: the legacy script embedded credentials and silently escalated roles.
// Provisioning requires an explicitly approved account and verified auth subject.
// No database connection or credential changes are performed by this script.
throw new Error('Legacy superadmin provisioning disabled. Ask an authorized operator to bind an approved Supabase user subject to internal.internal_users.sso_subject; never assign roles from browser metadata.');
