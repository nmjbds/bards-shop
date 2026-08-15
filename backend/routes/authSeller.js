const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { z }    = require('zod');
const { query } = require('../db');
const { validate } = require('../middleware/validate');
const { sendMail } = require('../services/mailer');
const {
  issueSession, safe,
  refreshHandler, logoutHandler, meHandler,
} = require('../services/sellerSession');
const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// routes/authSeller.js — seller.bardskh.com's OWN signup/signin, completely
// separate from routes/auth.js (customer/admin identity, `users` table).
// Mounted at /api/auth/seller on server-seller.js, alongside (not instead
// of) the existing routes/authSession.js mount at /api/auth — that existing
// mount is what still lets an admin session (users.role='admin') silently
// carry over from admin.bardskh.com via the shared bards_rt cookie; this
// file is what a seller (or a customer who wants to become one) now has to
// go through explicitly, on this domain, every time. See
// middleware/auth.js's requireSellerOrAdmin/requireSellerAccount and
// public-shared/api.js's SellerAuth for how the two paths are told apart.
//
// Signup verifies the email via a 6-digit OTP (reusing the same
// nodemailer/Gmail SMTP setup routes/auth.js's forgot-password already
// uses, via services/mailer.js) BEFORE a password is ever set. Sign-in
// accepts a password OR an OTP in place of one — no Google/Telegram here,
// this is a deliberately separate, narrower identity from the customer
// login options.
// ═══════════════════════════════════════════════════════════════

// ── Rate limiting ──────────────────────────────────────────────
// Small local copy of routes/auth.js's makeRateLimit() factory — not
// exported from that file, and this router intentionally doesn't require
// anything from routes/auth.js (see services/sellerSession.js's header
// comment on why: requiring routes/auth.js would also run its top-level
// passport.use(new GoogleStrategy(...)) calls, which throw synchronously if
// GOOGLE_CLIENT_ID isn't set).
function makeRateLimit({ windowMs, max, message, keyField }) {
  const attempts = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip || 'unknown';
    const key = keyField && req.body?.[keyField] ? `${ip}:${String(req.body[keyField]).toLowerCase()}` : ip;
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
const otpRateLimit = makeRateLimit({
  windowMs: 15 * 60 * 1000, max: 5, keyField: 'email',
  message: (retry) => `Too many code requests. Please try again in ${retry} minutes.`,
});
const signinRateLimit = makeRateLimit({
  windowMs: 15 * 60 * 1000, max: 10, keyField: 'identifier',
  message: (retry) => `Too many sign-in attempts. Please try again in ${retry} minutes.`,
});
const signupRateLimit = makeRateLimit({
  windowMs: 60 * 60 * 1000, max: 8,
  message: (retry) => `Too many sign-up attempts from this network. Please try again in ${retry} minutes.`,
});

// ── Validation schemas ──────────────────────────────────────────
const emailSchema = z.string().trim().min(1, 'Email is required.').max(200).email('Please enter a valid email address.');
const purposeSchema = z.enum(['signup', 'signin'], { error: 'Invalid purpose.' });

const requestOtpSchema = z.object({ email: emailSchema, purpose: purposeSchema });
const verifyOtpSchema  = z.object({ email: emailSchema, code: z.string().trim().length(6, 'Code must be 6 digits.') });
const signinOtpSchema  = z.object({ email: emailSchema, code: z.string().trim().length(6, 'Code must be 6 digits.') });
// Phone dropped 2026-08-15 — apply.html Step 5 (Phase 4, Twilio Verify)
// already collects + SMS-verifies phone for real; the copy that used to be
// collected here was never verified and never synced with that one.
const signupSchema = z.object({
  email:    emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72),
  otpToken: z.string().min(1, 'Email verification is required.'),
});
const signinSchema = z.object({
  identifier: z.string().trim().min(1, 'Email or phone is required.').max(200),
  password:   z.string().min(1, 'Password is required.').max(72),
});

// ── POST /request-otp — send a 6-digit code to `email` ──────────
// purpose:'signup' always sends (anyone can start a signup). purpose:'signin'
// silently no-ops if the email has no seller_accounts row yet — same
// email-enumeration guard routes/auth.js's forgot-password already uses —
// but still answers {ok:true} either way.
router.post('/request-otp', otpRateLimit, validate(requestOtpSchema), async (req, res) => {
  try {
    const { email, purpose } = req.body;
    const lower = email.toLowerCase();

    if (purpose === 'signin') {
      const exists = await query('SELECT id FROM seller_accounts WHERE email=$1', [lower]);
      if (!exists.rows.length) return res.json({ ok: true });
    }

    const code    = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await query(
      `INSERT INTO seller_otp_codes(email, purpose, code, expires_at)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (email, purpose) DO UPDATE SET code=$3, expires_at=$4, used=false`,
      [lower, purpose, code, expires]
    );

    const subject = purpose === 'signup' ? 'Your Bards Seller Signup Code' : 'Your Bards Seller Sign-in Code';
    try {
      await sendMail({
        to: email,
        subject,
        text: `Your Bards seller verification code is:\n\n${code}\n\nThis code expires in 15 minutes.\nIf you did not request this, you can safely ignore this email.\n\n- Bards Team`,
        html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2F2F0;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F0;padding:40px 16px">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#FAFAFA;border:1px solid #E4E4E2;border-radius:14px;overflow:hidden;max-width:480px;width:100%">
<tr><td style="background:#0A0A0A;padding:24px 32px">
  <p style="margin:0;font-size:28px;font-weight:900;letter-spacing:6px;color:#FAFAFA">BARDS</p>
  <p style="margin:4px 0 0;font-size:10px;letter-spacing:2px;color:#888;text-transform:uppercase">Seller Center</p>
</td></tr>
<tr><td style="padding:32px">
  <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0A0A0A">Verification Code</p>
  <p style="margin:0 0 24px;font-size:14px;color:#8A8A88;line-height:1.6">Use the code below to continue. It expires in <strong>15 minutes</strong>.</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#F2F2F0;border-radius:10px;padding:24px">
    <p style="margin:0;font-family:'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:14px;color:#0A0A0A">${code}</p>
  </td></tr></table>
  <p style="margin:24px 0 0;font-size:12px;color:#8A8A88;line-height:1.6">If you didn't request this, you can safely ignore this email.</p>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #E4E4E2">
  <p style="margin:0;font-size:11px;color:#C8C8C6;text-align:center">&copy; ${new Date().getFullYear()} Bards. Automated message, please do not reply.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
      });
    } catch(mailErr) {
      console.error('[SELLER OTP MAIL ERROR]', mailErr.message);
      console.warn(`[DEV FALLBACK] Seller OTP for ${email} (${purpose}): ${code}`);
    }

    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── POST /verify-otp — check a signup code, return a short-lived token ──
// that POST /signup consumes. Only for purpose:'signup' — signin's OTP path
// is a single self-contained call (POST /signin-otp below), no separate
// verify step, since there's no password to collect afterward.
router.post('/verify-otp', validate(verifyOtpSchema), async (req, res) => {
  try {
    const { email, code } = req.body;
    const lower = email.toLowerCase();
    const r = await query(
      `SELECT id, expires_at, used FROM seller_otp_codes WHERE email=$1 AND purpose='signup' AND code=$2`,
      [lower, code]
    );
    const row = r.rows[0];
    if (!row)     return res.status(400).json({ error: 'Invalid code.' });
    if (row.used) return res.status(400).json({ error: 'Code already used.' });
    if (new Date() > new Date(row.expires_at)) return res.status(400).json({ error: 'Code expired. Request a new one.' });

    const already = await query('SELECT id FROM seller_accounts WHERE email=$1', [lower]);
    if (already.rows.length) return res.status(409).json({ error: 'An account with this email already exists — sign in instead.' });

    const otpToken = jwt.sign({ email: lower, purpose: 'seller_signup' }, process.env.JWT_SECRET, { expiresIn: '15m' });
    res.json({ ok: true, otpToken });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── POST /signup — create the seller_accounts row ────────────────
// Requires otpToken from POST /verify-otp (proves the email was just
// verified) — the OTP row itself is marked used here, not at verify time,
// so a verify-then-abandon doesn't burn the code for a retry within its
// 15-minute window.
router.post('/signup', signupRateLimit, validate(signupSchema), async (req, res) => {
  try {
    const { email, password, otpToken } = req.body;
    const lower = email.toLowerCase();

    let payload;
    try { payload = jwt.verify(otpToken, process.env.JWT_SECRET); }
    catch { return res.status(400).json({ error: 'Email verification expired. Please verify your email again.' }); }
    if (payload.purpose !== 'seller_signup' || payload.email !== lower) {
      return res.status(400).json({ error: 'Email verification does not match.' });
    }

    const existsEmail = await query('SELECT id FROM seller_accounts WHERE email=$1', [lower]);
    if (existsEmail.rows.length) return res.status(409).json({ error: 'An account with this email already exists — sign in instead.' });

    const hash = await bcrypt.hash(password, 12);
    const r = await query(
      `INSERT INTO seller_accounts(email, password, email_verified_at)
       VALUES($1,$2,NOW()) RETURNING *`,
      [lower, hash]
    );
    await query(`UPDATE seller_otp_codes SET used=true WHERE email=$1 AND purpose='signup'`, [lower]);

    const seller = r.rows[0];
    const token = await issueSession(seller, req, res);
    res.status(201).json({ token, user: safe(seller) });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An account with this email already exists.' });
    console.error(e); res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /signin — email or phone + password ──────────────────────
router.post('/signin', signinRateLimit, validate(signinSchema), async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const id = identifier.trim().toLowerCase();
    const r = await query('SELECT * FROM seller_accounts WHERE email=$1 OR phone=$2', [id, identifier.trim()]);
    const seller = r.rows[0];
    if (!seller) return res.status(401).json({ error: 'Incorrect email/phone or password.' });
    const ok = await bcrypt.compare(password, seller.password);
    if (!ok) return res.status(401).json({ error: 'Incorrect email/phone or password.' });
    const token = await issueSession(seller, req, res);
    res.json({ token, user: safe(seller) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── POST /signin-otp — email + OTP instead of a password ──────────
router.post('/signin-otp', signinRateLimit, validate(signinOtpSchema), async (req, res) => {
  try {
    const { email, code } = req.body;
    const lower = email.toLowerCase();
    const r = await query(
      `SELECT id, expires_at, used FROM seller_otp_codes WHERE email=$1 AND purpose='signin' AND code=$2`,
      [lower, code]
    );
    const row = r.rows[0];
    if (!row)     return res.status(400).json({ error: 'Invalid code.' });
    if (row.used) return res.status(400).json({ error: 'Code already used.' });
    if (new Date() > new Date(row.expires_at)) return res.status(400).json({ error: 'Code expired. Request a new one.' });

    const sellerRes = await query('SELECT * FROM seller_accounts WHERE email=$1', [lower]);
    if (!sellerRes.rows.length) return res.status(401).json({ error: 'No account found for this email.' });

    await query(`UPDATE seller_otp_codes SET used=true WHERE email=$1 AND purpose='signin'`, [lower]);
    const seller = sellerRes.rows[0];
    const token = await issueSession(seller, req, res);
    res.json({ token, user: safe(seller) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// ── Session maintenance — same shape as routes/authSession.js, backed by
// services/sellerSession.js instead of services/session.js. ──
router.post('/refresh', refreshHandler);
router.post('/logout', logoutHandler);
router.get('/me', require('../middleware/auth').requireAuth, meHandler);

module.exports = router;
