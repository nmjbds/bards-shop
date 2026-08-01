// Seller Onboarding Blueprint (2026-07-31) notification hooks — §7 of
// docs/05-seller-onboarding-blueprint.md.
//
// Telegram: sends to the existing admin/store TELEGRAM_CHAT_ID only (the
// same channel telegram-bot.js already posts ABA payment alerts to) — NOT
// a DM to the individual seller. There's no reliable per-seller chat id to
// message: users.provider_id only doubles as a Telegram chat id for
// accounts that signed up via Telegram login specifically, and most
// sellers won't have signed up that way. Decided with the project owner
// 2026-07-31 rather than guessing — email covers the seller-facing side of
// every event instead.
//
// Both functions are best-effort and never throw — a notification failing
// must never break the shop-application flow itself. Callers should NOT
// await these in the request's critical path; fire-and-forget is fine.
const nodemailer = require('nodemailer');

// Same transporter config as routes/auth.js's forgot-password email — kept
// identical on purpose (this is the config that's actually verified working
// in production, not the SMTP_HOST/PORT env vars CLAUDE.md documents but the
// code never reads).
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  family: 4,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production',
  },
});

function emailShell(bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2F2F0;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F0;padding:40px 16px">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#FAFAFA;border:1px solid #E4E4E2;border-radius:14px;overflow:hidden;max-width:480px;width:100%">
<tr><td style="background:#0A0A0A;padding:24px 32px">
  <p style="margin:0;font-size:28px;font-weight:900;letter-spacing:6px;color:#FAFAFA;font-family:'Helvetica Neue',Arial,sans-serif">BARDS</p>
  <p style="margin:4px 0 0;font-size:10px;letter-spacing:2px;color:#888;text-transform:uppercase">Seller Hub</p>
</td></tr>
<tr><td style="padding:32px">${bodyHtml}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function sendEmail(to, subject, text, bodyHtml) {
  if (!to) return; // OAuth/Telegram accounts can have a null email — nothing to send to
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || `"Bards" <${process.env.SMTP_USER}>`,
      to, subject,
      headers: { 'X-Mailer': 'Bards Mailer 1.0' },
      text,
      html: emailShell(bodyHtml),
    });
  } catch(e) {
    console.error('[NOTIFY EMAIL]', e.message);
  }
}

async function sendTelegramToAdmin(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch(e) {
    console.error('[NOTIFY TELEGRAM]', e.message);
  }
}

module.exports = { sendEmail, sendTelegramToAdmin };
