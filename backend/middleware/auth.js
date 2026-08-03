const jwt = require('jsonwebtoken');
const { query } = require('../db');

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'No token. Please sign in.' });
  try {
    const decoded = jwt.verify(t, process.env.JWT_SECRET);
    req.user = {
      ...decoded,
      id: decoded.id || decoded.userId || decoded.sub
    };
    next();
  } catch(e) {
    const msg = e.name === 'TokenExpiredError' ? 'Session expired. Please sign in again.' : 'Invalid token.';
    res.status(401).json({ error: msg });
  }
}

// requireRole(...roles) — must run after requireAuth. Re-queries users.role from
// DB rather than trusting the JWT claim, since role can change (e.g. revoked)
// after a token was issued and access tokens live for 15 minutes either way.
// Stamps req.userRole so handlers that branch on admin-vs-seller (e.g. shop
// scoping in routes/seller.js) don't need a second lookup.
function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      const r = await query('SELECT role FROM users WHERE id=$1', [req.user.id]);
      if (!r.rows.length || !roles.includes(r.rows[0].role)) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      req.userRole = r.rows[0].role;
      next();
    } catch(e) { res.status(500).json({ error: 'Server error.' }); }
  };
}

// Plain (non-middleware) role lookup, for routes that only need to check role
// conditionally rather than gate the whole handler — e.g.
// payment.js's /confirm, which allows the order's owner OR a seller/admin.
async function getUserRole(userId) {
  const r = await query('SELECT role FROM users WHERE id=$1', [userId]);
  return r.rows[0]?.role || null;
}

// The caller's own approved shop id, or null if they don't have one yet
// (never applied, still pending, or rejected/suspended). Moved here from
// routes/seller.js (2026-07-25) once routes/coupons.js also needed it for
// coupon ownership scoping — same rationale as getUserRole above: a small
// lookup shared by 2+ route files belongs here, not copy-pasted.
async function getOwnApprovedShop(userId) {
  const r = await query("SELECT id FROM shops WHERE owner_user_id=$1 AND status='approved'", [userId]);
  return r.rows[0]?.id || null;
}

// Revoke every live refresh token for a user — call this alongside ANY
// `UPDATE users SET role=...`, not just the suspend flow (which already did
// this). Found 2026-08-03: promoting/demoting a role left old refresh
// tokens live, so a browser holding a pre-change cookie would keep getting
// fresh access tokens stamped with the OLD role indefinitely (up to 30
// days) instead of being forced to re-authenticate. Accepts an optional
// queryFn so a caller already inside a client.query() transaction (e.g.
// shops.js's approve-shop transaction, which updates users.role and
// shops.status atomically) can pass `client.query.bind(client)` to keep
// the revoke in the same transaction; defaults to the plain query() helper
// for call sites that aren't already in one.
async function revokeUserSessions(userId, queryFn = query) {
  await queryFn('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
}

module.exports = { requireAuth, requireRole, getUserRole, getOwnApprovedShop, revokeUserSessions };