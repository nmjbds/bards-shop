require('dotenv').config();
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const passport = require('passport');
const { z } = require('zod');
const GoogleStrategy   = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const { query } = require('../db');
const { validate, MIME_EXT } = require('../middleware/validate');
const router = express.Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Only allow same-site relative paths as an OAuth post-login redirect target —
// blocks open-redirect via a crafted ?redirect=https://evil.com or //evil.com.
function isSafeRedirectPath(p) {
  return typeof p === 'string' && p.length > 0 && p.length < 500
    && !p.startsWith('//') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p);
}

// ── Validation schemas ──────────────────────────────────────────
// password max 72: bcrypt silently truncates/ignores bytes past 72 — capping
// here means the rejection is explicit instead of a silent behavior surprise.
const signupSchema = z.object({
  name:     z.string().trim().min(1, 'Name is required.').max(100),
  email:    z.string().trim().min(1, 'Email is required.').max(200).email('Please enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72),
});
// avatar must be an http(s) URL — this already excludes data: URIs, so the
// error message is phrased for that specific (most common) rejection case.
const profileSchema = z.object({
  name:   z.string().trim().min(1).max(100).optional(),
  avatar: z.string().trim().max(2000)
            .regex(/^https?:\/\//, 'Please use the photo upload button — inline image data is no longer accepted here.')
            .optional(),
});
const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters.').max(72),
});

// ── Cloudflare R2 upload for avatars ───────────────────────────
// Mirrors the setup in routes/seller.js (same bucket/env vars/CDN), but
// exposed to any logged-in user — avatars aren't seller-only, so this can't
// reuse seller.js's requireSeller-gated /upload route.
let _avatarUploadReady = false;
let multer, S3Client, PutObjectCommand;
try {
  multer           = require('multer');
  const s3mod      = require('@aws-sdk/client-s3');
  S3Client         = s3mod.S3Client;
  PutObjectCommand = s3mod.PutObjectCommand;
  _avatarUploadReady = true;
} catch(e) {
  console.warn('[R2] Missing packages — avatar upload disabled. Run: npm install @aws-sdk/client-s3 multer');
}

function getR2Client() {
  const https = require('https');
  const { NodeHttpHandler } = require('@smithy/node-http-handler');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: new NodeHttpHandler({
      httpsAgent: new https.Agent({ secureProtocol: 'TLSv1_2_method', rejectUnauthorized: true }),
    }),
  });
}

// Single-file, image-only, 3MB max (matches the client-side check in account.html)
function makeAvatarUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter(req, file, cb) {
      if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
      cb(null, true);
    },
  }).single('avatar');
}

// Generic in-memory rate limiter factory — keyed by IP (+ optional field from
// body, e.g. email) OR by a custom keyFn(req) — e.g. authenticated user id,
// which is fairer than IP for logged-in routes (doesn't penalize shared
// office/campus networks) and harder to route around by switching IPs.
function makeRateLimit({ windowMs, max, message, keyField, keyFn }) {
  const attempts = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip || 'unknown';
    let key;
    if (keyFn) key = keyFn(req);
    else if (keyField && req.body && req.body[keyField]) key = `${ip}:${String(req.body[keyField]).toLowerCase()}`;
    else key = ip;
    const now = Date.now();
    const entry = attempts.get(key) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count++;
    attempts.set(key, entry);
    if (entry.count > max) {
      const retry = Math.ceil((windowMs - (now - entry.start)) / 1000 / 60) || 1;
      return res.status(429).json({ error: message(retry) });
    }
    next();
  };
}

// Forgot-password — max 5 requests per 15 min per IP
const otpRateLimit = makeRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: (retry) => `Too many requests. Please try again in ${retry} minutes.`,
});

// Sign-in — max 10 attempts per 15 min per IP+email (blocks brute-force password guessing)
const signinRateLimit = makeRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyField: 'email',
  message: (retry) => `Too many sign-in attempts. Please try again in ${retry} minutes.`,
});

// Sign-up — max 8 accounts per hour per IP (blocks mass fake-account creation)
const signupRateLimit = makeRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  message: (retry) => `Too many sign-up attempts from this network. Please try again in ${retry} minutes.`,
});

// Profile updates (name/avatar) — max 20 per hour per authenticated user.
// Keyed by user id (not IP), since this route requires auth already —
// keeps the limit tied to the account regardless of network.
const profileRateLimit = makeRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyFn: (req) => (req.user?.id ? `user:${req.user.id}` : (req.ip || 'unknown')),
  message: (retry) => `Too many profile updates. Please try again in ${retry} minutes.`,
});

// Initialize nodemailer transporter
// host/port instead of service:'gmail' to avoid self-signed certificate error
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS
  family: 4,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    // bypass self-signed cert เฉพาะ development เท่านั้น
    rejectUnauthorized: process.env.NODE_ENV === 'production',
  },
});

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

// Every login path (email, OAuth, Telegram) calls this instead of sign()
// directly — issues the access token AND a fresh refresh-token cookie.
async function issueSession(user, req, res) {
  const accessToken = sign(user);
  const refreshRaw  = await issueRefreshToken(user.id, req);
  setRefreshCookie(res, refreshRaw);
  return accessToken;
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { const r = await query('SELECT * FROM users WHERE id=$1', [id]); done(null, r.rows[0]); }
  catch(e) { done(e); }
});

passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.GOOGLE_CALLBACK_URL,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value;
    // Google marks whether it has actually verified ownership of this email.
    // Only auto-link to an existing password/email account when verified —
    // otherwise a malicious Google account with a spoofed/unverified email
    // could take over someone else's account.
    const emailVerified = profile.emails?.[0]?.verified === true;
    const avatar = profile.photos?.[0]?.value;
    let r = await query('SELECT * FROM users WHERE provider=$1 AND provider_id=$2', ['google', profile.id]);
    if (!r.rows.length && email && emailVerified) r = await query('SELECT * FROM users WHERE email=$1', [email]);
    if (r.rows.length) {
      await query('UPDATE users SET provider=$1,provider_id=$2,avatar=$3 WHERE id=$4', ['google', profile.id, avatar, r.rows[0].id]);
      return done(null, r.rows[0]);
    }
    // Don't store an unverified email against a brand-new account either,
    // to avoid silently colliding with someone else's real account later.
    const ins = await query(
      'INSERT INTO users(name,email,avatar,provider,provider_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [profile.displayName, emailVerified ? email : null, avatar, 'google', profile.id]
    );
    done(null, ins.rows[0]);
  } catch(e) { done(e); }
}));

// NOTE: Facebook login button is currently hidden on the frontend (not
// ready for launch) — Telegram Login has taken its place in the UI. This
// backend route/strategy is left intact so it's a one-line UI change to
// re-enable later, but /facebook and /facebook/callback are unreachable
// from the storefront until the button is restored.
passport.use(new FacebookStrategy({
  clientID:     process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL:  process.env.FACEBOOK_CALLBACK_URL,
  profileFields: ['id', 'displayName', 'emails', 'picture.type(large)'],
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value;
    let avatar = profile.photos?.[0]?.value || null;
    if (!avatar && profile.id) {
      avatar = `https://graph.facebook.com/${profile.id}/picture?type=large&width=320&height=320`;
    }
    let r = await query('SELECT * FROM users WHERE provider=$1 AND provider_id=$2', ['facebook', profile.id]);
    if (!r.rows.length && email) r = await query('SELECT * FROM users WHERE email=$1', [email]);
    if (r.rows.length) {
      await query('UPDATE users SET provider=$1,provider_id=$2,avatar=$3 WHERE id=$4', ['facebook', profile.id, avatar, r.rows[0].id]);
      return done(null, r.rows[0]);
    }
    const ins = await query(
      'INSERT INTO users(name,email,avatar,provider,provider_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [profile.displayName, email, avatar, 'facebook', profile.id]
    );
    done(null, ins.rows[0]);
  } catch(e) { done(e); }
}));

// Email signup
router.post('/signup', signupRateLimit, validate(signupSchema), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const exists = await query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered.' });
    const hash = await bcrypt.hash(password, 12);
    const r = await query(
      'INSERT INTO users(name,email,password,provider) VALUES($1,$2,$3,$4) RETURNING *',
      [name.trim(), email.toLowerCase(), hash, 'email']
    );
    const user = r.rows[0];
    const token = await issueSession(user, req, res);
    res.status(201).json({ token, user: safe(user) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// Email signin
router.post('/signin', signinRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const r = await query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    const user = r.rows[0];
    if (!user || !user.password) return res.status(401).json({ error: 'Incorrect email or password.' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
    const token = await issueSession(user, req, res);
    res.json({ token, user: safe(user) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// Exchange the refresh cookie for a fresh access token, rotating the refresh
// token in the process. Doesn't use requireAuth — the cookie IS the auth.
router.post('/refresh', async (req, res) => {
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

    const newRaw = await issueRefreshToken(user.id, req, row.id);
    setRefreshCookie(res, newRaw);
    res.json({ token: sign(user), user: safe(user) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// Revoke the current refresh token (best-effort — a missing/already-invalid
// cookie is not an error, logout should always "succeed" from the client's POV)
router.post('/logout', async (req, res) => {
  try {
    const raw = getCookie(req, REFRESH_COOKIE);
    if (raw) await query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL', [hashToken(raw)]);
  } catch(e) { console.error('[LOGOUT]', e.message); }
  clearRefreshCookie(res);
  res.json({ ok: true });
});

// Get current user
router.get('/me', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: safe(r.rows[0]) });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// Update profile (name only now — avatar goes through POST /avatar below,
// which uploads to R2 instead of storing a giant base64 string in the DB)
router.patch('/profile', require('../middleware/auth').requireAuth, profileRateLimit, validate(profileSchema), async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const r = await query(
      'UPDATE users SET name=COALESCE($1,name), avatar=COALESCE($2,avatar) WHERE id=$3 RETURNING *',
      [name||null, avatar||null, req.user.id]
    );
    res.json({ user: safe(r.rows[0]) });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// Upload avatar to Cloudflare R2 — replaces the old base64-into-DB approach.
// Same rate limit as profile updates (they're the same "edit my profile" action).
router.post('/avatar', require('../middleware/auth').requireAuth, profileRateLimit, (req, res) => {
  if (!_avatarUploadReady) {
    return res.status(503).json({ error: 'Upload not available. Run: npm install @aws-sdk/client-s3 multer' });
  }
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) {
    return res.status(503).json({ error: 'R2 environment variables not configured.' });
  }

  const upload = makeAvatarUpload();
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const r2      = getR2Client();
    const bucket  = process.env.R2_BUCKET_NAME || 'bards-media';
    const cdnBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

    try {
      // Extension from the validated mimetype, not the client-controlled
      // originalname — avoids injecting arbitrary characters/paths into the
      // R2 object key via a crafted filename.
      const ext = MIME_EXT[req.file.mimetype] || 'jpg';
      const key = `avatars/${req.user.id}-${Date.now()}.${ext}`;
      await r2.send(new PutObjectCommand({
        Bucket:      bucket,
        Key:         key,
        Body:        req.file.buffer,
        ContentType: req.file.mimetype,
        ACL:         'public-read',
      }));
      const url = cdnBase ? `${cdnBase}/${key}` : `https://${bucket}.r2.dev/${key}`;

      const r = await query('UPDATE users SET avatar=$1 WHERE id=$2 RETURNING *', [url, req.user.id]);
      res.json({ user: safe(r.rows[0]) });
    } catch(e) {
      console.error('[AVATAR UPLOAD]', e.message);
      res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
  });
});

// Change password
router.post('/change-password', require('../middleware/auth').requireAuth, validate(changePasswordSchema), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const r = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = r.rows[0];
    if (user.password) {
      const ok = await bcrypt.compare(currentPassword, user.password);
      if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// Forgot password — rate limited: max 5 per 15 min per IP
router.post('/forgot-password', otpRateLimit, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const r = await query('SELECT id, name FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!r.rows.length) return res.json({ ok: true }); // prevent email enumeration
    const user = r.rows[0];
    const code    = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await query(
      `INSERT INTO password_resets(user_id, code, expires_at)
       VALUES($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET code=$2, expires_at=$3, used=false`,
      [user.id, code, expires]
    );

    try {
      await transporter.sendMail({
        from:    process.env.MAIL_FROM || `"Bards" <${process.env.SMTP_USER}>`,
        to:      email,
        subject: 'Your Bards Password Reset Code',
        headers: {
          'X-Mailer':         'Bards Mailer 1.0',
          'X-Priority':       '3',
          'Precedence':       'bulk',
          'List-Unsubscribe': `<mailto:${process.env.SMTP_USER}?subject=unsubscribe>`,
        },
        text: `Hi ${user.name},\n\nYour Bards password reset code is:\n\n${code}\n\nThis code expires in 15 minutes.\nIf you did not request this, you can safely ignore this email.\n\n- Bards Team`,
        html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2F2F0;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F0;padding:40px 16px">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#FAFAFA;border:1px solid #E4E4E2;border-radius:14px;overflow:hidden;max-width:480px;width:100%">
<tr><td style="background:#0A0A0A;padding:24px 32px">
  <p style="margin:0;font-size:28px;font-weight:900;letter-spacing:6px;color:#FAFAFA;font-family:'Helvetica Neue',Arial,sans-serif">BARDS</p>
  <p style="margin:4px 0 0;font-size:10px;letter-spacing:2px;color:#888;text-transform:uppercase">Streetwear</p>
</td></tr>
<tr><td style="padding:32px">
  <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0A0A0A">Password Reset Code</p>
  <p style="margin:0 0 24px;font-size:14px;color:#8A8A88;line-height:1.6">Hi <strong style="color:#0A0A0A">${user.name}</strong>, use the code below to reset your password. It expires in <strong>15 minutes</strong>.</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#F2F2F0;border-radius:10px;padding:24px">
    <p style="margin:0;font-family:'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:14px;color:#0A0A0A">${code}</p>
  </td></tr></table>
  <p style="margin:24px 0 0;font-size:12px;color:#8A8A88;line-height:1.6">If you didn't request this, you can safely ignore this email. Your password will not change.</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #E4E4E2">
  <p style="margin:0;font-size:11px;color:#C8C8C6;text-align:center">&copy; ${new Date().getFullYear()} Bards. Automated message, please do not reply.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
      });
      console.log(`[MAIL] OTP sent to ${email}`);
    } catch(mailErr) {
      console.error('[MAIL ERROR]', mailErr.message);
      console.warn(`[DEV FALLBACK] OTP for ${email}: ${code}`);
    }

    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// Verify OTP
router.post('/verify-reset-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code are required.' });
    const r = await query(
      `SELECT pr.id, pr.expires_at, pr.used, u.id as user_id
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE u.email=$1 AND pr.code=$2`,
      [email.toLowerCase(), code]
    );
    const row = r.rows[0];
    if (!row)     return res.status(400).json({ error: 'Invalid code.' });
    if (row.used) return res.status(400).json({ error: 'Code already used.' });
    if (new Date() > new Date(row.expires_at)) return res.status(400).json({ error: 'Code expired. Request a new one.' });
    const resetToken = jwt.sign({ userId: row.user_id, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    res.json({ ok: true, token: resetToken });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); }
    catch { return res.status(400).json({ error: 'Reset link expired. Please start over.' }); }
    if (payload.purpose !== 'reset') return res.status(400).json({ error: 'Invalid reset token.' });
    // ตรวจสอบว่า email ตรงกับ userId ใน token (ป้องกัน token ของคนอื่นมาใช้)
    if (email) {
      const userRes = await query('SELECT id FROM users WHERE id=$1 AND LOWER(email)=LOWER($2)', [payload.userId, email]);
      if (!userRes.rows.length) return res.status(400).json({ error: 'Invalid reset token.' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password=$1 WHERE id=$2', [hash, payload.userId]);
    await query('UPDATE password_resets SET used=true WHERE user_id=$1', [payload.userId]);
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// Google OAuth — the original ?redirect= (e.g. "checkout.html") is carried through
// Google's round trip via the `state` param, since every other query param gets
// stripped. It comes back on /google/callback as req.query.state.
router.get('/google', (req, res, next) => {
  const redirect = isSafeRedirectPath(req.query.redirect) ? req.query.redirect : '';
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',
    access_type: 'online',
    state: redirect,
  })(req, res, next);
});
router.get('/google/callback', passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/signin?error=Google+login+failed` }), async (req, res) => {
  const token = await issueSession(req.user, req, res);
  const redirect = isSafeRedirectPath(req.query.state) ? `&redirect=${encodeURIComponent(req.query.state)}` : '';
  res.redirect(`${process.env.FRONTEND_URL}/signin?token=${token}${redirect}`);
});

// Facebook OAuth
router.get('/facebook', passport.authenticate('facebook', { scope: ['email', 'public_profile'] }));
router.get('/facebook/callback', passport.authenticate('facebook', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/signin?error=Facebook+login+failed` }), async (req, res) => {
  const token = await issueSession(req.user, req, res);
  res.redirect(`${process.env.FRONTEND_URL}/signin?token=${token}`);
});

// Shared Telegram auth-data verification (same check for both the redirect
// widget flow and the JSON/manual-popup flow below).
function verifyTelegramAuth(raw) {
  const data = { ...raw };
  const hash = data.hash;
  if (!hash) return { ok: false, reason: 'Telegram login failed' };
  delete data.hash;
  const secret   = crypto.createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const checkStr = Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('\n');
  const hmac     = crypto.createHmac('sha256', secret).update(checkStr).digest('hex');
  if (hmac !== hash) return { ok: false, reason: 'Telegram verification failed' };
  if (Date.now() / 1000 - parseInt(data.auth_date, 10) > 3600) return { ok: false, reason: 'Session expired' };
  return { ok: true, data };
}

async function upsertTelegramUser(data) {
  const telegramId = data.id.toString();
  const name       = [data.first_name, data.last_name].filter(Boolean).join(' ');
  const avatar     = data.photo_url || null;
  let r = await query('SELECT * FROM users WHERE provider=$1 AND provider_id=$2', ['telegram', telegramId]);
  if (!r.rows.length) {
    r = await query(`INSERT INTO users(name,avatar,provider,provider_id) VALUES($1,$2,'telegram',$3) RETURNING *`, [name, avatar, telegramId]);
  } else {
    await query('UPDATE users SET name=$1,avatar=$2 WHERE id=$3', [name, avatar, r.rows[0].id]);
  }
  return r.rows[0];
}

// Legacy redirect flow (kept in case the drop-in <script data-telegram-login> widget is ever used again)
router.get('/telegram/callback', async (req, res) => {
  try {
    const check = verifyTelegramAuth(req.query);
    if (!check.ok) return res.redirect(`${process.env.FRONTEND_URL}/signin.html?error=${encodeURIComponent(check.reason)}`);
    const user = await upsertTelegramUser(check.data);
    const token = await issueSession(user, req, res);
    res.redirect(`${process.env.FRONTEND_URL}/signin?token=${token}`);
  } catch(e) { console.error(e); res.redirect(`${process.env.FRONTEND_URL}/signin?error=Telegram+login+failed`); }
});

// JSON flow used by our custom-styled Telegram button (Telegram.Login.auth() popup).
// Rate-limited the same way as signin, since it's an alternate login path.
router.post('/telegram/verify', signinRateLimit, async (req, res) => {
  try {
    const check = verifyTelegramAuth(req.body || {});
    if (!check.ok) return res.status(401).json({ error: check.reason });
    const user = await upsertTelegramUser(check.data);
    const token = await issueSession(user, req, res);
    res.json({ token, user: safe(user) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

function safe(u) {
  return { id:u.id, name:u.name, email:u.email, avatar:u.avatar, provider:u.provider, joined:u.joined_at, role:u.role };
}

module.exports = { router, passport };