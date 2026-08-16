require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const { initDb } = require('./db');

// ═══════════════════════════════════════════════════════════════
// server-seller.js — Multi-domain split (2026-07-28), Phase 0/2.
// Dedicated process for seller.bardskh.com. Serves ONLY seller.html and
// seller-*.html (built into ../public-seller from ../public-shared +
// ../public-seller-src by scripts/build-public.js) and mounts ONLY the
// routers the seller dashboard uses:
//   - authSession.js   — /me, /refresh, /logout, backed by the SAME
//                        cross-domain session as bardskh.com/admin.bardskh.com
//                        (services/session.js, cookie Domain=.bardskh.com) —
//                        this is what still lets an admin session carry over
//                        silently onto this server (the "Seller Hub" link
//                        from admin.bardskh.com). See requireSellerOrAdmin
//                        in middleware/auth.js for how admin vs seller
//                        callers are told apart downstream.
//   - authSeller.js    — seller identity split: THIS server's own
//                        signup/signin/OTP + a completely separate session
//                        (seller_accounts / seller_refresh_tokens, cookie
//                        bards_seller_rt, host-only — never shared
//                        cross-domain). Mounted at /api/auth/seller,
//                        alongside authSession.js above at /api/auth (no
//                        path collision). See public-shared/api.js's
//                        SellerAuth and public-seller-src/signin.html /
//                        signup.html for the frontend half.
//   - paymentConfirm.js — POST /confirm/:orderId, for seller-orders.html's
//                        "CHECK PAYMENT STATUS" button
//   - seller.js        — the dashboard itself (orders/stats/products/
//                        customers/upload) — also used by admin (via
//                        req.userRole), which is why admin.bardskh.com's
//                        "Seller Hub" link points here rather than
//                        duplicating this file
//   - shops.js         — /apply, /me (a seller's own shop). GET '/' and
//                        PATCH '/:id' (admin approve/reject) are also in
//                        this file but simply unreachable from any page in
//                        public-seller-src — no admin-*.html page lives here
//   - couponsSeller.js — seller-coupons.html's CRUD (admin reaches the same
//                        page/routes when they cross over from admin.)
//   - categories.js    — public GET only exercised here (the category
//                        dropdown in seller-products.html), but the file's
//                        admin-only CRUD routes are inert unless called by
//                        an admin session — harmless since they're gated by
//                        requireRole('admin') regardless of which server
//                        they're mounted on
// Deliberately NOT mounted: routes/auth.js (full), orders.js, wishlist.js,
// addresses.js, cart.js, products.js (public catalog), couponsPublic.js.
//
// This file does NOT touch server.js or public/ — the existing combined
// service keeps running exactly as before until each domain is cut over.
// ═══════════════════════════════════════════════════════════════

const authSessionRouter = require('./routes/authSession');
const authSellerRouter  = require('./routes/authSeller');
const paymentConfirmRouter = require('./routes/paymentConfirm');
const sellerRouter   = require('./routes/seller');
const shopsRouter    = require('./routes/shops');
const couponsSellerRouter = require('./routes/couponsSeller');
const categoriesRouter = require('./routes/categories');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '../public-seller');

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

const allowed = [
  process.env.FRONTEND_URL || 'http://localhost:5500',
  'http://127.0.0.1:5500', 'http://localhost:5500',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'https://bardskh.com', 'https://www.bardskh.com',
  'https://seller.bardskh.com', 'https://admin.bardskh.com',
  // Temporary Render URLs, used to test each split server before its real
  // domain is cut over (multi-domain split, Phase 1-3) — a credentialed
  // fetch() from a page loaded on e.g. bards-customer.onrender.com sends
  // that as its Origin header, which the cors package rejects with a
  // thrown 'CORS blocked' error (surfacing as a bare "Internal error." to
  // the browser) if it's not in this list. Missed initially because
  // admin/seller both had their real custom domain attached before any
  // credentialed fetch was tested on the temp URL — found 2026-07-30 while
  // testing sign-in on bards-customer.onrender.com pre-cutover.
  'https://bards-shop.onrender.com',
  'https://bards-customer.onrender.com',
  'https://bards-seller.onrender.com',
  'https://bards-admin.onrender.com',
];
app.use(cors({
  origin: (o, cb) => (!o || allowed.includes(o)) ? cb(null, true) : cb(new Error('CORS blocked')),
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120, message: { error: 'Too many requests.' } }));

if (process.env.NODE_ENV !== 'production') {
  app.use((req, _, next) => { console.log('[seller]', req.method, req.url); next(); });
}

// Bare `/` (revised 2026-08-01, seller onboarding plan change) — no longer
// redirects straight to the /seller dashboard. It's now a public
// partner-facing landing page (seller-landing.html, built from
// public-seller-src same as everything else here) explaining why to sell
// on Bards, with its own "Start Selling" CTA to /apply. Someone landing
// here has no account yet — redirecting into the dashboard first would
// just bounce them straight back out via its own auth guard. Served
// directly (not a redirect) so the URL bar stays at the bare domain.
app.get('/', (_, res) => res.sendFile('seller-landing.html', { root: PUBLIC }));

// Clean URLs Phase 2 (2026-08-05) — .html is no longer reachable at all, not
// just "not recommended". Registered before express.static so static never
// gets a chance to serve the real file by its literal .html path. Project
// has no live users and no SEO to preserve, so a hard 404 (not a 301) is
// fine here. req.path excludes the query string, so ?foo=bar on a .html
// request is still caught correctly.
app.use((req, res, next) => {
  if (req.path.toLowerCase().endsWith('.html')) return res.status(404).send('Not found.');
  next();
});

app.use(express.static(PUBLIC));

app.use('/api/auth',        authSessionRouter);
app.use('/api/auth/seller', authSellerRouter);
app.use('/api/payment',   paymentConfirmRouter);
app.use('/api/seller',    sellerRouter);
app.use('/api/shops',     shopsRouter);
app.use('/api/coupons',   couponsSellerRouter);
app.use('/api/categories', categoriesRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString(), service: 'seller' }));

// ═══════════════════════════════════════════════════════════════
// TEMPORARY — Phase 6 manual testing bypass (2026-08-16). See
// docs/07-apply-flow-status.md. Twilio's trial account still blocks
// sending real SMS to most numbers (known since Phase 4 -- no Cambodia
// number to test with, trial-account country restrictions), which was
// blocking testing the rest of apply.html's Step 5 -> popup -> submit flow
// end-to-end. This lets apply.html's own client-side "must be verified"
// gate be skipped locally WITHOUT touching Twilio integration, the
// verify-phone/start|check routes, or their validation at all -- those are
// completely untouched and still fully enforce verification exactly as
// before for every other caller.
//
// Double-gated so there is no path for this to ever be live in production,
// even by accident: NODE_ENV must not be 'production' (Render always sets
// this), AND the SKIP_PHONE_VERIFY env var must be explicitly 'true' (only
// ever set in a local backend/.env -- never added to Render's environment
// variables, never committed as a real default anywhere).
//
// MUST BE REMOVED before launch -- delete this block, the matching
// SKIP_PHONE_VERIFY line in backend/.env, and apply.html's corresponding
// dev-bypass code once Phase 6 testing is done and Twilio is upgraded off
// the trial plan (see docs/07-apply-flow-status.md for the removal note).
const PHONE_VERIFY_BYPASS = process.env.NODE_ENV !== 'production' && process.env.SKIP_PHONE_VERIFY === 'true';
app.get('/api/dev-flags', (req, res) => res.json({ phoneVerifyBypass: PHONE_VERIFY_BYPASS }));
// ═══════════════════════════════════════════════════════════════

// Clean URLs for every .html in public-seller/. No nested subfolders exist
// here today, but this walks recursively anyway for the same reason as
// server-customer.js (consistency + future-proofing, not a bug fix on this
// server specifically) — manual walk rather than fs.readdirSync's
// `recursive: true` (Node ≥20.1 only; no engines version pinned).
function walkHtmlFiles(dir, base = '') {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(walkHtmlFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.html')) {
      files.push(rel);
    }
  }
  return files;
}
try {
  walkHtmlFiles(PUBLIC).forEach(rel => {
    // No index.html exists on this server today, but guard it the same way
    // as server-customer.js anyway — consistency + future-proofing.
    if (rel === 'index.html') return;
    const route = '/' + rel.replace(/\.html$/, '');
    app.get(route, (_, res) => res.sendFile(rel, { root: PUBLIC }));
  });
} catch (e) { console.warn('Could not scan PUBLIC folder:', e.message); }

// No SPA fallback — anything unmatched (customer/admin paths included) is a
// genuine 404, proving no other audience's pages are reachable here.
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).send('Not found.');
});

app.use((e, _, res, __) => { console.error(e); res.status(500).json({ error: 'Internal error.' }); });

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`\nBards SELLER → http://localhost:${PORT}\n`);
  });
}
start().catch(e => { console.error('Start failed:', e); process.exit(1); });
