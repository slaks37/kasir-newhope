const post=(b)=>fetch('http://127.0.0.1:3101/api/v1/sync/transactions',
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})
  .then(async r=>({s:r.status,b:await r.json().catch(()=>({}))}));
const line=console.log;

// tunggu siap
for(let i=0;i<30;i++){ if(await fetch('http://127.0.0.1:3101/ready').then(r=>r.ok).catch(()=>false)) break;
  await new Promise(r=>setTimeout(r,1000)); }

const mk=(id,total,extra={})=>({clientTxnId:id,invoiceNumber:'INV-'+id,cashierName:'Kasir',
  subtotal:total,discountAmount:0,taxAmount:0,serviceChargeAmount:0,totalAmount:total,
  paymentMethod:'CASH',paymentStatus:'PAID',createdAt:new Date().toISOString(),
  items:[{productRef:'p1',productName:'Kopi',unitPrice:total,unitCost:5000,quantity:1,totalPrice:total}],...extra});

line('\n  === RBAC: apakah server menegakkan peran untuk VOID? ===');
// 1. buat transaksi sebagai ADMIN
let r=await post({idempotencyKey:'rbac-1',businessId:'own-rbac_FNB',sector:'FNB',storeName:'Toko RBAC',
  transactions:[mk('RB-1',50000,{cashierRole:'ADMIN'})]});
line(`     buat transaksi (ADMIN)          : ${r.s} accepted=${r.b.accepted}`);

// 2. VOID transaksi itu, mengaku sebagai CASHIER — peran yang TIDAK punya izin void_order
r=await post({idempotencyKey:'rbac-2',businessId:'own-rbac_FNB',sector:'FNB',storeName:'Toko RBAC',
  transactions:[mk('RB-1',50000,{cashierRole:'CASHIER',paymentStatus:'CANCELLED'})]});
line(`     VOID mengaku CASHIER            : ${r.s} voided=${r.b.voided}`);
line(r.b.voided > 0
  ? '     >>> DITERIMA. Server tidak memeriksa peran; PIN manajer hanya ada di UI.'
  : '     >>> ditolak server.');

line('\n  === Tenant isolation: bisakah menulis ke unit usaha milik akun lain? ===');
// businessId milik akun lain (own-conc dari uji sebelumnya)
r=await post({idempotencyKey:'iso-1',businessId:'own-conc_RETAIL',sector:'RETAIL',storeName:'Curian',
  transactions:[mk('ISO-1',999000)]});
line(`     tulis ke own-conc_RETAIL        : ${r.s} ${JSON.stringify(r.b).slice(0,90)}`);
line('     (catatan: AUTH_ALLOW_LOCAL_DEVELOPMENT=1 aktif — principal jadi "local-development")');
