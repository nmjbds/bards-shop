const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ══════════════════════════════════════════════════════════════
// Public shop storefront reads + the follow system
// (docs/06-shop-profile-follow-blueprint.md) — mounted ONLY on
// server-customer.js, at /api/shops. Deliberately a separate file from
// routes/shops.js (mounted on seller./admin. instead) rather than adding
// customer-facing routes there — that file is written entirely for the
// seller/admin audience (imports getOwnApprovedShop, requireRole('admin')
// throughout); mixing in public reads would break the project's
// one-router-per-audience convention. No path collision either way since
// shops.js is never mounted on this server at all.
// ══════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared SELECT for both lookup paths below — status='approved' always
// enforced, and a bare 404 either way (never "not approved") so a
// guessable slug/id can't be used to probe a pending/rejected/suspended
// shop's existence — same "don't leak status via the error" pattern the
// payment-link token check already uses elsewhere in this project.
async function fetchApprovedShop(column, value) {
  const r = await query(
    `SELECT s.id, s.name, s.description, s.logo, s.cover_url, s.store_slug, s.created_at,
            s.owner_user_id,
            (SELECT COUNT(*) FROM shop_follows WHERE shop_id = s.id) AS follower_count,
            (SELECT COUNT(*) FROM products WHERE shop_id = s.id AND is_active = true) AS product_count
     FROM shops s
     WHERE s.${column} = $1 AND s.status = 'approved'`,
    [value]
  );
  return r.rows[0] || null;
}

// GET /api/shops/slug/:slug — public. Primary lookup path.
router.get('/slug/:slug', async (req, res) => {
  try {
    const shop = await fetchApprovedShop('store_slug', req.params.slug);
    if (!shop) return res.status(404).json({ error: 'Shop not found.' });
    res.json({ shop });
  } catch(e) {
    console.error('[SHOP PUBLIC GET /slug]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/shops/id/:id — public. Fallback for shops with no store_slug set
// (store_slug is optional at apply time — see blueprint's slug-coverage
// note; this route exists so those shops aren't simply unreachable).
router.get('/id/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Shop not found.' });
    const shop = await fetchApprovedShop('id', req.params.id);
    if (!shop) return res.status(404).json({ error: 'Shop not found.' });
    res.json({ shop });
  } catch(e) {
    console.error('[SHOP PUBLIC GET /id]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/shops/:id/follow — requireAuth
router.post('/:id/follow', requireAuth, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Shop not found.' });
    const shopRes = await query(`SELECT id FROM shops WHERE id=$1 AND status='approved'`, [req.params.id]);
    if (!shopRes.rows.length) return res.status(404).json({ error: 'Shop not found.' });
    // ON CONFLICT DO NOTHING: the UNIQUE(user_id, shop_id) constraint is the
    // real safety net against a double-click race (blueprint §5.4 edge case
    // 3) — this makes a repeat POST idempotent instead of erroring.
    await query(
      `INSERT INTO shop_follows (user_id, shop_id) VALUES ($1, $2) ON CONFLICT (user_id, shop_id) DO NOTHING`,
      [req.user.id, req.params.id]
    );
    res.json({ following: true });
  } catch(e) {
    console.error('[SHOP FOLLOW POST]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/shops/:id/follow — requireAuth. No shop-status check here on
// purpose: unfollowing must always work even if the shop got suspended
// after the user followed it (blueprint §5.4 edge case 4 — follows are
// never auto-deleted, so the reverse action can't be blocked either).
router.delete('/:id/follow', requireAuth, async (req, res) => {
  try {
    await query(`DELETE FROM shop_follows WHERE user_id=$1 AND shop_id=$2`, [req.user.id, req.params.id]);
    res.json({ following: false });
  } catch(e) {
    console.error('[SHOP FOLLOW DELETE]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/shops/:id/follow-status — requireAuth
router.get('/:id/follow-status', requireAuth, async (req, res) => {
  try {
    const r = await query(`SELECT 1 FROM shop_follows WHERE user_id=$1 AND shop_id=$2`, [req.user.id, req.params.id]);
    res.json({ following: r.rows.length > 0 });
  } catch(e) {
    console.error('[SHOP FOLLOW STATUS]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
