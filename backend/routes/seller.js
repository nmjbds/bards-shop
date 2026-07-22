const express = require('express');
const crypto  = require('crypto');
const { z } = require('zod');
const { query, pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, MIME_EXT } = require('../middleware/validate');
const { restoreStock } = require('../services/stock');
const router = express.Router();

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

// Seller/admin only middleware — also stamps req.userRole so downstream
// handlers (product shop-scoping) don't need a second role lookup.
async function requireSeller(req, res, next) {
  try {
    const r = await query('SELECT role FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length || !['seller','admin'].includes(r.rows[0].role)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    req.userRole = r.rows[0].role;
    next();
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
}

// Phase 4: the caller's own approved shop id, or null if they don't have
// one yet (never applied, still pending, or rejected/suspended).
async function getOwnApprovedShop(userId) {
  const r = await query("SELECT id FROM shops WHERE owner_user_id=$1 AND status='approved'", [userId]);
  return r.rows[0]?.id || null;
}

// ── GET /api/seller/orders ── admin: all orders, full items, unchanged.
// Seller: only orders containing at least one of their own shop's items —
// and within each of those, `items` is filtered down to just their own
// lines (a shared multi-shop order still shows to both sellers, but each
// only sees their own slice + an `own_subtotal` for convenience). This is
// visibility scoping only — order status/payment/total still describe the
// whole order (no real per-shop split), per the Phase 4 scope decision.
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
    if (status) { conditions.push(`o.status=$${idx++}`); params.push(status); }
    if (!isAdmin) {
      conditions.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(o.items) it WHERE (it->>'shop_id')=$${idx++})`);
      params.push(shopId);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const r = await query(
      `SELECT o.*, u.name as customer_name, u.email as customer_email
       FROM orders o LEFT JOIN users u ON o.user_id=u.id
       ${whereClause}
       ORDER BY o.created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      params
    );

    let orders = r.rows;
    if (!isAdmin) {
      orders = orders.map(o => {
        const ownItems = (o.items || []).filter(it => it.shop_id === shopId);
        const ownSubtotal = Math.round(ownItems.reduce((sum, it) => sum + Number(it.price) * it.quantity, 0) * 100) / 100;
        return { ...o, items: ownItems, own_subtotal: ownSubtotal };
      });
    }

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

// ── PATCH /api/seller/orders/:id ── update status + seller_note + tracking_number
router.patch('/orders/:id', requireAuth, requireSeller, validate(orderUpdateSchema), async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, seller_note, tracking_number } = req.body;
    await client.query('BEGIN');

    // 1. ดึง order ปัจจุบันก่อน เพื่อตรวจ transition
    const cur = await client.query('SELECT status, items FROM orders WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found.' }); }
    const currentStatus = cur.rows[0].status;

    // Non-admin sellers may only act on orders that contain at least one of
    // their own shop's items — same "don't leak existence" 404 as products.
    if (req.userRole !== 'admin') {
      const shopId = await getOwnApprovedShop(req.user.id);
      const hasOwnItem = shopId && (cur.rows[0].items || []).some(it => it.shop_id === shopId);
      if (!hasOwnItem) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found.' }); }
    }

    // 2. ตรวจว่า status ที่ขอมีอยู่ใน allowedTransitions หรือไม่
    const allowed = ALLOWED_TRANSITIONS[currentStatus];
    if (!allowed) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Unknown current status: ${currentStatus}` }); }
    if (!allowed.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Cannot change status from "${currentStatus}" to "${status}".`,
        allowedNext: allowed,
      });
    }

    const isPaid      = status === 'paid';
    const isCancelled = status === 'cancelled';

    // Dynamic SET clause
    const sets = [
      'status        = $1::text',
      'seller_note   = COALESCE($2::text, seller_note)',
      'confirmed_at  = CASE WHEN $3 THEN NOW() ELSE confirmed_at END',
      "cancelled_by  = CASE WHEN $4 THEN 'seller' ELSE cancelled_by END",
      "cancel_reason = CASE WHEN $4 THEN 'Cancelled by seller' ELSE cancel_reason END",
    ];
    const params = [status, seller_note || null, isPaid, isCancelled];
    let idx = 5;

    if (tracking_number !== undefined && tracking_number !== null) {
      sets.push(`tracking_number = $${idx++}::text`);
      params.push(tracking_number.trim() || null);
    }

    params.push(req.params.id);
    const r = await client.query(
      `UPDATE orders SET ${sets.join(', ')} WHERE id=$${idx} RETURNING *`,
      params
    );
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found.' }); }

    // Cancelling at any stage returns the stock that was reserved at checkout
    // (stock is only ever decremented once, at order creation).
    if (isCancelled) await restoreStock(client, r.rows[0].items);

    await client.query('COMMIT');
    res.json({ ok: true, order: r.rows[0] });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/seller/orders/:id/note ── update seller_note เท่านั้น (ไม่เปลี่ยน status)
router.patch('/orders/:id/note', requireAuth, requireSeller, validate(orderNoteSchema), async (req, res) => {
  try {
    const { seller_note } = req.body;
    if (seller_note === undefined) return res.status(400).json({ error: 'seller_note is required.' });

    if (req.userRole !== 'admin') {
      const shopId = await getOwnApprovedShop(req.user.id);
      const cur = await query('SELECT items FROM orders WHERE id=$1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ error: 'Order not found.' });
      const hasOwnItem = shopId && (cur.rows[0].items || []).some(it => it.shop_id === shopId);
      if (!hasOwnItem) return res.status(404).json({ error: 'Order not found.' });
    }

    const r = await query(
      `UPDATE orders SET seller_note=$1 WHERE id=$2 RETURNING id, seller_note`,
      [seller_note || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Order not found.' });
    res.json({ ok: true, order: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});


router.get('/stats', requireAuth, requireSeller, async (req, res) => {
  try {
    const [ordersRes, revenueRes, customersRes, pendingRes, dailyRes, statusRes, topRes] = await Promise.all([
      query("SELECT COUNT(*) FROM orders WHERE status NOT IN ('cancelled','expired')"),
      query("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE status IN ('paid','processing','shipped','delivered')"),
      query("SELECT COUNT(DISTINCT user_id) FROM orders"),
      query("SELECT COUNT(*) FROM orders WHERE status='pending_verification'"),

      // Daily revenue — last 7 days
      query(`
        SELECT
          TO_CHAR(created_at AT TIME ZONE 'UTC', 'Dy') AS day,
          COALESCE(SUM(total), 0) AS revenue
        FROM orders
        WHERE status IN ('paid','processing','shipped','delivered')
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY TO_CHAR(created_at AT TIME ZONE 'UTC', 'Dy'),
                 DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')
        ORDER BY DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')
      `),

      // Status breakdown
      query(`
        SELECT status, COUNT(*) AS count
        FROM orders
        WHERE status NOT IN ('expired')
        GROUP BY status
      `),

      // Top products by revenue (from JSONB items array)
      query(`
        SELECT
          item->>'name' AS name,
          SUM((item->>'price')::numeric * (item->>'quantity')::int) AS revenue
        FROM orders,
             jsonb_array_elements(items) AS item
        WHERE status IN ('paid','processing','shipped','delivered')
        GROUP BY item->>'name'
        ORDER BY revenue DESC
        LIMIT 5
      `),
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

// ── GET /api/products ── public: list active products (หน้าร้านค้า)
router.get('/public/products', async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM products WHERE is_active=true ORDER BY created_at DESC`
    );
    res.json({ products: r.rows });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── GET /api/products/:id ── public: single product (หน้า product.html)
router.get('/public/products/:id', async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM products WHERE id=$1 AND is_active=true`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: r.rows[0] });
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