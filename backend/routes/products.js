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
//   shop_id  = <uuid>     (shop profile page — docs/06-shop-profile-follow-blueprint.md)
//   shop     = <slug>     (same, when the caller only has the slug on hand — e.g. arrived
//                          via /shop/:slug and hasn't resolved the shop's real id yet)
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
    const shopId   = req.query.shop_id?.trim() || null;
    const shopSlug = req.query.shop?.trim()    || null;

    // ── WHERE ── (p. prefix needed once we JOIN shops — both tables have a `name` column)
    const conditions = ['p.is_active = true'];
    const params = [];

    // Phase 3 of the categories migration (2026-07-25) — resolve the ?category=
    // slug through the categories table (matches p.category_id) instead of a
    // raw text comparison, since category_id is now the real source of truth
    // (dual-written on every product create/edit). Still also matches on the
    // raw p.category text as a fallback, purely defensive: covers any product
    // whose category text doesn't resolve to a categories row (none exist in
    // real data today, but nothing enforces that at the DB level either) —
    // same query param name/format the frontend already sends, no API
    // contract change.
    if (category) {
      params.push(category);
      const idx = params.length;
      conditions.push(`(p.category_id = (SELECT id FROM categories WHERE slug = $${idx}) OR p.category = $${idx})`);
    }
    if (isNew) {
      conditions.push('p.is_new = true');
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
    }
    if (shopId) {
      params.push(shopId);
      conditions.push(`p.shop_id = $${params.length}`);
    } else if (shopSlug) {
      // Same "resolve slug through a subquery" shape as ?category= above —
      // no match just means an empty product list, not an error (the shop
      // page itself is what 404s on an unknown slug, via shopPublic.js).
      params.push(shopSlug);
      conditions.push(`p.shop_id = (SELECT id FROM shops WHERE store_slug = $${params.length})`);
    }

    const where = 'WHERE ' + conditions.join(' AND ');

    // ── ORDER BY ──
    const orderMap = {
      newest:     'p.created_at DESC',
      price_asc:  'p.price ASC',
      price_desc: 'p.price DESC',
      name:       'p.name ASC',
    };
    const orderBy = orderMap[sort] || 'p.created_at DESC';

    // ── COUNT (total) ──
    const countRes = await query(
      `SELECT COUNT(*) FROM products p ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    // ── FETCH ── LEFT JOIN shops: shop_id is nullable (products created before Phase 4,
    // or orphaned if a shop is ever removed without cascading — see CLAUDE.md §4) so a
    // product must still show up even with no matching shop row.
    //
    // units_sold: only joined when the request is shop-scoped (shop_id/shop
    // given). shop.html's "Best-selling" sort is client-side, same as every
    // other sort option on the site (all-products.html's SORT_OPTS pattern
    // re-sorts the already-fetched array, no re-fetch per sort change) --
    // so this is just extra per-product data the client sorts by, not a new
    // `sort=` value here. Kept conditional so all-products.html/index.html/
    // new-arrival.html's unscoped browsing never pays for this join, since
    // none of them have a "Best-selling" option today.
    const scoped = shopId || shopSlug;
    const soldJoin = scoped
      ? `LEFT JOIN (
           SELECT oi.product_id, SUM(oi.quantity) AS units_sold
           FROM order_shops os JOIN order_items oi ON oi.order_shop_id = os.id
           WHERE os.status IN ('paid','processing','shipped','delivered')
           GROUP BY oi.product_id
         ) sold ON sold.product_id = p.id`
      : '';
    const soldSelect = scoped ? ', COALESCE(sold.units_sold, 0) AS units_sold' : '';

    params.push(limit, offset);
    const r = await query(
      `SELECT p.id, p.name, p.description, p.price, p.sale_price, p.category, p.category_id,
              p.images, p.colors, p.sizes, p.stock, p.is_new, p.is_active, p.created_at,
              p.shop_id, s.name AS shop_name, s.logo AS shop_logo${soldSelect}
       FROM products p
       LEFT JOIN shops s ON p.shop_id = s.id
       ${soldJoin}
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
      `SELECT p.*, s.name AS shop_name, s.logo AS shop_logo
       FROM products p
       LEFT JOIN shops s ON p.shop_id = s.id
       WHERE p.id = $1 AND p.is_active = true`,
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
