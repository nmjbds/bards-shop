require('dotenv').config();
const express  = require('express');
const QRCode   = require('qrcode');
const { query }       = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// ══════════════════════════════════════════════
// KHQR Builder — ABA_MERCHANT_PAYLOAD + CRC16
// ══════════════════════════════════════════════

// CRC16-CCITT-FALSE
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

// Build EMV TLV field: ID(2) + LENGTH(2 zero-padded) + VALUE
function emvField(id, value) {
  const v = String(value);
  return id + String(v.length).padStart(2, '0') + v;
}

// Walk top-level EMV TLV fields
function walkEMV(payload) {
  const fields = [];
  let pos = 0;
  while (pos < payload.length) {
    const id     = payload.substring(pos, pos + 2);
    const lenStr = payload.substring(pos + 2, pos + 4);
    const len    = parseInt(lenStr, 10);
    if (isNaN(len)) break;
    const value  = payload.substring(pos + 4, pos + 4 + len);
    fields.push({ id, lenStr, len, value });
    if (id === '63') break;
    pos += 4 + len;
  }
  return fields;
}

// Build dynamic KHQR จาก static merchant payload + amount + orderId
function buildQR(amount, orderId) {
  const base   = process.env.ABA_MERCHANT_PAYLOAD || '';
  if (!base) throw new Error('ABA_MERCHANT_PAYLOAD not set in .env');
  const fields = walkEMV(base.replace(/6304[0-9A-Fa-f]{4}$/, ''));

  // subfield 05 = Reference Label (order ID)
  const ref   = (orderId || '').slice(0, 25);
  const sub05 = ref ? emvField('05', ref) : '';

  // Rebuild payload — preserve all fields, inject sub05 into field 62
  let rebuilt = '';
  for (const f of fields) {
    if (f.id === '54' || f.id === '63') continue;
    if (f.id === '62') {
      rebuilt += emvField('62', f.value + sub05);
    } else {
      rebuilt += f.id + f.lenStr + f.value;
    }
  }

  // Insert field 54 (amount) before field 58 (5802KH)
  const amtStr = Number(amount).toFixed(2);
  const f54    = emvField('54', amtStr);
  const pos58  = rebuilt.indexOf('5802KH');
  rebuilt = pos58 !== -1
    ? rebuilt.slice(0, pos58) + f54 + rebuilt.slice(pos58)
    : rebuilt + f54;

  rebuilt += '6304';
  rebuilt += crc16(rebuilt);
  return rebuilt;
}

function makeOrderId() {
  return 'BRD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// ══════════════════════════════════════════════
// POST /api/payment/create
// ══════════════════════════════════════════════
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { items, subtotal, shipping, total, address, couponCode, discount } = req.body;
    if (!items?.length || !total || total <= 0) {
      return res.status(400).json({ error: 'Invalid order data.' });
    }

    const orderId       = makeOrderId();
    const expirySeconds = parseInt(process.env.QR_EXPIRY_SECONDS || '86400');
    const expiresAt     = new Date(Date.now() + expirySeconds * 1000);

    // Build KHQR payload
    const qrPayload = buildQR(total, orderId);

    // Generate QR image (base64 PNG)
    const qrImage = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    // Save order (รวม discount + coupon_code)
    await query(
      `INSERT INTO orders(id,user_id,items,subtotal,shipping,discount,coupon_code,total,address,status,qr_payload,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)`,
      [
        orderId, req.user.id,
        JSON.stringify(items),
        Number(subtotal),
        Number(shipping || 0),
        Number(discount || 0),
        couponCode?.trim() || null,
        Number(total),
        JSON.stringify(address || {}),
        qrPayload,
        expiresAt,
      ]
    );

    // Increment coupon used_count ถ้ามีการใช้ coupon
    if (couponCode) {
      await query(
        'UPDATE coupons SET used_count = used_count + 1 WHERE UPPER(code)=UPPER($1)',
        [couponCode.trim()]
      ).catch(err => console.error('[COUPON] increment failed:', err.message));
    }

    res.json({
      orderId,
      qrPayload,
      qrImage,       // base64 PNG — ใช้กับ <img src="..."> ได้เลย
      amount: Number(total),
      expiresAt: expiresAt.toISOString(),
      expirySeconds,
    });
  } catch(e) {
  console.error('[PAYMENT ERROR]', e.message);
  res.status(500).json({ error: e.message || 'Server error.' });
}
});

// ══════════════════════════════════════════════
// GET /api/payment/link/:orderId — public, for pay.html
// ══════════════════════════════════════════════
router.get('/link/:orderId', async (req, res) => {
  try {
    const r = await query(
      'SELECT id,status,subtotal,shipping,discount,coupon_code,total,items,address,qr_payload,expires_at,cancelled_by,cancel_reason FROM orders WHERE id=$1',
      [req.params.orderId]
    );
    const o = r.rows[0];
    if (!o) return res.status(404).json({ error: 'Order not found.' });

    // Auto-expire: ถ้าหมดเวลา 24h → expired + cancelled_by=system
    if (o.status === 'pending' && o.expires_at && new Date() > new Date(o.expires_at)) {
      await query(
        "UPDATE orders SET status='expired', cancelled_by='system', cancel_reason='Payment window expired (24h)' WHERE id=$1",
        [o.id]
      );
      o.status = 'expired';
      o.cancelled_by = 'system';
    }

    // Generate QR image จาก payload ที่เก็บไว้
    let qrImage = null;
    if (o.qr_payload && o.status === 'pending') {
      qrImage = await QRCode.toDataURL(o.qr_payload, {
        errorCorrectionLevel: 'M',
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
    }

    res.json({ ...o, qrImage });
  } catch(e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════
// POST /api/payment/send-link/:orderId — seller ส่ง pay link
// ══════════════════════════════════════════════
router.post('/send-link/:orderId', requireAuth, async (req, res) => {
  try {
    const r = await query(
      "SELECT id,status,total,expires_at FROM orders WHERE id=$1 AND status IN ('pending','pending_verification')",
      [req.params.orderId]
    );
    const o = r.rows[0];
    if (!o) return res.status(400).json({ error: 'Order not found or already paid.' });
    const link = `${process.env.FRONTEND_URL || ''}/pay.html?id=${o.id}`;
    res.json({ ok: true, link, orderId: o.id, total: o.total });
  } catch(e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════
// POST /api/payment/confirm/:orderId
// customer หรือ seller กด confirm
// ══════════════════════════════════════════════
router.post('/confirm/:orderId', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const roleRes = await query('SELECT role FROM users WHERE id=$1', [req.user.id]);
    const role    = roleRes.rows[0]?.role;
    let r;
    if (['seller', 'admin'].includes(role)) {
      // seller/admin confirm ได้ทุก order
      r = await query(
        "UPDATE orders SET status='paid', confirmed_at=NOW() WHERE id=$1 RETURNING id",
        [orderId]
      );
    } else {
      // customer confirm เฉพาะ order ตัวเอง
      r = await query(
        "UPDATE orders SET status='paid', confirmed_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING id",
        [orderId, req.user.id]
      );
    }
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found.' });
    res.json({ ok: true, status: 'paid', orderId });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════
// GET /api/payment/status/:orderId
// ══════════════════════════════════════════════
router.get('/status/:orderId', requireAuth, async (req, res) => {
  try {
    const r = await query(
      'SELECT id,status,total,expires_at,confirmed_at FROM orders WHERE id=$1 AND user_id=$2',
      [req.params.orderId, req.user.id]
    );
    const o = r.rows[0];
    if (!o) return res.status(404).json({ error: 'Order not found.' });

    // Auto-expire
    if (o.status === 'pending' && o.expires_at && new Date() > new Date(o.expires_at)) {
      await query(
        "UPDATE orders SET status='expired', cancelled_by='system', cancel_reason='Payment window expired (24h)' WHERE id=$1",
        [o.id]
      );
      return res.json({ orderId: o.id, status: 'expired', cancelledBy: 'system' });
    }

    res.json({
      orderId:     o.id,
      status:      o.status,
      total:       o.total,
      confirmedAt: o.confirmed_at,
    });
  } catch(e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// backward compat alias
router.get('/verify/:orderId', requireAuth, async (req, res) => {
  req.params.orderId = req.params.orderId;
  const r = await query(
    'SELECT id,status,total,expires_at FROM orders WHERE id=$1 AND user_id=$2',
    [req.params.orderId, req.user.id]
  ).catch(() => ({ rows: [] }));
  const o = r.rows[0];
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (o.status === 'pending' && o.expires_at && new Date() > new Date(o.expires_at)) {
    await query("UPDATE orders SET status='expired' WHERE id=$1", [o.id]).catch(() => {});
    return res.json({ status: 'expired', orderId: o.id });
  }
  res.json({ status: o.status, orderId: o.id, total: o.total });
});

module.exports = router;