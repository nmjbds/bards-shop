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

module.exports = { requireAuth, requireRole, getUserRole };