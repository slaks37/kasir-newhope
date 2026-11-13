-- Module authorization reads explicit identity fields as svc_pos. No PIN,
-- payment credential, arbitrary user metadata or identity mutation privilege.
GRANT SELECT(id,is_active,full_name) ON internal.users TO svc_pos;
GRANT SELECT(id,user_id,tenant_id,merchant_id,outlet_id,scope_type,role,is_active) ON internal.memberships TO svc_pos;
GRANT SELECT(id,tenant_id,name,business_sector,external_ref,is_active,created_at,logo_url) ON internal.merchants TO svc_pos;
GRANT SELECT(id,tenant_id,merchant_id,name,address,is_active,latitude,longitude,radius_meters,created_at) ON internal.outlets TO svc_pos;
