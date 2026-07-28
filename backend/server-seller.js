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
//   - authSession.js   — /me, /refresh, /logout only (no signup/signin/OAuth
//                        pages here; those live on the customer server)
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

// Bare `/` always lands on the seller dashboard.
app.get('/', (_, res) => res.redirect('/seller'));

app.use(express.static(PUBLIC));

app.use('/api/auth',      authSessionRouter);
app.use('/api/payment',   paymentConfirmRouter);
app.use('/api/seller',    sellerRouter);
app.use('/api/shops',     shopsRouter);
app.use('/api/coupons',   couponsSellerRouter);
app.use('/api/categories', categoriesRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString(), service: 'seller' }));

// Clean URLs for every .html in public-seller/.
try {
  fs.readdirSync(PUBLIC)
    .filter(f => f.endsWith('.html'))
    .forEach(f => {
      const route = '/' + f.replace('.html', '');
      app.get(route, (_, res) => res.sendFile(f, { root: PUBLIC }));
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
