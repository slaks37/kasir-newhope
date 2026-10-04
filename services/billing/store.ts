/**
 * Katalog paket di database mengikuti src/config/saasPlans.ts (satu sumber harga).
 *
 * Langganan, faktur, rekonsiliasi pembayaran dan transisi status ada di
 * services/billing/engine.ts. Mesin langganan lama yang dulu ada di file ini
 * (termasuk penghangusan trial berdasarkan fingerprint perangkat) sudah tidak
 * dipakai dan dihapus agar tidak ada jalur billing kedua.
 */
import type { Db } from '../shared/db';

export async function pastikanPaket(db: Db, paket: Array<{ id: string; name: string; tierLevel: number; priceIdr: number; productLimit: number; features: string[] }>) {
  for (const p of paket) {
    await db.query(
      `INSERT INTO billing.plans (id, name, tier_level, billing_cycle, price_idr, product_limit, features)
       VALUES ($1, $2, $3, 'MONTHLY', $4, $5, $6::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, tier_level = EXCLUDED.tier_level,
         price_idr = EXCLUDED.price_idr, product_limit = EXCLUDED.product_limit, features = EXCLUDED.features,
         updated_at = CURRENT_TIMESTAMP`,
      [p.id, p.name, p.tierLevel, p.priceIdr, p.productLimit, JSON.stringify(p.features)]
    );
  }
}
