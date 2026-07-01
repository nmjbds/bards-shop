const express = require('express');
const { query } = require('../db');
const router = express.Router();

// ══════════════════════════════════════════════════════════════
// GET /api/products
// Public — หน้าร้านค้า ดึงสินค้าแบบ pagination + filter + search
//
// Query params:
//   page     = 1         (default 1)
//   limit    = 24        (default 24, max 100)
//   category = tops | pants | accessories | ...
//   search   = polo      (ILIKE name/description)
//   sort     = newest | price_asc | price_desc | name
//   new      = true      (เฉพาะ is_new=true)
// ══════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit) || 24));
    const offset   = (page - 1) * limit;
    const category = req.query.category?.trim() || null;
    const search   = req.query.search?.trim()   || null;
    const isNew    = req.query.new === 'true';
    const sort     = req.query.sort || 'newest';

    // ── WHERE ──
    const conditions = ['is_active = true'];
    const params = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (isNew) {
      conditions.push('is_new = true');
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }

    const where = 'WHERE ' + conditions.join(' AND ');

    // ── ORDER BY ──
    const orderMap = {
      newest:     'created_at DESC',
      price_asc:  'price ASC',
      price_desc: 'price DESC',
      name:       'name ASC',
    };
    const orderBy = orderMap[sort] || 'created_at DESC';

    // ── COUNT (total) ──
    const countRes = await query(
      `SELECT COUNT(*) FROM products ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    // ── FETCH ──
    params.push(limit, offset);
    const r = await query(
      `SELECT id, name, description, price, sale_price, category,
              images, colors, sizes, stock, is_new, is_active, created_at
       FROM products
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      products:   r.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext:    page * limit < total,
        hasPrev:    page > 1,
      },
    });
  } catch(e) {
    console.error('[PRODUCTS GET]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/products/:id
// Public — ดึงสินค้าชิ้นเดียว
// ══════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM products WHERE id = $1 AND is_active = true`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: r.rows[0] });
  } catch(e) {
    console.error('[PRODUCTS GET/:id]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
