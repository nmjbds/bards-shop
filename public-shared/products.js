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

/* Multi-domain split (2026-07-28) — hostnames known to be served by their
   own dedicated seller/admin server (real production subdomains, plus the
   temporary Render URLs used to test each one before its domain is cut
   over — see the multi-domain split plan). Every function below that needs
   to know "am I on seller/admin, and if so where's home base" reads from
   this one table — add a new temp URL here (not scattered across
   functions) the moment a new bards-* Render service is created for
   testing. Anything NOT in this table is treated as "has its own signin
   page" (the customer server, or local dev on the old combined server) —
   the safe default. */
const BARDS_HUB_BY_HOST = {
  'seller.bardskh.com':        'seller',
  'admin.bardskh.com':         'admin',
  'bards-seller.onrender.com': 'seller',
  'bards-admin.onrender.com':  'admin',
};
const BARDS_HUB_BASE = {
  main:   'https://bardskh.com',
  seller: 'https://seller.bardskh.com',
  admin:  'https://admin.bardskh.com',
};
function _bardsCurrentHub() {
  if (typeof location === 'undefined') return null;
  return BARDS_HUB_BY_HOST[location.hostname] || null;
}

/* Every https:// origin our own redirect flows are ever allowed to point
   at — used by safeRedirect() below to allow a cross-domain ?redirect=
   (needed for the seller/admin → bardskh.com/signin → back round trip,
   since those two servers have no signin page of their own) while still
   rejecting a real open-redirect attempt to an outside domain. Keep this
   in sync with the matching list in backend/routes/auth.js's
   isSafeRedirectPath() (same purpose, server side — used for the Google
   OAuth ?redirect=/state round trip). */
const BARDS_SAFE_REDIRECT_ORIGINS = new Set([
  'https://bardskh.com', 'https://www.bardskh.com',
  'https://seller.bardskh.com', 'https://admin.bardskh.com',
  'https://bards-shop.onrender.com',
  'https://bards-customer.onrender.com',
  'https://bards-seller.onrender.com',
  'https://bards-admin.onrender.com',
]);

/* Only allow same-site relative paths, or an absolute URL to one of our own
   known hosts (BARDS_SAFE_REDIRECT_ORIGINS above), as a post-login redirect
   target — blocks open-redirect via a crafted ?redirect=https://evil.com or
   //evil.com. The absolute-URL allowance was added for the multi-domain
   split (2026-07-28) — see bardsSigninUrl() below for why one is needed. */
function safeRedirect(path) {
  if (!path || typeof path !== 'string') return null;
  if (path.startsWith('//')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    try {
      const u = new URL(path);
      return (u.protocol === 'https:' && BARDS_SAFE_REDIRECT_ORIGINS.has(u.origin)) ? path : null;
    } catch { return null; }
  }
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
  const hub = _bardsCurrentHub();
  if (hub === 'seller') return '/seller';
  if (hub === 'admin')  return '/admin-shops';
  return '/account';
}

/* ใช้กับลิงก์ข้าม hub (View Store / Seller Hub / Admin-Shops) ในหน้า seller-*.html/
   admin-*.html — ถ้าไม่ได้อยู่บน seller./admin. subdomain จริง (local dev, apex
   bardskh.com, unknown host) คืน path เดิมเฉยๆ ไม่เปลี่ยนพฤติกรรมเลย (relative,
   เหมือนก่อน multi-domain) ถ้าอยู่บน subdomain จริง คืน absolute URL ข้ามโดเมนแทน
   กันปัญหาลิงก์ relative ที่ไปชนกับ redirect ที่ bare `/` เพิ่มไว้ตอน Step 8c
   (ดู CLAUDE.md หัวข้อ 7 / docs/03-tasks-checklist.md Step 8d) */
function bardsCrossHubUrl(hub, path) {
  if (!_bardsCurrentHub()) return path;
  return BARDS_HUB_BASE[hub] + path;
}

/* Multi-domain split (2026-07-28) — every seller-*.html/admin-*.html page's
   "not signed in" guard calls this instead of hardcoding a relative
   '/signin' path. Those two servers have no signin/signup pages of their
   own (see backend/server-seller.js / server-admin.js) — a signed-out
   visitor there needs an absolute URL to the customer server's real signin
   page, with `redirect` itself turned into a full URL BACK to this origin
   (not just a path), so the round trip lands back on the right server
   instead of on bardskh.com itself. Found via a real test: the old
   hardcoded `location.href='/signin?redirect=/admin-shops'` 404'd the
   moment admin.bardskh.com (and its temp Render URL) stopped being the same
   process as the customer pages. On the customer server (or local dev on
   the old combined server), this is unchanged — a plain relative
   'signin.html'. */
function bardsSigninUrl(redirectPath) {
  if (!_bardsCurrentHub()) {
    return redirectPath ? `/signin?redirect=${encodeURIComponent(redirectPath)}` : '/signin';
  }
  const backTo = redirectPath ? location.origin + redirectPath : null;
  return backTo
    ? `${BARDS_HUB_BASE.main}/signin?redirect=${encodeURIComponent(backTo)}`
    : `${BARDS_HUB_BASE.main}/signin`;
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
    shop_id:     p.shop_id || null,
    shop_name:   p.shop_name || '',
    shop_logo:   p.shop_logo || null,
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
       shopId: '<uuid>',   // optional — shop profile page (docs/06-shop-profile-follow-blueprint.md)
       shop: '<slug>',      // optional — same, when only the slug is on hand (shopId wins if both given)
     });

   ดึงสินค้าชิ้นเดียว:
     const { product } = await ProductsAPI.getOne(id);

   Merge เข้า PRODUCTS object (สำหรับหน้าที่ยังใช้ PRODUCTS):
     await fetchAndMerge({ category:'tops' });
═══════════════════════════════════════════════════════════ */
// ── API_BASE: ใช้จาก api.js หรือ fallback /api ──
const _API_BASE = (typeof API_BASE !== 'undefined' ? API_BASE : null) || window.BARDS_API_BASE || '/api';

const ProductsAPI = {
  async fetch({ page=1, limit=24, category, search, sort='newest', isNew, shopId, shop } = {}) {
    const params = new URLSearchParams({ page, limit, sort });
    if (category) params.set('category', category);
    if (search)   params.set('search', search);
    if (isNew)    params.set('new', 'true');
    if (shopId)      params.set('shop_id', shopId);
    else if (shop)   params.set('shop', shop);
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
      url:            `/categories/${c.slug}`,
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