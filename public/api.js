/**
 * api.js — BARDS Frontend API Client (Merged v3)
 * ================================================
 * include ไฟล์นี้ใน <head> หรือก่อน script อื่นในทุกหน้า:
 *   <script src="/api.js"></script>
 *
 * Provides:
 *   API_BASE     — URL prefix
 *   apiFetch()   — wrapper fetch พร้อม auth token + error handling
 *   Auth         — login/logout/token helpers
 *   AuthAPI      — /api/auth endpoints (email + OAuth + password reset)
 *   Cart         — high-level cart (local cache + server sync)
 *   CartAPI      — raw /api/cart HTTP calls
 *   WishlistAPI  — /api/wishlist endpoints
 *   OrdersAPI    — /api/orders endpoints
 *   PaymentAPI   — /api/payment endpoints
 *   CouponsAPI   — /api/coupons endpoints
 *   AddressesAPI — /api/addresses endpoints
 *   Addresses    — local address store
 *   updateBadge()— sync cart badge ทุก .cart-badge
 *   togglePw()   — toggle password visibility
 *   fmtUSD()     — format USD
 *   fmtDate()    — format date
 */

/* ── API_BASE ─────────────────────────────────────────────────
   ใช้ location.origin เพื่อรองรับทุก hostname/port
   override ได้ด้วย window.BARDS_API_BASE ก่อน include ───────── */
const API_BASE = window.BARDS_API_BASE
  || ((typeof location !== 'undefined' ? location.origin : 'http://localhost:3000') + '/api');

/* ═══════════════════════════════════════════════════════════════
   Auth helpers
   — เวอร์ชันใหม่: เพิ่ม setSession() / clearSession() ที่ทำงานครั้งเดียว
   — เวอร์ชันเก่า: คง setToken() / setUser() ไว้เพื่อ backward-compat
═══════════════════════════════════════════════════════════════ */
const Auth = {
  TOKEN_KEY: 'BARDS_TOKEN',
  USER_KEY:  'BARDS_USER',

  getToken()  { return localStorage.getItem(this.TOKEN_KEY); },
  getUser()   { try { return JSON.parse(localStorage.getItem(this.USER_KEY) || 'null'); } catch { return null; } },
  isLoggedIn(){ return !!this.getToken(); },

  /* เวอร์ชันเก่า (backward-compat) */
  setToken(t) { localStorage.setItem(this.TOKEN_KEY, t); },
  setUser(u)  { localStorage.setItem(this.USER_KEY, JSON.stringify(u)); },

  /* เวอร์ชันใหม่: set ทีเดียว */
  setSession(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },

  /* เวอร์ชันใหม่: clear ทีเดียว */
  clearSession() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },

  logout(to = '/signin') {
    // Best-effort — revoke the refresh cookie server-side. Fire-and-forget
    // so every existing onclick="Auth.logout(...)" call site keeps working
    // without needing to become async.
    fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    this.clearSession();
    if (typeof location !== 'undefined') location.href = to;
  },

  require() {
    if (!this.isLoggedIn()) {
      location.href = '/signin?redirect=' + encodeURIComponent(location.href);
      return false;
    }
    return true;
  },
};

/* ═══════════════════════════════════════════════════════════════
   apiFetch — wrapper fetch
   — เวอร์ชันเก่า: อ่าน text ก่อน แล้วค่อย JSON.parse
     → ป้องกัน "Unexpected end of JSON" และ server ส่ง HTML error มา
   — เพิ่ม: auto-logout เมื่อ 401 (จากเวอร์ชันเก่า)
═══════════════════════════════════════════════════════════════ */
/* Silent refresh — the access token is short-lived (15m) now, so a 401 on an
   authed call usually just means it expired, not that the session is dead.
   Concurrent 401s share one in-flight refresh instead of each rotating the
   refresh cookie themselves (that would race and invalidate each other). */
let _refreshPromise = null;
function _refreshAccessToken() {
  if (!_refreshPromise) {
    _refreshPromise = fetch(API_BASE + '/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(async res => {
        if (!res.ok) throw new Error('refresh failed');
        const data = await res.json();
        if (data?.token) Auth.setToken(data.token);
        if (data?.user)  Auth.setUser(data.user);
        return data.token;
      })
      .finally(() => { _refreshPromise = null; });
  }
  return _refreshPromise;
}

async function apiFetch(path, { method = 'GET', body, auth = false, _retried = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = Auth.getToken();
    if (!token) { Auth.logout(); return; }
    headers['Authorization'] = 'Bearer ' + token;
  }

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  /* Expired access token → try one silent refresh-and-retry before giving up */
  if (res.status === 401 && auth && !_retried) {
    try {
      const newToken = await _refreshAccessToken();
      if (newToken) return apiFetch(path, { method, body, auth, _retried: true });
    } catch { /* fall through to logout below */ }
    Auth.logout();
    return;
  }

  /* auto-logout on 401 (refresh already failed, or this is the retry itself) */
  if (res.status === 401 && auth) { Auth.logout(); return; }

  /* อ่าน text ก่อนเสมอ — ป้องกัน JSON parse crash */
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(res.ok ? 'Invalid server response' : `Server error ${res.status}`);
  }

  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data;
}

/* ═══════════════════════════════════════════════════════════════
   AuthAPI — /api/auth endpoints
   — ครบทั้ง email auth, OAuth, password reset
   — signin() + login() alias (รองรับทั้งสองชื่อ)
   — register() + signup() alias
═══════════════════════════════════════════════════════════════ */
const AuthAPI = {
  /* ── Email auth ── */
  signin(email, password) {
    return apiFetch('/auth/signin', { method: 'POST', body: { email, password } })
      .then(d => { if (d?.token && d?.user) Auth.setSession(d.token, d.user); return d; });
  },
  signup(name, email, password) {
    return apiFetch('/auth/signup', { method: 'POST', body: { name, email, password } })
      .then(d => { if (d?.token && d?.user) Auth.setSession(d.token, d.user); return d; });
  },

  /* alias — บางหน้าเรียก login() / register() */
  login(email, password)          { return this.signin(email, password); },
  register(name, email, password) { return this.signup(name, email, password); },

  /* ── Profile ── */
  me() {
    return apiFetch('/auth/me', { auth: true })
      .then(d => { if (d?.user) Auth.setUser(d.user); return d; });
  },
  updateProfile(fields) {
    return apiFetch('/auth/profile', { method: 'PATCH', body: fields, auth: true })
      .then(d => { if (d?.user) Auth.setUser(d.user); return d; });
  },
  /* Avatar upload — goes to Cloudflare R2 via multipart form-data,
     NOT through apiFetch() (which always sends JSON) */
  uploadAvatar(file) {
    const token = Auth.getToken();
    const fd = new FormData();
    fd.append('avatar', file);
    return fetch(API_BASE + '/auth/avatar', {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      credentials: 'include',
      body: fd,
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
        if (data?.user) Auth.setUser(data.user);
        return data;
      });
  },
  changePassword(currentPassword, newPassword) {
    return apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword }, auth: true });
  },

  /* ── OAuth — redirect-based flow ── */
  loginWithGoogle()   { location.href = API_BASE + '/auth/google'; },
  loginWithFacebook() { location.href = API_BASE + '/auth/facebook'; },

  /* ── OAuth callback handler (เรียกใน DOMContentLoaded) ── */
  async handleOAuthCallback() {
    const p     = new URLSearchParams(location.search);
    const token = p.get('token');
    const error = p.get('error');
    if (error) throw new Error(decodeURIComponent(error));
    if (!token) return false;
    Auth.setToken(token);
    await this.me();
    history.replaceState({}, '', location.pathname);
    return true;
  },

  /* ── Password reset ── */
  requestPasswordReset(email) {
    return apiFetch('/auth/forgot-password', { method: 'POST', body: { email } });
  },
  verifyResetCode(email, code) {
    return apiFetch('/auth/verify-reset-code', { method: 'POST', body: { email, code } });
  },
  resetPassword(email, token, newPassword) {
    return apiFetch('/auth/reset-password', { method: 'POST', body: { email, token, newPassword } });
  },

  /* ── Logout ── */
  async logout() {
    await apiFetch('/auth/logout', { method: 'POST', auth: true }).catch(() => {});
    Auth.clearSession();
  },
};

/* ═══════════════════════════════════════════════════════════════
   CartAPI — raw HTTP calls to /api/cart
   (ใช้ภายใน Cart object — ไม่ควรเรียกตรงจาก UI)
═══════════════════════════════════════════════════════════════ */
const CartAPI = {
  get()                      { return apiFetch('/cart', { auth: true }); },
  add(item)                  { return apiFetch('/cart', { method: 'POST', body: item, auth: true }); },
  update(id, color, size, qty) {
    return apiFetch('/cart/' + id, { method: 'PATCH', body: { color, size, quantity: qty }, auth: true });
  },
  remove(id, color, size) {
    return apiFetch(
      '/cart/' + id + '?color=' + encodeURIComponent(color || '') + '&size=' + encodeURIComponent(size || ''),
      { method: 'DELETE', auth: true }
    );
  },
  clear()       { return apiFetch('/cart', { method: 'DELETE', auth: true }); },
  sync(items)   { return apiFetch('/cart/sync', { method: 'POST', body: { items }, auth: true }); },
};

/* ═══════════════════════════════════════════════════════════════
   Cart — high-level cart manager
   — local storage เป็น cache / offline fallback
   — sync server อัตโนมัติเมื่อ login
   — cart.html เรียก Cart.* ทั้งหมด
═══════════════════════════════════════════════════════════════ */
const Cart = {
  _key: 'BARDS_CART',

  /* ── Local storage helpers ── */
  _get()   { try { return JSON.parse(localStorage.getItem(this._key) || '[]'); } catch { return []; } },
  _save(c) { localStorage.setItem(this._key, JSON.stringify(c)); },

  /* ── Public read ── */
  get()   { return this._get(); },
  save(c) { this._save(c); },
  count() { return this._get().reduce((n, i) => n + (i.quantity || 1), 0); },

  /* ── add: เพิ่ม item (sync server ถ้า login) ── */
  async add(item) {
    const c   = this._get();
    const key = item.id + '|' + (item.color || '') + '|' + (item.size || '');
    const ex  = c.find(i => i.id + '|' + (i.color || '') + '|' + (i.size || '') === key);
    if (ex) ex.quantity = Math.min(ex.quantity + (item.quantity || 1), 10);
    else    c.push({ ...item, quantity: item.quantity || 1 });
    this._save(c);
    updateBadge();
    if (Auth.isLoggedIn()) {
      // server ใช้ ON CONFLICT DO UPDATE SET quantity = quantity + EXCLUDED.quantity
      // ดังนั้นส่งแค่ delta ที่เพิ่มจริง = item.quantity || 1 เสมอ (ไม่ใช่ค่าสะสม)
      CartAPI.add({ ...item, quantity: item.quantity || 1 }).catch(e => console.warn('[CART ADD SYNC]', e.message));
    }
  },

  /* ── remove ── */
  async remove(id, color, size) {
    this._save(
      this._get().filter(i =>
        !(i.id === id && (i.color || '') === (color || '') && (i.size || '') === (size || ''))
      )
    );
    updateBadge();
    if (Auth.isLoggedIn()) {
      CartAPI.remove(id, color, size).catch(e => console.warn('[CART REMOVE SYNC]', e.message));
    }
  },

  /* ── updateQty ── */
  async updateQty(id, color, size, qty) {
    const c  = this._get();
    const it = c.find(i =>
      i.id === id && (i.color || '') === (color || '') && (i.size || '') === (size || '')
    );
    if (it) { it.quantity = qty; this._save(c); updateBadge(); }
    if (Auth.isLoggedIn()) {
      CartAPI.update(id, color, size, qty).catch(e => console.warn('[CART QTY SYNC]', e.message));
    }
  },

  /* ── clear ── */
  async clear() {
    localStorage.removeItem(this._key);
    updateBadge();
    if (Auth.isLoggedIn()) {
      CartAPI.clear().catch(e => console.warn('[CART CLEAR SYNC]', e.message));
    }
  },

  /* ── loadFromServer: โหลด cart จาก server แล้ว cache ── */
  async loadFromServer() {
    if (!Auth.isLoggedIn()) return this._get();
    try {
      const d     = await CartAPI.get();
      const items = (d.cart || []).map(r => ({
        id:       r.product_id,
        name:     r.name,
        price:    Number(r.price),
        image:    r.image  || '',
        color:    r.color  || '',
        size:     r.size   || '',
        quantity: r.quantity || 1,
      }));
      this._save(items);
      updateBadge();
      return items;
    } catch(e) {
      console.warn('[CART LOAD]', e.message);
      return this._get();
    }
  },

  /* ── syncOnLogin: merge local → server แล้วโหลดกลับ ──
     ทำงานเฉพาะครั้งแรกหลัง login เท่านั้น (guard ด้วย sessionStorage)
     ถ้าเรียกซ้ำหรือรีเฟรชหน้า → แค่โหลดจาก server อย่างเดียว ── */
  async syncOnLogin() {
    if (!Auth.isLoggedIn()) return;
    const SYNC_FLAG = 'BARDS_CART_SYNCED';
    const alreadySynced = sessionStorage.getItem(SYNC_FLAG);

    if (!alreadySynced) {
      // ครั้งแรกหลัง login: ส่ง local items ไป merge กับ server
      const local = this._get();
      if (local.length) {
        try { await CartAPI.sync(local); }
        catch(e) { console.warn('[CART SYNC LOGIN]', e.message); }
      }
      sessionStorage.setItem(SYNC_FLAG, '1');
    }

    // ทุกครั้ง: โหลดจาก server เป็น source of truth แล้ว overwrite local
    return await this.loadFromServer();
  },
};

/* ═══════════════════════════════════════════════════════════════
   WishlistAPI — /api/wishlist
   — มี syncOnLogin() ครบ (เวอร์ชันเก่า)
═══════════════════════════════════════════════════════════════ */
const WishlistAPI = {
  _key: 'NW_FAVS',

  _local()        { try { return JSON.parse(localStorage.getItem(this._key) || '[]'); } catch { return []; } },
  _saveLocal(arr) { localStorage.setItem(this._key, JSON.stringify(arr)); },

  async load() {
    if (!Auth.isLoggedIn()) return this._local();
    try {
      const d   = await apiFetch('/wishlist', { auth: true });
      const ids = d.wishlist || [];
      this._saveLocal(ids);
      return ids;
    } catch { return this._local(); }
  },

  async toggle(productId) {
    const current = await this.load();
    const isIn    = current.includes(productId);
    if (Auth.isLoggedIn()) {
      if (isIn) await apiFetch('/wishlist/' + productId, { method: 'DELETE', auth: true });
      else      await apiFetch('/wishlist/' + productId, { method: 'POST',   auth: true });
    }
    const next = isIn ? current.filter(id => id !== productId) : [...current, productId];
    this._saveLocal(next);
    return { favs: next, added: !isIn };
  },

  async remove(productId) {
    if (Auth.isLoggedIn()) {
      await apiFetch('/wishlist/' + productId, { method: 'DELETE', auth: true }).catch(() => {});
    }
    const next = this._local().filter(id => id !== productId);
    this._saveLocal(next);
    return next;
  },

  async syncOnLogin() {
    if (!Auth.isLoggedIn()) return;
    const local = this._local();
    if (!local.length) return;
    await Promise.all(
      local.map(id => apiFetch('/wishlist/' + id, { method: 'POST', auth: true }).catch(() => {}))
    );
  },
};

/* ═══════════════════════════════════════════════════════════════
   OrdersAPI — /api/orders
═══════════════════════════════════════════════════════════════ */
const OrdersAPI = {
  list()     { return apiFetch('/orders', { auth: true }); },
  get(id)    { return apiFetch('/orders/' + id, { auth: true }); },
  cancel(id) { return apiFetch('/orders/' + id + '/cancel', { method: 'POST', auth: true }); },
};

/* ═══════════════════════════════════════════════════════════════
   PaymentAPI — /api/payment
═══════════════════════════════════════════════════════════════ */
const PaymentAPI = {
  create(data)     { return apiFetch('/payment/create',          { method: 'POST', body: data, auth: true }); },
  verify(orderId)  { return apiFetch('/payment/status/' + orderId, { auth: true }); },
  status(orderId)  { return apiFetch('/payment/status/' + orderId, { auth: true }); },
  confirm(orderId) { return apiFetch('/payment/confirm/' + orderId, { method: 'POST', auth: true }); },
};

/* ═══════════════════════════════════════════════════════════════
   CouponsAPI — /api/coupons
═══════════════════════════════════════════════════════════════ */
const CouponsAPI = {
  validate(code, total) { return apiFetch('/coupons/validate', { method: 'POST', body: { code, total } }); },
  list()                { return apiFetch('/coupons/seller', { auth: true }); },
  create(data)          { return apiFetch('/coupons/seller', { method: 'POST',   body: data, auth: true }); },
  update(id, data)      { return apiFetch('/coupons/seller/' + id, { method: 'PATCH',  body: data, auth: true }); },
  remove(id)            { return apiFetch('/coupons/seller/' + id, { method: 'DELETE', auth: true }); },
};

/* ═══════════════════════════════════════════════════════════════
   AddressesAPI — /api/addresses (server)
   Addresses    — local address store (offline / cache)
═══════════════════════════════════════════════════════════════ */
const AddressesAPI = {
  list()           { return apiFetch('/addresses', { auth: true }); },
  create(data)     { return apiFetch('/addresses', { method: 'POST',   body: data, auth: true }); },
  update(id, data) { return apiFetch('/addresses/' + id, { method: 'PATCH',  body: data, auth: true }); },
  remove(id)       { return apiFetch('/addresses/' + id, { method: 'DELETE', auth: true }); },
  setDefault(id)   { return apiFetch('/addresses/' + id + '/set-default', { method: 'POST', auth: true }); },
};

const Addresses = {
  _key: 'BARDS_ADDRESSES',
  get()        { try { return JSON.parse(localStorage.getItem(this._key) || '[]'); } catch { return []; } },
  save(list)   { localStorage.setItem(this._key, JSON.stringify(list)); },
  getDefault() { const l = this.get(); return l.find(a => a.isDefault) || l[0] || null; },
  add(a)       { const l = this.get(); if (a.isDefault) l.forEach(x => x.isDefault = false); l.push(a); this.save(l); },
  update(i, a) { const l = this.get(); if (a.isDefault) l.forEach(x => x.isDefault = false); l[i] = a; this.save(l); },
  remove(i)    { const l = this.get(); l.splice(i, 1); this.save(l); },
  setDefault(i){ const l = this.get(); l.forEach((a, j) => a.isDefault = j === i); this.save(l); },
};

/* ═══════════════════════════════════════════════════════════════
   Global helpers
═══════════════════════════════════════════════════════════════ */

/* ── updateBadge: sync จำนวนสินค้าในตะกร้าไปทุก badge ── */
function updateBadge() {
  const n = Cart.count();
  document.querySelectorAll('.cart-badge, #cartBadge').forEach(b => {
    b.textContent   = n > 99 ? '99+' : n;
    b.style.display = n > 0 ? 'flex' : 'none';
  });
}

/* ── togglePw: รองรับทั้ง dual-SVG pattern และ innerHTML-swap ── */
function togglePw(id, btn) {
  const input = document.getElementById(id);
  if (!input) return;
  const show   = input.type === 'password';
  input.type   = show ? 'text' : 'password';
  const eyeOn  = btn.querySelector('.icon-eye');
  const eyeOff = btn.querySelector('.icon-eye-off');
  if (eyeOn && eyeOff) {
    eyeOn.style.display  = show ? 'none' : '';
    eyeOff.style.display = show ? ''     : 'none';
  } else {
    btn.innerHTML = show
      ? `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M1 12s3-7 11-7 11 7 11 7-3 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
}

function fmtUSD(n)  { return '$' + Number(n).toFixed(2); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }

/* ═══════════════════════════════════════════════════════════════
   Auto-init on DOMContentLoaded
   — updateBadge ทุกหน้า
   — จัดการ OAuth callback (?token= หรือ ?error=) อัตโนมัติ
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  updateBadge();

  const p     = new URLSearchParams(location.search);
  const token = p.get('token');
  const error = p.get('error');

  if (error) {
    /* ปล่อยให้แต่ละหน้าจัดการ error เอง (signin.html มี handler แล้ว) */
    return;
  }

  if (token) {
    try {
      await AuthAPI.handleOAuthCallback();
      await WishlistAPI.syncOnLogin().catch(() => {});
      await Cart.syncOnLogin().catch(() => {});
      const redirect = p.get('redirect') || p.get('next') || '/account';
      location.href  = redirect;
    } catch(e) {
      console.error('[OAuth callback]', e.message);
    }
  }
});