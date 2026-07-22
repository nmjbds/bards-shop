require('dotenv').config();
const express  = require('express');
const QRCode   = require('qrcode');
const { z } = require('zod');
const { query, pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { expireIfNeeded } = require('../services/orderLifecycle');
const { restoreStock } = require('../services/stock');
const aba = require('../services/abaPayway');
const { settleOrderPayment } = require('../services/paymentSettlement');
const router = express.Router();

// ── Validation ───────────────────────────────────────────────────
// Caps *shape and size*, not the pricing/stock math below (which already
// re-derives price/subtotal/discount from the DB and clamps quantity 1-10
// per line — that logic is untouched). This just stops someone from sending
// a 10,000-line order or a megabyte-long address field.
const createOrderSchema = z.object({
  items: z.array(z.object({
    id:       z.string().min(1).max(200),
    color:    z.string().max(50).optional(),
    size:     z.string().max(50).optional(),
    quantity: z.number(),
  })).min(1, 'Invalid order data.').max(50, 'Too many items in one order.'),
  shipping:   z.number().optional(),
  couponCode: z.string().trim().max(32).optional().nullable(),
  address: z.object({
    name:     z.string().trim().max(100).optional(),
    phone:    z.string().trim().max(30).optional(),
    line:     z.string().trim().max(300).optional(),
    line2:    z.string().trim().max(300).optional(),
    province: z.string().trim().max(100).optional(),
    note:     z.string().trim().max(500).optional(),
  }).optional(),
});

/* ════════════════════════════════════════════════════════════════════
 * LEGACY — static KHQR builder (ABA_MERCHANT_PAYLOAD + CRC16)
 *
 * Disabled 2026-07-18: this generated a KHQR string entirely locally and
 * never called ABA's API, so there was nothing on ABA's side to check a
 * payment's real status against — /confirm had to just take the caller's
 * word for it. Replaced by services/abaPayway.js (real Purchase +
 * Check Transaction API calls). Kept here for reference, not deleted —
 * do not remove without checking with the team first.
 * ════════════════════════════════════════════════════════════════════

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

  const ref   = (orderId || '').slice(0, 25);
  const sub05 = ref ? emvField('05', ref) : '';

  let rebuilt = '';
  for (const f of fields) {
    if (f.id === '54' || f.id === '63') continue;
    if (f.id === '62') {
      rebuilt += emvField('62', f.value + sub05);
    } else {
      rebuilt += f.id + f.lenStr + f.value;
    }
  }

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
 * ════════════════════════════════════════════════════════════════════ */

function makeOrderId() {
  return 'BRD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function renderQrImage(qrString) {
  return QRCode.toDataURL(qrString, {
    errorCorrectionLevel: 'M',
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

// ══════════════════════════════════════════════
// POST /api/payment/create
// Phase 1 (DB transaction): lock stock, recompute price/coupon from the DB,
// insert the order. Phase 2 (after commit): register the transaction with
// ABA PayWay so there's a real tran_id ABA knows about to check later. If
// phase 2 fails, the reservation is rolled back (stock restored, order
// marked 'failed') — we never leave a paid-looking order with no real ABA
// transaction behind it.
// ══════════════════════════════════════════════
router.post('/create', requireAuth, validate(createOrderSchema), async (req, res) => {
  const { items, shipping, address, couponCode } = req.body;
  const shippingCost = Math.max(0, Number(shipping) || 0);

  const client = await pool.connect();
  let orderId, expiresAt, expirySeconds, total;
  try {
    await client.query('BEGIN');

    const merged = new Map();
    for (const it of items) {
      if (!it?.id || !(Number(it.quantity) > 0)) continue;
      const qty = Math.min(Math.max(parseInt(it.quantity) || 0, 1), 10);
      const key = `${it.id}::${it.color || ''}::${it.size || ''}`;
      const prev = merged.get(key);
      merged.set(key, { id: it.id, color: it.color || '', size: it.size || '', quantity: (prev?.quantity || 0) + qty });
    }
    if (!merged.size) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid order data.' });
    }

    const orderItems = [];
    let subtotal = 0;

    for (const line of merged.values()) {
      const pr = await client.query(
        'SELECT id, name, price, sale_price, stock, is_active, images, shop_id FROM products WHERE id=$1 FOR UPDATE',
        [line.id]
      );
      const product = pr.rows[0];
      if (!product || !product.is_active) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Product no longer available: ${line.id}` });
      }
      if (product.stock != null && product.stock < line.quantity) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Not enough stock for "${product.name}" (${product.stock} left).`,
          code: 'OUT_OF_STOCK',
        });
      }
      if (product.stock != null) {
        await client.query('UPDATE products SET stock = stock - $1 WHERE id=$2', [line.quantity, product.id]);
      }

      const unitPrice = product.sale_price != null ? Number(product.sale_price) : Number(product.price);
      subtotal += unitPrice * line.quantity;
      orderItems.push({
        id: product.id,
        name: product.name,
        price: unitPrice,
        image: Array.isArray(product.images) ? (product.images[0] || null) : null,
        color: line.color,
        size: line.size,
        quantity: line.quantity,
        shop_id: product.shop_id || null,
      });
    }
    subtotal = Math.round(subtotal * 100) / 100;

    let discount = 0;
    let appliedCouponCode = null;
    if (couponCode) {
      const cr = await client.query(
        `SELECT * FROM coupons WHERE UPPER(code)=UPPER($1) AND active=true
           AND (start_date IS NULL OR start_date <= CURRENT_DATE)
           AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
         FOR UPDATE`,
        [couponCode.trim()]
      );
      const c = cr.rows[0];
      if (!c) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid or expired coupon code.' });
      }
      if (c.usage_limit > 0 && c.used_count >= c.usage_limit) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'This coupon has reached its usage limit.' });
      }
      if (c.min_order > 0 && subtotal < Number(c.min_order)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Minimum order $${Number(c.min_order).toFixed(2)} required for this coupon.` });
      }
      if (c.type === 'percent') discount = subtotal * Number(c.value) / 100;
      if (c.type === 'fixed')   discount = Math.min(Number(c.value), subtotal);
      discount = Math.round(discount * 100) / 100;
      appliedCouponCode = c.code;
      await client.query('UPDATE coupons SET used_count = used_count + 1 WHERE id=$1', [c.id]);
    }

    total = Math.round((subtotal - discount + shippingCost) * 100) / 100;
    if (total <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid order total.' });
    }

    orderId       = makeOrderId();
    expirySeconds = parseInt(process.env.QR_EXPIRY_SECONDS || '86400');
    expiresAt     = new Date(Date.now() + expirySeconds * 1000);

    await client.query(
      `INSERT INTO orders(id,user_id,items,subtotal,shipping,discount,coupon_code,total,address,status,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)`,
      [
        orderId, req.user.id,
        JSON.stringify(orderItems),
        subtotal,
        shippingCost,
        discount,
        appliedCouponCode,
        total,
        JSON.stringify(address || {}),
        expiresAt,
      ]
    );

    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PAYMENT ERROR]', e.message);
    return res.status(500).json({ error: e.message || 'Server error.' });
  } finally {
    client.release();
  }

  // Phase 2 — register with ABA PayWay. Reservation is already committed at
  // this point, so a failure here must compensate (restore stock, fail the order).
  try {
    const { httpOk, data } = await aba.createPurchase({ tranId: orderId, amount: total });
    if (!httpOk || !aba.isPurchaseSuccess(data)) {
      throw new Error(`ABA purchase failed (status ${aba.statusCode(data)}): ${JSON.stringify(data).slice(0, 300)}`);
    }

    const qrString = aba.extractQrString(data);
    if (!qrString) throw new Error(`ABA purchase succeeded but no qr_string in response: ${JSON.stringify(data).slice(0, 300)}`);

    await query(
      `INSERT INTO payments(order_id, provider, provider_ref, amount, status, raw_response)
       VALUES($1,'aba_payway',$2,$3,'pending',$4)`,
      [orderId, orderId, total, JSON.stringify(data)]
    );
    await query('UPDATE orders SET qr_payload=$1, payment_ref=$2 WHERE id=$3', [qrString, orderId, orderId]);

    const qrImage = await renderQrImage(qrString);
    res.json({
      orderId,
      qrPayload: qrString,
      deeplink: aba.extractDeeplink(data),
      qrImage,
      amount: total,
      expiresAt: expiresAt.toISOString(),
      expirySeconds,
    });
  } catch (e) {
    console.error('[ABA PURCHASE ERROR]', e.message);
    // Compensate: give back the stock/coupon reservation and fail the order.
    const compClient = await pool.connect();
    try {
      await compClient.query('BEGIN');
      const upd = await compClient.query(
        "UPDATE orders SET status='failed', cancel_reason='ABA PayWay purchase failed' WHERE id=$1 AND status='pending' RETURNING items",
        [orderId]
      );
      if (upd.rows.length) {
        await restoreStock(compClient, upd.rows[0].items);
      }
      await compClient.query('COMMIT');
    } catch (compErr) {
      await compClient.query('ROLLBACK').catch(() => {});
      console.error('[COMPENSATION ERROR]', compErr.message);
    } finally {
      compClient.release();
    }
    res.status(502).json({ error: 'Could not create a payment with ABA PayWay. Please try again.', code: 'ABA_PURCHASE_FAILED' });
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

    // Auto-expire: ถ้าหมดเวลา 24h → expired + cancelled_by=system + คืน stock
    // (endpoint นี้ public ไม่มี auth — เอาแค่ status/cancelled_by/cancel_reason
    // กลับมาจาก helper ไม่ spread ทั้ง row เพราะ SELECT * มี user_id ด้วย)
    if (o.status === 'pending' && o.expires_at && new Date() > new Date(o.expires_at)) {
      const updated = await expireIfNeeded(o.id);
      if (updated) {
        o.status = updated.status;
        o.cancelled_by = updated.cancelled_by;
        o.cancel_reason = updated.cancel_reason;
      }
    }

    let qrImage = null;
    if (o.qr_payload && o.status === 'pending') {
      qrImage = await renderQrImage(o.qr_payload);
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
// Does NOT take the caller's word for it — this only *triggers* a real
// check-transaction-2 call to ABA PayWay via settleOrderPayment(). Only the
// order's owner or a seller/admin may trigger the check; the result always
// comes from ABA, never from req.body.
// ══════════════════════════════════════════════
router.post('/confirm/:orderId', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderRes = await query('SELECT user_id FROM orders WHERE id=$1', [orderId]);
    if (!orderRes.rows.length) return res.status(404).json({ error: 'Order not found.' });

    if (orderRes.rows[0].user_id !== req.user.id) {
      const roleRes = await query('SELECT role FROM users WHERE id=$1', [req.user.id]);
      if (!['seller', 'admin'].includes(roleRes.rows[0]?.role)) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const result = await settleOrderPayment(orderId);
    if (!result.ok) return res.status(result.httpStatus || 500).json({ error: result.error });
    res.json({ ok: true, status: result.status, orderId });
  } catch(e) {
    console.error('[CONFIRM ERROR]', e.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ══════════════════════════════════════════════
// POST /api/payment/webhook — ABA PayWay calls this on its own when a
// payment succeeds. We don't trust the payload's status either — a webhook
// call is only a *hint to re-check now*; settleOrderPayment() always asks
// ABA directly via check-transaction-2 before touching order/payment status.
// Always answer 200 for a structurally valid request so ABA doesn't retry-storm us.
// ══════════════════════════════════════════════
router.post('/webhook', async (req, res) => {
  const tranId = req.body?.tran_id || req.body?.tranId;
  if (!tranId) return res.status(400).json({ error: 'Missing tran_id.' });
  try {
    await settleOrderPayment(tranId);
  } catch(e) {
    console.error('[WEBHOOK ERROR]', e.message);
  }
  res.status(200).json({ received: true });
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

    // Auto-expire (คืน stock ที่กันไว้ตอน checkout ด้วย)
    if (o.status === 'pending' && o.expires_at && new Date() > new Date(o.expires_at)) {
      await expireIfNeeded(o.id);
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
    await expireIfNeeded(o.id).catch(() => {});
    return res.json({ status: 'expired', orderId: o.id });
  }
  res.json({ status: o.status, orderId: o.id, total: o.total });
});

module.exports = router;
