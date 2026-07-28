const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const { query } = require('../db');

// ═══════════════════════════════════════════════════════════════
// services/session.js — extracted from routes/auth.js (2026-07-28,
// multi-domain split, Phase 1 prep).
//
// Why this file exists: routes/authSession.js (mounted at /api/auth on the
// seller./admin. servers, which have no signin/signup/OAuth pages of their
// own) originally did `require('./auth')` to reuse refreshHandler/
// logoutHandler/meHandler. But requiring routes/auth.js also runs its
// top-level `passport.use(new GoogleStrategy({...}))` /
// `new FacebookStrategy({...})` calls — and passport-google-oauth20's
// OAuth2Strategy constructor throws synchronously ("OAuth2Strategy requires
// a clientID option") if GOOGLE_CLIENT_ID isn't set. A freshly created
// Render service has no env vars configured yet, so this would crash the
// admin/seller server at boot before it even reached app.listen() — caught
// during Phase 1 prep by simulating an empty environment locally, not by
// looking at the code. Moving the actual session logic here means
// routes/authSession.js no longer touches passport/OAuth/nodemailer/R2 at
// all — it only needs this file, `../db`, and `../middleware/auth`.
//
// routes/auth.js re-exports everything below unchanged, so the customer
// server's behavior (and its existing module.exports shape) is identical to
// before this file existed.
// ═══════════════════════════════════════════════════════════════

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

// ── Refresh tokens ──────────────────────────────────────────────
// Access token (sign()) is short-lived (15m). A long-lived (30d) refresh
// token lives in an httpOnly cookie scoped to /api/auth, hashed at rest in
// refresh_tokens, and rotated on every use so a stolen access token can no
// longer stay valid for up to 7 days like it used to — see CLAUDE.md §3/§8.
const REFRESH_COOKIE   = 'bards_rt';
const REFRESH_TTL_MS   = 30 * 24 * 60 * 60 * 1000; // 30 days

// No cookie-parser dependency — we only ever need to read this one cookie.
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

// Inserts a new (hashed) refresh token row. If replacesId is given, that row
// is atomically marked revoked+replaced_by the new one (rotation).
async function issueRefreshToken(userId, req, replacesId = null) {
  const raw       = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  const userAgent = (req.headers['user-agent'] || '').slice(0, 255);
  const ins = await query(
    'INSERT INTO refresh_tokens(user_id, token_hash, expires_at, user_agent) VALUES($1,$2,$3,$4) RETURNING id',
    [userId, tokenHash, expiresAt, userAgent || null]
  );
  if (replacesId) {
    await query('UPDATE refresh_tokens SET revoked_at=NOW(), replaced_by=$1 WHERE id=$2', [ins.rows[0].id, replacesId]);
  }
  return raw;
}

// Multi-domain step 8b (2026-07-27) — Domain=.bardskh.com (leading dot; also
// matches the modern no-dot form per RFC 6265, kept for clarity/older client
// compat) makes this cookie valid for bardskh.com AND every subdomain under
// it (seller./admin.), so a refresh-token issued on one is presented on the
// others too. Combined with apiFetch()'s existing silent-refresh-on-401,
// this is what lets one login work across all three domains without a
// separate cookie/session per subdomain. Production-only — undefined in dev
// keeps the existing host-only-on-localhost behavior exactly as before (the
// `cookie` library omits the Domain attribute entirely when this is
// undefined, it does not send a literal "Domain=undefined"). Existing
// cookies already in a browser aren't retroactively widened by this change;
// they keep working host-only until they next rotate (signin, or the next
// /auth/refresh call, whichever comes first — within 30 days at the latest).
const REFRESH_COOKIE_DOMAIN = process.env.NODE_ENV === 'production' ? '.bardskh.com' : undefined;

function setRefreshCookie(res, raw) {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/api/auth',
    domain:   REFRESH_COOKIE_DOMAIN,
    maxAge:   REFRESH_TTL_MS,
  });
}

function clearRefreshCookie(res) {
  // Must match the Domain/Path the cookie was actually set with, or the
  // browser treats this as a different cookie and leaves the real one in
  // place — same reason logout wouldn't work if this drifted from setRefreshCookie() above.
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', domain: REFRESH_COOKIE_DOMAIN });
}

// Every login path (email, OAuth, Telegram) calls this instead of sign()
// directly — issues the access token AND a fresh refresh-token cookie.
async function issueSession(user, req, res) {
  const accessToken = sign(user);
  const refreshRaw  = await issueRefreshToken(user.id, req);
  setRefreshCookie(res, refreshRaw);
  return accessToken;
}

// Admin UI step 5 (2026-07-26) — shared suspension check, used at every
// login choke point (email signin, OAuth callbacks, Telegram) right before
// issueSession(). Checked AFTER password/OAuth/Telegram verification
// succeeds everywhere it's used, never before — so a suspended-account
// message is only ever shown to someone who already proved they own the
// account, not leaked to a stranger who merely knows the email.
function isSuspended(user) {
  return !!user && user.status === 'suspended';
}
const SUSPENDED_MSG = 'This account has been suspended. Contact support for help.';

function safe(u) {
  return { id:u.id, name:u.name, email:u.email, avatar:u.avatar, provider:u.provider, joined:u.joined_at, role:u.role };
}

// Exchange the refresh cookie for a fresh access token, rotating the refresh
// token in the process. Doesn't use requireAuth — the cookie IS the auth.
async function refreshHandler(req, res) {
  try {
    const raw = getCookie(req, REFRESH_COOKIE);
    if (!raw) return res.status(401).json({ error: 'No session. Please sign in.' });

    const tokenHash = hashToken(raw);
    const r = await query('SELECT * FROM refresh_tokens WHERE token_hash=$1', [tokenHash]);
    const row = r.rows[0];
    if (!row) { clearRefreshCookie(res); return res.status(401).json({ error: 'Invalid session. Please sign in again.' }); }

    if (row.revoked_at) {
      // This token was already rotated away (or logged out) — presenting it
      // again means it leaked. Kill every live session for this user.
      await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [row.user_id]);
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Session revoked. Please sign in again.' });
    }
    if (new Date(row.expires_at) < new Date()) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    const userRes = await query('SELECT * FROM users WHERE id=$1', [row.user_id]);
    if (!userRes.rows.length) { clearRefreshCookie(res); return res.status(401).json({ error: 'User not found.' }); }
    const user = userRes.rows[0];

    // Belt-and-suspenders — PATCH /seller/customers/:id/status already revokes
    // every refresh token the instant an account is suspended, but this catches
    // the edge case of a token issued in the gap between that revoke query and
    // whatever request is mid-flight right now.
    if (isSuspended(user)) {
      await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [user.id]);
      clearRefreshCookie(res);
      return res.status(403).json({ error: SUSPENDED_MSG, code: 'ACCOUNT_SUSPENDED' });
    }

    const newRaw = await issueRefreshToken(user.id, req, row.id);
    setRefreshCookie(res, newRaw);
    res.json({ token: sign(user), user: safe(user) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
}

// Revoke the current refresh token (best-effort — a missing/already-invalid
// cookie is not an error, logout should always "succeed" from the client's POV)
async function logoutHandler(req, res) {
  try {
    const raw = getCookie(req, REFRESH_COOKIE);
    if (raw) await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL', [hashToken(raw)]);
  } catch(e) { console.error('[LOGOUT]', e.message); }
  clearRefreshCookie(res);
  res.json({ ok: true });
}

// Get current user — also doubles as the fastest signal a still-valid (≤15m)
// access token was suspended mid-session: every logged-in page calls this on
// load, so a suspended user gets bounced back to signin with a clear reason
// instead of pages silently half-working until the token naturally expires.
// (requireAuth middleware is attached at the router.get() call site, not here.)
async function meHandler(req, res) {
  try {
    const r = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found.' });
    if (isSuspended(r.rows[0])) return res.status(403).json({ error: SUSPENDED_MSG, code: 'ACCOUNT_SUSPENDED' });
    res.json({ user: safe(r.rows[0]) });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
}

module.exports = {
  REFRESH_COOKIE, REFRESH_COOKIE_DOMAIN,
  sign, issueSession, isSuspended, SUSPENDED_MSG, safe,
  refreshHandler, logoutHandler, meHandler,
};
