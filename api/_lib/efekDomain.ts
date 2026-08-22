/**
 * Efek domain dari sebuah transaksi.
 *
 * SATU TEMPAT untuk menjawab "apa yang berubah ketika sebuah struk masuk".
 * Sebelumnya jawabannya tersebar: stok dikurangi di browser, poin ditambah di
 * browser, dan server hanya menyimpan barisnya. Tidak ada satu pun tempat yang
 * bisa dibaca untuk tahu urutan kejadiannya.
 *
 * BENTUKNYA: peristiwa lebih dulu, lalu efeknya diturunkan.
 *
 *     ORDER_PAID
 *         ├── inventory_ledger  (SALE / RECIPE_CONSUMPTION)
 *         └── loyalty_ledger    (EARN / REDEEM)
 *
 *     ORDER_VOIDED
 *         ├── inventory_ledger  (VOID_REVERSAL)
 *         └── loyalty_ledger    (VOID_REVERSAL)
 *
 * Void TIDAK menghapus baris mana pun. Ia menambahkan kebalikannya, sehingga
 * riwayat tetap terbaca dan saldo tetap benar. Menimpa riwayat berarti
 * kehilangan satu-satunya bukti tentang apa yang sebenarnya terjadi.
 */

import type pg from 'pg';

type Klien = pg.PoolClient | pg.Pool;

export interface BarisStruk {
  productId: string | null;
  productName: string;
  quantity: number;
}

export interface EfekTransaksi {
  businessId: string;
  transactionId: string;
  /** Kunci idempotensi dari klien — clientTxnId sudah cukup unik. */
  idempotencyKey: string;
  deviceRef?: string | null;
  items: BarisStruk[];
  customerId?: string | null;
  pointsEarned?: number;
  pointsRedeemed?: number;
  totalAmount?: number;
  occurredAt?: string | null;
}

/**
 * Menerbitkan peristiwa. Mengembalikan null bila peristiwa dengan kunci yang
 * sama sudah pernah dicatat — kiriman ulang tidak boleh menghasilkan efek
 * kedua, dan itu dijaga oleh indeks unik, bukan oleh pemeriksaan terpisah yang
 * bisa kalah balapan.
 */
async function terbitkan(
  db: Klien,
  businessId: string,
  eventType: string,
  idempotencyKey: string,
  transactionId: string | null,
  payload: Record<string, unknown>,
  deviceRef?: string | null,
  occurredAt?: string | null
): Promise<string | null> {
  const { rows } = await db.query(
    `INSERT INTO pos.domain_events
       (id, business_id, event_type, transaction_id, occurred_at, payload, device_ref, idempotency_key)
     VALUES (uuidv7(), $1, $2, $3, COALESCE($4::timestamptz, CURRENT_TIMESTAMP), $5::jsonb, $6, $7)
     ON CONFLICT (business_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [businessId, eventType, transactionId, occurredAt ?? null,
     JSON.stringify(payload), deviceRef ?? null, idempotencyKey]
  );
  return rows[0]?.id ?? null;
}

/**
 * Resep sebuah produk. Dikembalikan kosong bila produknya bukan berbasis resep
 * — dan itu keputusan yang menentukan: produk ber-mode STOCK yang juga
 * dikurangi bahan bakunya akan terhitung DUA KALI.
 */
async function resepProduk(db: Klien, productId: string) {
  const { rows } = await db.query(
    `SELECT r.ingredient_id, r.quantity_required AS quantity, i.name, i.unit
       FROM pos.product_recipes r
       JOIN pos.ingredients i ON i.id = r.ingredient_id
       JOIN pos.products p    ON p.id = r.product_id
      WHERE r.product_id = $1 AND p.inventory_mode = 'RECIPE'`,
    [productId]
  );
  return rows;
}

async function modeProduk(db: Klien, productId: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT inventory_mode FROM pos.products WHERE id = $1`, [productId]);
  return rows[0]?.inventory_mode ?? 'STOCK';
}

/** Satu baris ledger persediaan. */
async function catatStok(
  db: Klien, businessId: string, eventId: string,
  itemType: 'PRODUCT' | 'INGREDIENT', itemId: string, itemName: string,
  delta: number, unit: string | null, reason: string,
  transactionId: string | null, occurredAt?: string | null
) {
  if (!delta) return; // ck_inv_ledger_delta menolak nol; hemat satu perjalanan.
  await db.query(
    `INSERT INTO pos.inventory_ledger
       (id, business_id, event_id, item_type, item_id, item_name, delta, unit,
        reason, transaction_id, occurred_at)
     VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
             COALESCE($10::timestamptz, CURRENT_TIMESTAMP))`,
    [businessId, eventId, itemType, itemId, itemName.slice(0, 160), delta,
     unit, reason, transactionId, occurredAt ?? null]
  );
}

/**
 * ORDER_PAID: struk masuk, efeknya dicatat.
 *
 * Mengembalikan false bila peristiwanya sudah pernah tercatat — pemanggil bisa
 * memakainya untuk membedakan "baru" dari "kiriman ulang".
 */
export async function orderPaid(db: Klien, e: EfekTransaksi): Promise<boolean> {
  const eventId = await terbitkan(
    db, e.businessId, 'ORDER_PAID', `ORDER_PAID:${e.idempotencyKey}`,
    e.transactionId,
    { items: e.items.length, total: e.totalAmount ?? 0 },
    e.deviceRef, e.occurredAt
  );
  if (!eventId) return false;

  for (const baris of e.items) {
    if (!baris.productId) continue;
    const qty = Math.max(0, Number(baris.quantity) || 0);
    if (!qty) continue;

    const mode = await modeProduk(db, baris.productId);

    // NONE: jasa. Tidak ada persediaan yang bergerak, dan memaksakan baris
    // ledger untuknya hanya menghasilkan saldo negatif tak berujung pada
    // sesuatu yang tidak pernah punya stok.
    if (mode === 'NONE') continue;

    if (mode === 'STOCK') {
      await catatStok(db, e.businessId, eventId, 'PRODUCT', baris.productId,
        baris.productName, -qty, null, 'SALE', e.transactionId, e.occurredAt);
      continue;
    }

    // RECIPE: yang berkurang bahan bakunya, BUKAN stok produknya.
    for (const r of await resepProduk(db, baris.productId)) {
      await catatStok(db, e.businessId, eventId, 'INGREDIENT', r.ingredient_id,
        r.name, -(Number(r.quantity) || 0) * qty, r.unit,
        'RECIPE_CONSUMPTION', e.transactionId, e.occurredAt);
    }
  }

  if (e.customerId) {
    const poin = (e.pointsEarned ?? 0) - (e.pointsRedeemed ?? 0);
    await db.query(
      `INSERT INTO pos.loyalty_ledger
         (id, business_id, customer_id, event_id, delta_points, delta_spent,
          delta_visits, reason, transaction_id, occurred_at)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, 1, $6, $7,
               COALESCE($8::timestamptz, CURRENT_TIMESTAMP))`,
      [e.businessId, e.customerId, eventId, poin, e.totalAmount ?? 0,
       (e.pointsRedeemed ?? 0) > 0 ? 'REDEEM' : 'EARN', e.transactionId, e.occurredAt]
    );
  }

  return true;
}

/**
 * ORDER_VOIDED: seluruh efek dibalik dengan baris kebalikan.
 *
 * Dibaca dari ledger, bukan dari struknya. Yang harus dikembalikan adalah
 * sebanyak yang DULU BENAR-BENAR diambil — bukan sebanyak yang seharusnya
 * menurut resep atau aturan poin hari ini, yang bisa sudah berubah.
 */
export async function orderVoided(
  db: Klien,
  businessId: string,
  transactionId: string,
  idempotencyKey: string,
  deviceRef?: string | null
): Promise<boolean> {
  const eventId = await terbitkan(
    db, businessId, 'ORDER_VOIDED', `ORDER_VOIDED:${idempotencyKey}`,
    transactionId, {}, deviceRef, null
  );
  if (!eventId) return false;

  await db.query(
    `INSERT INTO pos.inventory_ledger
       (id, business_id, event_id, item_type, item_id, item_name, delta, unit,
        reason, transaction_id, note)
     SELECT uuidv7(), business_id, $2, item_type, item_id, item_name,
            -delta, unit, 'VOID_REVERSAL', transaction_id,
            'Pembalikan otomatis dari pembatalan struk'
       FROM pos.inventory_ledger
      WHERE transaction_id = $1 AND reason <> 'VOID_REVERSAL'`,
    [transactionId, eventId]
  );

  await db.query(
    `INSERT INTO pos.loyalty_ledger
       (id, business_id, customer_id, event_id, delta_points, delta_spent,
        delta_visits, reason, transaction_id, note)
     SELECT uuidv7(), business_id, customer_id, $2, -delta_points, -delta_spent,
            -delta_visits, 'VOID_REVERSAL', transaction_id,
            'Pembalikan otomatis dari pembatalan struk'
       FROM pos.loyalty_ledger
      WHERE transaction_id = $1 AND reason <> 'VOID_REVERSAL'`,
    [transactionId, eventId]
  );

  return true;
}
