const { pool } = require('../db');
const { restoreStock } = require('./stock');

// Atomically flips a pending order past its payment window to 'expired' and
// gives back the stock reserved at checkout. Row lock + status guard means
// concurrent callers (GET /orders/:id, GET /payment/status, GET /payment/link
// all poll this) only ever restore stock once per order.
async function expireIfNeeded(orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
    const order = r.rows[0];
    if (!order) { await client.query('ROLLBACK'); return null; }

    if (order.status === 'pending' && order.expires_at && new Date() > new Date(order.expires_at)) {
      const upd = await client.query(
        `UPDATE orders SET status='expired', cancelled_by='system',
                cancel_reason='Payment window expired (24h)'
         WHERE id=$1 RETURNING *`,
        [orderId]
      );
      // Phase 5 Step 2 (2026-07-25) — mirror onto order_shops, same rationale as
      // paymentSettlement.js: only fires while still 'pending' (before this
      // order's expires_at), which is before any per-shop divergence is possible,
      // so applying uniformly to every shop here is safe.
      await client.query(
        `UPDATE order_shops SET status='expired', cancelled_by='system',
                cancel_reason='Payment window expired (24h)' WHERE order_id=$1`,
        [orderId]
      );
      await restoreStock(client, order.items);
      await client.query('COMMIT');
      return upd.rows[0];
    }

    await client.query('COMMIT');
    return order;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { expireIfNeeded };
