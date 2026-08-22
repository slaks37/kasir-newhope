import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  console.log('--- Testing Financial Transaction vs Operational Context Segregation ---');

  // 1. Get an outlet and cashier
  const outRes = await client.query("SELECT id, tenant_id, merchant_id FROM internal.outlets LIMIT 1");
  const outlet = outRes.rows[0];

  // 2. Create Universal Financial Transaction (Carwash Order)
  const txCarwash = (await client.query(`
    INSERT INTO pos.transactions (tenant_id, merchant_id, outlet_id, invoice_number, order_status, subtotal, tax_amount, total_amount, payment_method, business_sector)
    VALUES ($1, $2, $3, 'INV-CW-TEST-001', 'COMPLETED', 60000, 6000, 66000, 'QRIS', 'CARWASH')
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id])).rows[0].id;

  // Insert Carwash Operational Context
  await client.query(`
    INSERT INTO pos.order_context_carwash (transaction_id, license_plate, vehicle_category, vehicle_model, bay_number, wash_status)
    VALUES ($1, 'B 8888 NH', 'SUV_LARGE', 'Toyota Fortuner GR Sport', 'Bay 3', 'FINISHED')
  `, [txCarwash]);

  // 3. Create Universal Financial Transaction (Laundry Order)
  const txLaundry = (await client.query(`
    INSERT INTO pos.transactions (tenant_id, merchant_id, outlet_id, invoice_number, order_status, subtotal, tax_amount, total_amount, payment_method, business_sector)
    VALUES ($1, $2, $3, 'INV-LD-TEST-002', 'OPEN', 45000, 4500, 49500, 'CASH', 'LAUNDRY')
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id])).rows[0].id;

  // Insert Laundry Operational Context
  await client.query(`
    INSERT INTO pos.order_context_laundry (transaction_id, weight_kg, item_count, fragrance_name, service_tier, operational_status, rack_location)
    VALUES ($1, 5.0, 14, 'Sakura Fresh', 'EXPRESS_1DAY', 'IRONING', 'Rak B-04')
  `, [txLaundry]);

  console.log('--- Querying contract.live_carwash_queue ---');
  const cwQueue = await client.query("SELECT invoice_number, license_plate, vehicle_category, bay_number, wash_status, total_amount FROM contract.live_carwash_queue WHERE transaction_id = $1", [txCarwash]);
  console.table(cwQueue.rows);

  console.log('--- Querying contract.live_laundry_orders ---');
  const ldQueue = await client.query("SELECT invoice_number, weight_kg, fragrance_name, operational_status, rack_location, total_amount FROM contract.live_laundry_orders WHERE transaction_id = $1", [txLaundry]);
  console.table(ldQueue.rows);

} finally {
  await client.end();
}
