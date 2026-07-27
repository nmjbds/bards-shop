require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const session   = require('express-session');
const path      = require('path');
const { initDb } = require('./db');
const { router: authRouter, passport } = require('./routes/auth');
const ordersRouter   = require('./routes/orders');
const paymentRouter  = require('./routes/payment');
const wishlistRouter = require('./routes/wishlist');
const sellerRouter   = require('./routes/seller');
const addressesRouter= require('./routes/addresses');
const couponsRouter  = require('./routes/coupons');
const cartRouter     = require('./routes/cart');
const productsRouter = require('./routes/products');
const shopsRouter    = require('./routes/shops');
const categoriesRouter = require('./routes/categories');

const app  = express();
// Render puts exactly one reverse proxy in front of this app — trust its
// X-Forwarded-For so req.ip (used as the default rate-limit key) reflects the
// real client IP instead of Render's proxy address for every request.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '../public');

// Multi-domain (Step 8, 2026-07-27) — seller.bardskh.com and
// admin.bardskh.com are additional Custom Domains on this exact same Render
// Web Service (one deploy, one process, one DB connection — not separate
// services), so there's nothing to route between at the infra level; the
// only thing that needs to change per-domain is which page a bare `/`
// resolves to and where signin/signup send you after logging in (step 8c).
// req.bardsHost is detection only for now — 8a doesn't change behavior for
// any request yet, this just makes the hostname available to later
// middleware/routes. Exact-match on the literal production hostnames
// (not a `startsWith('seller.')` prefix check) so a request actually has to
// be for one of these two real subdomains, not anything that merely starts
// with the same letters.
function bardsHostKind(hostname) {
  if (hostname === 'seller.bardskh.com') return 'seller';
  if (hostname === 'admin.bardskh.com') return 'admin';
  return 'main';
}
app.use((req, res, next) => {
  req.bardsHost = bardsHostKind(req.hostname);
  next();
});

/* Helmet — sets the usual protective headers (X-Content-Type-Options,
   X-Frame-Options, HSTS, removes X-Powered-By, etc).
   contentSecurityPolicy is OFF: the frontend is plain static HTML full of
   onclick="..." handlers and inline <style>/<script> (no build step, no
   nonces/hashes anywhere) — Helmet's default CSP blocks all of that and
   would break every page. Enabling a real CSP here needs a proper pass
   over the frontend first, not a silent one-line flip. */
/* crossOriginOpenerPolicy: Helmet's default is 'same-origin', which severs
   window.opener between this site and any popup we open to a different
   origin (e.g. Telegram's login widget popping open oauth.telegram.org) —
   the popup can no longer report its result back to the window that opened
   it. 'same-origin-allow-popups' keeps the same-origin isolation for this
   site's own pages while still allowing that one specific cross-origin
   popup pattern to communicate back (2026-07-23). */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

/* CORS */
const allowed = [
  process.env.FRONTEND_URL||'http://localhost:5500',
  'http://127.0.0.1:5500','http://localhost:5500',
  'http://localhost:3000','http://127.0.0.1:3000',
  'https://bards-shop.onrender.com',
  'https://bardskh.com',
  'https://www.bardskh.com',
  // Multi-domain (Step 8, 2026-07-27) — seller./admin. subdomains, same
  // Render service/deploy as the domains above, not separate services.
  'https://seller.bardskh.com',
  'https://admin.bardskh.com',
];
app.use(cors({
  origin:(o,cb)=>(!o||allowed.includes(o))?cb(null,true):cb(new Error('CORS blocked')),
  credentials:true,
}));

/* Body + Session */
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true, limit:'2mb'})); // ABA PayWay webhook may POST form-encoded, not JSON
app.use(session({
  secret:process.env.SESSION_SECRET||process.env.JWT_SECRET||'bards-secret',
  resave:false, saveUninitialized:false,
  cookie:{secure:process.env.NODE_ENV==='production',maxAge:600000}
}));
app.use(passport.initialize());
app.use(passport.session());

/* Rate limit */
app.use('/api/auth', rateLimit({windowMs:15*60*1000,max:30,message:{error:'Too many requests.'}}));
app.use('/api',      rateLimit({windowMs:60*1000,   max:120,message:{error:'Too many requests.'}}));

/* Dev logger */
if(process.env.NODE_ENV!=='production')
  app.use((req,_,next)=>{console.log(req.method,req.url);next();});

/* ── Serve static files (HTML, JS, CSS, images) ── */
app.use(express.static(PUBLIC));

/* ── API Routes ── */
app.use('/api/auth',      authRouter);
app.use('/api/orders',    ordersRouter);
app.use('/api/payment',   paymentRouter);
app.use('/api/wishlist',  wishlistRouter);
app.use('/api/seller',    sellerRouter);
app.use('/api/addresses', addressesRouter);
app.use('/api/coupons',   couponsRouter);
app.use('/api/cart',     cartRouter);
app.use('/api/products', productsRouter);
app.use('/api/shops',    shopsRouter);
app.use('/api/categories', categoriesRouter);

/* /api/products — handled by routes/products.js */

/* ── Health ── */
// bardsHost included as a cheap, permanent diagnostic — once real DNS is live
// (step 8e) this is the fastest way to confirm a subdomain is actually
// reaching this app and being detected correctly, e.g. curl
// https://seller.bardskh.com/api/health and check for "bardsHost":"seller".
app.get('/api/health',(req,res)=>res.json({ok:true,ts:new Date().toISOString(),bardsHost:req.bardsHost}));

/* ── Clean URLs — auto-scan PUBLIC folder ── */
// ทุก .html ได้ clean URL อัตโนมัติ ไม่ต้องแก้เมื่อเพิ่มไฟล์ใหม่
const fs = require('fs');
try {
  fs.readdirSync(PUBLIC)
    .filter(f => f.endsWith('.html'))
    .forEach(f => {
      const route = '/' + f.replace('.html','');
      app.get(route, (_,res) => res.sendFile(f, {root:PUBLIC}));
    });
} catch(e) { console.warn('Could not scan PUBLIC folder:', e.message); }

/* /categories/:cat → tops.html (template เดียว, generic — categories migration step 4d, 2026-07-25)
   เดิม tops.html/pants.html/accessories.html เนื้อหาเหมือนกันทุกตัวอักษร ต่างแค่ชื่อไฟล์ที่ client JS
   ใช้ derive PAGE_CAT — รวมเหลือ tops.html ไฟล์เดียว (ชื่อไฟล์เดิม ไม่ได้ตั้งใจสื่อว่าเป็นหมวด "เสื้อ"
   อย่างเดียวอีกต่อไป — ดู comment ในตัวไฟล์) เสิร์ฟไฟล์เดียวกันนี้ตรงๆ ให้ทุก :cat โดยไม่เช็คว่ามีหมวดนั้น
   จริงใน DB หรือไม่ที่ระดับ routing เลย — ปล่อยให้ client JS (fetchAndMerge/fetchCategories) จัดการเอง
   ไม่มีสินค้า/ไม่มีหมวดจริงก็แค่โชว์ empty state ปกติ — หมวดใหม่ที่เพิ่มผ่าน DB (categories table) ใช้
   เส้นทางนี้ได้ทันทีไม่ต้อง deploy โค้ด/สร้างไฟล์ใหม่เลย */
app.get('/categories/:cat', (_,res)=> res.sendFile('tops.html', {root:PUBLIC}));

/* URL หมวดแบบเก่า (ก่อน step 4d) ที่อาจมีคนบุ๊กมาร์ก/แชร์ไว้ — /pants, /pants.html, /accessories,
   /accessories.html ยังใช้งานได้ปกติแม้ pants.html/accessories.html ถูกลบไฟล์จริงออกไปแล้ว (รวมเข้า
   tops.html หมดแล้ว) — เสิร์ฟไฟล์เดียวกัน (tops.html) ตรงๆ ไม่ redirect เพราะ client JS อ่าน category จาก
   location.pathname ของ URL จริงที่ browser เห็นอยู่แล้ว ไม่ได้พึ่งพาว่าไฟล์ไหนถูกส่งมา เลยได้ค่าถูกต้อง
   ไม่ว่าจะเข้าทางไหน — /tops, /tops.html ไม่ต้องเพิ่ม route ตรงนี้เพราะไฟล์ tops.html ยังอยู่จริง
   express.static() + auto-scan ด้านบน เสิร์ฟให้เองอยู่แล้วตามปกติ */
['pants','accessories'].forEach(cat => {
  app.get(`/${cat}`,      (_,res)=> res.sendFile('tops.html', {root:PUBLIC}));
  app.get(`/${cat}.html`, (_,res)=> res.sendFile('tops.html', {root:PUBLIC}));
});

/* /product/:id → product.html */
app.get('/product/:id', (_,res)=>{
  res.sendFile('product.html',{root:PUBLIC}, err=>{
    if(err) res.sendFile('all-products.html',{root:PUBLIC});
  });
});

/* SPA fallback — ส่ง index.html สำหรับทุก path ที่ไม่ match */
app.get('*', (req,res)=>{
  if(req.path.startsWith('/api')) return res.status(404).json({error:'Not found.'});
  res.sendFile('index.html',{root:PUBLIC});
});

app.use((e,_,res,__)=>{console.error(e);res.status(500).json({error:'Internal error.'});});

async function start(){
  await initDb();
  app.listen(PORT,()=>{
    console.log(`\n🚀 Bards → http://localhost:${PORT}`);
    console.log(`   /signin  /signup  /categories/tops  /categories/pants`);
    console.log(`   /seller  /seller-orders  /all-products\n`);
  });
}
start().catch(e=>{console.error('Start failed:',e);process.exit(1);});