const twilio = require('twilio');

// services/twilioVerify.js — Twilio Verify wrapper for seller phone
// verification (Phase 4 of the TikTok-onboarding-flow rework, apply.html
// Step 5 "Contact"). Mirrors this project's other services/*.js files
// (r2.js, mailer.js): a lazily-created SDK client + thin wrapper
// functions, so routes/shops.js doesn't touch the Twilio SDK directly.
//
// No new DB table/column for OTP state -- Twilio Verify is a *hosted* OTP
// service, it tracks pending codes/expiry/attempt-count on Twilio's own
// side (services.create()/verificationChecks.create() below). This
// project's own DIY OTP tables (seller_otp_codes, password_resets) exist
// only because those flows predate this and roll their own; this one
// doesn't need that pattern at all.
let _client = null;
function getClient() {
  if (!_client) {
    _client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _client;
}

// Cambodia-only marketplace (see CLAUDE.md, apply.html's old country
// default) -- no country-code picker anywhere in this form, so normalizing
// straight to +855 here is the single source of truth rather than trusting
// the frontend to format it. A caller that already sent a '+'-prefixed
// (E.164-ish) number is left as-is -- covers a seller who typed their own
// country code for some reason, or a future non-Cambodia caller, without
// mangling it.
function normalizePhoneKH(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  // Already has the country code but is missing the leading '+' (e.g. a
  // seller pasted "855123456789") -- don't double-prepend +855 on top of
  // it. length>=10 rules out a Cambodian local number coincidentally
  // starting with the digits 855 (those all start with a leading 0, e.g.
  // "085xxxxxxx", which fails this startsWith check anyway).
  if (digits.startsWith('855') && digits.length >= 10) return '+' + digits;
  return '+855' + digits.replace(/^0+/, '');
}

async function startVerification(rawPhone) {
  const to = normalizePhoneKH(rawPhone);
  await getClient().verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to, channel: 'sms' });
  return to;
}

// Returns true only if Twilio reports the code as valid for this number
// (status 'approved') -- never trusts a bare "no error thrown" as success,
// since verificationChecks.create() resolves normally even for a wrong
// code (it comes back with status:'pending', not a rejected promise).
async function checkVerification(rawPhone, code) {
  const to = normalizePhoneKH(rawPhone);
  const result = await getClient().verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to, code });
  return result.status === 'approved';
}

module.exports = { normalizePhoneKH, startVerification, checkVerification };
