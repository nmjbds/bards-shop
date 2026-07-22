const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const router = express.Router();

// ── Validation schemas ──────────────────────────────────────────
const shopApplySchema = z.object({
  name:        z.string().trim().min(1, 'Shop name is required.').max(100),
  description: z.string().trim().max(1000).optional().nullable(),
  logo:        z.string().trim().max(2000).optional().nullable(),
});

const shopUpdateSchema = z.object({
  name:        z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  logo:        z.string().trim().max(2000).optional().nullable(),
});

const statusEnum = z.enum(['pending', 'approved', 'rejected', 'suspended'], { error: 'Invalid status.' });
const shopStatusSchema = z.object({ status: statusEnum });

// Allowed to apply for a shop — same role gate used everywhere else in the
// project (no central requireSeller yet, see CLAUDE.md §2/§9).
async function requireSellerOrAdmin(req, res, next) {
  try {
    const r = await query('SELECT role FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length || !['seller', 'admin'].includes(r.rows[0].role)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    next();
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
}

// ── POST /api/shops/apply ── create own shop (one per seller — DB enforces
// via UNIQUE owner_user_id). Always starts 'pending', even for admins —
// keeps the review step consistent regardless of who's applying.
router.post('/apply', requireAuth, requireSellerOrAdmin, validate(shopApplySchema), async (req, res) => {
  try {
    const { name, description, logo } = req.body;
    const r = await query(
      `INSERT INTO shops(owner_user_id, name, description, logo, status)
       VALUES($1,$2,$3,$4,'pending') RETURNING *`,
      [req.user.id, name, description || null, logo || null]
    );
    res.status(201).json({ shop: r.rows[0] });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'You already have a shop.' });
    console.error(e); res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/shops/me ── own shop status (for the seller dashboard to show
// pending/approved/rejected/suspended, or prompt to apply if none yet)
router.get('/me', requireAuth, requireSellerOrAdmin, async (req, res) => {
  try {
    const r = await query('SELECT * FROM shops WHERE owner_user_id=$1', [req.user.id]);
    res.json({ shop: r.rows[0] || null });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/shops/me ── seller edits own shop's name/description/logo.
// Does not touch status — approval state is admin-only (see PATCH /:id).
router.patch('/me', requireAuth, requireSellerOrAdmin, validate(shopUpdateSchema), async (req, res) => {
  try {
    const { name, description, logo } = req.body;
    const updates = [];
    const params  = [];
    let idx = 1;
    if (name        !== undefined) { updates.push(`name=$${idx++}`);        params.push(name); }
    if (description !== undefined) { updates.push(`description=$${idx++}`); params.push(description || null); }
    if (logo        !== undefined) { updates.push(`logo=$${idx++}`);        params.push(logo || null); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
    updates.push(`updated_at=NOW()`);

    params.push(req.user.id);
    const r = await query(
      `UPDATE shops SET ${updates.join(',')} WHERE owner_user_id=$${idx} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No shop found — apply first.' });
    res.json({ shop: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── GET /api/shops ── admin: list all shops (review queue). ?status= filter
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const status = req.query.status || null;
    const r = status
      ? await query(
          `SELECT s.*, u.name AS owner_name, u.email AS owner_email
           FROM shops s JOIN users u ON u.id=s.owner_user_id
           WHERE s.status=$1 ORDER BY s.created_at DESC`,
          [status]
        )
      : await query(
          `SELECT s.*, u.name AS owner_name, u.email AS owner_email
           FROM shops s JOIN users u ON u.id=s.owner_user_id
           ORDER BY s.created_at DESC`
        );
    res.json({ shops: r.rows });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/shops/:id ── admin: approve / reject / suspend
router.patch('/:id', requireAuth, requireRole('admin'), validate(shopStatusSchema), async (req, res) => {
  try {
    const { status } = req.body;
    const r = await query(
      `UPDATE shops SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Shop not found.' });
    res.json({ ok: true, shop: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
