import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateIdentityManifest} from '../neon/identity-core.mjs';
import {authEmailPayload} from '../../services/shared/betterAuthEmail';
const fixture={version:1,sourceProject:'fqxrhumsgigcgjtlbfuo',backupRef:'SYNTHETIC-BACKUP-001',reviewerRef:'SYNTHETIC-REVIEW-001',users:[{id:randomUUID(),email:'OWNER@example.invalid',name:'Synthetic owner',emailVerified:true,isActive:true}]};
assert.equal(validateIdentityManifest(fixture).manifest.users[0].email,'owner@example.invalid');
for(const value of [{...fixture,sourceProject:'wrong-project'},{...fixture,backupRef:''},{...fixture,reviewerRef:''},
  {...fixture,users:[...fixture.users,...fixture.users]},
  {...fixture,users:[{...fixture.users[0],password:'NeverImportThis'}]},
  {...fixture,users:[{...fixture.users[0],encrypted_password:'hash'}]},
  {...fixture,users:[{...fixture.users[0],metadata:{role:'SUPERADMIN'}}]},
  {...fixture,users:[{...fixture.users[0],emailVerified:'true'}]},
  {...fixture,users:[{...fixture.users[0],id:'not-a-uuid'}]}])assert.throws(()=>validateIdentityManifest(value));
const env={AUTH_EMAIL_ENABLED:'1',RESEND_API_KEY:'fixture-never-sent',AUTH_EMAIL_FROM:'New Hope POS <no-reply@kasir.newhope.space>',AUTH_EMAIL_VERIFIED_DOMAIN:'kasir.newhope.space',VERCEL_ENV:'preview',AUTH_EMAIL_ALLOWED_RECIPIENTS:'owner@example.invalid'};
const reset={kind:'RESET' as const,email:'owner@example.invalid',baseUrl:'https://preview.example.invalid',url:'https://preview.example.invalid/api/auth/reset-password/private-fixture?callbackURL=https%3A%2F%2Fpreview.example.invalid%2Freset-password'};
const first=authEmailPayload(reset,env),second=authEmailPayload(reset,env);
assert.equal(first.idempotencyKey,second.idempotencyKey);
assert(!first.idempotencyKey.includes('private-fixture'));
assert(first.payload.html.includes('<html lang="id">'));
for(const [mail,config] of [[{...reset,url:'https://foreign.invalid/api/auth/reset-password/x'},env],
  [{...reset,url:'https://preview.example.invalid/api/auth/admin'},env],
  [{...reset,email:'customer@example.invalid'},env],
  [reset,{...env,AUTH_EMAIL_ALLOWED_RECIPIENTS:''}],
  [reset,{...env,AUTH_EMAIL_FROM:'attacker@foreign.invalid'}],
  [reset,{...env,AUTH_EMAIL_FROM:'sender@kasir.newhope.space\nBcc: victim@example.invalid'}],
  [reset,{...env,AUTH_EMAIL_VERIFIED_DOMAIN:''}]] as const)assert.throws(()=>authEmailPayload(mail,config));
console.log('PASS: credential-free reviewed identity manifest, collisions/types, approved preview-recipient/sender/HTTPS path gates, token-free idempotency and Indonesian email template; no message sent');
