const express = require('express');
const { query } = require('../db');
const router = express.Router();

// ══════════════════════════════════════════════════════════════
// GET /api/categories
// Public — list active categories, for the homepage card grid,
// categories.html's tabs, and (Phase 4 of the categories migration)
// seller-products.html's category dropdown. Ordered by sort_order so the
// display order is DB-driven now instead of hardcoded in products.js's
// CATEGORIES array.
// ══════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const r = await query(
      `SELECT id, name, slug, parent_id, image, color, sort_order, show_on_homepage
       FROM categories
       WHERE is_active = true
       ORDER BY sort_order ASC, name ASC`
    );
    res.json({ categories: r.rows });
  } catch(e) {
    console.error('[CATEGORIES GET]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
