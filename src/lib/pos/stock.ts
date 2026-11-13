import type { CartItem, Order, Product } from '../../types';

/**
 * Jumlah per produk yang MASIH berada di tangan pelanggan: qty terjual dikurangi
 * qty yang sudah di-refund. Void hanya boleh mengembalikan sisa ini ke stok —
 * sama seperti server (services/pos/sync.ts, VOID_RESTORE). Tanpa ini, void
 * setelah refund parsial mengembalikan barang yang sama dua kali.
 */
export function remainingQuantityByProduct(order: Pick<Order, 'items' | 'refunds'>): Map<string, number> {
  const refundedByLine = new Map<string, number>();
  for (const refund of order.refunds ?? []) {
    for (const item of refund.items) refundedByLine.set(item.cartItemId, (refundedByLine.get(item.cartItemId) ?? 0) + item.quantity);
  }
  const remaining = new Map<string, number>();
  for (const item of order.items) {
    const left = Math.max(0, item.quantity - (refundedByLine.get(item.id) ?? 0));
    if (left > 0) remaining.set(item.productId, (remaining.get(item.productId) ?? 0) + left);
  }
  return remaining;
}

/**
 * Stok setelah penjualan. TIDAK di-clamp ke 0: menjual 11 dari stok 5 harus
 * tercatat −6 (perlu restock / ada selisih), bukan 0 — clamp menghilangkan 6
 * unit dari pencatatan dan membuat void/retur mengembalikan stok "dari udara".
 */
export function stockAfterSale(stock: number, sold: number): number {
  return stock - sold;
}

/** Item keranjang yang qty-nya melebihi stok tercatat (peringatan, tidak memblokir). */
export function oversoldCartItems(cart: Pick<CartItem, 'id' | 'productId' | 'quantity'>[], products: Pick<Product, 'id' | 'stock'|'inventoryTracked'>[]): Map<string, number> {
  const stockById = new Map(products.map(product => [product.id, product.inventoryTracked===false?undefined:product.stock]));
  const inCart = new Map<string, number>();
  for (const item of cart) inCart.set(item.productId, (inCart.get(item.productId) ?? 0) + item.quantity);
  const flagged = new Map<string, number>();
  for (const item of cart) {
    const stock = stockById.get(item.productId);
    if (typeof stock === 'number' && (inCart.get(item.productId) ?? 0) > stock) flagged.set(item.id, stock);
  }
  return flagged;
}
