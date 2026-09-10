import '../shared/env';
import { startService, PORTS } from '../shared/service';
import { registerBillingRoutes } from './routes';
import { pastikanPaket } from './store';
import { SAAS_PLANS } from '../../src/config/saasPlans';

startService({
  name:'billing',port:PORTS.billing,schema:'billing',
  register:async(app,svc)=>{
    await pastikanPaket(svc.db,SAAS_PLANS);
    registerBillingRoutes(app,svc.db,true);
    app.post('/api/v1/auth/send-welcome', async (req, res) => {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ ok: false, error: 'MISSING_EMAIL' });
      
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Kirim Welcome Email
        await resend.emails.send({
          from: 'welcome@newhopepos.id',
          to: email,
          subject: 'Selamat Datang di New Hope POS!',
          html: `
            <div style="font-family: sans-serif; max-w-md; margin: 0 auto;">
              <h2>Pendaftaran Berhasil!</h2>
              <p>Halo,</p>
              <p>Akun kasir Anda dengan email <strong>${email}</strong> telah berhasil dibuat dan <strong>terkonfirmasi otomatis</strong>.</p>
              <p>Anda sudah bisa langsung masuk (login) ke dalam sistem menggunakan password yang baru saja Anda buat tanpa perlu memasukkan kode OTP apa pun.</p>
              <br/>
              <p>Selamat berjualan!<br/>Tim New Hope POS</p>
            </div>
          `
        });

        res.json({ ok: true });
      } catch (err: any) {
        svc.log.error('Custom signup gagal:', err);
        // Bila duplicate email, error code dari Postgres biasanya 23505
        if (err.code === '23505') {
          return res.status(400).json({ ok: false, error: 'User already registered' });
        }
        res.status(500).json({ ok: false, error: 'WELCOME_EMAIL_FAILED' });
      }
    });


  }
});
