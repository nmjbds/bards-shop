const express = require('express');
const { query, pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { restoreStock } = require('../services/stock');
const router = express.Router();

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
        const ext  = file.originalname.split('.').pop().toLowerCase() || 'jpg';
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

// Seller/admin only middleware
async function requireSeller(req, res, next) {
  try {
    const r = await query('SELECT role FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length || !['seller','admin'].includes(r.rows[0].role)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    next();
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
}

// ── GET /api/seller/orders ── all orders with customer info
router.get('/orders', requireAuth, requireSeller, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 200, 500);
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status || null;
    let r;
    if (status) {
      r = await query(
        `SELECT o.*, u.name as customer_name, u.email as customer_email
         FROM orders o LEFT JOIN users u ON o.user_id=u.id
         WHERE o.status=$1
         ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
        [status, limit, offset]
      );
    } else {
      r = await query(
        `SELECT o.*, u.name as customer_name, u.email as customer_email
         FROM orders o LEFT JOIN users u ON o.user_id=u.id
         ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
    }
    res.json({ orders: r.rows });
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
router.patch('/orders/:id', requireAuth, requireSeller, async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, seller_note, tracking_number } = req.body;
    await client.query('BEGIN');

    // 1. ดึง order ปัจจุบันก่อน เพื่อตรวจ transition
    const cur = await client.query('SELECT status FROM orders WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found.' }); }
    const currentStatus = cur.rows[0].status;

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
router.patch('/orders/:id/note', requireAuth, requireSeller, async (req, res) => {
  try {
    const { seller_note } = req.body;
    if (seller_note === undefined) return res.status(400).json({ error: 'seller_note is required.' });
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

// ── GET /api/seller/products ── list all products
router.get('/products', requireAuth, requireSeller, async (req, res) => {
  try {
    const r = await query(
      `SELECT * FROM products ORDER BY created_at DESC`
    );
    res.json({ products: r.rows });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── POST /api/seller/products ── create product
router.post('/products', requireAuth, requireSeller, async (req, res) => {
  try {
    const {
      name, description, price, sale_price,
      category, images, colors, sizes, stock, is_new, is_active
    } = req.body;
    if (!name)  return res.status(400).json({ error: 'Product name is required.' });
    if (!price) return res.status(400).json({ error: 'Price is required.' });

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
         (id, name, description, price, sale_price, category, images, colors, sizes, stock, is_new, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      ]
    );
    res.status(201).json({ product: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/seller/products/:id ── update product
router.patch('/products/:id', requireAuth, requireSeller, async (req, res) => {
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
    const r = await query(
      `UPDATE products SET ${updates.join(',')} WHERE id=$${idx} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── DELETE /api/seller/products/:id ── delete product
router.delete('/products/:id', requireAuth, requireSeller, async (req, res) => {
  try {
    await query('DELETE FROM products WHERE id=$1', [req.params.id]);
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

// ── POST /api/seller/make-seller ── promote user to seller (admin secret required)
router.post('/make-seller', async (req, res) => {
  try {
    const { email, secret } = req.body;
    if (!secret || secret !== process.env.ADMIN_SECRET) {
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