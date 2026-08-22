import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  console.log('--- Testing 4 Decoupled Lifecycles (Car Wash Simulation) ---');

  // 1. Get Outlet & Washer User
  const outRes = await client.query("SELECT id, tenant_id, merchant_id FROM internal.outlets LIMIT 1");
  const outlet = outRes.rows[0];

  const userRes = await client.query("SELECT id FROM internal.users LIMIT 1");
  const washerStaffId = userRes.rows[0].id;

  // ==========================================
  // CASE A: UPFRONT PAYMENT (Bayar di Depan)
  // ==========================================
  console.log('\n--- CASE A: UPFRONT PAYMENT (Bayar saat Kendaraan Masuk) ---');
  
  // 1. Sales Order Created
  const txA = (await client.query(`
    INSERT INTO pos.transactions (tenant_id, merchant_id, outlet_id, invoice_number, order_status, subtotal, tax_amount, total_amount, payment_method, business_sector)
    VALUES ($1, $2, $3, 'INV-CW-UPFRONT-001', 'OPEN', 100000, 10000, 110000, 'QRIS', 'CARWASH')
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id])).rows[0].id;

  // 2. Customer Pays Immediately at Gate
  await client.query(`
    INSERT INTO pos.payments (tenant_id, merchant_id, outlet_id, transaction_id, payment_method, payment_status, amount, paid_at)
    VALUES ($1, $2, $3, $4, 'QRIS', 'PAID', 110000, NOW())
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, txA]);

  // 3. Operational Job in Progress (Pit Washing)
  const jobA = (await client.query(`
    INSERT INTO pos.operational_jobs (tenant_id, merchant_id, outlet_id, transaction_id, job_type, job_number, resource_name, status, assigned_staff_id)
    VALUES ($1, $2, $3, $4, 'CARWASH_BAY', 'SPK-CW-A01', 'Bay 1 Hidrolik', 'IN_PROGRESS', $5)
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, txA, washerStaffId])).rows[0].id;

  // 4. Commission Recorded (Pending Conditions)
  const commA = (await client.query(`
    INSERT INTO pos.staff_commissions (tenant_id, merchant_id, outlet_id, transaction_id, job_id, staff_user_id, commission_type, gross_service_amount, commission_rate_pct, commission_amount, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'SERVICE_WASHER', 100000, 15.0, 15000, 'PENDING_CONDITIONS')
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, txA, jobA, washerStaffId])).rows[0].id;

  const commStatus1 = (await client.query("SELECT status FROM pos.staff_commissions WHERE id = $1", [commA])).rows[0].status;
  console.log('Status Komisi saat Mobil Sedang Dicuci (Sudah Bayar, Belum Selesai):', commStatus1, '(HARUS PENDING_CONDITIONS)');

  // 5. Washer Finishes Job
  console.log('Washer Selesai Cuci & QC Passed (status = FINISHED)...');
  await client.query("UPDATE pos.operational_jobs SET status = 'FINISHED' WHERE id = $1", [jobA]);

  const commStatus2 = (await client.query("SELECT status, accrued_at FROM pos.staff_commissions WHERE id = $1", [commA])).rows[0];
  console.log('Status Komisi Setelah Mobil Selesai:', commStatus2.status, '| Accrued At:', commStatus2.accrued_at);

  // ==========================================
  // CASE B: EXIT PAYMENT (Bayar saat Selesai)
  // ==========================================
  console.log('\n--- CASE B: EXIT PAYMENT (Bayar di Kasir Setelah Mobil Bersih) ---');

  // 1. Sales Order Created
  const txB = (await client.query(`
    INSERT INTO pos.transactions (tenant_id, merchant_id, outlet_id, invoice_number, order_status, subtotal, tax_amount, total_amount, payment_method, business_sector)
    VALUES ($1, $2, $3, 'INV-CW-EXIT-002', 'OPEN', 80000, 8000, 88000, 'CASH', 'CARWASH')
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id])).rows[0].id;

  // 2. Operational Job Completed First
  const jobB = (await client.query(`
    INSERT INTO pos.operational_jobs (tenant_id, merchant_id, outlet_id, transaction_id, job_type, job_number, resource_name, status, assigned_staff_id)
    VALUES ($1, $2, $3, $4, 'CARWASH_BAY', 'SPK-CW-B02', 'Bay 2 Detailing', 'FINISHED', $5)
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, txB, washerStaffId])).rows[0].id;

  // 3. Commission Recorded (Pending Conditions)
  const commB = (await client.query(`
    INSERT INTO pos.staff_commissions (tenant_id, merchant_id, outlet_id, transaction_id, job_id, staff_user_id, commission_type, gross_service_amount, commission_rate_pct, commission_amount, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'SERVICE_WASHER', 80000, 15.0, 12000, 'PENDING_CONDITIONS')
    RETURNING id
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, txB, jobB, washerStaffId])).rows[0].id;

  const commStatusB1 = (await client.query("SELECT status FROM pos.staff_commissions WHERE id = $1", [commB])).rows[0].status;
  console.log('Status Komisi saat Mobil Sudah Bersih tapi Belum Dibayar:', commStatusB1, '(HARUS PENDING_CONDITIONS)');

  // 4. Customer Pays on Exit
  console.log('Pelanggan Membayar di Kasir (status = PAID)...');
  await client.query(`
    INSERT INTO pos.payments (tenant_id, merchant_id, outlet_id, transaction_id, payment_method, payment_status, amount, paid_at)
    VALUES ($1, $2, $3, $4, 'CASH', 'PAID', 88000, NOW())
  `, [outlet.tenant_id, outlet.merchant_id, outlet.id, txB]);

  const commStatusB2 = (await client.query("SELECT status, accrued_at FROM pos.staff_commissions WHERE id = $1", [commB])).rows[0];
  console.log('Status Komisi Setelah Pembayaran Masuk:', commStatusB2.status, '| Accrued At:', commStatusB2.accrued_at);

  console.log('\n--- Querying contract.staff_commission_ledger ---');
  const ledger = await client.query("SELECT staff_name, invoice_number, commission_type, gross_service_amount, commission_amount, commission_status FROM contract.staff_commission_ledger WHERE transaction_id IN ($1, $2)", [txA, txB]);
  console.table(ledger.rows);

} finally {
  await client.end();
}
