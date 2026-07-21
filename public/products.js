/**
 * products.js — BARDS Single Source of Truth for Products
 * =========================================================
 * ทุกหน้า include ไฟล์นี้ 1 ไฟล์เท่านั้น:
 *   <script src="products.js"></script>
 *
 * อนาคต (เมื่อมี Admin panel):
 *   - Admin POST /api/products  → เพิ่ม/แก้/ลบในฐานข้อมูล
 *   - แก้ loadProducts() ด้านล่างให้ fetch จาก API แทน
 *   - ทุกหน้าไม่ต้องแก้อะไรเพราะดึงจาก PRODUCTS ที่เดียว
 */

const PRODUCTS = {
  'oversized-tee-black': {
    name:'Classic Black Oversized Tee', price:35.00,
    tag:'BESTSELLER', tagLight:false, category:'tops',
    isNew:false, isSale:false, stock:'in-stock',
    dateAdded:'2024-10-01', rating:4.9, reviews:248,
    desc:'Crafted from 300GSM premium heavy-weight cotton.',
    images:['https://hnungh.github.io/mpj/img/oversized-tee-black.jpg','https://hnungh.github.io/mpj/img/hoodie-grey.jpg'],
    colors:[{name:'Noir Black',hex:'#111111'},{name:'Stone White',hex:'#EDE9E1'}],
    sizes:['S','M','L','XL'],
    specs:{Material:'Premium Cotton',Weight:'300 GSM',Fit:'Oversized',Care:'Machine Wash'}
  },
  'cargo-pants-olive': {
    name:'Military Olive Cargo Pants', price:48.18,
    tag:'NEW', tagLight:false, category:'pants',
    isNew:false, isSale:false, stock:'in-stock',
    dateAdded:'2024-11-01', rating:4.7, reviews:91,
    desc:'กางเกงคาร์โก้สีเขียวมะกอก 8 ช่อง Ripstop Nylon',
    images:['https://hnungh.github.io/mpj/img/cargo-pants-olive.jpg','https://hnungh.github.io/mpj/img/hoodie-grey.jpg'],
    colors:[{name:'Olive Green',hex:'#6B7C4A'},{name:'Tactical Black',hex:'#2A2A2A'}],
    sizes:['M','L','XL'],
    specs:{Material:'Ripstop Nylon',Pockets:'8 Pockets',Fit:'Relaxed',Care:'Cold Wash'}
  },
  'hoodie-grey': {
    name:'Stone Grey Pullover Hoodie', price:39.09,
    tag:'POPULAR', tagLight:false, category:'tops',
    isNew:false, isSale:false, stock:'in-stock',
    dateAdded:'2024-10-15', rating:4.8, reviews:175,
    desc:'เสื้อฮู้ดดี้สีเทาหิน French Terry 380GSM',
    images:['https://hnungh.github.io/mpj/img/hoodie-grey.jpg'],
    colors:[{name:'Stone Grey',hex:'#9A9A95'},{name:'Midnight Navy',hex:'#1A2240'}],
    sizes:['S','M','L','XL'],
    specs:{Material:'French Terry',Weight:'380 GSM',Fit:'Regular',Care:'Gentle Wash'}
  },
  'sunglasses-retro': {
    name:'Retro Square Sunglasses', price:26.97,
    tag:'LIMITED', tagLight:false, category:'accessories',
    isNew:false, isSale:true, stock:'low-stock',
    dateAdded:'2024-10-20', rating:4.6, reviews:58,
    desc:'แว่นตากันแดดทรงสี่เหลี่ยม Acetate UV400',
    images:['https://hnungh.github.io/mpj/img/sunglasses-retro.jpg'],
    colors:[{name:'Glossy Black',hex:'#111111'},{name:'Tortoise',hex:'#8B5E3C'}],
    sizes:['One Size'],
    specs:{Frame:'Acetate',Lens:'UV400',Style:'Square Retro','Lens Width':'52mm'}
  },
  'oversized-tee-white': {
    name:'Stone White Oversized Tee', price:23.94,
    tag:'NEW', tagLight:false, category:'tops',
    isNew:true, isSale:false, stock:'in-stock',
    dateAdded:'2025-01-10', rating:4.8, reviews:112,
    desc:'เสื้อ oversized สีขาวหิน 300GSM',
    images:['https://hnungh.github.io/mpj/img/oversized-tee-black.jpg'],
    colors:[{name:'Stone White',hex:'#EDE9E1'},{name:'Noir Black',hex:'#111111'}],
    sizes:['S','M','L','XL'],
    specs:{Material:'Premium Cotton',Weight:'300 GSM',Fit:'Oversized',Care:'Machine Wash'}
  },
  'cargo-pants-black': {
    name:'Tactical Black Cargo Pants', price:48.18,
    tag:'NEW', tagLight:false, category:'pants',
    isNew:true, isSale:false, stock:'in-stock',
    dateAdded:'2025-01-12', rating:4.7, reviews:44,
    desc:'กางเกงคาร์โก้สีดำ 8 ช่อง Ripstop Nylon',
    images:['https://hnungh.github.io/mpj/img/cargo-pants-olive.jpg'],
    colors:[{name:'Tactical Black',hex:'#2A2A2A'},{name:'Olive Green',hex:'#6B7C4A'}],
    sizes:['M','L','XL'],
    specs:{Material:'Ripstop Nylon',Pockets:'8 Pockets',Fit:'Relaxed',Care:'Cold Wash'}
  },
  'hoodie-navy': {
    name:'Midnight Navy Pullover Hoodie', price:39.09,
    tag:'NEW', tagLight:false, category:'tops',
    isNew:true, isSale:false, stock:'in-stock',
    dateAdded:'2025-01-15', rating:4.7, reviews:63,
    desc:'เสื้อฮู้ดดี้สีกรมท่า French Terry 380GSM',
    images:['https://hnungh.github.io/mpj/img/hoodie-grey.jpg'],
    colors:[{name:'Midnight Navy',hex:'#1A2240'},{name:'Stone Grey',hex:'#9A9A95'}],
    sizes:['S','M','L','XL'],
    specs:{Material:'French Terry',Weight:'380 GSM',Fit:'Regular',Care:'Gentle Wash'}
  },
  'sunglasses-black': {
    name:'Classic Black Sunglasses', price:26.97,
    tag:'NEW', tagLight:false, category:'accessories',
    isNew:true, isSale:false, stock:'in-stock',
    dateAdded:'2025-01-18', rating:4.5, reviews:21,
    desc:'แว่นตากันแดดคลาสสิกสีดำ Acetate UV400',
    images:['https://hnungh.github.io/mpj/img/sunglasses-retro.jpg'],
    colors:[{name:'Glossy Black',hex:'#111111'}],
    sizes:['One Size'],
    specs:{Frame:'Acetate',Lens:'UV400',Style:'Classic',Care:'Wipe clean'}
  }
};

const CATEGORIES = [
  { id:'tops',        label:'Tops',        url:'categories/tops.html',        img:PRODUCTS['oversized-tee-black'].images[0] },
  { id:'pants',       label:'Pants',       url:'categories/pants.html',       img:PRODUCTS['cargo-pants-olive'].images[0]   },
  { id:'accessories', label:'Accessories', url:'categories/accessories.html', img:PRODUCTS['sunglasses-retro'].images[0]    },
];

function fmtUSD(n){ return '$'+Number(n).toFixed(2); }

/* escape user/seller-controlled text before it goes into innerHTML (product name, image URL, etc.) */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ─── normalize: แปลง DB row → format เดียวกับ static PRODUCTS ─── */
function _normProduct(p) {
  const parseColors = v => {
    if (!Array.isArray(v)) return [];
    return v.map(c => typeof c === 'object' ? c : { name: c, hex: '#888888' });
  };
  const parseSizes = v => {
    if (!Array.isArray(v)) return [];
    return v.map(s => String(s).toUpperCase());
  };
  const stockStr = p.stock != null
    ? (p.stock > 10 ? 'in-stock' : p.stock > 0 ? 'low-stock' : 'out-of-stock')
    : 'in-stock';
  return {
    id:          p.id,
    name:        p.name || '',
    price:       Number(p.price) || 0,
    sale_price:  p.sale_price ? Number(p.sale_price) : null,
    salePrice:   p.sale_price ? Number(p.sale_price) : null,
    category:    p.category || '',
    images:      Array.isArray(p.images) && p.images.length ? p.images : [''],
    colors:      parseColors(p.colors),
    sizes:       parseSizes(p.sizes),
    desc:        p.description || '',
    description: p.description || '',
    tag:         p.is_new ? 'NEW' : (p.sale_price ? 'SALE' : 'NEW'),
    tagLight:    false,
    isNew:       !!p.is_new,
    isSale:      !!p.sale_price,
    stock:       stockStr,
    is_active:   p.is_active !== false,
    dateAdded:   p.created_at || '',
    specs:       p.specs || null,
  };
}

/* ═══════════════════════════════════════════════════════════
   ProductsAPI — ดึงสินค้าจาก DB พร้อม pagination / filter / search
   
   ใช้งาน:
     const { products, pagination } = await ProductsAPI.fetch({
       page: 1, limit: 24,
       category: 'tops',   // optional
       search: 'polo',     // optional
       sort: 'newest',     // newest | price_asc | price_desc | name
       new: true,          // optional
     });
   
   ดึงสินค้าชิ้นเดียว:
     const { product } = await ProductsAPI.getOne(id);
   
   Merge เข้า PRODUCTS object (สำหรับหน้าที่ยังใช้ PRODUCTS):
     await fetchAndMerge({ category:'tops' });
═══════════════════════════════════════════════════════════ */
// ── API_BASE: ใช้จาก api.js หรือ fallback /api ──
const _API_BASE = (typeof API_BASE !== 'undefined' ? API_BASE : null) || window.BARDS_API_BASE || '/api';

const ProductsAPI = {
  async fetch({ page=1, limit=24, category, search, sort='newest', isNew } = {}) {
    const params = new URLSearchParams({ page, limit, sort });
    if (category) params.set('category', category);
    if (search)   params.set('search', search);
    if (isNew)    params.set('new', 'true');
    const res = await fetch(_API_BASE + '/products?' + params.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return {
      products:   (data.products || []).map(_normProduct),
      pagination: data.pagination || { page:1, total:0, totalPages:1, hasNext:false, hasPrev:false },
    };
  },

  async getOne(id) {
    const res = await fetch(_API_BASE + '/products/' + encodeURIComponent(id));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return { product: data.product ? _normProduct(data.product) : null };
  },
};

/* ─── fetchAndMerge: สำหรับหน้าที่ยังใช้ PRODUCTS object ───
   รับ filter เดียวกับ ProductsAPI.fetch()
   แต่จะ merge ผลลัพธ์เข้า PRODUCTS แทนที่จะ return
   
   document.addEventListener('DOMContentLoaded', async () => {
     await fetchAndMerge({ category: 'tops' }); // หรือไม่ใส่ filter
     renderGrid();
   });
────────────────────────────────────────────────────────── */
async function fetchAndMerge(opts = {}) {
  try {
    // ดึง page 1 ก่อน แล้ว loop ดึง page ที่เหลือถ้ามี
    // (สำหรับหน้าที่ต้องการสินค้าทั้งหมดใน category)
    let page = 1;
    const limit = opts.limit || 100;
    let hasNext = true;
    let total = 0;

    while (hasNext) {
      const { products, pagination } = await ProductsAPI.fetch({ ...opts, page, limit });
      products.forEach(p => { PRODUCTS[p.id] = p; });
      total += products.length;
      hasNext = pagination.hasNext;
      page++;
      // safety: ไม่ดึงเกิน 10 pages ต่อครั้ง (1000 items)
      if (page > 10) break;
    }
    console.log('[products.js] fetchAndMerge loaded', total, 'products');
  } catch(e) {
    console.warn('[products.js] fetchAndMerge() failed, using local PRODUCTS:', e.message);
  }
}

// backward compat
async function loadProducts() { return fetchAndMerge(); }

/* ─── วิธีใช้ loadProducts() ────────────────────────────────────────────────
   เรียกใน DOMContentLoaded ก่อน render แต่ละหน้า เช่น:

   document.addEventListener('DOMContentLoaded', async () => {
     await loadProducts();   // โหลดจาก API (ถ้า fail จะใช้ PRODUCTS เดิม)
     renderProducts();
   });
────────────────────────────────────────────────────────────────────── */