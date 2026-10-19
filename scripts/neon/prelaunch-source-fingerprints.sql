-- READ ONLY single MVCC statement. Digests/counts only; no row data or secrets.
WITH relations AS MATERIALIZED (
 SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=ANY(ARRAY['public','pos','internal','billing','ai','contract','mcp_private','blog_mcp_private']) AND c.relkind='r'
)
SELECT jsonb_build_object('format','newhope-prelaunch-source-fingerprints-v1','sourceProject','fqxrhumsgigcgjtlbfuo','capturedAt',statement_timestamp(),'sourceFrozen',false,
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',schema,'name',name,'fingerprint',
 (SELECT value::jsonb FROM XMLTABLE('/row' PASSING query_to_xml(format($q$SELECT jsonb_build_object('rows',count(*),'sha256',encode(extensions.digest(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'sha256'),'hex'))::text value FROM %I.%I t$q$,schema,name),false,true,'') COLUMNS value text PATH 'value'))) ORDER BY schema,name) FROM relations)) checkpoint;
