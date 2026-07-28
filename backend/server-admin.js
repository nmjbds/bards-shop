require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const { initDb } = require('./db');

// ═══════════════════════════════════════════════════════════════
// server-admin.js — Multi-domain split (2026-07-28), Phase 0/1.
// Dedicated process for admin.bardskh.com. Serves ONLY admin-*.html (built
// into ../public-admin from ../public-shared + ../public-admin-src by
// scripts/build-public.js — see that file and CLAUDE.md-adjacent plan doc
// for why) and mounts ONLY the routers admin actually uses:
//   - authSession.js  — /me, /refresh, /logout only (no signup/signin/OAuth
//                        pages exist on this domain; those live on the
//                        customer server, which this domain redirects to)
//   - paymentConfirm.js — just POST /confirm/:orderId, for the
//                        "CHECK PAYMENT STATUS" button in admin-orders.html
//   - seller.js       — admin-orders/-stats/-customers.html all call
//                        /api/seller/* (shared with the seller dashboard;
//                        admin sees unscoped data via req.userRole)
//   - shops.js        — admin-shops.html's approve/reject/suspend flow
//   - categories.js   — admin-categories.html's CRUD + the public GET used
//                        by the category dropdown
// Deliberately NOT mounted: routes/auth.js (full signup/signin/OAuth),
// orders.js, wishlist.js, addresses.js, cart.js, products.js (public
// catalog), coupons.js (admin manages coupons via the seller server's
// seller-coupons.html, reached through the "Seller Hub" cross-hub link —
// there's no separate admin coupons page).
//
// This file does NOT touch server.js or public/ — the existing combined
// service keeps running exactly as before until each domain is cut over.
// ═══════════════════════════════════════════════════════════════

const authSessionRouter = require('./routes/authSession');
const paymentConfirmRouter = require('./routes/paymentConfirm');
const sellerRouter   = require('./routes/seller');
const shopsRouter    = require('./routes/shops');
const categoriesRouter = require('./routes/categories');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '../public-admin');

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
  app.use((req, _, next) => { console.log('[admin]', req.method, req.url); next(); });
}

// Bare `/` always lands on the admin dashboard — this server has no other
// audience to disambiguate by hostname (unlike the old combined server.js).
app.get('/', (_, res) => res.redirect('/admin-shops'));

app.use(express.static(PUBLIC));

app.use('/api/auth',      authSessionRouter);
app.use('/api/payment',   paymentConfirmRouter);
app.use('/api/seller',    sellerRouter);
app.use('/api/shops',     shopsRouter);
app.use('/api/categories', categoriesRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString(), service: 'admin' }));

// Clean URLs for every .html in public-admin/ (same auto-scan convention as
// the combined server.js).
try {
  fs.readdirSync(PUBLIC)
    .filter(f => f.endsWith('.html'))
    .forEach(f => {
      const route = '/' + f.replace('.html', '');
      app.get(route, (_, res) => res.sendFile(f, { root: PUBLIC }));
    });
} catch (e) { console.warn('Could not scan PUBLIC folder:', e.message); }

// No SPA fallback to a customer homepage — this server only ever serves
// admin pages, so anything unmatched (including customer/seller paths like
// /checkout or /seller-orders) is a genuine 404, proving no other
// audience's pages are reachable here.
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).send('Not found.');
});

app.use((e, _, res, __) => { console.error(e); res.status(500).json({ error: 'Internal error.' }); });

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`\nBards ADMIN → http://localhost:${PORT}\n`);
  });
}
start().catch(e => { console.error('Start failed:', e); process.exit(1); });
