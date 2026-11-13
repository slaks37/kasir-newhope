// Shared complete schema order. No connection, environment loading or fixture seed.
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
const ORDER=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql'];
const LEGACY_NAMESPACE='supabase/migrations/20261003040610_business_scoped_operational_state.sql';
const LEGACY_NAMESPACE_AFTER='0055_shared_state_versions.sql';
const SECURITY=['free-plan-selection.sql','free-plan-ai-credit-access.sql','restrict-browser-rls-policies.sql','intelligence-cache.sql','intelligence-wallet.sql'];
export function migrationFiles(root=process.cwd()) {
  const numbered = readdirSync(join(root,'migrations'))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f !== '0001_compat.sql')
    .sort();
  return [
    ...ORDER.map((f) => ({ name: f, path: join(root, f) })),
    // Preserve the legacy recovery snapshot and version trigger first.
    // Migration 0067 then extends the legacy checks for workspace rows.
    ...numbered.flatMap(f=>f===LEGACY_NAMESPACE_AFTER?['migrations/'+f,LEGACY_NAMESPACE]:['migrations/'+f])
      .map(f=>({name:f,path:join(root,f)})),
    ...SECURITY.map(f=>({name:'docs/security/'+f,path:join(root,'docs/security',f)})),
  ];
}
