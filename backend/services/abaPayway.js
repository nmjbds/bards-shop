// ABA PayWay (KHQR / ABA PAY) client — real hosted API.
//
// The field order/formula below is CONFIRMED against ABA's sandbox (tested
// 2026-07-18, got a real HTTP 200 + qrString back) — it differs from
// docs/05-payment-aba-payway.md, which caused "Wrong Hash" (code 1) errors.
// Per ABA's own support response: the hash must only include parameters
// actually sent in the request body — the doc's approach of padding every
// unused field (items, shipping, firstname, type, ...) with '' is wrong for
// this flow. The rule that worked: take the doc's documented field order,
// drop every field this integration doesn't send, keep the rest in place —
// don't insert '' placeholders for the dropped ones.
const crypto = require('crypto');

function hmacSha512Base64(raw, apiKey) {
  return crypto.createHmac('sha512', apiKey).update(raw).digest('base64');
}

function reqTimeNow() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14); // YYYYMMDDHHmmss
}

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env`);
  return v;
}

// ABA's onboarding email sometimes gives the bare host
// (https://checkout-sandbox.payway.com.kh) and sometimes gives a full
// endpoint URL (.../api/payment-gateway/v1/payments/purchase) as "the API
// URL" — using URL().origin handles either shape and always yields just the
// host, so the endpoint-specific paths below are appended exactly once.
function baseUrl() {
  return new URL(env('ABA_PAYWAY_BASE_URL')).origin;
}

// POST /purchase — registers the transaction with ABA and gets back a KHQR
// string + deeplink. tranId must be unique per attempt — we use orders.id,
// which is already unique per order.
//
// CONFIRMED hash field order (only fields we actually send, in this order):
//   req_time + merchant_id + tran_id + amount + payment_option + return_url + currency
async function createPurchase({ tranId, amount }) {
  const reqTime    = reqTimeNow();
  const merchantId = env('ABA_PAYWAY_MERCHANT_ID');
  const apiKey     = env('ABA_PAYWAY_API_KEY');

  const fields = {
    reqTime,
    merchantId,
    tranId,
    amount: Number(amount).toFixed(2),
    currency: 'USD',
    paymentOption: 'abapay_khqr_deeplink',
    returnUrl: Buffer.from(`${process.env.API_PUBLIC_URL || ''}/api/payment/webhook`).toString('base64'),
  };
  const raw  = fields.reqTime + fields.merchantId + fields.tranId + fields.amount
             + fields.paymentOption + fields.returnUrl + fields.currency;
  const hash = hmacSha512Base64(raw, apiKey);

  const form = new URLSearchParams();
  form.append('req_time', fields.reqTime);
  form.append('merchant_id', fields.merchantId);
  form.append('tran_id', fields.tranId);
  form.append('amount', fields.amount);
  form.append('currency', fields.currency);
  form.append('payment_option', fields.paymentOption);
  form.append('return_url', fields.returnUrl);
  form.append('hash', hash);

  const res  = await fetch(`${baseUrl()}/api/payment-gateway/v1/payments/purchase`, { method: 'POST', body: form });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { httpOk: res.ok, httpStatus: res.status, data };
}

// POST /check-transaction-2 — asks ABA for the *current* status of tranId.
// CONFIRMED hash: req_time + merchant_id + tran_id (tested against a live
// sandbox transaction, got a real 200 + payment_status:"PENDING" back).
async function checkTransaction(tranId) {
  const reqTime    = reqTimeNow();
  const merchantId = env('ABA_PAYWAY_MERCHANT_ID');
  const apiKey     = env('ABA_PAYWAY_API_KEY');
  const hash       = hmacSha512Base64(`${reqTime}${merchantId}${tranId}`, apiKey);

  const form = new URLSearchParams();
  form.append('req_time', reqTime);
  form.append('merchant_id', merchantId);
  form.append('tran_id', tranId);
  form.append('hash', hash);

  const res  = await fetch(`${baseUrl()}/api/payment-gateway/v1/payments/check-transaction-2`, { method: 'POST', body: form });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { httpOk: res.ok, httpStatus: res.status, data };
}

// CONFIRMED: on success, status.code is the STRING "00" (not "0"); ABA's own
// error responses use a bare number instead (e.g. 1 for "Wrong Hash") — the
// two response shapes aren't type-consistent, so compare numerically.
function statusCode(data) {
  const code = data?.status?.code;
  return code === undefined || code === null ? null : String(code);
}

function isPurchaseSuccess(data) {
  return Number(statusCode(data)) === 0;
}

// CONFIRMED shape from a live sandbox check-transaction-2 call on an unpaid
// order: { data: { payment_status: "PENDING", payment_status_code: 2, ... },
// status: { code: "00", ... } }. "APPROVED" for the paid case is inferred
// (PENDING/DECLINED being the obvious siblings) but not yet observed —
// confirm against payments.raw_response the first time a sandbox QR is
// actually paid, and adjust here if the real value differs.
function paymentStatus(data) {
  return (data?.data?.payment_status || '').toString().toUpperCase();
}

function isPaid(data) {
  return Number(statusCode(data)) === 0 && paymentStatus(data) === 'APPROVED';
}

// Top-level, no nested "data" wrapper on /purchase — but ABA's casing for
// this field is NOT consistent across responses (observed both "qrString"
// and "qr_string" from the same sandbox merchant on different calls), so
// check both rather than assume one.
function extractQrString(data) {
  return data?.qrString || data?.qr_string || null;
}

function extractDeeplink(data) {
  return data?.abapay_deeplink || data?.abapayDeeplink || null;
}

module.exports = {
  createPurchase, checkTransaction,
  isPurchaseSuccess, isPaid, statusCode, paymentStatus,
  extractQrString, extractDeeplink,
};
