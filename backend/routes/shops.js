const express = require('express');
const { z } = require('zod');
const { query, pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate, MIME_EXT } = require('../middleware/validate');
const { getSignedGetUrl } = require('../services/r2');
const { sendEmail, sendTelegramToAdmin } = require('../services/notify');
const router = express.Router();

// ── Cloudflare R2 upload for seller documents (private bucket) ─────────
// Mirrors routes/seller.js's/auth.js's upload setup, but PutObject targets
// R2_DOCS_BUCKET_NAME (no ACL — private by default) instead of the public
// product-images/avatar bucket. See services/r2.js and
// docs/05-seller-onboarding-blueprint.md §4 for why file_url stores an
// object key rather than a URL.
let _docUploadReady = false;
let multer, PutObjectCommand, getR2Client;
try {
  multer           = require('multer');
  PutObjectCommand = require('@aws-sdk/client-s3').PutObjectCommand;
  getR2Client      = require('../services/r2').getR2Client;
  _docUploadReady  = true;
} catch(e) {
  console.warn('[R2] Missing packages — document upload disabled. Run: npm install @aws-sdk/client-s3 multer');
}

function makeDocUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      if (!MIME_EXT[file.mimetype]) return cb(new Error('Only images or PDF files are allowed'));
      cb(null, true);
    },
  }).single('document');
}

function makeBrandingUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
      cb(null, true);
    },
  }).single('image');
}

// Attach a fresh, short-lived presigned GET URL to each seller_documents row
// — never store/reuse one (they expire). If the docs bucket isn't
// provisioned yet (R2_DOCS_BUCKET_NAME unset) or signing fails for any
// reason, fall back to url:null rather than failing the whole request —
// the shop/application data itself is still useful without it.
async function signDocuments(rows) {
  const bucket = process.env.R2_DOCS_BUCKET_NAME;
  if (!bucket) return rows.map(d => ({ ...d, url: null }));
  return Promise.all(rows.map(async (d) => {
    try {
      return { ...d, url: await getSignedGetUrl(bucket, d.file_url) };
    } catch(e) {
      console.error('[R2 SIGN]', e.message);
      return { ...d, url: null };
    }
  }));
}

// ── Validation schemas ──────────────────────────────────────────
// Reserved words a store URL can't be — would collide with real routes/
// subdomains (admin.bardskh.com, seller.bardskh.com, /api/*, etc).
const RESERVED_STORE_SLUGS = new Set([
  'admin', 'api', 'seller', 'shop', 'shops', 'www', 'app', 'static', 'assets', 'bardskh',
]);
const storeSlugSchema = z.string().trim().min(1).max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Store URL must be lowercase letters, numbers, and hyphens only (e.g. "my-shop").')
  .refine(s => !RESERVED_STORE_SLUGS.has(s), { message: 'This store URL is reserved — please choose another.' });

// All fields beyond `name` are optional here on purpose: the 6-step apply
// form saves progress via PATCH /me as the seller fills each step (see
// blueprint §8 edge case 5 — "seller closes the tab mid-form"), so a shop
// row can legitimately exist with most of this still null.
const shopApplySchema = z.object({
  name:                z.string().trim().min(1, 'Shop name is required.').max(100),
  description:         z.string().trim().max(1000).optional().nullable(),
  logo:                z.string().trim().max(2000).optional().nullable(),
  cover_url:           z.string().trim().max(2000).optional().nullable(),
  business_type:       z.enum(['individual', 'business']).optional().nullable(),
  full_name:           z.string().trim().max(200).optional().nullable(),
  phone:               z.string().trim().max(30).optional().nullable(),
  country:             z.string().trim().max(100).optional().nullable(),
  province:            z.string().trim().max(100).optional().nullable(),
  address:             z.string().trim().max(500).optional().nullable(),
  store_slug:          storeSlugSchema.optional().nullable(),
  category_id:         z.string().uuid().optional().nullable(),
  bank_name:           z.enum(['ABA', 'ACLEDA', 'Wing', 'Chip Mong']).optional().nullable(),
  bank_account_name:   z.string().trim().max(200).optional().nullable(),
  bank_account_number: z.string().trim().max(50).optional().nullable(),
  currency:            z.enum(['KHR', 'USD']).optional().nullable(),
  return_address:      z.string().trim().max(500).optional().nullable(),
});
const shopUpdateSchema = shopApplySchema.partial();

const statusEnum = z.enum(['pending', 'needs_info', 'rejected', 'approved', 'suspended'], { error: 'Invalid status.' });
const shopStatusSchema = z.object({
  status:               statusEnum,
  rejection_reason:     z.string().trim().max(1000).optional().nullable(),
  info_requested_note:  z.string().trim().max(1000).optional().nullable(),
}).refine(
  (d) => d.status !== 'rejected' || !!d.rejection_reason,
  { message: 'rejection_reason is required when rejecting.', path: ['rejection_reason'] }
).refine(
  (d) => d.status !== 'needs_info' || !!d.info_requested_note,
  { message: 'info_requested_note is required when requesting more info.', path: ['info_requested_note'] }
);

const checklistKeys = ['profile', 'store', 'bank', 'add_product', 'shipping', 'return_address', 'first_product'];
const checklistSchema = z.object(
  Object.fromEntries(checklistKeys.map(k => [k, z.boolean().optional()]))
).strict();

const docTypeSchema = z.enum(['id_card', 'business_license', 'tax_document']);

// ── POST /api/shops/apply ── create own shop (one per user — DB enforces
// via UNIQUE owner_user_id). Open to ANY authenticated role (2026-07-31,
// Seller Onboarding Blueprint) — a plain `customer` applies directly, no
// admin-granted `role='seller'` needed first (that manual path via
// POST /api/seller/make-seller still exists separately for special cases).
// role only ever flips to 'seller' once an admin approves — see PATCH /:id.
router.post('/apply', requireAuth, validate(shopApplySchema), async (req, res) => {
  try {
    const {
      name, description, logo, cover_url, business_type, full_name, phone,
      country, province, address, store_slug, category_id, bank_name,
      bank_account_name, bank_account_number, currency,
    } = req.body;
    const r = await query(
      `INSERT INTO shops(
         owner_user_id, name, description, logo, cover_url, business_type,
         full_name, phone, country, province, address, store_slug,
         category_id, bank_name, bank_account_name, bank_account_number,
         currency, status, submitted_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending',NOW())
       RETURNING *`,
      [
        req.user.id, name, description || null, logo || null, cover_url || null,
        business_type || null, full_name || null, phone || null, country || null,
        province || null, address || null, store_slug || null, category_id || null,
        bank_name || null, bank_account_name || null, bank_account_number || null,
        currency || null,
      ]
    );
    res.status(201).json({ shop: r.rows[0] });

    // Fire-and-forget — this INSERT only ever succeeds once per user (DB
    // unique constraint on owner_user_id), so this only runs on genuine
    // first application, never on a later edit.
    sendEmail(
      req.user.email, 'Bards Seller Application Received',
      `Hi,\n\nWe've received your application for "${name}". We'll review it and let you know once it's approved.\n\n- Bards Team`,
      `<p style="margin:0 0 12px;font-size:15px;font-weight:700;">Application Received</p>
       <p style="margin:0;font-size:13px;color:#4A4A48;line-height:1.6;">We've received your application for <b>${name}</b>. We'll review it and let you know once it's approved.</p>`
    );
    sendTelegramToAdmin(
      `📝 <b>New shop application</b>\n${name} — ${req.user.email || req.user.id}\n<i>Review at /admin-shops</i>`
    );
  } catch(e) {
    if (e.code === '23505') {
      if (e.constraint === 'idx_shops_store_slug') return res.status(409).json({ error: 'This store URL is already taken.' });
      return res.status(409).json({ error: 'You already have a shop.' });
    }
    console.error(e); res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/shops/me ── own shop + documents (for the seller dashboard to
// show pending/needs_info/rejected/approved/suspended, or prompt to apply if
// none yet). Open to any authenticated role — a `customer` mid-application
// needs this to see their own status just as much as an approved seller.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM shops WHERE owner_user_id=$1', [req.user.id]);
    if (!r.rows.length) return res.json({ shop: null, documents: [] });
    const docsRes = await query('SELECT * FROM seller_documents WHERE shop_id=$1 ORDER BY uploaded_at DESC', [r.rows[0].id]);
    res.json({ shop: r.rows[0], documents: await signDocuments(docsRes.rows) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/shops/me ── seller edits own shop fields. Does not touch
// `status` — approval/rejection state is admin-only (see PATCH /:id); the
// one seller-triggered exception is POST /me/resubmit below.
router.patch('/me', requireAuth, validate(shopUpdateSchema), async (req, res) => {
  try {
    const b = req.body;
    const updates = [];
    const params  = [];
    let idx = 1;
    const set = (col, val) => { updates.push(`${col}=$${idx++}`); params.push(val); };
    if (b.name                !== undefined) set('name', b.name);
    if (b.description         !== undefined) set('description', b.description || null);
    if (b.logo                !== undefined) set('logo', b.logo || null);
    if (b.cover_url           !== undefined) set('cover_url', b.cover_url || null);
    if (b.business_type       !== undefined) set('business_type', b.business_type || null);
    if (b.full_name           !== undefined) set('full_name', b.full_name || null);
    if (b.phone                !== undefined) set('phone', b.phone || null);
    if (b.country              !== undefined) set('country', b.country || null);
    if (b.province             !== undefined) set('province', b.province || null);
    if (b.address              !== undefined) set('address', b.address || null);
    if (b.store_slug           !== undefined) set('store_slug', b.store_slug || null);
    if (b.category_id          !== undefined) set('category_id', b.category_id || null);
    if (b.bank_name            !== undefined) set('bank_name', b.bank_name || null);
    if (b.bank_account_name    !== undefined) set('bank_account_name', b.bank_account_name || null);
    if (b.bank_account_number  !== undefined) set('bank_account_number', b.bank_account_number || null);
    if (b.currency              !== undefined) set('currency', b.currency || null);
    if (b.return_address        !== undefined) set('return_address', b.return_address || null);
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
    updates.push(`updated_at=NOW()`);

    params.push(req.user.id);
    const r = await query(
      `UPDATE shops SET ${updates.join(',')} WHERE owner_user_id=$${idx} RETURNING *`,
      params
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No shop found — apply first.' });
    res.json({ shop: r.rows[0] });
  } catch(e) {
    if (e.code === '23505' && e.constraint === 'idx_shops_store_slug') {
      return res.status(409).json({ error: 'This store URL is already taken.' });
    }
    console.error(e); res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/shops/me/resubmit ── the one status transition a seller
// triggers themselves (rejected/needs_info -> pending), after fixing
// whatever PATCH /me needed. Mirrors orders' pattern of giving the
// non-admin party one specific action (cancel) rather than open status
// PATCH access.
router.post('/me/resubmit', requireAuth, async (req, res) => {
  try {
    const current = await query('SELECT status FROM shops WHERE owner_user_id=$1', [req.user.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'No shop found — apply first.' });
    if (!['rejected', 'needs_info'].includes(current.rows[0].status)) {
      return res.status(400).json({ error: 'Only a rejected or needs-info application can be resubmitted.' });
    }
    const r = await query(
      `UPDATE shops SET status='pending', submitted_at=NOW(), updated_at=NOW()
       WHERE owner_user_id=$1 RETURNING *`,
      [req.user.id]
    );
    res.json({ ok: true, shop: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/shops/me/onboarding-checklist ── merge-update the JSONB
// checklist one or more keys at a time (Postgres `||` shallow-merges,
// leaving keys not present in this request untouched).
router.patch('/me/onboarding-checklist', requireAuth, validate(checklistSchema), async (req, res) => {
  try {
    if (!Object.keys(req.body).length) return res.status(400).json({ error: 'No fields to update.' });
    const r = await query(
      `UPDATE shops SET onboarding_checklist = onboarding_checklist || $1::jsonb, updated_at=NOW()
       WHERE owner_user_id=$2 RETURNING onboarding_checklist`,
      [JSON.stringify(req.body), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No shop found — apply first.' });
    res.json({ onboarding_checklist: r.rows[0].onboarding_checklist });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── POST /api/shops/me/documents ── upload one ID/business-license/tax
// document, tied to the caller's own shop. Requires R2_DOCS_BUCKET_NAME (a
// separate, private bucket — never given a public custom domain, unlike the
// product-images/avatar bucket) — 503 until that's configured.
router.post('/me/documents', requireAuth, (req, res) => {
  if (!_docUploadReady) {
    return res.status(503).json({ error: 'Upload not available. Run: npm install @aws-sdk/client-s3 multer' });
  }
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_DOCS_BUCKET_NAME) {
    return res.status(503).json({ error: 'Document storage is not configured yet.' });
  }

  const upload = makeDocUpload();
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const docTypeResult = docTypeSchema.safeParse(req.body.doc_type);
    if (!docTypeResult.success) {
      return res.status(400).json({ error: 'doc_type must be one of: id_card, business_license, tax_document.' });
    }
    const docType = docTypeResult.data;

    try {
      const shopRes = await query('SELECT id FROM shops WHERE owner_user_id=$1', [req.user.id]);
      if (!shopRes.rows.length) return res.status(404).json({ error: 'No shop found — apply first.' });
      const shopId = shopRes.rows[0].id;

      const ext = MIME_EXT[req.file.mimetype] || 'bin';
      const key = `seller-documents/${shopId}/${docType}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const r2 = getR2Client();
      await r2.send(new PutObjectCommand({
        Bucket:      process.env.R2_DOCS_BUCKET_NAME,
        Key:         key,
        Body:        req.file.buffer,
        ContentType: req.file.mimetype,
        // No ACL — bucket has no public access configured, unlike bards-media.
      }));

      const inserted = await query(
        `INSERT INTO seller_documents(shop_id, doc_type, file_url) VALUES($1,$2,$3) RETURNING *`,
        [shopId, docType, key]
      );
      const [document] = await signDocuments(inserted.rows);
      res.status(201).json({ document });
    } catch(e) {
      console.error('[R2 DOC UPLOAD]', e.message);
      res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
  });
});

// ── POST /api/shops/me/branding ── logo/cover image upload — the PUBLIC
// bucket (bards-media, same as product images/avatars), unlike documents
// above. Its own route rather than reusing routes/seller.js's
// requireSeller-gated POST /upload: a plain `customer` mid-application has
// no seller/admin role yet, but still needs to upload a logo/cover before
// any admin has approved anything. Gate is "has a shop row at all" (any
// status) rather than role — narrower than opening product-image upload to
// every authenticated user would be.
router.post('/me/branding', requireAuth, (req, res) => {
  if (!_docUploadReady) {
    return res.status(503).json({ error: 'Upload not available. Run: npm install @aws-sdk/client-s3 multer' });
  }
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
    return res.status(503).json({ error: 'R2 environment variables not configured.' });
  }

  const upload = makeBrandingUpload();
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    try {
      const shopRes = await query('SELECT id FROM shops WHERE owner_user_id=$1', [req.user.id]);
      if (!shopRes.rows.length) return res.status(404).json({ error: 'No shop found — apply first.' });

      const bucket  = process.env.R2_BUCKET_NAME || 'bards-media';
      const cdnBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
      const ext = MIME_EXT[req.file.mimetype] || 'jpg';
      const key = `shop-branding/${shopRes.rows[0].id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const r2 = getR2Client();
      await r2.send(new PutObjectCommand({
        Bucket:      bucket,
        Key:         key,
        Body:        req.file.buffer,
        ContentType: req.file.mimetype,
        ACL:         'public-read',
      }));
      res.json({ url: cdnBase ? `${cdnBase}/${key}` : `https://${bucket}.r2.dev/${key}` });
    } catch(e) {
      console.error('[R2 BRANDING UPLOAD]', e.message);
      res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
  });
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

// ── GET /api/shops/:id ── admin: single shop detail + its documents. Was
// missing entirely before the onboarding blueprint — GET / (list) and
// GET /me (own shop) covered every case except "admin looks at one
// application in detail".
router.get('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const shopRes = await query(
      `SELECT s.*, u.name AS owner_name, u.email AS owner_email
       FROM shops s JOIN users u ON u.id = s.owner_user_id
       WHERE s.id=$1`,
      [req.params.id]
    );
    if (!shopRes.rows.length) return res.status(404).json({ error: 'Shop not found.' });
    const docsRes = await query('SELECT * FROM seller_documents WHERE shop_id=$1 ORDER BY uploaded_at DESC', [req.params.id]);
    res.json({ shop: shopRes.rows[0], documents: await signDocuments(docsRes.rows) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/shops/:id ── admin: approve / reject / suspend / request
// more info. Same-status guard kept from before (no silent no-op re-clicks).
// Approving is the one branch that touches a second table (users.role) —
// done inside a transaction so a shop can never end up 'approved' with its
// owner still stuck on role='customer', or vice versa (blueprint §8 edge
// case 7). Never touches an owner who's already 'admin' — only ever
// promotes a plain customer.
const STATUS_EMAIL = {
  approved: {
    subject: '🎉 Your Bards Shop is Approved!',
    text: (s) => `Congratulations! Your shop "${s.name}" is now approved and live on Bards.`,
    html: (s) => `<p style="margin:0 0 12px;font-size:15px;font-weight:700;">Your shop is approved 🎉</p>
      <p style="margin:0;font-size:13px;color:#4A4A48;line-height:1.6;"><b>${s.name}</b> is now live on Bards — you can start adding products right away.</p>`,
  },
  rejected: {
    subject: 'Update on Your Bards Shop Application',
    text: (s) => `Your application for "${s.name}" was not approved.\n\nReason: ${s.rejection_reason}\n\nYou're welcome to update your info and resubmit.`,
    html: (s) => `<p style="margin:0 0 12px;font-size:15px;font-weight:700;">Application not approved</p>
      <p style="margin:0 0 12px;font-size:13px;color:#4A4A48;line-height:1.6;">Your application for <b>${s.name}</b> was not approved this time.</p>
      <p style="margin:0 0 12px;font-size:13px;color:#991B1B;background:#FEF2F2;padding:10px 12px;border-radius:8px;">${s.rejection_reason}</p>
      <p style="margin:0;font-size:13px;color:#4A4A48;">You're welcome to update your info and resubmit.</p>`,
  },
  needs_info: {
    subject: 'More Information Needed for Your Bards Shop Application',
    text: (s) => `We need more information about your application for "${s.name}".\n\n${s.info_requested_note}\n\nPlease update your application and resubmit.`,
    html: (s) => `<p style="margin:0 0 12px;font-size:15px;font-weight:700;">More info needed</p>
      <p style="margin:0 0 12px;font-size:13px;color:#4A4A48;line-height:1.6;">We need a bit more information about your application for <b>${s.name}</b>:</p>
      <p style="margin:0 0 12px;font-size:13px;color:#854D0E;background:#FEFCE8;padding:10px 12px;border-radius:8px;">${s.info_requested_note}</p>
      <p style="margin:0;font-size:13px;color:#4A4A48;">Please update your application and resubmit.</p>`,
  },
};

router.patch('/:id', requireAuth, requireRole('admin'), validate(shopStatusSchema), async (req, res) => {
  const { status, rejection_reason, info_requested_note } = req.body;
  try {
    const current = await query(
      `SELECT s.status, s.owner_user_id, u.email AS owner_email
       FROM shops s JOIN users u ON u.id = s.owner_user_id WHERE s.id=$1`,
      [req.params.id]
    );
    if (!current.rows.length) return res.status(404).json({ error: 'Shop not found.' });
    if (current.rows[0].status === status) {
      return res.status(400).json({ error: `Shop is already ${status}.` });
    }
    const ownerEmail = current.rows[0].owner_email;

    if (status === 'approved') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query(
          `UPDATE shops SET status='approved', reviewed_by=$1, reviewed_at=NOW(), updated_at=NOW()
           WHERE id=$2 RETURNING *`,
          [req.user.id, req.params.id]
        );
        await client.query(
          `UPDATE users SET role='seller' WHERE id=$1 AND role='customer'`,
          [current.rows[0].owner_user_id]
        );
        await client.query('COMMIT');
        const shop = r.rows[0];
        const t = STATUS_EMAIL.approved;
        sendEmail(ownerEmail, t.subject, t.text(shop), t.html(shop));
        return res.json({ ok: true, shop });
      } catch(e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }

    const updates = [`status=$1`, `updated_at=NOW()`, `reviewed_by=$2`, `reviewed_at=NOW()`];
    const params  = [status, req.user.id];
    let idx = 3;
    if (status === 'rejected')   { updates.push(`rejection_reason=$${idx++}`);    params.push(rejection_reason); }
    if (status === 'needs_info') { updates.push(`info_requested_note=$${idx++}`); params.push(info_requested_note); }
    params.push(req.params.id);
    const r = await query(`UPDATE shops SET ${updates.join(',')} WHERE id=$${idx} RETURNING *`, params);
    const shop = r.rows[0];
    if (STATUS_EMAIL[status]) {
      const t = STATUS_EMAIL[status];
      sendEmail(ownerEmail, t.subject, t.text(shop), t.html(shop));
    }
    res.json({ ok: true, shop });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/shops/:id/auto-approve-products ── admin: toggle whether new
// products from this shop skip the review queue (routes/seller.js's
// POST /products checks this flag — see Seller Onboarding Blueprint §2's
// "after a shop has a good track record" step). Separate from PATCH /:id
// (status transitions) since this isn't a status change — no same-value
// guard needed, flipping it back and forth is harmless.
const autoApproveSchema = z.object({ auto_approve_products: z.boolean() });
router.patch('/:id/auto-approve-products', requireAuth, requireRole('admin'), validate(autoApproveSchema), async (req, res) => {
  try {
    const r = await query(
      `UPDATE shops SET auto_approve_products=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [req.body.auto_approve_products, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Shop not found.' });
    res.json({ ok: true, shop: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

module.exports = router;
