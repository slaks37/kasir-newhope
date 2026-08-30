// Rumus disalin PERSIS dari src/context/POSContext.tsx
//   applyCartItemDiscount : disc = (rawTotal * discountPercent) / 100     <- tanpa pembulatan
//   totalPrice            : rawTotal - disc
//   processPayment        : tax = Math.round(subtotal * taxRate / 100)
const line=console.log;

const item = (harga, qty, pct) => {
  const rawTotal = harga * qty;
  const disc = pct > 0 ? (rawTotal * pct) / 100 : 0;
  return { rawTotal, disc, totalPrice: rawTotal - disc };
};

line('\n  A. Diskon persen yang tidak bulat');
for (const [h,q,p] of [[33333,1,10],[10000,3,33],[15750,2,15],[9999,7,12.5],[100,1,33.33]]) {
  const r = item(h,q,p);
  const pecahan = !Number.isInteger(r.totalPrice);
  line(`     ${String(h).padStart(6)} x${q} -${p}%  -> diskon ${String(r.disc).padEnd(22)} total ${String(r.totalPrice).padEnd(22)} ${pecahan?'<-- PECAHAN':''}`);
}

line('\n  B. Akumulasi ke subtotal, lalu pajak 11% (PPN)');
const keranjang = [item(33333,1,10), item(10000,3,33), item(15750,2,15)];
const subtotal = keranjang.reduce((s,x)=>s+x.totalPrice,0);
const tax = Math.round((subtotal * 11) / 100);
const service = Math.round((subtotal * 5) / 100);
const grand = subtotal + tax + service;
line(`     subtotal   : ${subtotal}`);
line(`     pajak 11%  : ${tax}   (dibulatkan)`);
line(`     service 5% : ${service}   (dibulatkan)`);
line(`     grand total: ${grand}`);
line(`     grand total bulat? ${Number.isInteger(grand) ? 'ya' : 'TIDAK — ' + grand}`);

line('\n  C. Kembalian tunai');
const bayar = 100000;
const kembali = Math.max(0, bayar - grand);
line(`     bayar ${bayar} - total ${grand} = ${kembali}`);
line(`     kembalian bulat? ${Number.isInteger(kembali) ? 'ya' : 'TIDAK — ' + kembali}`);

line('\n  D. Klasik floating point');
line(`     0.1 + 0.2 === 0.3 ? ${0.1+0.2===0.3}   (${0.1+0.2})`);
line(`     19900 * 3 * 0.15  = ${19900*3*0.15}`);
line(`     (8950*7)*0.075    = ${(8950*7)*0.075}`);

line('\n  E. Batas aman integer untuk rupiah');
line(`     Number.MAX_SAFE_INTEGER = ${Number.MAX_SAFE_INTEGER}  (~9 kuadriliun rupiah)`);
line(`     omzet tahunan 100 miliar aman? ${100_000_000_000 < Number.MAX_SAFE_INTEGER}`);
