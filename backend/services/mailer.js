const nodemailer = require('nodemailer');

// Single shared SMTP transporter — extracted from routes/auth.js (seller
// identity split) so the new seller-OTP email flow (routes/authSeller.js)
// doesn't duplicate SMTP/TLS config in a second place. Behavior-preserving:
// same host/port/auth/tls options routes/auth.js's forgot-password flow has
// always used — host/port instead of service:'gmail' to avoid a self-signed
// certificate error.
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

// Thin wrapper — fills in the from-address/common headers every outbound
// mail in this project already used (routes/auth.js's forgot-password OTP),
// so new callers (routes/authSeller.js) don't repeat that boilerplate.
async function sendMail({ to, subject, text, html }) {
  return transporter.sendMail({
    from: process.env.MAIL_FROM || `"Bards" <${process.env.SMTP_USER}>`,
    to, subject, text, html,
    headers: {
      'X-Mailer': 'Bards Mailer 1.0',
      'X-Priority': '3',
      'Precedence': 'bulk',
      'List-Unsubscribe': `<mailto:${process.env.SMTP_USER}?subject=unsubscribe>`,
    },
  });
}

module.exports = { transporter, sendMail };
