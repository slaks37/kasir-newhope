import assert from 'node:assert/strict';
import { rehearsalTarget } from './rehearsal-target.mjs';
const base = { NEW_HOPE_REHEARSAL_CONFIRM: 'DISPOSABLE_POSTGRES17', NEW_HOPE_REHEARSAL_DATABASE_URL: 'postgres://postgres:rehearsal-only@127.0.0.1:55432/newhope_security_rehearsal' };
assert.equal(rehearsalTarget(base), base.NEW_HOPE_REHEARSAL_DATABASE_URL);
assert.throws(() => rehearsalTarget({ DATABASE_URL: base.NEW_HOPE_REHEARSAL_DATABASE_URL }));
assert.throws(() => rehearsalTarget({ ...base, NEW_HOPE_REHEARSAL_CONFIRM: '' }));
for (const target of [
  'postgres://postgres:rehearsal-only@db.fqxrhumsgigcgjtlbfuo.supabase.co:55432/newhope_security_rehearsal',
  'postgres://postgres:rehearsal-only@127.0.0.1:5432/newhope_security_rehearsal',
  'postgres://postgres:rehearsal-only@127.0.0.1:55432/postgres',
  'postgres://service_role:rehearsal-only@127.0.0.1:55432/newhope_security_rehearsal',
  base.NEW_HOPE_REHEARSAL_DATABASE_URL + '?host=db.example.invalid',
  base.NEW_HOPE_REHEARSAL_DATABASE_URL + '#unexpected',
]) assert.throws(() => rehearsalTarget({ ...base, NEW_HOPE_REHEARSAL_DATABASE_URL: target }));
console.log('PASS: dedicated disposable target; production/remote/default URL and connection overrides rejected before connection');
