import 'dotenv/config';
import { execSync } from 'node:child_process';

const envs = [
  { key: 'VITE_SUPABASE_URL', val: process.env.VITE_SUPABASE_URL },
  { key: 'VITE_SUPABASE_ANON_KEY', val: process.env.VITE_SUPABASE_ANON_KEY },
  { key: 'DATABASE_URL', val: process.env.DATABASE_URL },
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
