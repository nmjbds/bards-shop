require('dotenv').config();
const express   = require('express');
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

const app  = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '../public');

/* CORS */
const allowed = [
  process.env.FRONTEND_URL||'http://localhost:5500',
  'http://127.0.0.1:5500','http://localhost:5500',
  'http://localhost:3000','http://127.0.0.1:3000',
  'https://bards-shop.onrender.com',
  'https://bardskh.com',
  'https://www.bardskh.com',
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

/* /api/products — handled by routes/products.js */

/* ── Health ── */
app.get('/api/health',(_,res)=>res.json({ok:true,ts:new Date().toISOString()}));

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

/* /categories/tops → tops.html  (ไฟล์เดิมทำงานได้เลย) */
app.get('/categories/:cat', (req,res)=>{
  const cat = req.params.cat; // tops | pants | accessories
  const file = `${cat}.html`;
  res.sendFile(file, {root:PUBLIC}, err=>{
    if(err) res.sendFile('all-product.html',{root:PUBLIC});
  });
});

/* /product/:id → product.html */
app.get('/product/:id', (_,res)=>{
  res.sendFile('product.html',{root:PUBLIC}, err=>{
    if(err) res.sendFile('all-product.html',{root:PUBLIC});
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