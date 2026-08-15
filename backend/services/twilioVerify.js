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

// Cambodia is still the target market, but apply.html Step 5 now has a
// country-code picker (open to any country for now, see the frontend --
// TODO once real testing/launch is closer: lock this back down to +855
// only, per the project owner's plan) -- so this can no longer just
// hardcode +855. `dialCode` (e.g. '+66') is whatever the seller picked in
// that dropdown; DEFAULT_DIAL_CODE only matters if a caller omits it
// (shouldn't happen from apply.html itself, but keeps this function safe
// to call directly). A caller that already sent a '+'-prefixed (E.164-ish)
// `raw` value is left as-is regardless of `dialCode` -- covers a seller
// who pasted their own full international number.
const DEFAULT_DIAL_CODE = '+855';

function normalizePhoneKH(raw, dialCode) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  const dial = String(dialCode || DEFAULT_DIAL_CODE).replace(/[^\d+]/g, '');
  const dialDigits = dial.startsWith('+') ? dial.slice(1) : dial;
  // Already has the dial code but is missing the leading '+' (e.g. a
  // seller pasted "855123456789") -- don't double-prepend the dial code on
  // top of it. length>dialDigits.length rules out a local number
  // coincidentally starting with the same digits as the dial code (those
  // all start with a leading 0 locally, e.g. "085xxxxxxx", which fails
  // this startsWith check anyway).
  if (digits.startsWith(dialDigits) && digits.length > dialDigits.length) return '+' + digits;
  return (dial.startsWith('+') ? dial : '+' + dial) + digits.replace(/^0+/, '');
}

async function startVerification(rawPhone, dialCode) {
  const to = normalizePhoneKH(rawPhone, dialCode);
  await getClient().verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to, channel: 'sms' });
  return to;
}

// Returns true only if Twilio reports the code as valid for this number
// (status 'approved') -- never trusts a bare "no error thrown" as success,
// since verificationChecks.create() resolves normally even for a wrong
// code (it comes back with status:'pending', not a rejected promise).
async function checkVerification(rawPhone, code, dialCode) {
  const to = normalizePhoneKH(rawPhone, dialCode);
  const result = await getClient().verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to, code });
  return result.status === 'approved';
}

module.exports = { normalizePhoneKH, startVerification, checkVerification };
