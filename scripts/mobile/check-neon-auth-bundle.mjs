import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2]||'dist-mobile';
const forbidden=['newhope-offline-ui-signing-v1','GoTrueClient','SupabaseClient','/auth/v1/token','/auth/v1/authorize','sb-PLACEHOLDER-auth-token'];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(entry.name.endsWith('.js')){const bytes=fs.readFileSync(p,'utf8');for(const marker of forbidden)if(bytes.includes(marker))throw Error('LEGACY_AUTH_IN_NEON_BUILD: '+p+' '+marker);}}}
walk(root);console.log('PASS Neon build graph: no Supabase Auth SDK or legacy Auth endpoint implementation');
