const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const { query } = require('../db');

// ═══════════════════════════════════════════════════════════════
// services/sellerSession.js — the seller identity split's session stack.
// A straight structural mirror of services/session.js, but every query
// targets seller_accounts/seller_refresh_tokens instead of users/
// refresh_tokens — sellers no longer share the customer/admin identity
// table at all (see docs/05-seller-onboarding-blueprint.md's superseding
// decision + the seller-auth-split plan).
//
// Deliberately reuses the SAME JWT_SECRET as services/session.js — there is
// no security benefit to a second secret (the signature already proves the
// token came from this server), and a second secret would force
// middleware/auth.js's requireAuth (shared by all 3 servers) to try
// multiple secrets. What distinguishes a seller token is the `kind:'seller'`
// claim in its payload, checked by middleware/auth.js's requireSellerOrAdmin/
// requireSellerAccount — requireAuth itself is untouched by this file.
//
// The refresh-token cookie is intentionally NOT shared cross-domain like
// services/session.js's bards_rt (Domain=.bardskh.com) — no `domain` is set
// here at all, in any environment, so this cookie is host-only and can never
// be presented to bardskh.com or admin.bardskh.com. That is the entire
// mechanism behind "seller.bardskh.com must not auto-login from a bardskh.com
// session" — see routes/authSeller.js and CLAUDE.md's auth section.
// ═══════════════════════════════════════════════════════════════

function sign(seller) {
  return jwt.sign(
    { id: seller.id, email: seller.email, phone: seller.phone, kind: 'seller' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

const REFRESH_COOKIE = 'bards_seller_rt';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, same as the customer/admin refresh token

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function issueRefreshToken(sellerId, req, replacesId = null) {
  const raw       = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const userAgent = (req.headers['user-agent'] || '').slice(0, 255);
  const ins = await query(
    'INSERT INTO seller_refresh_tokens(seller_id, token_hash, expires_at, user_agent) VALUES($1,$2,$3,$4) RETURNING id',
    [sellerId, tokenHash, expiresAt, userAgent || null]
  );
  if (replacesId) {
    await query('UPDATE seller_refresh_tokens SET revoked_at=NOW(), replaced_by=$1 WHERE id=$2', [ins.rows[0].id, replacesId]);
  }
  return raw;
}

// No `domain` attribute at all, ever — this is the deliberate difference
// from services/session.js's REFRESH_COOKIE_DOMAIN (.bardskh.com in
// production). Host-only means the browser only ever sends this cookie back
// to the exact origin that set it (seller.bardskh.com), never to
// bardskh.com or admin.bardskh.com, and vice versa.
function setRefreshCookie(res, raw) {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/api/auth',
    maxAge:   REFRESH_TTL_MS,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

async function issueSession(seller, req, res) {
  const accessToken = sign(seller);
  const refreshRaw  = await issueRefreshToken(seller.id, req);
  setRefreshCookie(res, refreshRaw);
  return accessToken;
}

// Always includes role:'seller' — this is what lets the existing 5
// seller-*.html dashboard pages' `['seller','admin'].includes(user.role)`
// guard keep working completely unmodified, whether the session behind it
// came from this file (a real seller_accounts row) or from the admin
// fallback path (services/session.js, users.role='admin').
function safe(s) {
  return { id: s.id, email: s.email, phone: s.phone, role: 'seller' };
}

async function refreshHandler(req, res) {
  try {
    const raw = getCookie(req, REFRESH_COOKIE);
    if (!raw) return res.status(401).json({ error: 'No session. Please sign in.' });

    const tokenHash = hashToken(raw);
    const r = await query('SELECT * FROM seller_refresh_tokens WHERE token_hash=$1', [tokenHash]);
    const row = r.rows[0];
    if (!row) { clearRefreshCookie(res); return res.status(401).json({ error: 'Invalid session. Please sign in again.' }); }

    if (row.revoked_at) {
      // Reuse of an already-rotated token — treat as leaked, kill every
      // live session for this seller (same reuse-detection as the
      // customer/admin refresh token).
      await query('UPDATE seller_refresh_tokens SET revoked_at=NOW() WHERE seller_id=$1 AND revoked_at IS NULL', [row.seller_id]);
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Session revoked. Please sign in again.' });
    }
    if (new Date(row.expires_at) < new Date()) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    const sellerRes = await query('SELECT * FROM seller_accounts WHERE id=$1', [row.seller_id]);
    if (!sellerRes.rows.length) { clearRefreshCookie(res); return res.status(401).json({ error: 'Account not found.' }); }
    const seller = sellerRes.rows[0];

    const newRaw = await issueRefreshToken(seller.id, req, row.id);
    setRefreshCookie(res, newRaw);
    res.json({ token: sign(seller), user: safe(seller) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
}

async function logoutHandler(req, res) {
  try {
    const raw = getCookie(req, REFRESH_COOKIE);
    if (raw) await query('UPDATE seller_refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL', [hashToken(raw)]);
  } catch(e) { console.error('[SELLER LOGOUT]', e.message); }
  clearRefreshCookie(res);
  res.json({ ok: true });
}

async function meHandler(req, res) {
  try {
    const r = await query('SELECT * FROM seller_accounts WHERE id=$1', [req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Account not found.' });
    res.json({ user: safe(r.rows[0]) });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
}

module.exports = {
  REFRESH_COOKIE,
  sign, issueSession, safe,
  refreshHandler, logoutHandler, meHandler,
};
