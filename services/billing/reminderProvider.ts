import {createAuthProviderOperations} from '../shared/authProviderOperations';
import { Resend } from 'resend';
import type { ReminderDependencies } from './reminders';

export function createReminderProvider(): ReminderDependencies {
  const auth=createAuthProviderOperations();
  if(!auth.configured||!process.env.RESEND_API_KEY)throw new Error('REMINDER_PROVIDER_NOT_CONFIGURED');
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    async verifiedOwnerEmail(subject) {
      const identity=await auth.ownerIdentity(subject);return identity?.verified?identity.email:null;
    },
    async send(mail,idempotencyKey) {
      const {data,error} = await resend.emails.send(mail,{idempotencyKey});
      if (error || !data?.id) throw new Error('EMAIL_PROVIDER_REJECTED');
      return data.id;
    },
  };
}
