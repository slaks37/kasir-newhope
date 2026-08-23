import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function test() {
  const testEmail = `test_${Date.now()}@example.com`;
  console.log(`Testing custom_signup RPC via Supabase Client for ${testEmail}...`);

  const { data, error } = await supabase.rpc('custom_signup', {
    user_email: testEmail,
    user_password: KATA_SANDI,
    store_name: 'Warung Kopi Sukses',
    full_name: 'Budi Santoso',
    sector: 'FNB'
  });

  if (error) {
    console.error('RPC Error:', error);
    process.exit(1);
  }

  console.log('RPC Response:', data);

  console.log('Testing signInWithPassword with newly created user...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: KATA_SANDI
  });

  if (authError) {
    console.error('Auth Sign In Error:', authError);
    process.exit(1);
  }

  console.log('Auth Sign In SUCCESS! User ID:', authData.user.id);
  console.log('User metadata:', authData.user.user_metadata);
}

test().catch(console.error);
