const express = require('express');
const { query }       = require('../db');
const { requireAuth } = require('../middleware/auth');
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
    const r = await query(
      `SELECT *,
        CASE WHEN status='pending' AND expires_at IS NOT NULL AND NOW() > expires_at
             THEN 'expired' ELSE status END AS computed_status
       FROM orders WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found.' });
    const order = r.rows[0];
    // auto-expire on-demand: ถ้าหมดเวลาแล้วยัง pending อยู่ → update และ return expired
    if (order.status === 'pending' && order.expires_at && new Date() > new Date(order.expires_at)) {
      await query(
        "UPDATE orders SET status='expired', cancelled_by='system', cancel_reason='Payment window expired (24h)' WHERE id=$1",
        [order.id]
      ).catch(()=>{});
      order.status = 'expired';
      order.cancelled_by = 'system';
      order.cancel_reason = 'Payment window expired (24h)';
    }
    res.json({ order });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// POST /api/orders/:id/cancel
router.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const r = await query(
      "UPDATE orders SET status='cancelled', cancelled_by='customer', cancel_reason='Cancelled by customer' WHERE id=$1 AND user_id=$2 AND status IN ('pending','pending_verification') RETURNING *",
      [req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'Cannot cancel this order.' });
    res.json({ ok: true, order: r.rows[0] });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
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