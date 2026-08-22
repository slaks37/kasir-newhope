import 'dotenv/config';
import { Resend } from 'resend';

async function main() {
  const resend = new Resend(process.env.RESEND_API_KEY);
  console.log('Testing Resend email sending with key:', process.env.RESEND_API_KEY ? 'Present' : 'Missing');

  try {
    // With free tier / restricted keys on Resend, sender defaults to onboarding@resend.dev
    // Note: onboarding@resend.dev can send to the account's registered email
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    console.log('Sending test email using from:', fromEmail);

    // Let's test checking if the key is valid
    const res = await resend.emails.send({
      from: fromEmail,
      to: 'delivered@resend.dev', // Resend official delivered test sink
      subject: 'Test Resend New Hope POS',
      html: '<p>Resend integration is working properly!</p>'
    });

    console.log('Resend send result:', res);
  } catch (err) {
    console.error('Resend error:', err);
  }
}

main().catch(console.error);
