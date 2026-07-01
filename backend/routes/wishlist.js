const express = require('express');
const { query }       = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT product_id FROM wishlists WHERE user_id=$1 ORDER BY added_at DESC', [req.user.id]);
    res.json({ wishlist: r.rows.map(row => row.product_id) });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

router.post('/:productId', requireAuth, async (req, res) => {
  try {
    await query('INSERT INTO wishlists(user_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.user.id, req.params.productId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

router.delete('/:productId', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM wishlists WHERE user_id=$1 AND product_id=$2', [req.user.id, req.params.productId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
