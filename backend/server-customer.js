require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const session   = require('express-session');
const path      = require('path');
const fs        = require('fs');
const { initDb } = require('./db');
const { router: authRouter, passport } = require('./routes/auth');
const ordersRouter   = require('./routes/orders');
const paymentRouter  = require('./routes/payment');
const wishlistRouter = require('./routes/wishlist');
const addressesRouter= require('./routes/addresses');
const couponsPublicRouter = require('./routes/couponsPublic');
const cartRouter     = require('./routes/cart');
const productsRouter = require('./routes/products');
const categoriesRouter = require('./routes/categories');
const shopPublicRouter = require('./routes/shopPublic');

// ═══════════════════════════════════════════════════════════════
// server-customer.js — Multi-domain split (2026-07-28), Phase 0/3.
// Dedicated process for bardskh.com. Serves ONLY the customer-facing pages
// (built into ../public-customer from ../public-shared +
// ../public-customer-src by scripts/build-public.js) and mounts ONLY the
// routers a shopper/account holder uses: the FULL auth.js (this is the only
// server with signin/signup/OAuth pages — seller./admin. redirect back
// here), orders, payment (full checkout/webhook/QR flow), wishlist,
// addresses, cart, the public product catalog, coupon preview at checkout,
// and categories (public GET, used by every product-listing page).
// Deliberately NOT mounted: seller.js, shops.js, couponsSeller.js — no
// seller/admin dashboard code exists in this process at all.
//
// This file does NOT touch server.js or public/ — the existing combined
// service keeps running exactly as before until this domain is cut over
// (Phase 3, last — after admin and seller are both live and verified).
// ═══════════════════════════════════════════════════════════════

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '../public-customer');

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
app.use(express.urlencoded({ extended: true, limit: '2mb' })); // ABA PayWay webhook may POST form-encoded
app.use(session({
  secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'bards-secret',
  resave: false, saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 600000 },
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many requests.' } }));
app.use('/api',      rateLimit({ windowMs: 60 * 1000,      max: 120, message: { error: 'Too many requests.' } }));

if (process.env.NODE_ENV !== 'production') {
  app.use((req, _, next) => { console.log('[customer]', req.method, req.url); next(); });
}

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

app.use('/api/auth',      authRouter);
app.use('/api/orders',    ordersRouter);
app.use('/api/payment',   paymentRouter);
app.use('/api/wishlist',  wishlistRouter);
app.use('/api/addresses', addressesRouter);
app.use('/api/coupons',   couponsPublicRouter);
app.use('/api/cart',      cartRouter);
app.use('/api/products',  productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/shops',     shopPublicRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString(), service: 'customer' }));

// Clean URLs for every .html in public-customer/, including nested
// subfolders (en/, kh/ — the static-page translations). The old version of
// this scan only read the top level, so /en/contact (no .html) never
// matched any real route and silently fell through to the SPA fallback
// below instead (serving the homepage, not the contact page — worse than a
// 404 since it looked like it worked). Walking manually rather than using
// fs.readdirSync's built-in `recursive: true` option (Node ≥20.1 only —
// package.json doesn't pin an engines version, so that flag isn't
// guaranteed to exist wherever this actually runs).
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
    // index.html is deliberately NOT given its own /index route — bare `/`
    // (served by express.static's default directory-index behavior) is the
    // only way in; a professional site shouldn't have two working URLs for
    // the same homepage.
    if (rel === 'index.html') return;
    const route = '/' + rel.replace(/\.html$/, '');
    app.get(route, (_, res) => res.sendFile(rel, { root: PUBLIC }));
  });
} catch (e) { console.warn('Could not scan PUBLIC folder:', e.message); }

// /categories/:cat → tops.html (generic category-listing template — see
// CLAUDE.md §10/§11). Same convention as the combined server.js.
app.get('/categories/:cat', (_, res) => res.sendFile('tops.html', { root: PUBLIC }));

// Legacy category URLs (/pants, /accessories) — same file, unchanged. No
// .html variant registered anymore (Clean URLs Phase 2, 2026-08-05) — the
// blanket .html block above would have shadowed it anyway, so it's removed
// outright rather than left as dead code.
['pants', 'accessories'].forEach(cat => {
  app.get(`/${cat}`, (_, res) => res.sendFile('tops.html', { root: PUBLIC }));
});

// /product/:id → product.html
app.get('/product/:id', (_, res) => {
  res.sendFile('product.html', { root: PUBLIC }, err => {
    if (err) res.sendFile('all-products.html', { root: PUBLIC });
  });
});

// Shop storefront (docs/06-shop-profile-follow-blueprint.md) — /shop/:slug
// is the primary, prettier URL; /shop/id/:id is the fallback for shops
// that never set a store_slug (optional at apply time — checked the real
// DB on 2026-08-06: 2 of the 3 currently-approved shops have none). Both
// serve the same shop.html, which reads the URL client-side to decide
// which lookup to call — /shop/id/:id MUST be registered first, since
// Express matches route patterns in registration order and /shop/:slug's
// wildcard would otherwise swallow /shop/id/anything, treating "id" as if
// it were a literal slug value (also why 'id' is in shops.js's
// RESERVED_STORE_SLUGS, belt-and-suspenders against a shop ever actually
// being slugged "id").
//
// :tab? (optional, 2026-08-07 redesign) — shop.html now has 4 client-side
// "views" (Products/Categories/Information/Category Detail) navigated via
// pushState, not full reloads. This one route per variant still has to
// resolve on a direct load/refresh/shared link for each of them
// (/shop/:slug, /shop/:slug/categories, /shop/:slug/information, and the
// same 3 under /shop/id/:id/) — verified in isolation that Express 4's
// optional named param handles all 6 shapes correctly with just these 2
// routes, still respecting the id-before-slug ordering above (a request
// to /shop/id/xxx is still caught by the first line, not parsed as
// slug="id", tab="xxx" by the second). Renamed from /about to
// /information 2026-08-08 (no functional change needed here — this
// route was always generic, never hardcoded the tab name).
app.get('/shop/id/:id/:tab?', (_, res) => res.sendFile('shop.html', { root: PUBLIC }));
app.get('/shop/:slug/:tab?', (_, res) => res.sendFile('shop.html', { root: PUBLIC }));

// /shop/:slug/category/:categorySlug — the Category Detail page (2026-08-08).
// A 4-segment path can never match the :tab? routes above (those top out
// at 3 segments), so this is a clean additive pair, not a rework — order
// relative to the :tab? routes doesn't matter for correctness (different
// segment counts can't collide either direction), but id-before-slug
// still does, same reasoning as above. Verified all 6 shapes (this pair +
// the :tab? pair, each in id/slug variants) resolve correctly together.
app.get('/shop/id/:id/category/:categorySlug', (_, res) => res.sendFile('shop.html', { root: PUBLIC }));
app.get('/shop/:slug/category/:categorySlug', (_, res) => res.sendFile('shop.html', { root: PUBLIC }));

// Explicitly reject /index (no extension) — omitting it from the
// walkHtmlFiles scan above isn't enough on its own: without this, the
// request would just fall through to the SPA fallback below and get
// index.html served anyway (200, silently the wrong outcome) — the exact
// same class of bug the recursive-walk fix corrected for /en/*, /kh/*.
// Registered before the fallback so it actually wins.
app.get('/index', (_, res) => res.status(404).send('Not found.'));

// SPA fallback — this server's audience is the whole storefront, so an
// unmatched path still resolves to the homepage (unlike the seller/admin
// servers, which 404 on anything outside their own pages).
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile('index.html', { root: PUBLIC });
});

app.use((e, _, res, __) => { console.error(e); res.status(500).json({ error: 'Internal error.' }); });

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`\nBards CUSTOMER → http://localhost:${PORT}\n`);
  });
}
start().catch(e => { console.error('Start failed:', e); process.exit(1); });
