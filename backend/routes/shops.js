const express = require('express');
const { z } = require('zod');
const { query } = require('../db');
const { requireAuth, requireRole, requireSellerAccount } = require('../middleware/auth');
const { validate, MIME_EXT } = require('../middleware/validate');
const { getSignedGetUrl } = require('../services/r2');
const { sendEmail, sendTelegramToAdmin } = require('../services/notify');
const { slugify } = require('../helpers/slugify');
const { startVerification, checkVerification } = require('../services/twilioVerify');
const router = express.Router();

// ── Rate limiting (Phase 4, phone verification) ───────────────────────
// Local copy of routes/auth.js's/routes/authSeller.js's makeRateLimit()
// factory -- same reasoning as authSeller.js's copy: not exported from
// either of those files, and this router doesn't require anything from
// them (avoids pulling in unrelated top-level side effects, e.g.
// routes/auth.js's passport.use(new GoogleStrategy(...)) call, which
// throws synchronously if GOOGLE_CLIENT_ID isn't set).
function makeRateLimit({ windowMs, max, message, keyField }) {
  const attempts = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip || 'unknown';
    const key = keyField && req.body?.[keyField] ? `${ip}:${String(req.body[keyField]).toLowerCase()}` : ip;
    const now = Date.now();
    const entry = attempts.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count++;
    attempts.set(key, entry);
    if (entry.count > max) {
      const retry = Math.ceil((windowMs - (now - entry.start)) / 1000 / 60) || 1;
      return res.status(429).json({ error: message(retry) });
    }
    next();
  };
}
// Starting a verification is what actually costs money / sends an SMS --
// keep this one strict. Keyed by IP+phone (not just phone) so it can't be
// used to lock a stranger's real number out by hammering it from many IPs
// while still capping how many codes any one caller can trigger.
const phoneVerifyStartRateLimit = makeRateLimit({
  windowMs: 60 * 60 * 1000, max: 5, keyField: 'phone',
  message: (retry) => `Too many verification requests for this number. Please try again in ${retry} minutes.`,
});
// Checking a code doesn't send an SMS, but still deserves its own limit --
// separate from the start limit (a seller legitimately re-checking a
// mistyped code a few times shouldn't burn through their 5 start-attempts
// budget) and generous enough not to get in the way of normal typos, while
// still capping brute-force guessing of the 6-digit code.
const phoneVerifyCheckRateLimit = makeRateLimit({
  windowMs: 60 * 60 * 1000, max: 15, keyField: 'phone',
  message: (retry) => `Too many attempts for this number. Please try again in ${retry} minutes.`,
});

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
  'id', // /shop/id/:uuid fallback route (docs/06-shop-profile-follow-blueprint.md) — a
        // slug literally equal to "id" would collide with it in server-customer.js
]);
const storeSlugSchema = z.string().trim().min(1).max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Store URL must be lowercase letters, numbers, and hyphens only (e.g. "my-shop").')
  .refine(s => !RESERVED_STORE_SLUGS.has(s), { message: 'This store URL is reserved — please choose another.' });

// bank_name/currency below were already .optional().nullable() -- but a
// fixed-choice z.enum() still rejects an empty string ('' is neither one of
// the listed values nor null/undefined). apply.html currently converts ''
// to null client-side before sending (collectStep5Fields()), which is why
// this hasn't broken anything so far -- optionalEnum() makes that hold true
// server-side too, so a future caller (e.g. the Phase 2+ apply.html rework)
// isn't silently relying on that same client-side conversion to stay
// optional in practice, not just on paper.
const optionalEnum = (values) => z.preprocess(v => (v === '' ? null : v), z.enum(values).nullable().optional());

// id_number/birthdate (Phase 2, docs/tiktok-seller-onboarding-flow.md) — the
// reference flow's identity-document step captures these alongside
// full_name/address (normally via OCR off the uploaded ID card; this
// project has no OCR integration, so these are always typed by hand for
// now). Same '' -> null preprocessing as optionalEnum() above, for the same
// reason: an untouched text/date input posts '' rather than omitting the
// key, and neither .min(5) nor z.iso.date() would treat '' as "not
// provided" on their own.
//
// id_number stays a loosely-bounded string, not a per-country ID format
// regex: business_type='business' stores a business registration number
// here too (different shape from an individual's ID card number), and
// Cambodia-specific ID formats aren't validated anywhere else in this
// project either. 5-50 just guards against obviously-wrong input (empty
// paste, a stray single character) without rejecting a real value.
const idNumberSchema = z.preprocess(
  v => (v === '' ? null : v),
  z.string().trim()
    .min(5, 'ID/registration number must be at least 5 characters.')
    .max(50, 'ID/registration number must be at most 50 characters.')
    .nullable().optional()
);

// z.iso.date() (zod v4) already rejects anything that isn't a real
// YYYY-MM-DD calendar date (e.g. 2024-02-30, month 13) — the .refine() below
// only adds the "not in the future" rule on top. Comparing the raw
// YYYY-MM-DD strings (rather than parsing both sides into Date objects)
// sidesteps timezone-conversion edge cases around "today" entirely, since
// zero-padded ISO date strings sort identically to their chronological
// order.
const birthdateSchema = z.preprocess(
  v => (v === '' ? null : v),
  z.iso.date('Birthdate must be a valid date (YYYY-MM-DD).')
    .refine(d => d <= new Date().toISOString().slice(0, 10), { message: 'Birthdate cannot be in the future.' })
    .nullable().optional()
);

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
  id_number:           idNumberSchema,
  birthdate:           birthdateSchema,
  phone:               z.string().trim().max(30).optional().nullable(),
  country:             z.string().trim().max(100).optional().nullable(),
  province:            z.string().trim().max(100).optional().nullable(),
  address:             z.string().trim().max(500).optional().nullable(),
  store_slug:          storeSlugSchema.optional().nullable(),
  category_id:         z.string().uuid().optional().nullable(),
  // bank_name/bank_account_name/bank_account_number/currency/return_address
  // are all optional here already (Phase 1, docs/tiktok-seller-onboarding-
  // flow.md) -- collecting payout info during initial signup doesn't match
  // the reference flow, which asks for it only after approval. Columns stay
  // on `shops` (Phase 1 doesn't touch the DB shape here, just how strictly
  // these are validated) -- see optionalEnum() above for why bank_name/
  // currency specifically also tolerate ''.
  bank_name:           optionalEnum(['ABA', 'ACLEDA', 'Wing', 'Chip Mong']),
  bank_account_name:   z.string().trim().max(200).optional().nullable(),
  bank_account_number: z.string().trim().max(50).optional().nullable(),
  currency:            optionalEnum(['KHR', 'USD']),
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

// Deliberately loose (min 6, no format regex) -- same reasoning as
// authSeller.js's phoneSchema: normalizePhoneKH() (services/twilioVerify.js)
// is what actually decides what's sent to Twilio, this is just a sanity
// floor against an empty/obviously-too-short value before that.
const phoneVerifySchema = z.object({ phone: z.string().trim().min(6, 'Please enter a valid phone number.').max(30) });
const phoneVerifyCheckSchema = phoneVerifySchema.extend({
  code: z.string().trim().length(6, 'Code must be 6 digits.'),
});

// Auto-generated store_slug collision retries (POST /apply below) — capped
// so a pathological run of collisions can't loop forever. 20 is generous:
// each retry appends "-N", so this only gets exercised at all when many
// shops already share the same slugified name.
const MAX_SLUG_ATTEMPTS = 20;

// ── POST /api/shops/apply ── create own shop (one per seller — DB enforces
// via UNIQUE seller_account_id). Gated by requireSellerAccount — the caller
// must be authenticated through seller.bardskh.com's own signup/signin
// (routes/authSeller.js), not a customer/admin session. There is no more
// "candidate role" concept: a shop's owner IS a seller_accounts row from the
// moment they sign up, full stop — no role to flip later (contrast with the
// pre-split design this comment used to describe, where a plain `customer`
// applied and role flipped to 'seller' only on admin approval).
router.post('/apply', requireAuth, requireSellerAccount, validate(shopApplySchema), async (req, res) => {
  const {
    name, description, logo, cover_url, business_type, full_name,
    id_number, birthdate, phone,
    country, province, address, store_slug, category_id, bank_name,
    bank_account_name, bank_account_number, currency,
  } = req.body;

  // store_slug: honor the caller's own choice verbatim if given (unchanged
  // behavior — a single attempt, "already taken" 409 on collision). If none
  // was given, auto-generate from `name` (docs/tiktok-seller-onboarding-
  // flow.md's reference flow never asks for a store URL at all) and retry
  // with a "-2", "-3", ... suffix on collision, up to MAX_SLUG_ATTEMPTS —
  // only the auto-generated path retries; we'd never silently swap in a
  // different slug than the one a seller actually typed.
  const autoSlug = !store_slug;
  const baseSlug = autoSlug ? slugify(name) : store_slug;
  const maxAttempts = autoSlug ? MAX_SLUG_ATTEMPTS : 1;

  let shop;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidateSlug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      try {
        const r = await query(
          `INSERT INTO shops(
             seller_account_id, name, description, logo, cover_url, business_type,
             full_name, id_number, birthdate, phone, country, province, address, store_slug,
             category_id, bank_name, bank_account_name, bank_account_number,
             currency, status, submitted_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'pending',NOW())
           RETURNING *`,
          [
            req.user.id, name, description || null, logo || null, cover_url || null,
            business_type || null, full_name || null, id_number || null, birthdate || null,
            phone || null, country || null,
            province || null, address || null, candidateSlug, category_id || null,
            bank_name || null, bank_account_name || null, bank_account_number || null,
            currency || null,
          ]
        );
        shop = r.rows[0];
        break;
      } catch (e) {
        if (e.code !== '23505') throw e;
        if (e.constraint !== 'idx_shops_store_slug') {
          return res.status(409).json({ error: 'You already have a shop.' });
        }
        const isLastAttempt = attempt === maxAttempts - 1;
        if (!isLastAttempt) continue; // auto-generated slug collided — try the next suffix
        return res.status(409).json({
          error: autoSlug
            ? 'Could not generate a unique store URL — please try again.'
            : 'This store URL is already taken.',
        });
      }
    }
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error.' });
  }

  res.status(201).json({ shop });

  // Fire-and-forget — this INSERT only ever succeeds once per seller (DB
  // unique constraint on seller_account_id), so this only runs on genuine
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
});

// ── GET /api/shops/me ── own shop + documents (for the seller dashboard to
// show pending/needs_info/rejected/approved/suspended, or prompt to apply if
// none yet).
router.get('/me', requireAuth, requireSellerAccount, async (req, res) => {
  try {
    const r = await query('SELECT * FROM shops WHERE seller_account_id=$1', [req.user.id]);
    if (!r.rows.length) return res.json({ shop: null, documents: [] });
    const docsRes = await query('SELECT * FROM seller_documents WHERE shop_id=$1 ORDER BY uploaded_at DESC', [r.rows[0].id]);
    res.json({ shop: r.rows[0], documents: await signDocuments(docsRes.rows) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/shops/me ── seller edits own shop fields. Does not touch
// `status` — approval/rejection state is admin-only (see PATCH /:id); the
// one seller-triggered exception is POST /me/resubmit below.
router.patch('/me', requireAuth, requireSellerAccount, validate(shopUpdateSchema), async (req, res) => {
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
    if (b.id_number            !== undefined) set('id_number', b.id_number || null);
    if (b.birthdate            !== undefined) set('birthdate', b.birthdate || null);
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
      `UPDATE shops SET ${updates.join(',')} WHERE seller_account_id=$${idx} RETURNING *`,
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
router.post('/me/resubmit', requireAuth, requireSellerAccount, async (req, res) => {
  try {
    const current = await query('SELECT status FROM shops WHERE seller_account_id=$1', [req.user.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'No shop found — apply first.' });
    if (!['rejected', 'needs_info'].includes(current.rows[0].status)) {
      return res.status(400).json({ error: 'Only a rejected or needs-info application can be resubmitted.' });
    }
    const r = await query(
      `UPDATE shops SET status='pending', submitted_at=NOW(), updated_at=NOW()
       WHERE seller_account_id=$1 RETURNING *`,
      [req.user.id]
    );
    res.json({ ok: true, shop: r.rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── PATCH /api/shops/me/onboarding-checklist ── merge-update the JSONB
// checklist one or more keys at a time (Postgres `||` shallow-merges,
// leaving keys not present in this request untouched).
router.patch('/me/onboarding-checklist', requireAuth, requireSellerAccount, validate(checklistSchema), async (req, res) => {
  try {
    if (!Object.keys(req.body).length) return res.status(400).json({ error: 'No fields to update.' });
    const r = await query(
      `UPDATE shops SET onboarding_checklist = onboarding_checklist || $1::jsonb, updated_at=NOW()
       WHERE seller_account_id=$2 RETURNING onboarding_checklist`,
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
router.post('/me/documents', requireAuth, requireSellerAccount, (req, res) => {
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
      const shopRes = await query('SELECT id FROM shops WHERE seller_account_id=$1', [req.user.id]);
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
// requireSeller-gated POST /upload, which also accepts admin — a seller
// mid-application (shop not approved yet) still needs to upload a logo/cover.
router.post('/me/branding', requireAuth, requireSellerAccount, (req, res) => {
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
      const shopRes = await query('SELECT id FROM shops WHERE seller_account_id=$1', [req.user.id]);
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

// ── POST /api/shops/verify-phone/start ── Phase 4, apply.html Step 5 —
// sends a 6-digit SMS code via Twilio Verify to the given number. No shop
// row required (unlike documents/branding above) -- phone verification can
// happen before Step 1 even creates one, since Step 5 comes after it in
// the form but this doesn't touch `shops` at all itself. Self-serve only
// (requireSellerAccount, no admin fallback), matching every other route in
// this section.
router.post('/verify-phone/start', requireAuth, requireSellerAccount, phoneVerifyStartRateLimit, validate(phoneVerifySchema), async (req, res) => {
  try {
    await startVerification(req.body.phone);
    res.json({ ok: true });
  } catch(e) {
    console.error('[TWILIO VERIFY START]', e.code, e.message);
    // Twilio-specific codes worth a friendlier message than the generic
    // fallback -- 60200 is "invalid phone number" (e.g. too short/garbled
    // after normalizePhoneKH()), 60203 is Twilio's own per-number send-rate
    // cap (distinct from phoneVerifyStartRateLimit above, which is ours),
    // 21608 is trial-account-only: a Twilio trial account can only send to
    // numbers pre-added as a "Verified Caller ID" in the Console (or a
    // Verify Service test number, which bypasses this entirely). Found
    // this gap testing against a real number on the project's trial
    // account -- it was previously falling through to the generic 502.
    if (e.code === 60200) return res.status(400).json({ error: 'That doesn’t look like a valid phone number.' });
    if (e.code === 60203) return res.status(429).json({ error: 'Too many codes sent to this number recently. Please try again later.' });
    if (e.code === 21608) return res.status(400).json({ error: 'This number needs to be verified in the Twilio trial account first (or use a Verify test number).' });
    res.status(502).json({ error: 'Could not send verification code. Please try again.' });
  }
});

// ── POST /api/shops/verify-phone/check ── Phase 4 — checks the code the
// seller typed back against Twilio. Returns verified:true only when Twilio
// itself reports the code as approved (checkVerification() below already
// enforces that, not just "the request didn't error") -- this is a
// stateless check, nothing is written to `shops` here; apply.html still
// saves `phone` the normal way via PATCH /me once Step 5's Continue is
// clicked, same as before Phase 4.
router.post('/verify-phone/check', requireAuth, requireSellerAccount, phoneVerifyCheckRateLimit, validate(phoneVerifyCheckSchema), async (req, res) => {
  try {
    const approved = await checkVerification(req.body.phone, req.body.code);
    if (!approved) return res.status(400).json({ error: 'Invalid or expired code.' });
    res.json({ ok: true, verified: true });
  } catch(e) {
    console.error('[TWILIO VERIFY CHECK]', e.code, e.message);
    // 20404 = no pending verification found for this number (expired --
    // Twilio Verify codes expire after 10 minutes by default -- or check
    // called without ever calling /start for this number).
    if (e.code === 20404) return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
    res.status(502).json({ error: 'Could not verify code. Please try again.' });
  }
});

// ── GET /api/shops ── admin: list all shops (review queue). ?status= filter
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const status = req.query.status || null;
    // owner_name has no dedicated column on seller_accounts (email/phone
    // only) — fall back to shops.full_name (captured at apply Step "Seller
    // Info"), which is null until a seller fills that step in, hence the
    // COALESCE to email so admin-shops.html always has something to show.
    const r = status
      ? await query(
          `SELECT s.*, COALESCE(s.full_name, sa.email) AS owner_name, sa.email AS owner_email
           FROM shops s JOIN seller_accounts sa ON sa.id=s.seller_account_id
           WHERE s.status=$1 ORDER BY s.created_at DESC`,
          [status]
        )
      : await query(
          `SELECT s.*, COALESCE(s.full_name, sa.email) AS owner_name, sa.email AS owner_email
           FROM shops s JOIN seller_accounts sa ON sa.id=s.seller_account_id
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
      `SELECT s.*, COALESCE(s.full_name, sa.email) AS owner_name, sa.email AS owner_email
       FROM shops s JOIN seller_accounts sa ON sa.id = s.seller_account_id
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
// Approving used to also flip users.role='seller' inside a transaction
// (pre seller-identity-split design, to avoid a shop ending up 'approved'
// with its owner stuck on role='customer') — under the split, a shop's
// owner is a seller_accounts row from the moment they signed up, there is
// no role left to flip, so this is back to a single UPDATE like every other
// status branch below.
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
      `SELECT s.status, sa.email AS owner_email
       FROM shops s JOIN seller_accounts sa ON sa.id = s.seller_account_id WHERE s.id=$1`,
      [req.params.id]
    );
    if (!current.rows.length) return res.status(404).json({ error: 'Shop not found.' });
    if (current.rows[0].status === status) {
      return res.status(400).json({ error: `Shop is already ${status}.` });
    }
    const ownerEmail = current.rows[0].owner_email;

    if (status === 'approved') {
      const r = await query(
        `UPDATE shops SET status='approved', reviewed_by=$1, reviewed_at=NOW(), updated_at=NOW()
         WHERE id=$2 RETURNING *`,
        [req.user.id, req.params.id]
      );
      const shop = r.rows[0];
      const t = STATUS_EMAIL.approved;
      sendEmail(ownerEmail, t.subject, t.text(shop), t.html(shop));
      return res.json({ ok: true, shop });
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
