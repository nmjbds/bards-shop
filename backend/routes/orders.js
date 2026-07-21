const express = require('express');
const { query, pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { expireIfNeeded } = require('../services/orderLifecycle');
const { restoreStock } = require('../services/stock');
const router = express.Router();

// GET /api/orders
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ orders: r.rows });
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

// POST /api/orders/:id/pending — customer clicked "I've Paid"
router.post('/:id/pending', requireAuth, async (req, res) => {
  try {
    await query(
      "UPDATE orders SET status='pending_verification' WHERE id=$1 AND user_id=$2 AND status='pending'",
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;