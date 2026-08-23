/**
 * Endpoint cron tidak boleh bisa dipicu siapa saja.
 *
 * Vercel menyertakan header `authorization: Bearer $CRON_SECRET` pada setiap
 * pemanggilan terjadwal. Tanpa pemeriksaan ini, alamatnya menjadi tombol publik
 * untuk menjalankan proses berat berulang kali.
 */
export function jagaCron(req: any, res: any): boolean {
  const rahasia = process.env.CRON_SECRET;
  if (!rahasia) {
    res.status(503).json({ ok: false, error: 'CRON_NOT_CONFIGURED' });
    return false;
  }
  const auth = String(req?.headers?.authorization ?? '');
  if (auth !== `Bearer ${rahasia}`) {
    res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    return false;
  }
  return true;
}
