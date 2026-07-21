const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const router = express.Router();

// price/quantity use .positive() (not nonnegative) to match the original
// `!price`/`!quantity` truthy checks, which also rejected 0.
const cartItemSchema = z.object({
  id:       z.string().min(1, 'id, price and quantity are required.').max(200),
  name:     z.string().trim().max(200).optional(),
  price:    z.coerce.number({ error: 'id, price and quantity are required.' }).positive('id, price and quantity are required.').max(100000),
  image:    z.string().trim().max(2000).optional().nullable(),
  color:    z.string().trim().max(50).optional(),
  size:     z.string().trim().max(50).optional(),
  quantity: z.coerce.number({ error: 'id, price and quantity are required.' }).positive('id, price and quantity are required.'),
});
const cartPatchSchema = z.object({
  color:    z.string().trim().max(50).optional(),
  size:     z.string().trim().max(50).optional(),
  quantity: z.coerce.number().finite().optional(),
});
// Loose per-item shape on purpose: the handler already does
// `if (!item.id || !item.price) continue;` and skips bad entries rather
// than failing the whole sync, so this only caps size/length — it doesn't
// require price/quantity to be positive (that would turn one bad local-
// storage entry into a full 400 instead of a silent skip).
const cartSyncSchema = z.object({
  items: z.array(z.object({
    id:       z.string().max(200).optional(),
    name:     z.string().trim().max(200).optional(),
    price:    z.coerce.number().max(100000).optional(),
    image:    z.string().trim().max(2000).optional().nullable(),
    color:    z.string().trim().max(50).optional(),
    size:     z.string().trim().max(50).optional(),
    quantity: z.coerce.number().optional(),
  })).max(50, 'Too many items to sync at once.').optional(),
});

// ══════════════════════════════════════════════
// GET /api/cart — ดึง cart ของ user
// ══════════════════════════════════════════════
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM carts WHERE user_id=$1 ORDER BY added_at ASC',
      [req.user.id]
    );
    res.json({ cart: r.rows });
  } catch(e) {
    console.error('[CART GET]', e.message);
    res.status(500).json({ error: e.message || 'Server error.' });
  }
});

// ══════════════════════════════════════════════
// POST /api/cart — เพิ่ม / อัปเดต item
// body: { id, name, price, image, color, size, quantity }
// ══════════════════════════════════════════════
router.post('/', requireAuth, validate(cartItemSchema), async (req, res) => {
  try {
    const { id, name, price, image, color, size, quantity } = req.body;
    const qty = Math.min(Math.max(parseInt(quantity) || 1, 1), 10);

    // Upsert: ถ้ามี key เดียวกัน (user+product+color+size) → บวก qty, ไม่เกิน 10
    await query(
      `INSERT INTO carts(user_id, product_id, name, price, image, color, size, quantity)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, product_id, color, size)
       DO UPDATE SET
         quantity  = LEAST(carts.quantity + EXCLUDED.quantity, 10),
         name      = EXCLUDED.name,
         price     = EXCLUDED.price,
         image     = EXCLUDED.image,
         added_at  = NOW()`,
      [req.user.id, id, name||id, Number(price), image||null, color||'', size||'', qty]
    );

    const r = await query('SELECT * FROM carts WHERE user_id=$1 ORDER BY added_at ASC', [req.user.id]);
    res.json({ ok: true, cart: r.rows });
  } catch(e) {
    console.error('[CART POST]', e.message);
    res.status(500).json({ error: e.message || 'Server error.' });
  }
});

// ══════════════════════════════════════════════
// PATCH /api/cart/:product_id — อัปเดต qty
// body: { color, size, quantity }
// ══════════════════════════════════════════════
router.patch('/:product_id', requireAuth, validate(cartPatchSchema), async (req, res) => {
  try {
    const { color, size, quantity } = req.body;
    const qty = Math.min(Math.max(parseInt(quantity) || 1, 1), 10);
    await query(
      `UPDATE carts SET quantity=$1
       WHERE user_id=$2 AND product_id=$3 AND color=$4 AND size=$5`,
      [qty, req.user.id, req.params.product_id, color||'', size||'']
    );
    const r = await query('SELECT * FROM carts WHERE user_id=$1 ORDER BY added_at ASC', [req.user.id]);
    res.json({ ok: true, cart: r.rows });
  } catch(e) {
    console.error('[CART PATCH]', e.message);
    res.status(500).json({ error: e.message || 'Server error.' });
  }
});

// ══════════════════════════════════════════════
// DELETE /api/cart/:product_id — ลบ item
// query: ?color=&size=
// ══════════════════════════════════════════════
router.delete('/:product_id', requireAuth, async (req, res) => {
  try {
    const { color, size } = req.query;
    await query(
      'DELETE FROM carts WHERE user_id=$1 AND product_id=$2 AND color=$3 AND size=$4',
      [req.user.id, req.params.product_id, color||'', size||'']
    );
    const r = await query('SELECT * FROM carts WHERE user_id=$1 ORDER BY added_at ASC', [req.user.id]);
    res.json({ ok: true, cart: r.rows });
  } catch(e) {
    console.error('[CART DELETE]', e.message);
    res.status(500).json({ error: e.message || 'Server error.' });
  }
});

// ══════════════════════════════════════════════
// DELETE /api/cart — ล้าง cart ทั้งหมด (หลัง checkout)
// ══════════════════════════════════════════════
router.delete('/', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM carts WHERE user_id=$1', [req.user.id]);
    res.json({ ok: true, cart: [] });
  } catch(e) {
    console.error('[CART CLEAR]', e.message);
    res.status(500).json({ error: e.message || 'Server error.' });
  }
});

// ══════════════════════════════════════════════
// POST /api/cart/sync — sync local cart เข้า server (เรียกตอน login)
// body: { items: [{id,name,price,image,color,size,quantity}] }
// ══════════════════════════════════════════════
router.post('/sync', requireAuth, validate(cartSyncSchema), async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.json({ ok: true, cart: [] });
    }
    // Insert แต่ละ item ด้วย ON CONFLICT (ไม่ลบของเดิม — merge)
    for (const item of items) {
      if (!item.id || !item.price) continue;
      const qty = Math.min(Math.max(parseInt(item.quantity) || 1, 1), 10);
      await query(
        `INSERT INTO carts(user_id, product_id, name, price, image, color, size, quantity)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (user_id, product_id, color, size)
         DO UPDATE SET quantity = LEAST(carts.quantity + EXCLUDED.quantity, 10)`,
        [req.user.id, item.id, item.name||item.id, Number(item.price),
         item.image||null, item.color||'', item.size||'', qty]
      );
    }
    const r = await query('SELECT * FROM carts WHERE user_id=$1 ORDER BY added_at ASC', [req.user.id]);
    res.json({ ok: true, cart: r.rows });
  } catch(e) {
    console.error('[CART SYNC]', e.message);
    res.status(500).json({ error: e.message || 'Server error.' });
  }
});

module.exports = router;
