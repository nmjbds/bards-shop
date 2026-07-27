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

// เดิมมีสินค้าปลอม 8 ชิ้น hardcode ไว้ตรงนี้ (fake demo data ตั้งแต่ก่อนต่อ API จริง) — fetchAndMerge()
// ด้านล่างมีแต่ "เพิ่ม/ทับ" ตาม key ไม่เคยลบของเดิมออก ทำให้สินค้าปลอมเหล่านี้ติดค้างปนอยู่กับสินค้าจริง
// ทุกหน้า catalog ตลอดมา (index/categories/all-products/tops/pants/accessories/new-arrival/cart ทุกหน้า
// render จาก Object.keys/values(PRODUCTS) ตรงๆ) กดเข้าไปดู/ซื้อไม่ได้เพราะไม่มีอยู่จริงใน DB — ลบออกแล้ว
// (2026-07-23) เหลือ empty object ให้ fetchAndMerge() เติมสินค้าจริงจาก API เข้ามาแทนทั้งหมด
const PRODUCTS = {};

// เดิม hardcode 3 หมวดตรงนี้ (2026-07-25: ย้ายไป categories table จริงแล้ว — ดู CLAUDE.md §4/§11)
// CATEGORIES เริ่มว่างเปล่าเหมือน PRODUCTS ด้านบน ต้องเรียก fetchCategories() (ดูด้านล่าง) ก่อนอ่านค่า —
// หน้าไหนต้องการ CATEGORIES ต้อง await fetchCategories() ก่อน render เหมือนที่ fetchAndMerge() ต้อง
// await ก่อนอ่าน PRODUCTS
let CATEGORIES = [];

function fmtUSD(n){ return '$'+Number(n).toFixed(2); }

/* escape user/seller-controlled text before it goes into innerHTML (product name, image URL, etc.) */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* only allow same-site relative paths as a post-login redirect target —
   blocks open-redirect via a crafted ?redirect=https://evil.com or //evil.com */
function safeRedirect(path) {
  if (!path || typeof path !== 'string') return null;
  if (path.startsWith('//')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return null;
  return path;
}

/* Multi-domain (step 8c, 2026-07-27) — default landing page after signin/
   signup when there's no explicit ?redirect= present, based on which of the
   3 domains the page is being viewed from. Any page's own explicit
   ?redirect= (passed through safeRedirect() above) always wins over this —
   it's only the fallback when there isn't one, used by signin.html/
   signup.html. Same login/signup mechanism and pages either way (no
   separate signup system per domain) — just where you land afterward. */
function bardsDefaultLanding() {
  if (typeof location === 'undefined') return 'account.html';
  if (location.hostname === 'seller.bardskh.com') return '/seller';
  if (location.hostname === 'admin.bardskh.com') return '/admin-shops';
  return 'account.html';
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

/* ═══════════════════════════════════════════════════════════
   CategoriesAPI / fetchCategories() — เพิ่ม 2026-07-25 (ขั้น 4a ของ
   categories migration) แทนที่ CATEGORIES array เดิมที่ hardcode ไว้
   ตรงนี้ ตอนนี้ดึงจริงจาก GET /api/categories — ใช้งาน:

     document.addEventListener('DOMContentLoaded', async () => {
       await fetchCategories();
       renderCategories(); // อ่าน CATEGORIES ได้แล้ว
     });

   url ที่ map มาจาก slug ยังชี้ไปที่ categories/<slug>.html เหมือนเดิม
   (ไฟล์ static เดิมยังอยู่ ยังไม่เปลี่ยน routing — เป็นงานขั้นถัดไป)
═══════════════════════════════════════════════════════════ */
const CategoriesAPI = {
  async fetch() {
    const res = await fetch(_API_BASE + '/categories');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.categories || [];
  },
};

async function fetchCategories() {
  try {
    const rows = await CategoriesAPI.fetch();
    CATEGORIES = rows.map(c => ({
      id:             c.slug,
      label:          c.name,
      url:            `categories/${c.slug}.html`,
      color:          c.color || '#2A2A2A',
      showOnHomepage: c.show_on_homepage !== false,
    }));
  } catch(e) {
    console.warn('[products.js] fetchCategories() failed:', e.message);
  }
  return CATEGORIES;
}

/* ─── วิธีใช้ loadProducts() ────────────────────────────────────────────────
   เรียกใน DOMContentLoaded ก่อน render แต่ละหน้า เช่น:

   document.addEventListener('DOMContentLoaded', async () => {
     await loadProducts();   // โหลดจาก API (ถ้า fail จะใช้ PRODUCTS เดิม)
     renderProducts();
   });
────────────────────────────────────────────────────────────────────── */