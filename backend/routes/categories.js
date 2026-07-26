const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
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

// ── Admin UI Step 4 (2026-07-26) — category management ─────────────────
// เดิมมีแค่ GET public ด้านบน (list เฉพาะ is_active=true, field จำกัด) เพิ่ม
// CRUD เต็มสำหรับ admin: list ทุกแถว (รวม inactive) พร้อมจำนวนสินค้าที่ผูกอยู่
// ต่อหมวด (ใช้ตัดสินใจว่าจะลบได้ไหม), สร้าง/แก้/ลบ — ทุก route ผ่าน
// requireAuth+requireRole('admin') เท่านั้น ไม่มี seller access เพราะหมวดหมู่
// เป็น platform-wide taxonomy ไม่ใช่ของแต่ละร้าน (ต่างจาก products/coupons)
const slugSchema = z.string().trim().min(1).max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers, and hyphens only (e.g. "new-arrivals").');

const categoryCreateSchema = z.object({
  name:             z.string().trim().min(1, 'Name is required.').max(80),
  slug:             slugSchema,
  image:            z.string().trim().max(2000).optional().nullable(),
  color:            z.string().trim().max(20).optional().nullable(),
  sort_order:       z.coerce.number().int().optional(),
  is_active:        z.boolean().optional(),
  show_on_homepage: z.boolean().optional(),
});
const categoryUpdateSchema = categoryCreateSchema.partial();

// GET /api/categories/admin — every category (incl. inactive) + live product
// count per category, for the admin list/delete-guard. Registered before
// any /:id route so the literal "admin" segment can't be swallowed by a
// param route later.
router.get('/admin', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const r = await query(
      `SELECT c.*, COUNT(p.id)::int AS product_count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name ASC`
    );
    res.json({ categories: r.rows });
  } catch(e) {
    console.error('[CATEGORIES ADMIN GET]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/categories — admin: create a new category
router.post('/', requireAuth, requireRole('admin'), validate(categoryCreateSchema), async (req, res) => {
  try {
    const { name, slug, image, color, sort_order, is_active, show_on_homepage } = req.body;
    const r = await query(
      `INSERT INTO categories(name, slug, image, color, sort_order, is_active, show_on_homepage)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        name, slug, image || null, color || null,
        sort_order ?? 0,
        is_active ?? true,
        show_on_homepage ?? true,
      ]
    );
    res.status(201).json({ category: r.rows[0] });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A category with this slug already exists.' });
    console.error('[CATEGORIES POST]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /api/categories/:id — admin: edit any field
router.patch('/:id', requireAuth, requireRole('admin'), validate(categoryUpdateSchema), async (req, res) => {
  try {
    const { name, slug, image, color, sort_order, is_active, show_on_homepage } = req.body;
    const updates = [];
    const params  = [];
    let idx = 1;
    if (name             !== undefined) { updates.push(`name=$${idx++}`);             params.push(name); }
    if (slug             !== undefined) { updates.push(`slug=$${idx++}`);             params.push(slug); }
    if (image            !== undefined) { updates.push(`image=$${idx++}`);            params.push(image || null); }
    if (color            !== undefined) { updates.push(`color=$${idx++}`);            params.push(color || null); }
    if (sort_order       !== undefined) { updates.push(`sort_order=$${idx++}`);       params.push(sort_order); }
    if (is_active        !== undefined) { updates.push(`is_active=$${idx++}`);        params.push(is_active); }
    if (show_on_homepage !== undefined) { updates.push(`show_on_homepage=$${idx++}`); params.push(show_on_homepage); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
    updates.push(`updated_at=NOW()`);

    params.push(req.params.id);
    const r = await query(
      `UPDATE categories SET ${updates.join(',')} WHERE id=$${idx} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Category not found.' });
    res.json({ category: r.rows[0] });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A category with this slug already exists.' });
    console.error('[CATEGORIES PATCH]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/categories/:id — admin: hard delete, blocked while any product
// still references it (no ON DELETE CASCADE on products.category_id, on
// purpose — see CLAUDE.md §4 — a category disappearing must never silently
// orphan/hide products). Check the count up front for a friendly message;
// the FK error (23503) is still caught as a belt-and-suspenders fallback in
// case of a race with a product being (re)assigned concurrently.
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const existing = await query('SELECT id FROM categories WHERE id=$1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Category not found.' });

    const count = await query('SELECT COUNT(*)::int AS n FROM products WHERE category_id=$1', [req.params.id]);
    if (count.rows[0].n > 0) {
      return res.status(409).json({
        error: `Cannot delete — ${count.rows[0].n} product(s) still use this category. Move them first, or hide it instead by turning off "Visible".`,
      });
    }

    await query('DELETE FROM categories WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    if (e.code === '23503') return res.status(409).json({ error: 'Cannot delete — category still has products attached.' });
    console.error('[CATEGORIES DELETE]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
