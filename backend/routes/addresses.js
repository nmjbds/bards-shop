const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET /api/addresses
router.get('/', requireAuth, async (req, res) => {
  try {
  const r = await query(
  `SELECT * FROM addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at ASC`,
  [req.user.id]
);
    res.json({ addresses: r.rows });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// POST /api/addresses
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, phone, address, city, province, postal_code, is_default } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'Name and address are required.' });
    // If new address is default, unset others
    if (is_default) {
      await query('UPDATE addresses SET is_default=false WHERE user_id=$1', [req.user.id]);
    }
    const r = await query(
  `INSERT INTO addresses(user_id, name, phone, address, city, province, postal_code, is_default)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [req.user.id, name, phone||null, address, city||null, province||null, postal_code||null, !!is_default]
);
    res.status(201).json({ address: r.rows[0] });
  } catch(e) { console.error('[ADDR POST]', e.message); res.status(500).json({ error: e.message || 'Server error.' }); }
});

// PATCH /api/addresses/:id
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { name, phone, address, city, province, postal_code, is_default } = req.body;

    // จัดการ is_default แยกออกมาก่อน เพราะ COALESCE กับ false จะสับสน
    if (is_default === true) {
      await query('UPDATE addresses SET is_default=false WHERE user_id=$1', [req.user.id]);
    }

    // อัปเดต fields อื่นๆ โดยไม่แตะ is_default ถ้าไม่ได้ส่งมา
    const updates = [];
    const params = [];
    let idx = 1;

    if (name    !== undefined) { updates.push(`name=$${idx++}`);    params.push(name); }
    if (phone    !== undefined) { updates.push(`phone=$${idx++}`);       params.push(phone || null); }
    if (address !== undefined) { updates.push(`address=$${idx++}`); params.push(address); }
    if (city     !== undefined) { updates.push(`city=$${idx++}`);        params.push(city || null); }
    if (province !== undefined) { updates.push(`province=$${idx++}`);    params.push(province || null); }
    if (postal_code !== undefined) { updates.push(`postal_code=$${idx++}`); params.push(postal_code || null); }
    if (is_default !== undefined) { updates.push(`is_default=$${idx++}`); params.push(!!is_default); }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });

    params.push(req.params.id, req.user.id);
    const sql = `UPDATE addresses SET ${updates.join(',')} WHERE id=$${idx} AND user_id=$${idx+1} RETURNING *`;
    const r = await query(sql, params);

    if (!r.rows.length) return res.status(404).json({ error: 'Address not found.' });
    res.json({ address: r.rows[0] });
  } catch(e) { console.error('[ADDR PATCH]', e.message); res.status(500).json({ error: e.message || 'Server error.' }); }
});

// DELETE /api/addresses/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM addresses WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch(e) { console.error('[ADDR DELETE]', e.message); res.status(500).json({ error: e.message || 'Server error.' }); }
});

// POST /api/addresses/:id/set-default
router.post('/:id/set-default', requireAuth, async (req, res) => {
  try {
    await query('UPDATE addresses SET is_default=false WHERE user_id=$1', [req.user.id]);
    await query('UPDATE addresses SET is_default=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch(e) { console.error('[ADDR SET-DEFAULT]', e.message); res.status(500).json({ error: e.message || 'Server error.' }); }
});

module.exports = router;