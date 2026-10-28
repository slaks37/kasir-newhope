// Shared complete schema order. No connection, environment loading or fixture seed.
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
const ORDER=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql'];
export function migrationFiles(root=process.cwd()) {
  const numbered = readdirSync(join(root,'migrations'))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f !== '0001_compat.sql')
    .sort();
  return [
    ...ORDER.map((f) => ({ name: f, path: join(root, f) })),
    ...numbered.map((f) => ({ name: f, path: join(join(root,'migrations'), f) })),
    ...['free-plan-selection.sql','free-plan-ai-credit-access.sql','restrict-browser-rls-policies.sql','intelligence-cache.sql','intelligence-wallet.sql'].map(f=>({name:f,path:join(root,'docs/security',f)})),
    ...readdirSync(join(root,'supabase/migrations')).filter(f=>f.endsWith('_business_scoped_operational_state.sql')).sort().map(f=>({name:'supabase/migrations/'+f,path:join(root,'supabase/migrations',f)})),
  ];
}

