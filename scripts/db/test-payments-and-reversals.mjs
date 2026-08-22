import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  console.log('--- 1. Testing Split-Tender & Async QRIS Settlement ---');

  const outRes = await client.query("SELECT id, tenant_id, merchant_id FROM internal.outlets LIMIT 1");
  const outlet = outRes.rows[0];

  const invSplit = 'INV-SPLIT-' + Date.now();
  const tx = (await client.query(`
    INSERT INTO pos.transactions (tenant_id, merchant_id, outlet_id, invoice_number, order_status, subtotal, tax_amount, total_amount, payment_method, business_sector)
    VALUES ($1, $2, $3, $4, 'OPEN', 113636, 11364, 125000, 'SPLIT', 'FNB')
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, invSplit])).rows[0].id;

  const intentId = (await client.query("SELECT uuidv7() AS id")).rows[0].id;

  // Tender 1: Cash 50,000 (Settled immediately)
  await client.query(`
    INSERT INTO pos.payments (tenant_id, merchant_id, outlet_id, transaction_id, payment_intent_id, attempt_number, payment_method, payment_status, amount, settled_at)
    VALUES ($1, $2, $3, $4, $5, 1, 'CASH', 'SETTLED', 50000, NOW())
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, tx, intentId]);

  let txStatus1 = (await client.query("SELECT order_status FROM pos.transactions WHERE id = $1", [tx])).rows[0].order_status;
  console.log('Order Status setelah Pembayaran Parsial Tunai Rp 50.000 / Rp 125.000:', txStatus1, '(HARUS OPEN)');

  // Tender 2: QRIS Dynamic 75,000 (Attempt 1: PENDING async)
  const qrisPayId = (await client.query(`
    INSERT INTO pos.payments (tenant_id, merchant_id, outlet_id, transaction_id, payment_intent_id, attempt_number, payment_method, payment_status, amount)
    VALUES ($1, $2, $3, $4, $5, 2, 'QRIS', 'PENDING', 75000)
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, tx, intentId])).rows[0].id;

  let txStatus2 = (await client.query("SELECT order_status FROM pos.transactions WHERE id = $1", [tx])).rows[0].order_status;
  console.log('Order Status saat Menunggu QRIS Async Rp 75.000 (PENDING):', txStatus2, '(HARUS OPEN)');

  // Webhook QRIS Callback: SETTLED!
  console.log('Webhook QRIS Diterima dari Payment Gateway (status = SETTLED)...');
  await client.query(`
    UPDATE pos.payments
       SET payment_status = 'SETTLED',
           settled_at = NOW()
     WHERE id = $1
  `, [qrisPayId]);

  let txStatus3 = (await client.query("SELECT order_status, completed_at FROM pos.transactions WHERE id = $1", [tx])).rows[0];
  console.log('Order Status setelah Seluruh Tender Lunas (Total Rp 125.000):', txStatus3.order_status, '| Settled At:', txStatus3.completed_at);


  console.log('\n--- 2. Testing Physical Immutability Guard on Inventory Ledger ---');
  
  // Ambil sembarang baris mutasi
  const sampleMut = (await client.query("SELECT id FROM pos.inventory_transactions LIMIT 1")).rows[0]?.id;
  if (sampleMut) {
    try {
      await client.query("UPDATE pos.inventory_transactions SET quantity_delta = 9999 WHERE id = $1", [sampleMut]);
      console.error('ERROR: UPDATE seharusnya diblokir oleh trigger immutability!');
    } catch (err) {
      console.log('✓ UPDATE Diblokir dengan Aman oleh Immutability Enforcer:', err.message);
    }

    try {
      await client.query("DELETE FROM pos.inventory_transactions WHERE id = $1", [sampleMut]);
      console.error('ERROR: DELETE seharusnya diblokir oleh trigger immutability!');
    } catch (err) {
      console.log('✓ DELETE Diblokir dengan Aman oleh Immutability Enforcer:', err.message);
    }
  }


  console.log('\n--- 3. Testing Void with Compensating Reversals ---');

  // Siapkan item dan saldo
  const locRes = await client.query("SELECT id FROM pos.inventory_locations WHERE outlet_id = $1 LIMIT 1", [outlet.id]);
  const locId = locRes.rows[0].id;

  const itemRes = (await client.query(`
    INSERT INTO pos.inventory_items (tenant_id, merchant_id, sku, item_name, base_unit, cost_per_unit, item_type)
    VALUES ($1, $2, 'SKU-REVERSAL-TEST', 'Kopi Kemasan 250g', 'pcs', 30000, 'RETAIL_FINISHED')
    ON CONFLICT (merchant_id, sku) DO UPDATE SET item_name = EXCLUDED.item_name
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id])).rows[0].id;

  await client.query(`
    INSERT INTO pos.inventory_balances (tenant_id, merchant_id, outlet_id, location_id, inventory_item_id, current_stock)
    VALUES ($1, $2, $3, $4, $5, 100.0)
    ON CONFLICT (outlet_id, location_id, inventory_item_id) DO UPDATE SET current_stock = 100.0
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, locId, itemRes]);

  // Buat penjualan 5 pcs (Mutasi: -5.0)
  const invVoid = 'INV-VOID-' + Date.now();
  const txVoid = (await client.query(`
    INSERT INTO pos.transactions (tenant_id, merchant_id, outlet_id, invoice_number, order_status, subtotal, tax_amount, total_amount, payment_method, business_sector)
    VALUES ($1, $2, $3, $4, 'SETTLED', 250000, 25000, 275000, 'CASH', 'RETAIL')
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, invVoid])).rows[0].id;

  await client.query(`
    INSERT INTO pos.inventory_transactions (
      tenant_id, merchant_id, outlet_id, location_id, inventory_item_id, quantity_delta, reference_type, reference_id, reason
    ) VALUES ($1, $2, $3, $4, $5, -5.0, 'SALE', $6, 'Penjualan Kasir POS')
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, locId, itemRes, txVoid]);

  const stockAfterSale = (await client.query("SELECT current_stock FROM pos.inventory_balances WHERE inventory_item_id = $1 AND location_id = $2", [itemRes, locId])).rows[0].current_stock;
  console.log('Saldo Stok setelah Penjualan (-5 pcs):', stockAfterSale, 'pcs (HARUS 95)');

  // Eksekusi Stored Procedure Void dengan Compensating Reversal
  console.log('Mengeksekusi pos.fn_void_transaction_with_compensating_reversals()...');
  const voidRes = await client.query("SELECT pos.fn_void_transaction_with_compensating_reversals($1, 'Pelanggan Salah Beli Ukuran') AS res", [txVoid]);
  console.log('Hasil Eksekusi Void Stored Procedure:', voidRes.rows[0].res);

  const stockAfterVoid = (await client.query("SELECT current_stock FROM pos.inventory_balances WHERE inventory_item_id = $1 AND location_id = $2", [itemRes, locId])).rows[0].current_stock;
  console.log('Saldo Stok setelah Void Reversal (+5 pcs):', stockAfterVoid, 'pcs (KEMBALI KE 100)');

  console.log('\n--- Rekam Jejak Audit Buku Besar (Immutable Ledger History) ---');
  const ledgerHistory = await client.query(`
    SELECT reference_type, quantity_delta, reason, created_at
      FROM pos.inventory_transactions
     WHERE reference_id = $1
     ORDER BY created_at ASC
  `, [txVoid]);
  console.table(ledgerHistory.rows);

} finally {
  await client.end();
}
