// Stock is a single counter per product (schema has no per-variant stock —
// color/size are just labels), so restore/decrement always target products.id.
// stock IS NOT NULL guard matches the "null = unlimited/untracked" convention
// used by seller.js product create (stock left null on purpose).

async function restoreStock(client, items) {
  for (const item of items || []) {
    const qty = Number(item?.quantity);
    if (!item?.id || !(qty > 0)) continue;
    await client.query(
      'UPDATE products SET stock = stock + $1 WHERE id=$2 AND stock IS NOT NULL',
      [qty, item.id]
    );
  }
}

module.exports = { restoreStock };
