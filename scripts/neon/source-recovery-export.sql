-- Read-only, one PostgreSQL statement: catalog and all rows share one MVCC snapshot.
-- Replace the public-key token below with the RSA OpenPGP PUBLIC key only. Never pass private
-- keys or customer plaintext through MCP. Every customer-bearing result is encrypted.
-- This reviewed catalog exporter supports ordinary non-partitioned application
-- tables, enums, sequences, functions, views, indexes, constraints, RLS/policies,
-- triggers and schema ACL evidence. Unsupported types/partitioning fail restore.
WITH scope AS (
 SELECT array_agg(nspname::text ORDER BY nspname) names FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema','pgbouncer')
), relations AS MATERIALIZED (
 SELECT c.*,n.nspname schema FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=ANY((SELECT names FROM scope)::text[]) AND c.relkind IN('r','p','v','m','S')
), table_export AS MATERIALIZED (
 SELECT r.schema,r.relname name,r.relkind kind,r.relispartition partitioned_child,
 r.relrowsecurity rls,r.relforcerowsecurity force_rls,r.reloptions,
 (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
 'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
 'default',pg_get_expr(d.adbin,d.adrelid),
 'collation',CASE WHEN a.attcollation<>t.typcollation THEN quote_ident(cn.nspname)||'.'||quote_ident(co.collname) ELSE NULL END)
 ORDER BY a.attnum) FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
 WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT data::jsonb FROM XMLTABLE('/row' PASSING query_to_xml(
 format('SELECT COALESCE(jsonb_agg(to_jsonb(t)::text),''[]''::jsonb)::text data FROM %I.%I t',r.schema,r.relname),false,true,'')
 COLUMNS data text PATH 'data')) rows
 FROM relations r WHERE r.relkind IN('r','p') ORDER BY r.schema,r.relname
), payload AS MATERIALIZED (
 SELECT jsonb_build_object(
 'format','newhope-pg-recovery-v1','dataPolicy','owner-approved private full logical recovery archive; all visible non-system schema rows include authentication credentials; encrypted on source before transfer','redactedColumns','[]'::jsonb,'redactedNestedPaths','[]'::jsonb,'omittedTables','[]'::jsonb,'sourceProject','fqxrhumsgigcgjtlbfuo',
 'capturedAt',statement_timestamp(),'snapshot',pg_current_snapshot()::text,
 'postgresVersion',current_setting('server_version'),'schemas',(SELECT names FROM scope),
 'schemaAcl',(SELECT jsonb_agg(jsonb_build_object('schema',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text)) FROM pg_namespace WHERE nspname=ANY((SELECT names FROM scope)::text[])),
 'tables',(SELECT jsonb_agg(to_jsonb(t)) FROM table_export t),
 'enums',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY((SELECT names FROM scope)::text[]) AND t.typtype='e'),
 'unsupported',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype)) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY((SELECT names FROM scope)::text[]) AND t.typtype IN('d','r','m') OR n.nspname=ANY((SELECT names FROM scope)::text[]) AND t.typtype='c' AND t.typrelid NOT IN(SELECT oid FROM relations)),
 'inheritance',(SELECT jsonb_agg(jsonb_build_object('child',i.inhrelid::regclass::text,'parent',i.inhparent::regclass::text)) FROM pg_inherits i WHERE i.inhrelid IN(SELECT oid FROM relations)),
 'sequences',(SELECT jsonb_agg(jsonb_build_object('schema',r.schema,'name',r.relname,'type',format_type(s.seqtypid,NULL),'start',s.seqstart::text,'increment',s.seqincrement::text,'min',s.seqmin::text,'max',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle,
 'state',(SELECT state::jsonb FROM XMLTABLE('/row' PASSING query_to_xml(format('SELECT jsonb_build_object(''lastValue'',last_value::text,''isCalled'',is_called)::text state FROM %I.%I',r.schema,r.relname),false,true,'') COLUMNS state text PATH 'state')),
 'ownerColumn',(SELECT jsonb_build_object('schema',nc.nspname,'table',ct.relname,'column',a.attname,'dependencyType',d.deptype) FROM pg_depend d JOIN pg_class ct ON ct.oid=d.refobjid JOIN pg_namespace nc ON nc.oid=ct.relnamespace JOIN pg_attribute a ON a.attrelid=ct.oid AND a.attnum=d.refobjsubid WHERE d.classid='pg_class'::regclass AND d.objid=r.oid AND d.deptype IN('a','i') LIMIT 1))) FROM relations r JOIN pg_sequence s ON s.seqrelid=r.oid WHERE r.relkind='S'),
 'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'securityDefiner',p.prosecdef,'acl',p.proacl::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY((SELECT names FROM scope)::text[]) AND p.prokind IN('f','p') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')),
 'views',(SELECT jsonb_agg(jsonb_build_object('schema',r.schema,'name',r.relname,'kind',r.relkind,'definition',pg_get_viewdef(r.oid,true),'options',r.reloptions)) FROM relations r WHERE r.relkind IN('v','m')),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('schema',r.schema,'table',r.relname,'name',c.conname,'type',c.contype,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid,true))) FROM pg_constraint c JOIN relations r ON r.oid=c.conrelid),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('schema',r.schema,'table',r.relname,'name',ci.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid)) FROM pg_index i JOIN relations r ON r.oid=i.indrelid JOIN pg_class ci ON ci.oid=i.indexrelid WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('schema',r.schema,'table',r.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true))) FROM pg_trigger t JOIN relations r ON r.oid=t.tgrelid WHERE NOT t.tgisinternal),
 'policies',(SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'withCheck',with_check)) FROM pg_policies WHERE schemaname=ANY((SELECT names FROM scope)::text[])),
 'acl',(SELECT jsonb_agg(jsonb_build_object('schema',r.schema,'name',r.relname,'kind',r.relkind,'owner',pg_get_userbyid(r.relowner),'acl',r.relacl::text)) FROM relations r),
 'defaultAcl',(SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'kind',d.defaclobjtype,'acl',d.defaclacl::text)) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace),
 'authMetadata',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id::text,'email',email,'email_confirmed_at',email_confirmed_at,'banned_until',banned_until,'deleted_at',deleted_at,'is_sso_user',is_sso_user,'created_at',created_at,'name',coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name')) ORDER BY id),'[]'::jsonb) FROM auth.users),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname)) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace)
 ) document
), bounded AS (
 SELECT CASE WHEN octet_length(document::text)<=12000000 THEN document ELSE NULL END document FROM payload
)
SELECT 'newhope-pg-recovery-v1' format,
 CASE WHEN document IS NULL THEN 'SNAPSHOT_EXCEEDS_12MB_BOUND' ELSE 'ENCRYPTED' END status,
 octet_length(document::text) plaintext_bytes,
 encode(extensions.pgp_pub_encrypt(document::text,extensions.dearmor('__PUBLIC_KEY__'),'cipher-algo=aes256,compress-algo=1'),'base64') ciphertext
FROM bounded;
