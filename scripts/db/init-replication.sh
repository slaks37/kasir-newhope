#!/bin/bash
# Runs once, on first boot of the primary. Creates the replication role and the
# read-only analytics role Metabase will use.
#
# The two are deliberately different identities:
#   replicator   streams WAL. No table access.
#   bi_readonly  SELECTs the BI views on the replica. Cannot write anywhere.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD:-change-me-in-env}';

    -- bi_readonly is created without LOGIN by migrations/0004 so the schema is
    -- self-contained. Give it a password here so Metabase can actually connect.
    DO \$\$ BEGIN
        CREATE ROLE bi_readonly NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;

    ALTER ROLE bi_readonly WITH LOGIN PASSWORD '${BI_PASSWORD:-change-me-in-env}';

    -- Belt and braces: even on the primary, this role can only read.
    ALTER ROLE bi_readonly SET default_transaction_read_only = on;
EOSQL

cat >> "$PGDATA/pg_hba.conf" <<-EOHBA
	host replication replicator 0.0.0.0/0 md5
EOHBA

echo "replication + bi_readonly roles created"
