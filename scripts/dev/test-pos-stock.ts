import assert from 'node:assert/strict';
import { oversoldCartItems, remainingQuantityByProduct, stockAfterSale } from '../../src/lib/pos/stock';

// QA case: Kopi 50 → sell 2 → refund 1 → void. Void returns only the 1 still sold (back to 50, not 51).
const order: any = {
  items: [{ id: 'line-kopi', productId: 'kopi', quantity: 2 }, { id: 'line-teh', productId: 'teh', quantity: 11 }],
  refunds: [{ items: [{ cartItemId: 'line-kopi', productId: 'kopi', quantity: 1 }] }],
};
const remaining = remainingQuantityByProduct(order);
assert.equal(remaining.get('kopi'), 1);
assert.equal(remaining.get('teh'), 11);
let kopi = stockAfterSale(50, 2); kopi += 1; kopi += remaining.get('kopi')!;
assert.equal(kopi, 50, 'sale → refund → void restores the original stock exactly');

// QA case: Teh stock 5, sold 11 → −6 (not clamped to 0); void then returns to 5, not 11.
let teh = stockAfterSale(5, 11);
assert.equal(teh, -6);
teh += remaining.get('teh')!;
assert.equal(teh, 5);

// Fully refunded lines contribute nothing to a later void.
assert.equal(remainingQuantityByProduct({ items: [{ id: 'a', productId: 'p', quantity: 1 }], refunds: [{ items: [{ cartItemId: 'a', quantity: 1 }] }] } as any).has('p'), false);

// The cart warns per line when the combined quantity of a product exceeds recorded stock.
const flagged = oversoldCartItems([{ id: 'l1', productId: 'teh', quantity: 4 }, { id: 'l2', productId: 'teh', quantity: 2 }, { id: 'l3', productId: 'kopi', quantity: 1 }],
  [{ id: 'teh', stock: 5 }, { id: 'kopi', stock: 10 }]);
assert.deepEqual([...flagged.keys()], ['l1', 'l2']);
assert.equal(flagged.get('l1'), 5);
console.log('PASS: void restores only unrefunded quantity, stock is never silently clamped, oversell warning per cart line');
