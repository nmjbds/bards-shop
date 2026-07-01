const jwt = require('jsonwebtoken');

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

module.exports = { requireAuth };