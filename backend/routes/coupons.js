const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const router = express.Router();

// ── Validation schemas ──────────────────────────────────────────
const dateField = z.coerce.date().optional().nullable().transform(d => d ? d.toISOString().slice(0, 10) : d);
const couponTypeEnum = z.enum(['percent', 'fixed', 'freeship'], { error: 'Invalid type.' });

// Create requires code+type (matches existing POST /seller behavior).
const couponCreateSchema = z.object({
  code:        z.string().trim().min(1, 'Coupon code is required.').max(32)
                 .regex(/^[A-Za-z0-9_-]+$/, 'Coupon code can only contain letters, numbers, - and _.'),
  description: z.string().trim().max(500).optional().nullable(),
  type:        couponTypeEnum,
  value:       z.coerce.number().finite().nonnegative().max(100000).optional(),
  min_order:   z.coerce.number().finite().nonnegative().max(100000).optional(),
  usage_limit: z.coerce.number().int().nonnegative().max(1000000).optional(),
  start_date:  dateField,
  expiry_date: dateField,
  active:      z.boolean().optional(),
})
  .refine(d => d.type === 'freeship' || (d.value !== undefined && d.value > 0),
    { message: 'Discount value must be greater than 0.', path: ['value'] })
  .refine(d => d.type !== 'percent' || d.value === undefined || d.value <= 100,
    { message: 'Percent discount cannot exceed 100.', path: ['value'] })
  .refine(d => !(d.start_date && d.expiry_date) || d.expiry_date >= d.start_date,
    { message: 'Expiry date must be on or after the start date.', path: ['expiry_date'] });

// PATCH /seller/:id never reads `code` from the body (route only updates the
// other fields) — this schema doesn't include it either. `type`, if
// provided, is now re-validated against the same enum as create, closing
// the gap where an update could set it to an arbitrary string.
const couponUpdateSchema = z.object({
  description: z.string().trim().max(500).optional().nullable(),
  type:        couponTypeEnum.optional().nullable(),
  value:       z.coerce.number().finite().nonnegative().max(100000).optional().nullable(),
  min_order:   z.coerce.number().finite().nonnegative().max(100000).optional().nullable(),
  usage_limit: z.coerce.number().int().nonnegative().max(1000000).optional().nullable(),
  start_date:  dateField,
  expiry_date: dateField,
  active:      z.boolean().optional().nullable(),
})
  .refine(d => d.type !== 'percent' || d.value == null || d.value <= 100,
    { message: 'Percent discount cannot exceed 100.', path: ['value'] })
  .refine(d => !(d.start_date && d.expiry_date) || d.expiry_date >= d.start_date,
    { message: 'Expiry date must be on or after the start date.', path: ['expiry_date'] });

// Seller/admin gate — consolidated 2026-07-22 into the central requireRole()
// in middleware/auth.js (was a copy-pasted duplicate of seller.js's version).
const requireSeller = requireRole('seller', 'admin');

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
router.post('/seller', requireAuth, requireSeller, validate(couponCreateSchema), async (req, res) => {
  try {
    const { code, description, type, value, min_order, usage_limit, start_date, expiry_date, active } = req.body;
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
router.patch('/seller/:id', requireAuth, requireSeller, validate(couponUpdateSchema), async (req, res) => {
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