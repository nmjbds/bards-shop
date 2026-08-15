const nodemailer = require('nodemailer');
const { Resend } = require('resend');

// Single shared SMTP transporter — extracted from routes/auth.js (seller
// identity split) so the new seller-OTP email flow (routes/authSeller.js)
// doesn't duplicate SMTP/TLS config in a second place. Behavior-preserving:
// same host/port/auth/tls options routes/auth.js's forgot-password flow has
// always used — host/port instead of service:'gmail' to avoid a self-signed
// certificate error.
//
// Still used directly (not through sendMail() below) by routes/auth.js's
// forgot-password and services/notify.js — both call `transporter.sendMail()`
// themselves and are untouched by the Resend switch below.
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

// Resend — backs sendMail() below only. routes/authSeller.js (seller
// signup/signin OTP) is the sole caller of sendMail() in the project (checked
// 2026-08-15 — everything else uses `transporter` above directly), so this
// switch from Gmail SMTP to Resend only affects seller OTP mail. Sends from a
// verified bardskh.com domain instead of a personal Gmail address.
const resend = new Resend(process.env.RESEND_API_KEY);
const RESEND_FROM = process.env.RESEND_FROM || 'Bards <no-reply@bardskh.com>';

async function sendMail({ to, subject, text, html }) {
  const { error } = await resend.emails.send({ from: RESEND_FROM, to, subject, text, html });
  if (error) throw new Error(error.message || 'Resend send failed.');
}

module.exports = { transporter, sendMail };
