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
 *   ShopsAPI     — /api/shops endpoints (seller onboarding + admin review)
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

  // Presence AND expiry (2026-07-28, multi-domain split debugging) — a
  // token sitting in localStorage past its 15-minute lifetime used to still
  // count as "logged in" here, since this only ever checked presence. That
  // self-healed invisibly almost everywhere else: the first authenticated
  // apiFetch() call gets a 401, silently refreshes, and retries. But
  // signin.html's "already signed in, skip the form" shortcut calls this
  // directly and immediately navigates on a true result — no apiFetch
  // round trip in between to catch a dead token. Combined with the
  // multi-domain split's cross-origin signin redirect (bardsSigninUrl()),
  // a stale token on bardskh.com and a stale token on admin.bardskh.com
  // could each trust the other's bounce and loop indefinitely — reported
  // and reproduced 2026-07-29. Decoding the JWT payload here only reads
  // its `exp` claim for this UX shortcut; it's never a substitute for real
  // signature verification, which the server still does on every request.
  isLoggedIn(){
    const t = this.getToken();
    if (!t) return false;
    const exp = this._tokenExpiry(t);
    return exp === null || exp > Date.now();
  },
  _tokenExpiry(token) {
    try {
      const payload = token.split('.')[1];
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4);
      const json = JSON.parse(atob(b64));
      return typeof json.exp === 'number' ? json.exp * 1000 : null;
    } catch { return null; } // malformed/undecodable — let the server be the judge, same as before
  },

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

  // `to` left undefined (not defaulted to a hardcoded '/signin') so the
  // multi-domain-aware fallback below only kicks in when a caller doesn't
  // pass one — every onclick="Auth.logout('/signin')" /
  // Auth.logout('signin.html') call site across seller-*.html/admin-*.html
  // was updated (2026-07-28) to just Auth.logout() with no argument, so
  // this default is what actually runs there now; account.html's explicit
  // Auth.logout('/signin') calls (updated from 'signin.html' during the
  // Clean URLs pass) still pass a `to` explicitly and work exactly as
  // before (customer server always has its own signin page).
  logout(to) {
    // Best-effort — revoke the refresh cookie server-side. Fire-and-forget
    // (keepalive:true, not awaited) so every existing
    // onclick="Auth.logout(...)" call site keeps working without needing
    // to become async — but keepalive matters here specifically: the very
    // next line navigates away (location.href), and a plain fetch with no
    // keepalive flag can be silently cancelled mid-flight by that
    // navigation, meaning the server never actually revokes the refresh
    // token. keepalive tells the browser to let the request finish in the
    // background instead of killing it (found 2026-07-29 while debugging a
    // "logout doesn't fully stick" report during multi-domain testing).
    fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {});
    this.clearSession();
    let target = to || (typeof bardsSigninUrl === 'function' ? bardsSigninUrl() : '/signin');
    // Cross-domain logout gap (found 2026-07-29): clearSession() above only
    // clears THIS origin's localStorage. Logging out on admin.bardskh.com
    // does nothing to a still-unexpired token sitting in bardskh.com's own
    // localStorage from an earlier sign-in there — so landing on
    // bardskh.com/signin (via bardsSigninUrl() above) would find that
    // stale-but-valid token, believe it's still logged in, and immediately
    // bounce right back, which can loop against the destination's own "not
    // signed in" guard. Only added when `to` wasn't explicitly passed (the
    // multi-domain redirect path) — account.html's same-origin
    // Auth.logout('signin.html') never had this problem since
    // clearSession() already covers that single origin.
    if (!to) target += (target.includes('?') ? '&' : '?') + 'loggedout=1';
    if (typeof location !== 'undefined') location.href = target;
  },

  // Unused elsewhere in the codebase currently (no page calls this), but
  // fixed alongside logout()/ensureSession() for the same reason: a
  // hardcoded '/signin' 404s on the seller/admin servers, which have no
  // signin page of their own.
  require() {
    if (!this.isLoggedIn()) {
      location.href = (typeof bardsSigninUrl === 'function')
        ? bardsSigninUrl(location.pathname + location.search)
        : '/signin?redirect=' + encodeURIComponent(location.href);
      return false;
    }
    return true;
  },

  /* เหมือน isLoggedIn() แต่ถ้าไม่มี token ใน origin นี้ (เช่น เพิ่งข้ามมาจาก
     subdomain อื่นครั้งแรก) จะลอง silent refresh จาก cookie bards_rt ที่แชร์
     ข้ามโดเมนก่อนยอมแพ้ — ใช้แทน isLoggedIn() ในหน้าที่ auth guard ต้อง await ได้
     (กัน user ที่ login ฝั่ง bardskh.com อยู่แล้วโดนเด้งไป signin ซ้ำตอนข้ามไป
     seller./admin. subdomain ทั้งที่ session จริงยังไม่หมดอายุ) */
  async ensureSession() {
    if (this.isLoggedIn()) return true;
    try {
      const token = await _refreshFor(this);
      return !!token;
    } catch {
      return false;
    }
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
   refresh cookie themselves (that would race and invalidate each other).

   Seller identity split: refresh now has TWO independent identities it can
   be refreshing — the original Auth (customer/admin, shared bards_rt
   cookie) and SellerAuth (a real seller.bardskh.com session, host-only
   bards_seller_rt cookie, defined further down this file). _activeAuth()
   picks whichever one actually has a token, defaulting to Auth — this is
   what lets the 5 seller-*.html dashboard pages' existing apiFetch('/seller/...',
   {auth:true}) calls (scattered inline across those files, no separate
   per-audience API wrapper) keep working completely unmodified: on every
   origin other than a page where a real seller session exists,
   SellerAuth.getToken() is null, so this resolves to Auth exactly like
   before the split. */
let _refreshPromise = null;
let _sellerRefreshPromise = null;
function _activeAuth() {
  return (typeof SellerAuth !== 'undefined' && SellerAuth.getToken()) ? SellerAuth : Auth;
}
function _refreshFor(activeAuth) {
  if (typeof SellerAuth !== 'undefined' && activeAuth === SellerAuth) {
    if (!_sellerRefreshPromise) {
      _sellerRefreshPromise = fetch(API_BASE + '/auth/seller/refresh', { method: 'POST', credentials: 'include' })
        .then(async res => {
          if (!res.ok) throw new Error('refresh failed');
          const data = await res.json();
          if (data?.token) SellerAuth.setSession(data.token, data.user);
          return data.token;
        })
        .finally(() => { _sellerRefreshPromise = null; });
    }
    return _sellerRefreshPromise;
  }
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
  const activeAuth = _activeAuth();
  if (auth) {
    const token = activeAuth.getToken();
    if (!token) { activeAuth.logout(); return; }
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
      const newToken = await _refreshFor(activeAuth);
      if (newToken) return apiFetch(path, { method, body, auth, _retried: true });
    } catch { /* fall through to logout below */ }
    activeAuth.logout();
    return;
  }

  /* auto-logout on 401 (refresh already failed, or this is the retry itself) */
  if (res.status === 401 && auth) { activeAuth.logout(); return; }

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
   SellerAuth / SellerAuthAPI — seller identity split.
   Completely separate localStorage keys and token from Auth above — a
   seller.bardskh.com session never touches BARDS_TOKEN/BARDS_USER, and a
   bardskh.com/admin.bardskh.com session never touches these. Nothing here
   reads or writes Auth's state, on purpose (that's what makes "seller must
   not auto-login from a customer session" hold at the frontend layer too,
   not just via the cookie split on the backend — see services/sellerSession.js).
   apiFetch() above is seller-aware (_activeAuth()/_refreshFor()) — once
   SellerAuth.setSession() has been called (by SellerAuthAPI.signup/signin/
   signinOtp below, or by SellerAuth.ensureSession()'s own refresh), every
   ordinary apiFetch(path, {auth:true}) call anywhere on the page —
   including the 5 dashboard pages' inline /seller/* calls — automatically
   uses this session instead of Auth's, with no other code changes needed.

   SellerAuth.ensureSession() is the dual-path guard every seller.bardskh.com
   page (apply.html + the 5 dashboard pages) calls instead of Auth.ensureSession():
     1. Try this server's own seller session first (silent-refresh against
        POST /api/auth/seller/refresh, backed by the host-only bards_seller_rt
        cookie — never present unless someone actually signed in/up here).
     2. Only if that fails, fall back to the ORIGINAL shared Auth.ensureSession()
        (POST /api/auth/refresh, the cross-domain bards_rt cookie) — but only
        ever accepts an admin caller from that path. A customer session
        refreshing successfully there is deliberately NOT treated as logged in
        here; this is what stops a bardskh.com customer session from carrying
        over, since apply.html used to accept any authenticated role at all.
   Callers get back { user } (role:'seller' or 'admin') or null.
═══════════════════════════════════════════════════════════════ */
const SellerAuth = {
  TOKEN_KEY: 'BARDS_SELLER_TOKEN',
  USER_KEY:  'BARDS_SELLER_USER',

  getToken() { return localStorage.getItem(this.TOKEN_KEY); },
  getUser()  { try { return JSON.parse(localStorage.getItem(this.USER_KEY) || 'null'); } catch { return null; } },

  setToken(t) { localStorage.setItem(this.TOKEN_KEY, t); },
  setUser(u)  { localStorage.setItem(this.USER_KEY, JSON.stringify(u)); },
  setSession(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },

  // Best-effort server-side revoke (mirrors Auth.logout()'s keepalive fetch —
  // see that function's comment for why keepalive matters right before a
  // navigation), then always clears local state and sends the visitor to
  // this domain's OWN signin page — never bardsSigninUrl(), which points at
  // bardskh.com for every other hub.
  logout() {
    fetch(API_BASE + '/auth/seller/logout', { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {});
    this.clearSession();
    if (typeof location !== 'undefined') location.href = '/signin';
  },

  // Returns { user } on success (role always present: 'seller' from this
  // server's own session, or 'admin' from the shared-cookie fallback), or
  // null if neither path produced a valid session. Never throws.
  async ensureSession() {
    try {
      const token = await _refreshFor(this);
      if (token) return { user: this.getUser() };
    } catch { /* fall through to the admin fallback below */ }

    // Admin fallback — reuses the ORIGINAL Auth/apiFetch machinery
    // unmodified (Auth.ensureSession() already does its own silent-refresh
    // against the shared bards_rt cookie). Deliberately does NOT touch
    // SellerAuth's own token/localStorage — the admin path stays
    // authenticated via Auth's token on every subsequent apiFetch() call
    // (_activeAuth() only prefers SellerAuth when it actually has a token).
    try {
      if (!(await Auth.ensureSession())) return null;
      const { user } = await AuthAPI.me();
      if (user?.role !== 'admin') return null;
      return { user };
    } catch { return null; }
  },
};

const SellerAuthAPI = {
  requestOtp(email, purpose)      { return apiFetch('/auth/seller/request-otp', { method: 'POST', body: { email, purpose } }); },
  verifyOtp(email, code)          { return apiFetch('/auth/seller/verify-otp',  { method: 'POST', body: { email, code } }); },
  signup(email, phone, password, otpToken) {
    return apiFetch('/auth/seller/signup', { method: 'POST', body: { email, phone, password, otpToken } })
      .then(d => { if (d?.token) SellerAuth.setSession(d.token, d.user); return d; });
  },
  signin(identifier, password) {
    return apiFetch('/auth/seller/signin', { method: 'POST', body: { identifier, password } })
      .then(d => { if (d?.token) SellerAuth.setSession(d.token, d.user); return d; });
  },
  signinOtp(email, code) {
    return apiFetch('/auth/seller/signin-otp', { method: 'POST', body: { email, code } })
      .then(d => { if (d?.token) SellerAuth.setSession(d.token, d.user); return d; });
  },
  me() { return apiFetch('/auth/seller/me', { auth: true }); },
};

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

  /* ── OAuth — redirect-based flow ──
     redirect: optional same-site path (e.g. "checkout.html") to return to after
     login — carried through Google's round trip via the `state` param. */
  loginWithGoogle(redirect)   { location.href = API_BASE + '/auth/google' + (redirect ? ('?redirect=' + encodeURIComponent(redirect)) : ''); },
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
  validate(code, items) { return apiFetch('/coupons/validate', { method: 'POST', body: { code, items } }); },
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

/* ═══════════════════════════════════════════════════════════════
   ShopsAPI — /api/shops (seller onboarding self-serve + admin review)
═══════════════════════════════════════════════════════════════ */
const ShopsAPI = {
  /* ── seller/self ──
     apiFetch() is seller-aware (_activeAuth(), defined further up this
     file) — it picks up SellerAuth's token automatically once a real
     seller session exists, so these need no special handling even though
     this same group is also called by an admin browsing cross-domain via
     the "Seller Hub" link (who never has a SellerAuth token, so
     apiFetch() falls back to Auth exactly as before the seller identity
     split). */
  me()                  { return apiFetch('/shops/me', { auth: true }); },
  apply(data)            { return apiFetch('/shops/apply', { method: 'POST', body: data, auth: true }); },
  update(data)           { return apiFetch('/shops/me', { method: 'PATCH', body: data, auth: true }); },
  resubmit()             { return apiFetch('/shops/me/resubmit', { method: 'POST', auth: true }); },
  updateChecklist(data)  { return apiFetch('/shops/me/onboarding-checklist', { method: 'PATCH', body: data, auth: true }); },

  /* Phone verification (Phase 4) — stateless on the server (Twilio Verify
     tracks the pending code itself), doesn't touch `shops` at all. Callers
     still PATCH /shops/me { phone } separately once verified, same as
     before Phase 4. */
  startPhoneVerification(phone)       { return apiFetch('/shops/verify-phone/start', { method: 'POST', body: { phone }, auth: true }); },
  checkPhoneVerification(phone, code) { return apiFetch('/shops/verify-phone/check', { method: 'POST', body: { phone, code }, auth: true }); },

  /* Document upload — multipart, not through apiFetch() (same reason as
     AuthAPI.uploadAvatar above: always sends JSON). Token picked via
     _activeAuth() the same way apiFetch() does internally. doc_type must be
     one of id_card | business_license | tax_document. */
  uploadDocument(file, docType) {
    const token = _activeAuth().getToken();
    const fd = new FormData();
    fd.append('document', file);
    fd.append('doc_type', docType);
    return fetch(API_BASE + '/shops/me/documents', {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      credentials: 'include',
      body: fd,
    }).then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      return data;
    });
  },

  /* Logo/cover upload — separate from uploadDocument() above (public bucket,
     no doc_type, returns a URL immediately instead of a DB row). */
  uploadBranding(file) {
    const token = _activeAuth().getToken();
    const fd = new FormData();
    fd.append('image', file);
    return fetch(API_BASE + '/shops/me/branding', {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      credentials: 'include',
      body: fd,
    }).then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      return data;
    });
  },

  /* ── admin ── */
  list(status)     { return apiFetch('/shops' + (status ? '?status=' + encodeURIComponent(status) : ''), { auth: true }); },
  get(id)          { return apiFetch('/shops/' + id, { auth: true }); },
  setStatus(id, data) { return apiFetch('/shops/' + id, { method: 'PATCH', body: data, auth: true }); },
  setAutoApprove(id, on) { return apiFetch('/shops/' + id + '/auto-approve-products', { method: 'PATCH', body: { auto_approve_products: on }, auth: true }); },

  /* ── public shop storefront + follow (docs/06-shop-profile-follow-
     blueprint.md) — routes/shopPublic.js, mounted on the customer server
     only. getByIdPublic() is named to not collide with the admin-only
     get(id) above (GET /shops/:id, a completely different endpoint). */
  getBySlug(slug)      { return apiFetch('/shops/slug/' + encodeURIComponent(slug)); },
  getByIdPublic(id)    { return apiFetch('/shops/id/' + encodeURIComponent(id)); },
  follow(id)           { return apiFetch('/shops/' + id + '/follow', { method: 'POST', auth: true }); },
  unfollow(id)         { return apiFetch('/shops/' + id + '/follow', { method: 'DELETE', auth: true }); },
  getFollowStatus(id)  { return apiFetch('/shops/' + id + '/follow-status', { auth: true }); },
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
   — OAuth callback (?token=/?error=) ไม่ได้จัดการที่นี่แล้ว: ทุก provider
     (Google/Telegram) redirect กลับมาที่ signin.html เท่านั้นเสมอ ซึ่งมี
     handler ของตัวเองครบอยู่แล้ว (loading state + error mapping + safe
     redirect) — เคยมี logic ซ้ำกันตรงนี้ด้วย ทำให้ทั้งสองที่แข่งกันเรียก
     handleOAuthCallback() พร้อมกันตอนอยู่หน้า signin.html
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  updateBadge();
});