import 'dotenv/config';
import { execSync } from 'node:child_process';

const envs = [
  { key: 'VITE_SUPABASE_URL', val: process.env.VITE_SUPABASE_URL },
  { key: 'VITE_SUPABASE_ANON_KEY', val: process.env.VITE_SUPABASE_ANON_KEY },
  { key: 'DATABASE_URL', val: process.env.DATABASE_URL },
  { key: 'PUBLIC_APP_URL', val: process.env.PUBLIC_APP_URL },
  { key: 'DOKU_CLIENT_ID', val: process.env.DOKU_CLIENT_ID },
  { key: 'DOKU_SECRET_KEY', val: process.env.DOKU_SECRET_KEY },
  { key: 'DOKU_API_URL', val: process.env.DOKU_API_URL },
  { key: 'DOKU_ALLOWED_CHANNELS', val: process.env.DOKU_ALLOWED_CHANNELS },
  { key: 'DEEPSEEK_API_KEY', val: process.env.DEEPSEEK_API_KEY },
  { key: 'DEEPSEEK_BASE_URL', val: process.env.DEEPSEEK_BASE_URL },
  { key: 'DEEPSEEK_MODEL', val: process.env.DEEPSEEK_MODEL }
];

console.log('Syncing environment variables to Vercel...');

for (const target of ['production', 'preview', 'development']) {
  for (const env of envs) {
    if (!env.val) continue;
    try {
      // Remove first if exists to avoid conflict
      try {
        execSync(`npx vercel env rm ${env.key} ${target} -y`, { stdio: 'ignore' });
      } catch {}
      
      execSync(`npx vercel env add ${env.key} ${target} --value "${env.val}" --yes`, { stdio: 'pipe' });
      console.log(`✓ Added ${env.key} (${target})`);
    } catch (e) {
      console.log(`! Failed adding ${env.key} (${target}):`, e.message);
    }
  }
}

console.log('\nRedeploying with new environment variables...');
execSync(`npx vercel --prod --yes`, { stdio: 'inherit' });
console.log('\nAll done!');
