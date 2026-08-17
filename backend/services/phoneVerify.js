const { query } = require('../db');

// services/phoneVerify.js — seller phone verification (apply.html/
// settle/form.html Step 5 "Contact"). Phase 10 (2026-08-17): migrated from
// Twilio Verify to MoceanAPI, replacing the old services/twilioVerify.js.
//
// Twilio Verify was a *hosted* OTP service -- it generated the code, sent
// it, and tracked expiry/attempts entirely on Twilio's side, so nothing
// needed to live in our own DB for that flow. MoceanAPI has no equivalent
// -- POST /rest/2/sms just sends a text message, nothing more -- so this
// file now owns the OTP lifecycle itself: generate a 6-digit code, store it
// (phone_otp_codes, db.js), send it via Mocean, and check it back against
// our own row. Mirrors routes/authSeller.js's seller_otp_codes pattern
// (email OTP) applied to phone for the first time.
//
// Uses native fetch + URLSearchParams (no SDK) to match this project's
// existing external-API convention (see services/abaPayway.js) rather than
// the mocean-sdk npm package, whose Promise-mode response shape isn't
// clearly documented -- the raw REST response shape (an HTTP 200 with the
// real result embedded in the body as {messages:[{status,...}]}) is fully
// documented and confirmed against https://moceanapi.com/docs, so parsing
// that directly is the more predictable choice.

const MOCEAN_URL = 'https://rest.moceanapi.com/rest/2/sms';
const SENDER_ID = 'BARDS';
const DEFAULT_DIAL_CODE = '+855';
const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes -- matches seller_otp_codes' convention

// MoceanAPI wants country code + number with NO leading '+' (e.g.
// "85512345678"), unlike Twilio Verify's E.164 format ("+85512345678") --
// same parsing logic as the old normalizePhoneKH, just stripped of the '+'
// on output instead of keeping it. Cambodia is still the target market,
// but apply.html Step 5 has a country-code picker open to any country for
// now (see the frontend -- TODO once real testing/launch is closer: lock
// this back down to +855 only), so this can't just hardcode +855. `raw`
// that already looks like a full international number (leading '+') is
// left as-is (minus the '+') regardless of `dialCode`.
function normalizePhoneKH(raw, dialCode) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.slice(1);
  const dial = String(dialCode || DEFAULT_DIAL_CODE).replace(/[^\d+]/g, '');
  const dialDigits = dial.startsWith('+') ? dial.slice(1) : dial;
  // Already has the dial code but is missing the leading '+' (e.g. a
  // seller pasted "855123456789") -- don't double-prepend the dial code on
  // top of it. length>dialDigits.length rules out a local number
  // coincidentally starting with the same digits as the dial code (those
  // all start with a leading 0 locally, e.g. "085xxxxxxx", which fails
  // this startsWith check anyway).
  if (digits.startsWith(dialDigits) && digits.length > dialDigits.length) return digits;
  return dialDigits + digits.replace(/^0+/, '');
}

// Throws on any failure -- both transport-level (network/HTTP) and
// API-level (a 200 response whose embedded status isn't 0). Callers never
// need to separately check a return value for success; a resolved promise
// always means the SMS was actually accepted for delivery. e.moceanStatus
// is set for API-level failures so routes/shops.js can map specific codes
// to friendly messages, same pattern as the old code's e.code from Twilio.
async function sendSms(to, text) {
  const form = new URLSearchParams();
  form.append('mocean-from', SENDER_ID);
  form.append('mocean-to', to);
  form.append('mocean-text', text);
  form.append('mocean-resp-format', 'JSON');

  const res = await fetch(MOCEAN_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MOCEAN_API_TOKEN}` },
    body: form,
  });
  const text2 = await res.text();
  let data;
  try { data = JSON.parse(text2); } catch { data = null; }

  const msg = data?.messages?.[0];
  if (!res.ok || !msg || msg.status !== 0) {
    const e = new Error(msg?.err_msg || `SMS send failed (HTTP ${res.status})`);
    e.moceanStatus = msg?.status;
    e.httpStatus = res.status;
    throw e;
  }
  return msg;
}

async function startVerification(rawPhone, dialCode) {
  const to = normalizePhoneKH(rawPhone, dialCode);
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + OTP_TTL_MS);
  // Upsert (not insert) -- a seller re-requesting a code for the same
  // number replaces the pending one rather than erroring, same as
  // seller_otp_codes' ON CONFLICT pattern.
  await query(
    `INSERT INTO phone_otp_codes(phone, code, expires_at)
     VALUES($1,$2,$3)
     ON CONFLICT (phone) DO UPDATE SET code=$2, expires_at=$3, used=false`,
    [to, code, expires]
  );
  await sendSms(to, `Your Bards verification code is ${code}. This code expires in 15 minutes.`);
  return to;
}

// Returns { approved, reason } rather than a plain boolean so the caller
// can still show a distinct "expired" message vs. a generic "invalid"
// one -- same two-message UX the old Twilio-backed version had (its
// checkVerification() returned a boolean, but the route separately caught
// Twilio's thrown 20404 "expired" error to get the same distinction).
// Marks the row used on success so a correct code can't be replayed.
async function checkVerification(rawPhone, code, dialCode) {
  const to = normalizePhoneKH(rawPhone, dialCode);
  const r = await query(
    `SELECT id, expires_at, used FROM phone_otp_codes WHERE phone=$1 AND code=$2`,
    [to, code]
  );
  const row = r.rows[0];
  if (!row || row.used) return { approved: false, reason: 'invalid' };
  if (new Date() > new Date(row.expires_at)) return { approved: false, reason: 'expired' };
  await query(`UPDATE phone_otp_codes SET used=true WHERE id=$1`, [row.id]);
  return { approved: true };
}

module.exports = { normalizePhoneKH, startVerification, checkVerification };
