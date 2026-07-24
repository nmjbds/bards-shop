const express = require('express');
const { query, pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { expireIfNeeded } = require('../services/orderLifecycle');
const { restoreStock } = require('../services/stock');
const router = express.Router();

// Phase 5 Step 3 (2026-07-25) — attaches a `shops` breakdown to one or more
// orders, additively: every existing flat field (items/status/seller_note/
// tracking_number/cancelled_by/cancel_reason/...) is untouched, still read
// straight off `orders` exactly as before (still correctly dual-written by
// Step 2) — nothing that already worked changes. `shops` is new data for
// pages that want a genuine per-shop view (order-detail.html); pages that
// don't look at it (orders.html, account.html, payment.html, pay.html,
// checkout.html) are unaffected, since the headline status/items they
// already show is order-level by nature (payment is one transaction
// regardless of shop count) and doesn't need per-shop granularity.
async function attachShops(orders) {
  if (!orders.length) return orders;
  const orderIds = orders.map(o => o.id);
  const shopsRes = await query(
    `SELECT os.id AS order_shop_id, os.order_id, os.shop_id, os.status, os.seller_note,
            os.tracking_number, os.cancelled_by, os.cancel_reason, os.subtotal,
            s.name AS shop_name, s.logo AS shop_logo
     FROM order_shops os LEFT JOIN shops s ON s.id = os.shop_id
     WHERE os.order_id = ANY($1::text[])
     ORDER BY os.created_at ASC`,
    [orderIds]
  );
  const shopRowIds = shopsRes.rows.map(r => r.order_shop_id);
  const itemsRes = shopRowIds.length
    ? await query(
        `SELECT order_shop_id, product_id AS id, name, price, image, color, size, quantity
         FROM order_items WHERE order_shop_id = ANY($1::uuid[])`,
        [shopRowIds]
      )
    : { rows: [] };

  const itemsByShopRow = new Map();
  for (const it of itemsRes.rows) {
    if (!itemsByShopRow.has(it.order_shop_id)) itemsByShopRow.set(it.order_shop_id, []);
    itemsByShopRow.get(it.order_shop_id).push({
      id: it.id, name: it.name, price: Number(it.price),
      image: it.image, color: it.color, size: it.size, quantity: it.quantity,
    });
  }

  const shopsByOrder = new Map();
  for (const row of shopsRes.rows) {
    if (!shopsByOrder.has(row.order_id)) shopsByOrder.set(row.order_id, []);
    shopsByOrder.get(row.order_id).push({
      shop_id: row.shop_id,
      shop_name: row.shop_name || 'BARDS',
      shop_logo: row.shop_logo || null,
      status: row.status,
      seller_note: row.seller_note,
      tracking_number: row.tracking_number,
      cancelled_by: row.cancelled_by,
      cancel_reason: row.cancel_reason,
      subtotal: row.subtotal,
      items: itemsByShopRow.get(row.order_shop_id) || [],
    });
  }

  for (const o of orders) o.shops = shopsByOrder.get(o.id) || [];
  return orders;
}

// GET /api/orders
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    const orders = await attachShops(r.rows);
    res.json({ orders });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// GET /api/orders/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found.' });
    let order = r.rows[0];
    // auto-expire on-demand: ถ้าหมดเวลาแล้วยัง pending อยู่ → update, คืน stock, return expired
    if (order.status === 'pending' && order.expires_at && new Date() > new Date(order.expires_at)) {
      order = (await expireIfNeeded(order.id).catch(() => null)) || order;
    }
    [order] = await attachShops([order]);
    res.json({ order });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// POST /api/orders/:id/cancel
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE orders SET status='cancelled', cancelled_by='customer', cancel_reason='Cancelled by customer'
       WHERE id=$1 AND user_id=$2 AND status IN ('pending','pending_verification')
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot cancel this order.' });
    }
    // Phase 5 Step 2 (2026-07-25) — mirror onto order_shops, same rationale as
    // settleOrderPayment()/expireIfNeeded(): only reachable while still
    // pending/pending_verification, before any per-shop divergence is
    // possible, so a uniform update across every shop on this order is safe.
    await client.query(
      `UPDATE order_shops SET status='cancelled', cancelled_by='customer',
              cancel_reason='Cancelled by customer' WHERE order_id=$1`,
      [req.params.id]
    );
    await restoreStock(client, r.rows[0].items);
    await client.query('COMMIT');
    res.json({ ok: true, order: r.rows[0] });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
});

module.exports = router;