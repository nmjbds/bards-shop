const express = require('express');
const crypto  = require('crypto');
const { z } = require('zod');
const { query, pool } = require('../db');
const { requireAuth, requireRole, getOwnApprovedShop } = require('../middleware/auth');
const { validate, MIME_EXT } = require('../middleware/validate');
const { restoreStock } = require('../services/stock');
const router = express.Router();

// Seller/admin gate — was a locally copy-pasted requireSeller() (same logic
// duplicated in coupons.js, and a third variant inline in payment.js);
// consolidated 2026-07-22 into the central requireRole() in middleware/auth.js,
// which stamps req.userRole the same way this local version used to.
const requireSeller = requireRole('seller', 'admin');

// ── Validation schemas ──────────────────────────────────────────
// images/colors/sizes arrive either as a real array or a JSON-encoded
// string (see parseArr() below, unchanged) — accept both shapes here, just
// cap size so a request can't smuggle an unbounded payload into JSONB.
const stringArrayField = z.union([
  z.array(z.string().max(500)).max(20),
  z.string().max(20000),
]).optional();

const productCreateSchema = z.object({
  name:        z.string().trim().min(1, 'Product name is required.').max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  price:       z.coerce.number({ error: 'Price is required.' }).positive('Price is required.').max(100000),
  sale_price:  z.coerce.number().finite().nonnegative().max(100000).optional().nullable(),
  category:    z.string().trim().max(50).optional().nullable(),
  images: stringArrayField, colors: stringArrayField, sizes: stringArrayField,
  stock:     z.union([z.coerce.number().int().nonnegative().max(1000000), z.null()]).optional(),
  is_new:    z.boolean().optional(),
  is_active: z.boolean().optional(),
});
// Same fields, all optional — PATCH only touches fields that are present.
const productUpdateSchema = z.object({
  name:        z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  price:       z.coerce.number().finite().nonnegative().max(100000).optional(),
  sale_price:  z.coerce.number().finite().nonnegative().max(100000).optional().nullable(),
  category:    z.string().trim().max(50).optional().nullable(),
  images: stringArrayField, colors: stringArrayField, sizes: stringArrayField,
  stock:     z.union([z.coerce.number().int().nonnegative().max(1000000), z.null()]).optional(),
  is_new:    z.boolean().optional(),
  is_active: z.boolean().optional(),
});
const orderUpdateSchema = z.object({
  status:          z.string().max(50).optional(),
  seller_note:     z.string().trim().max(2000).optional().nullable(),
  tracking_number: z.string().trim().max(100).optional().nullable(),
});
const orderNoteSchema = z.object({
  seller_note: z.string().trim().max(2000).optional().nullable(),
});
const makeSellerSchema = z.object({
  email:  z.string().trim().max(200).email('Please enter a valid email address.'),
  secret: z.string().min(1).max(500),
});

// Constant-time comparison — the previous `secret !== process.env.ADMIN_SECRET`
// leaks timing information proportional to how many leading characters match.
function secretMatches(provided, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Cloudflare R2 Upload ──────────────────────────────────────
// ต้องติดตั้ง:  npm install @aws-sdk/client-s3 multer multer-memfile
// .env ที่ต้องมี:
//   R2_ACCOUNT_ID=xxxx
//   R2_ACCESS_KEY_ID=xxxx
//   R2_SECRET_ACCESS_KEY=xxxx
//   R2_BUCKET_NAME=bards-media
//   R2_PUBLIC_URL=https://cdn.bardskh.com   ← domain CDN ของคุณ
// ─────────────────────────────────────────────────────────────
let _uploadReady = false;
let multer, S3Client, PutObjectCommand;
try {
  multer        = require('multer');
  const s3mod   = require('@aws-sdk/client-s3');
  S3Client      = s3mod.S3Client;
  PutObjectCommand = s3mod.PutObjectCommand;
  _uploadReady  = true;
} catch(e) {
  console.warn('[R2] Missing packages — upload disabled. Run: npm install @aws-sdk/client-s3 multer');
}

function getR2Client() {
  const https = require('https');
  const { NodeHttpHandler } = require('@smithy/node-http-handler');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: new NodeHttpHandler({
      httpsAgent: new https.Agent({
        secureProtocol: 'TLSv1_2_method',
        rejectUnauthorized: true,
      }),
    }),
  });
}

// multer: รับไฟล์ใน memory (ไม่บันทึก disk) จำกัด 10MB ต่อไฟล์, max 17 ไฟล์
function makeUpload() {
  const storage = multer.memoryStorage();
  return multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Only image files are allowed'));
      }
      cb(null, true);
    },
  }).array('images', 17);
}

// ── POST /api/seller/upload ── อัปโหลดรูปไปยัง Cloudflare R2
// Form-data field: images (array, max 17)
// Returns: { urls: ['https://cdn.bardskh.com/images/xxx.jpg', ...] }
router.post('/upload', requireAuth, requireSeller, (req, res) => {
  if (!_uploadReady) {
    return res.status(503).json({ error: 'Upload not available. Run: npm install @aws-sdk/client-s3 multer' });
  }
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
    return res.status(503).json({ error: 'R2 environment variables not configured.' });
  }

  const upload = makeUpload();
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    const r2     = getR2Client();
    const bucket = process.env.R2_BUCKET_NAME || 'bards-media';
    const cdnBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

    try {
      const urls = await Promise.all(req.files.map(async (file) => {
        // Extension from the validated mimetype, not the client-controlled
        // originalname — avoids injecting arbitrary characters/paths into
        // the R2 object key via a crafted filename.
        const ext  = MIME_EXT[file.mimetype] || 'jpg';
        const key  = `images/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        await r2.send(new PutObjectCommand({
          Bucket:      bucket,
          Key:         key,
          Body:        file.buffer,
          ContentType: file.mimetype,
          // Public read — ต้องเปิด "Allow public access" ใน R2 dashboard ด้วย
          ACL:         'public-read',
        }));
        return cdnBase ? `${cdnBase}/${key}` : `https://${bucket}.r2.dev/${key}`;
      }));
      res.json({ urls });
    } catch(e) {
      console.error('[R2 UPLOAD]', e.message);
      res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
  });
});

// ── GET /api/seller/orders ── Phase 5 Step 2 (2026-07-25): reads from
// order_shops/order_items now instead of unnesting orders.items JSONB.
// admin: one row per (order, shop) pair across the whole platform — a
// multi-shop order now shows as separate rows, one per shop, each correctly
// scoped to that shop's own items/status (was one row per order with every
// shop's items mixed together under one whole-order status). seller: same
// query, filtered to their own shop_id. Every order that exists today has
// exactly one shop, so none of this changes what either role actually sees
// yet. `status`/`seller_note`/`tracking_number`/`cancelled_by`/
// `cancel_reason` now come from order_shops (this shop's own fulfillment
// state) — see PATCH /orders/:id below for how these stay in sync with the
// `orders` row that customer-facing pages still read directly.
router.get('/orders', requireAuth, requireSeller, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 200, 500);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status || null;
    const isAdmin = req.userRole === 'admin';

    let shopId = null;
    if (!isAdmin) {
      shopId = await getOwnApprovedShop(req.user.id);
      if (!shopId) return res.json({ orders: [] });
    }

    const conditions = [];
    const params = [];
    let idx = 1;
    if (status) { conditions.push(`os.status=$${idx++}`); params.push(status); }
    if (!isAdmin) { conditions.push(`os.shop_id=$${idx++}`); params.push(shopId); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const r = await query(
      `SELECT os.id AS order_shop_id, os.shop_id, os.subtotal AS own_subtotal,
              os.status, os.seller_note, os.tracking_number, os.cancelled_by, os.cancel_reason,
              o.id, o.user_id, o.subtotal, o.shipping, o.discount, o.coupon_code, o.total,
              o.address, o.payment_ref, o.qr_payload, o.expires_at, o.confirmed_at, o.pay_token,
              o.created_at,
              u.name AS customer_name, u.email AS customer_email
       FROM order_shops os
       JOIN orders o ON o.id = os.order_id
       LEFT JOIN users u ON o.user_id = u.id
       ${whereClause}
       ORDER BY o.created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    if (!r.rows.length) return res.json({ orders: [] });

    const itemsRes = await query(
      `SELECT order_shop_id, product_id AS id, name, price, image, color, size, quantity
       FROM order_items WHERE order_shop_id = ANY($1::uuid[])`,
      [r.rows.map(row => row.order_shop_id)]
    );
    const itemsByShopRow = new Map();
    for (const it of itemsRes.rows) {
      if (!itemsByShopRow.has(it.order_shop_id)) itemsByShopRow.set(it.order_shop_id, []);
      itemsByShopRow.get(it.order_shop_id).push({
        id: it.id, name: it.name, price: Number(it.price),
        image: it.image, color: it.color, size: it.size, quantity: it.quantity,
      });
    }

    const orders = r.rows.map(row => ({
      id: row.id,
      user_id: row.user_id,
      items: itemsByShopRow.get(row.order_shop_id) || [],
      subtotal: row.subtotal,
      shipping: row.shipping,
      discount: row.discount,
      coupon_code: row.coupon_code,
      total: row.total,
      address: row.address,
      status: row.status,
      seller_note: row.seller_note,
      tracking_number: row.tracking_number,
      cancelled_by: row.cancelled_by,
      cancel_reason: row.cancel_reason,
      payment_ref: row.payment_ref,
      qr_payload: row.qr_payload,
      expires_at: row.expires_at,
      confirmed_at: row.confirmed_at,
      pay_token: row.pay_token,
      created_at: row.created_at,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      own_subtotal: row.own_subtotal,
      shop_id: row.shop_id,
    }));

    res.json({ orders });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── Allowed status transitions (Marketplace standard) ──
// แต่ละสถานะไปได้เฉพาะสถานะที่กำหนดเท่านั้น
const ALLOWED_TRANSITIONS = {
  pending:              ['pending_verification', 'paid', 'cancelled'],
  pending_verification: ['paid', 'cancelled'],
  paid:                 ['processing', 'cancelled'],
  processing:           ['shipped', 'cancelled'],
  shipped:              ['delivered'],
  delivered:            [], // final state — ล็อคแล้ว
  cancelled:            [], // final state — ล็อคแล้ว
  expired:              [], // final state — ล็อคแล้ว
};

// ── PATCH /api/seller/orders/:id ── Phase 5 Step 2 (2026-07-25): now updates
// this shop's order_shops row, not the whole orders row — a seller can only
// ever act on their own shop's slice of an order (admin acts on every
// order_shops row for the order at once, mirroring the old "admin touches
// the whole order" behaviour — this route has no per-shop targeting for
// admin to pick just one shop within an order).
//
// Dual-write onto `orders` (status/seller_note/tracking_number/cancelled_by/
// cancel_reason): customer-facing pages still read these straight off
// `orders` until Step 3 migrates them, so they must not go stale.
//   - status: if every order_shops row for this order ends up with the SAME
//     status after this update, `orders` mirrors it exactly — the only case
//     that exists today (one shop per order, always uniform). If they've
//     diverged (only possible once a second real shop exists), orders.status/
//     cancelled_by/cancel_reason are left alone ("frozen") rather than
//     inventing an aggregate — a Step 3 concern once the customer UI can show
//     a real per-shop breakdown (confirmed with the project owner before
//     writing this).
//   - seller_note/tracking_number: simpler single-value fields, always
//     mirror whatever this specific PATCH just wrote (last-writer-wins if a
//     future multi-shop order has two sellers touching them — an accepted
//     rough edge until Step 3 gives orders.seller_note/tracking_number a
//     real per-shop home; not solvable while there's one shared column).
router.patch('/orders/:id', requireAuth, requireSeller, validate(orderUpdateSchema), async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, seller_note, tracking_number } = req.body;
    const isAdmin = req.userRole === 'admin';
    await client.query('BEGIN');

    // 1. Find which order_shops row(s) this caller may act on.
    let targetRows;
    if (isAdmin) {
      targetRows = (await client.query(
        'SELECT * FROM order_shops WHERE order_id=$1 FOR UPDATE', [req.params.id]
      )).rows;
    } else {
      const shopId = await getOwnApprovedShop(req.user.id);
      targetRows = shopId ? (await client.query(
        'SELECT * FROM order_shops WHERE order_id=$1 AND shop_id=$2 FOR UPDATE', [req.params.id, shopId]
      )).rows : [];
    }
    if (!targetRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found.' }); }

    // 2. Validate + apply the transition per targeted row — each row's own
    // current status governs what it may become (matters once shops can
    // genuinely diverge; today there's exactly one row per order, so this is
    // equivalent to the old single check).
    const isCancelled = status === 'cancelled';
    const trackingVal = tracking_number !== undefined && tracking_number !== null
      ? (tracking_number.trim() || null) : undefined;
    const updatedRows = [];
    for (const row of targetRows) {
      const allowed = ALLOWED_TRANSITIONS[row.status];
      if (!allowed) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Unknown current status: ${row.status}` }); }
      if (!allowed.includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Cannot change status from "${row.status}" to "${status}".`,
          allowedNext: allowed,
        });
      }
      const upd = await client.query(
        `UPDATE order_shops SET
           status = $1::text,
           seller_note = COALESCE($2::text, seller_note),
           tracking_number = COALESCE($3::text, tracking_number),
           cancelled_by = CASE WHEN $4 THEN 'seller' ELSE cancelled_by END,
           cancel_reason = CASE WHEN $4 THEN 'Cancelled by seller' ELSE cancel_reason END,
           updated_at = NOW()
         WHERE id=$5 RETURNING *`,
        [status, seller_note || null, trackingVal ?? null, isCancelled, row.id]
      );
      updatedRows.push(upd.rows[0]);
    }

    // 3. Cancelling returns stock reserved at checkout, scoped to just this
    // shop's own items — not the whole order. This is the actual behaviour
    // change Phase 5 exists for: a seller cancelling their own slice no
    // longer touches another shop's items/stock in the same order.
    if (isCancelled) {
      for (const row of updatedRows) {
        const itemsRes = await client.query(
          'SELECT product_id AS id, quantity FROM order_items WHERE order_shop_id=$1', [row.id]
        );
        await restoreStock(client, itemsRes.rows);
      }
    }

    // 4. Dual-write onto `orders` — see comment above the route.
    const distinctRes = await client.query('SELECT DISTINCT status FROM order_shops WHERE order_id=$1', [req.params.id]);
    if (distinctRes.rows.length === 1) {
      const uniformStatus = distinctRes.rows[0].status;
      await client.query(
        `UPDATE orders SET
           status = $1::text,
           confirmed_at = CASE WHEN $2 THEN NOW() ELSE confirmed_at END,
           cancelled_by = CASE WHEN $3 THEN 'seller' ELSE cancelled_by END,
           cancel_reason = CASE WHEN $3 THEN 'Cancelled by seller' ELSE cancel_reason END
         WHERE id=$4`,
        [uniformStatus, uniformStatus === 'paid', uniformStatus === 'cancelled', req.params.id]
      );
    }
    if (seller_note || trackingVal !== undefined) {
      const setParts = [];
      const dwParams = [];
      let dwIdx = 1;
      if (seller_note) { setParts.push(`seller_note=$${dwIdx++}`); dwParams.push(seller_note); }
      if (trackingVal !== undefined) { setParts.push(`tracking_number=$${dwIdx++}`); dwParams.push(trackingVal); }
      dwParams.push(req.params.id);
      await client.query(`UPDATE orders SET ${setParts.join(', ')} WHERE id=$${dwIdx}`, dwParams);
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      order: {
        id: req.params.id,
        status: updatedRows[0].status,
        seller_note: updatedRows[0].seller_note,
        tracking_number: updatedRows[0].tracking_number,
        cancelled_by: updatedRows[0].cancelled_by,
        cancel_reason: updatedRows[0].cancel_reason,
      },
    });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/seller/orders/:id/note ── Phase 5 Step 2 (2026-07-25): updates
// this shop's order_shops.seller_note (was orders.seller_note directly) —
// same ownership model as PATCH /orders/:id above, dual-writes onto `orders`
// for customer-facing compat the same unconditional way (single-value field,
// no status-divergence question to worry about here).
router.patch('/orders/:id/note', requireAuth, requireSeller, validate(orderNoteSchema), async (req, res) => {
  try {
    const { seller_note } = req.body;
    if (seller_note === undefined) return res.status(400).json({ error: 'seller_note is required.' });
    const isAdmin = req.userRole === 'admin';

    let targetIds;
    if (isAdmin) {
      targetIds = (await query('SELECT id FROM order_shops WHERE order_id=$1', [req.params.id])).rows.map(r => r.id);
    } else {
      const shopId = await getOwnApprovedShop(req.user.id);
      targetIds = shopId
        ? (await query('SELECT id FROM order_shops WHERE order_id=$1 AND shop_id=$2', [req.params.id, shopId])).rows.map(r => r.id)
        : [];
    }
    if (!targetIds.length) return res.status(404).json({ error: 'Order not found.' });

    await query(
      `UPDATE order_shops SET seller_note=$1, updated_at=NOW() WHERE id = ANY($2::uuid[])`,
      [seller_note || null, targetIds]
    );
    await query('UPDATE orders SET seller_note=$1 WHERE id=$2', [seller_note || null, req.params.id]);

    res.json({ ok: true, order: { id: req.params.id, seller_note: seller_note || null } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});


// Shop-scoped for sellers (Phase 4 follow-up, 2026-07-24; real tables since
// Phase 5 Step 2, 2026-07-25) — admin keeps seeing the exact same
// platform-wide queries as before (unchanged, still reads straight off
// `orders` — SUM(orders.total) correctly includes shipping/nets discounts,
// which summing order_items would not, so there's no reason to move admin's
// branch onto the new tables). A seller's branch now queries order_shops/
// order_items directly with a plain JOIN instead of unnesting orders.items
// JSONB (which is what Part A did on 2026-07-24, before order_shops
// existed) — same numbers, simpler/faster SQL, and status/breakdown now
// reflect this shop's own order_shops.status rather than the whole order's.
function zeroStats() {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return {
    totalOrders: 0, totalRevenue: 0, totalCustomers: 0, pendingOrders: 0,
    dailyRevenue: days.map(d => ({ day: d, revenue: 0 })),
    statusBreakdown: {}, topProducts: [],
  };
}

router.get('/stats', requireAuth, requireSeller, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    let shopId = null;
    if (!isAdmin) {
      shopId = await getOwnApprovedShop(req.user.id);
      if (!shopId) return res.json(zeroStats());
    }

    const [ordersRes, revenueRes, customersRes, pendingRes, dailyRes, statusRes, topRes] = await Promise.all([
      isAdmin
        ? query("SELECT COUNT(*) FROM orders WHERE status NOT IN ('cancelled','expired')")
        : query("SELECT COUNT(*) FROM order_shops WHERE shop_id=$1 AND status NOT IN ('cancelled','expired')", [shopId]),

      isAdmin
        ? query("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE status IN ('paid','processing','shipped','delivered')")
        : query(`
            SELECT COALESCE(SUM(oi.price * oi.quantity), 0) AS total
            FROM order_shops os JOIN order_items oi ON oi.order_shop_id = os.id
            WHERE os.shop_id=$1 AND os.status IN ('paid','processing','shipped','delivered')
          `, [shopId]),

      isAdmin
        ? query('SELECT COUNT(DISTINCT user_id) FROM orders')
        : query(`
            SELECT COUNT(DISTINCT o.user_id) FROM order_shops os
            JOIN orders o ON o.id = os.order_id WHERE os.shop_id=$1
          `, [shopId]),

      isAdmin
        ? query("SELECT COUNT(*) FROM orders WHERE status='pending_verification'")
        : query("SELECT COUNT(*) FROM order_shops WHERE shop_id=$1 AND status='pending_verification'", [shopId]),

      // Daily revenue — last 7 days
      isAdmin
        ? query(`
            SELECT
              TO_CHAR(created_at AT TIME ZONE 'UTC', 'Dy') AS day,
              COALESCE(SUM(total), 0) AS revenue
            FROM orders
            WHERE status IN ('paid','processing','shipped','delivered')
              AND created_at >= NOW() - INTERVAL '7 days'
            GROUP BY TO_CHAR(created_at AT TIME ZONE 'UTC', 'Dy'),
                     DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')
            ORDER BY DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')
          `)
        : query(`
            SELECT
              TO_CHAR(os.created_at AT TIME ZONE 'UTC', 'Dy') AS day,
              COALESCE(SUM(oi.price * oi.quantity), 0) AS revenue
            FROM order_shops os JOIN order_items oi ON oi.order_shop_id = os.id
            WHERE os.shop_id=$1 AND os.status IN ('paid','processing','shipped','delivered')
              AND os.created_at >= NOW() - INTERVAL '7 days'
            GROUP BY TO_CHAR(os.created_at AT TIME ZONE 'UTC', 'Dy'),
                     DATE_TRUNC('day', os.created_at AT TIME ZONE 'UTC')
            ORDER BY DATE_TRUNC('day', os.created_at AT TIME ZONE 'UTC')
          `, [shopId]),

      // Status breakdown
      isAdmin
        ? query(`
            SELECT status, COUNT(*) AS count FROM orders
            WHERE status NOT IN ('expired') GROUP BY status
          `)
        : query(`
            SELECT status, COUNT(*) AS count FROM order_shops
            WHERE shop_id=$1 AND status NOT IN ('expired') GROUP BY status
          `, [shopId]),

      // Top products by revenue
      isAdmin
        ? query(`
            SELECT item->>'name' AS name,
                   SUM((item->>'price')::numeric * (item->>'quantity')::int) AS revenue
            FROM orders, jsonb_array_elements(items) AS item
            WHERE status IN ('paid','processing','shipped','delivered')
            GROUP BY item->>'name' ORDER BY revenue DESC LIMIT 5
          `)
        : query(`
            SELECT oi.name, SUM(oi.price * oi.quantity) AS revenue
            FROM order_shops os JOIN order_items oi ON oi.order_shop_id = os.id
            WHERE os.shop_id=$1 AND os.status IN ('paid','processing','shipped','delivered')
            GROUP BY oi.name ORDER BY revenue DESC LIMIT 5
          `, [shopId]),
    ]);

    // Fill missing days with 0
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const dailyMap = {};
    dailyRes.rows.forEach(r => { dailyMap[r.day] = parseFloat(r.revenue); });
    const dailyRevenue = days.map(d => ({ day: d, revenue: dailyMap[d] || 0 }));

    // Status breakdown as object
    const statusBreakdown = {};
    statusRes.rows.forEach(r => { statusBreakdown[r.status] = parseInt(r.count); });

    const topProducts = topRes.rows.map(r => ({
      name: r.name || 'Unknown',
      revenue: parseFloat(r.revenue) || 0,
    }));

    res.json({
      totalOrders:    parseInt(ordersRes.rows[0].count),
      totalRevenue:   parseFloat(revenueRes.rows[0].total),
      totalCustomers: parseInt(customersRes.rows[0].count),
      pendingOrders:  parseInt(pendingRes.rows[0].count),
      dailyRevenue,
      statusBreakdown,
      topProducts,
    });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── GET /api/seller/products ── list products — admin sees everything
// (platform oversight), seller sees only their own shop's products. A
// seller with no approved shop yet just sees an empty list, not an error.
router.get('/products', requireAuth, requireSeller, async (req, res) => {
  try {
    if (req.userRole === 'admin') {
      const r = await query(`SELECT * FROM products ORDER BY created_at DESC`);
      return res.json({ products: r.rows });
    }
    const shopId = await getOwnApprovedShop(req.user.id);
    if (!shopId) return res.json({ products: [] });
    const r = await query(`SELECT * FROM products WHERE shop_id=$1 ORDER BY created_at DESC`, [shopId]);
    res.json({ products: r.rows });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── POST /api/seller/products ── create product — always under the
// caller's own approved shop (never a client-supplied shop_id). Applies to
// admins too, since every product needs a shop; admins get one via the
// Phase-4-Step-1 backfill so this doesn't block existing usage.
router.post('/products', requireAuth, requireSeller, validate(productCreateSchema), async (req, res) => {
  try {
    const shopId = await getOwnApprovedShop(req.user.id);
    if (!shopId) return res.status(403).json({ error: 'You need an approved shop before adding products.' });

    const {
      name, description, price, sale_price,
      category, images, colors, sizes, stock, is_new, is_active
    } = req.body;

    // parse ถ้า client ส่งมาเป็น JSON string แล้ว stringify กลับ
    // เพื่อให้ pg ส่งเป็น JSON string เข้า column json/jsonb ได้ถูกต้อง
    const parseArr = v => {
      if (Array.isArray(v)) return JSON.stringify(v);
      if (typeof v === 'string') { try { return JSON.stringify(JSON.parse(v)); } catch { return '[]'; } }
      return '[]';
    };

    // สร้าง id เป็น UUID เสมอ (กันกรณี DB ไม่มี DEFAULT)
    const newId = crypto.randomUUID ? crypto.randomUUID()
                : require('crypto').randomUUID();

    const r = await query(
      `INSERT INTO products
         (id, name, description, price, sale_price, category, images, colors, sizes, stock, is_new, is_active, shop_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        newId,
        name,
        description || null,
        Number(price),
        sale_price ? Number(sale_price) : null,
        category || null,
        parseArr(images),
        parseArr(colors),
        parseArr(sizes),
        stock != null ? parseInt(stock) : null,
        is_new === true,
        is_active !== false,
        shopId,
      ]
    );
    res.status(201).json({ product: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/seller/products/:id ── update product — admin can edit any
// product, seller only their own shop's (WHERE shop_id=own scopes it; a
// mismatch just falls through to the existing 404, same as "not found" —
// doesn't leak whether the product exists under another shop).
router.patch('/products/:id', requireAuth, requireSeller, validate(productUpdateSchema), async (req, res) => {
  try {
    const {
      name, description, price, sale_price,
      category, images, colors, sizes, stock, is_new, is_active
    } = req.body;

    const updates = [];
    const params  = [];
    let idx = 1;

    if (name        !== undefined) { updates.push(`name=$${idx++}`);        params.push(name); }
    if (description !== undefined) { updates.push(`description=$${idx++}`); params.push(description || null); }
    if (price       !== undefined) { updates.push(`price=$${idx++}`);       params.push(Number(price)); }
    if (sale_price  !== undefined) { updates.push(`sale_price=$${idx++}`);  params.push(sale_price ? Number(sale_price) : null); }
    if (category    !== undefined) { updates.push(`category=$${idx++}`);    params.push(category || null); }
    const parseArr = v => { if (Array.isArray(v)) return JSON.stringify(v); if (typeof v === 'string') { try { return JSON.stringify(JSON.parse(v)); } catch { return '[]'; } } return '[]'; };
    if (images      !== undefined) { updates.push(`images=$${idx++}`);  params.push(parseArr(images)); }
    if (colors      !== undefined) { updates.push(`colors=$${idx++}`);  params.push(parseArr(colors)); }
    if (sizes       !== undefined) { updates.push(`sizes=$${idx++}`);   params.push(parseArr(sizes)); }
    if (stock       !== undefined) { updates.push(`stock=$${idx++}`);       params.push(stock != null ? parseInt(stock) : null); }
    if (is_new      !== undefined) { updates.push(`is_new=$${idx++}`);      params.push(!!is_new); }
    if (is_active   !== undefined) { updates.push(`is_active=$${idx++}`);   params.push(!!is_active); }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });

    params.push(req.params.id);
    let sql = `UPDATE products SET ${updates.join(',')} WHERE id=$${idx}`;
    if (req.userRole !== 'admin') {
      const shopId = await getOwnApprovedShop(req.user.id);
      params.push(shopId);
      sql += ` AND shop_id=$${idx + 1}`;
    }
    const r = await query(`${sql} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── DELETE /api/seller/products/:id ── delete product — same admin/own-shop
// scoping as PATCH above.
router.delete('/products/:id', requireAuth, requireSeller, async (req, res) => {
  try {
    if (req.userRole === 'admin') {
      await query('DELETE FROM products WHERE id=$1', [req.params.id]);
    } else {
      const shopId = await getOwnApprovedShop(req.user.id);
      await query('DELETE FROM products WHERE id=$1 AND shop_id=$2', [req.params.id, shopId]);
    }
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── GET /api/seller/customers ── customer list (name + email + order count only — no sensitive data)
router.get('/customers', requireAuth, requireSeller, async (req, res) => {
  try {
    const r = await query(`
      SELECT
        u.id, u.name, u.email, u.avatar, u.created_at AS joined,
        COUNT(o.id)       AS total_orders,
        COALESCE(SUM(CASE WHEN o.status IN ('paid','processing','shipped','delivered') THEN o.total ELSE 0 END), 0) AS total_spent
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.role = 'customer'
      GROUP BY u.id
      ORDER BY total_spent DESC
      LIMIT 100
    `);
    res.json({ customers: r.rows });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── POST /api/seller/make-seller ── promote user to seller
// Requires BOTH an authenticated admin session AND the shared secret — previously
// the shared secret alone was sufficient, so anyone who guessed/leaked
// ADMIN_SECRET could promote any account to seller with no login at all.
router.post('/make-seller', requireAuth, requireRole('admin'), validate(makeSellerSchema), async (req, res) => {
  try {
    const { email, secret } = req.body;
    if (!secretMatches(secret, process.env.ADMIN_SECRET)) {
      return res.status(403).json({ error: 'Wrong secret.' });
    }
    const r = await query(
      "UPDATE users SET role='seller' WHERE email=$1 RETURNING id, email, role",
      [email.toLowerCase()]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true, user: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;