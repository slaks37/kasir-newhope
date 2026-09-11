import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import type { ReminderDependencies } from './reminders';

export function createReminderProvider(): ReminderDependencies {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.RESEND_API_KEY) throw new Error('REMINDER_PROVIDER_NOT_CONFIGURED');
  const auth = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})}});
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    async verifiedOwnerEmail(subject) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject || '')) return null;
      const {data,error} = await auth.auth.admin.getUserById(subject);
      if (error) { if (error.status === 404) return null; throw new Error('OWNER_LOOKUP_FAILED'); }
      const user = data.user;
      if (user?.deleted_at || (user?.banned_until && Date.parse(user.banned_until) > Date.now())) return null;
      return user?.id === subject && user.email_confirmed_at && user.email ? user.email : null;
    },
    async send(mail,idempotencyKey) {
      const {data,error} = await resend.emails.send(mail,{idempotencyKey});
      if (error || !data?.id) throw new Error('EMAIL_PROVIDER_REJECTED');
      return data.id;
    },
  };
}
