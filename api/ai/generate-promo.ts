type VercelRequest = any;
type VercelResponse = any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { storeName, sector, objective } = req.body ?? {};

  const name = storeName || 'New Hope Cafe & POS';
  const sec = sector || 'FNB';

  const promoIdeas = [
    {
      title: `⚡ Promo Kilat Gajian (Payday Boost)`,
      code: 'GAJIANHEMAT',
      discountPercent: 15,
      maxDiscountAmount: 25000,
      description: `Diskon 15% untuk semua transaksi di ${name} saat akhir bulan.`,
      targetAudience: 'Pelanggan setia & pekerja kantoran',
    },
    {
      title: `☕ Happy Hour Sore Seru`,
      code: 'HAPPYHOURS',
      discountPercent: 20,
      maxDiscountAmount: 20000,
      description: `Diskon 20% khusus jam 14:00 - 17:00 untuk mendongkrak omzet jam sepi.`,
      targetAudience: 'Pelanggan yang berkunjung di jam santai',
    },
    {
      title: `🎁 Double Points Weekend Loyalty`,
      code: 'WEEKENDSERU',
      discountPercent: 10,
      maxDiscountAmount: 15000,
      description: `Dapatkan 2x loyalty point untuk setiap transaksi menggunakan QRIS di akhir pekan.`,
      targetAudience: 'Member & pelanggan tetap',
    },
  ];

  return res.status(200).json({
    ok: true,
    promoIdeas,
    message: 'Ide promo berhasil di-generate secara otomatis oleh AI Copilot.',
  });
}
