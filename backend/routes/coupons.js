const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ── Seller/admin middleware (copy pattern จาก seller.js) ──
async function requireSeller(req, res, next) {
  try {
    const r = await query('SELECT role FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length || !['seller','admin'].includes(r.rows[0].role)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    next();
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
}

// ════════════════════════════════════════
// PUBLIC / CHECKOUT ROUTES
// ════════════════════════════════════════

// POST /api/coupons/validate — validate coupon at checkout
router.post('/validate', async (req, res) => {
  try {
    const { code, total } = req.body;
    if (!code) return res.status(400).json({ error: 'Coupon code is required.' });

    const r = await query(
      `SELECT * FROM coupons
       WHERE UPPER(code)=UPPER($1) AND active=true
         AND (start_date IS NULL OR start_date <= CURRENT_DATE)
         AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)`,
      [code.trim()]
    );
    const c = r.rows[0];
    if (!c) return res.status(400).json({ error: 'Invalid or expired coupon code.' });
    if (c.usage_limit > 0 && c.used_count >= c.usage_limit) {
      return res.status(400).json({ error: 'This coupon has reached its usage limit.' });
    }
    if (c.min_order > 0 && Number(total) < Number(c.min_order)) {
      return res.status(400).json({
        error: `Minimum order $${Number(c.min_order).toFixed(2)} required for this coupon.`
      });
    }

    let discount = 0;
    if (c.type === 'percent')  discount = Number(total) * Number(c.value) / 100;
    if (c.type === 'fixed')    discount = Math.min(Number(c.value), Number(total));
    if (c.type === 'freeship') discount = 0;

    res.json({
      ok: true,
      coupon: {
        id: c.id, code: c.code, type: c.type,
        value: Number(c.value), discount: parseFloat(discount.toFixed(2)),
        freeShipping: c.type === 'freeship',
      }
    });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// POST /api/coupons/use — increment used_count (เรียกจาก server หลัง order สร้างสำเร็จ)
// ยังคง endpoint นี้ไว้สำหรับ backward compat แต่ไม่ควร expose ให้ client เรียกตรงๆ
// ใน payment.js ควรเรียก incrementCouponUsage() แทน
router.post('/use', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required.' });
    await query(
      'UPDATE coupons SET used_count = used_count + 1 WHERE UPPER(code)=UPPER($1)',
      [code.trim()]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// ════════════════════════════════════════
// SELLER CRUD ROUTES (เพิ่มใหม่)
// ════════════════════════════════════════

// GET /api/coupons/seller — list all coupons (seller only)
router.get('/seller', requireAuth, requireSeller, async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM coupons ORDER BY created_at DESC'
    );
    res.json({ coupons: r.rows });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// POST /api/coupons/seller — create coupon (seller only)
router.post('/seller', requireAuth, requireSeller, async (req, res) => {
  try {
    const { code, description, type, value, min_order, usage_limit, start_date, expiry_date, active } = req.body;
    if (!code) return res.status(400).json({ error: 'Coupon code is required.' });
    if (!['percent','fixed','freeship'].includes(type)) return res.status(400).json({ error: 'Invalid type.' });
    if (type !== 'freeship' && (!value || Number(value) <= 0)) {
      return res.status(400).json({ error: 'Discount value must be greater than 0.' });
    }
    // ตรวจ duplicate code
    const dup = await query('SELECT id FROM coupons WHERE UPPER(code)=UPPER($1)', [code.trim()]);
    if (dup.rows.length) return res.status(409).json({ error: 'Coupon code already exists.' });

    const r = await query(
      `INSERT INTO coupons(code, description, type, value, min_order, usage_limit, start_date, expiry_date, active, used_count)
       VALUES(UPPER($1), $2, $3, $4, $5, $6, $7, $8, $9, 0) RETURNING *`,
      [
        code.trim(),
        description || null,
        type,
        type === 'freeship' ? 0 : Number(value),
        Number(min_order) || 0,
        parseInt(usage_limit) || 0,
        start_date || null,
        expiry_date || null,
        active !== false,
      ]
    );
    res.status(201).json({ coupon: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// PATCH /api/coupons/seller/:id — update coupon (seller only)
router.patch('/seller/:id', requireAuth, requireSeller, async (req, res) => {
  try {
    const { description, type, value, min_order, usage_limit, start_date, expiry_date, active } = req.body;
    const r = await query(
      `UPDATE coupons
       SET description=COALESCE($1,description),
           type=COALESCE($2,type),
           value=COALESCE($3,value),
           min_order=COALESCE($4,min_order),
           usage_limit=COALESCE($5,usage_limit),
           start_date=COALESCE($6,start_date),
           expiry_date=COALESCE($7,expiry_date),
           active=COALESCE($8,active)
       WHERE id=$9 RETURNING *`,
      [
        description ?? null,
        type ?? null,
        value != null ? Number(value) : null,
        min_order != null ? Number(min_order) : null,
        usage_limit != null ? parseInt(usage_limit) : null,
        start_date ?? null,
        expiry_date ?? null,
        active ?? null,
        req.params.id,
      ]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Coupon not found.' });
    res.json({ coupon: r.rows[0] });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// DELETE /api/coupons/seller/:id — delete coupon (seller only)
router.delete('/seller/:id', requireAuth, requireSeller, async (req, res) => {
  try {
    await query('DELETE FROM coupons WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;