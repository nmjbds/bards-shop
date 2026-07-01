/**
 * telegram-bot.js — Bards Payment Auto-Confirm Bot
 * Run: node telegram-bot.js
 * Reads ABA payment notifications and auto-confirms orders
 */
require('dotenv').config();
const { Pool } = require('pg');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8200703222:AAHR8eX2Sp2WzfwwhV-WNBApDJRDhDvlZT8';
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || '8052755516';
const API_URL   = `https://api.telegram.org/bot${BOT_TOKEN}`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query(text, params) {
  const client = await pool.connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

// Parse ABA notification message
// Example: "$23.94 ត្រូវបានបង់ដោយ LOK POEUY (*224) ... សម្គាល់: BRD-ABC123 ..."
function parseABAMessage(text) {
  // Amount — match $X.XX or X.XX USD
  const amtMatch = text.match(/\$?([\d]+\.[\d]{2})/);
  const amount   = amtMatch ? parseFloat(amtMatch[1]) : null;

  // Order ID — match BRD-XXXXXX-XXXX pattern in note/reference
  const orderMatch = text.match(/BRD-[A-Z0-9]+-[A-Z0-9]+/i);
  const orderId    = orderMatch ? orderMatch[0].toUpperCase() : null;

  // Transaction number
  const txMatch = text.match(/លេខប្រតិបត្តិការ[:\s]*(\d+)/);
  const txId    = txMatch ? txMatch[1] : null;

  // Payer name
  const payerMatch = text.match(/បង់ដោយ\s+([A-Z\s]+)\s*\(/i) || text.match(/paid by\s+([A-Za-z\s]+)\s*\(/i);
  const payer      = payerMatch ? payerMatch[1].trim() : 'Unknown';

  return { amount, orderId, txId, payer };
}

// Confirm order in database
async function confirmOrder(orderId, amount, txId, payer) {
  // Find order by ID
  const r = await query(
    `SELECT id, status, total FROM orders WHERE id=$1`,
    [orderId]
  );

  if (!r.rows.length) {
    return { ok: false, reason: `Order ${orderId} not found in database` };
  }

  const order = r.rows[0];

  if (order.status === 'paid' || order.status === 'delivered') {
    return { ok: false, reason: `Order ${orderId} already marked as ${order.status}` };
  }

  // Verify amount matches (allow ±$0.01 tolerance)
  const diff = Math.abs(Number(order.total) - amount);
  if (diff > 0.02) {
    return {
      ok: false,
      reason: `Amount mismatch — Order total: $${order.total}, Paid: $${amount}`
    };
  }

  // Mark as paid
  await query(
    `UPDATE orders SET status='paid', confirmed_at=NOW(),
     seller_note=COALESCE(seller_note||' | ', '') || $2
     WHERE id=$1`,
    [orderId, `Auto-confirmed via Telegram · TX:${txId||'N/A'} · Payer:${payer}`]
  );

  return { ok: true, order };
}

// Send Telegram message
async function sendMessage(chatId, text, parseMode = 'HTML') {
  await fetch(`${API_URL}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
}

// Get updates with long polling
let offset = 0;
async function getUpdates() {
  const res  = await fetch(`${API_URL}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message"]`);
  const data = await res.json();
  return data.result || [];
}

// Process incoming message
async function processUpdate(update) {
  const msg  = update.message;
  if (!msg || !msg.text) return;

  const text     = msg.text;
  const fromId   = String(msg.chat?.id || msg.from?.id);
  const fromName = msg.from?.first_name || 'Unknown';

  console.log(`\n📨 Message from ${fromName} (${fromId}):`);
  console.log(text.slice(0, 200));

  // ── Security: whitelist check ───────────────────────────────
  const ALLOWED = (process.env.TELEGRAM_ALLOWED_IDS || CHAT_ID).split(',').map(s=>s.trim());
  if (!ALLOWED.includes(fromId)) {
    console.log(`🚫 Blocked: ${fromName} (${fromId})`);
    await sendMessage(fromId, '🚫 This bot is private. Unauthorized access.');
    return;
  }

  // Only process from ABA notification group/channel
  // Accept from our chat ID or forwarded messages
  const isFromABA = text.includes('ABA PAY') || text.includes('ABA Mobile') ||
                    text.includes('ត្រូវបានបង់') || text.includes('BARDS by P.LOK') ||
                    text.includes('BARDS SHOP');

  if (!isFromABA) {
    // Handle manual commands from seller
    if (text.startsWith('/confirm ')) {
      const parts   = text.split(' ');
      const orderId = parts[1]?.toUpperCase();
      if (!orderId) { await sendMessage(fromId, '❌ Usage: /confirm ORDER_ID'); return; }
      const r = await query("UPDATE orders SET status='paid', confirmed_at=NOW() WHERE id=$1 RETURNING id,total", [orderId]);
      if (!r.rows.length) { await sendMessage(fromId, `❌ Order <code>${orderId}</code> not found`, 'HTML'); return; }
      await sendMessage(fromId, `✅ Order <code>${orderId}</code> manually confirmed!\nTotal: $${r.rows[0].total}`, 'HTML');
      return;
    }

    if (text === '/pending') {
      const r = await query("SELECT id,total,created_at FROM orders WHERE status='pending_verification' ORDER BY created_at DESC LIMIT 10");
      if (!r.rows.length) { await sendMessage(fromId, '✅ No pending orders!'); return; }
      const list = r.rows.map(o => `• <code>${o.id}</code> — $${o.total}`).join('\n');
      await sendMessage(fromId, `📋 <b>Pending Orders (${r.rows.length})</b>\n\n${list}\n\nUse /confirm ORDER_ID to confirm`, 'HTML');
      return;
    }

    if (text === '/stats') {
      const [paid, pending, total] = await Promise.all([
        query("SELECT COUNT(*),SUM(total) FROM orders WHERE status='paid'"),
        query("SELECT COUNT(*) FROM orders WHERE status='pending_verification'"),
        query("SELECT COUNT(*),SUM(total) FROM orders WHERE status NOT IN ('cancelled','expired')"),
      ]);
      await sendMessage(fromId,
        `📊 <b>Bards Stats</b>\n\n` +
        `✅ Paid: ${paid.rows[0].count} orders · $${Number(paid.rows[0].sum||0).toFixed(2)}\n` +
        `⏳ Pending: ${pending.rows[0].count} orders\n` +
        `📦 Total: ${total.rows[0].count} orders · $${Number(total.rows[0].sum||0).toFixed(2)}`,
        'HTML'
      );
      return;
    }

    if (text === '/help') {
      await sendMessage(fromId,
        `🤖 <b>Bards Bot Commands</b>\n\n` +
        `/pending — List pending orders\n` +
        `/confirm ORDER_ID — Manually confirm order\n` +
        `/stats — View store stats\n\n` +
        `<i>Bot also auto-confirms when ABA payment notification is forwarded here</i>`,
        'HTML'
      );
      return;
    }
    return;
  }

  // Parse ABA payment notification
  const parsed = parseABAMessage(text);
  console.log('📊 Parsed:', parsed);

  if (!parsed.amount) {
    console.log('⚠️  Could not parse amount, skipping');
    return;
  }

  if (!parsed.orderId) {
    // No order ID in note — alert seller to confirm manually
    await sendMessage(CHAT_ID,
      `⚠️ <b>Payment received — No Order ID in note</b>\n\n` +
      `💰 Amount: <b>$${parsed.amount}</b>\n` +
      `👤 Payer: ${parsed.payer}\n` +
      `🔢 TX: ${parsed.txId||'N/A'}\n\n` +
      `Use /pending to see pending orders and /confirm ORDER_ID`,
      'HTML'
    );
    return;
  }

  // Try to confirm
  const result = await confirmOrder(parsed.orderId, parsed.amount, parsed.txId, parsed.payer);

  if (result.ok) {
    console.log(`✅ Auto-confirmed order ${parsed.orderId}`);
    await sendMessage(CHAT_ID,
      `✅ <b>Payment Auto-Confirmed!</b>\n\n` +
      `📦 Order: <code>${parsed.orderId}</code>\n` +
      `💰 Amount: <b>$${parsed.amount}</b>\n` +
      `👤 Payer: ${parsed.payer}\n` +
      `🔢 TX: ${parsed.txId||'N/A'}\n\n` +
      `<i>Order status → Paid ✓</i>`,
      'HTML'
    );
  } else {
    console.log(`❌ Could not confirm: ${result.reason}`);
    await sendMessage(CHAT_ID,
      `❌ <b>Could not auto-confirm</b>\n\n` +
      `📦 Order: <code>${parsed.orderId}</code>\n` +
      `💰 Paid: $${parsed.amount}\n` +
      `⚠️ Reason: ${result.reason}\n\n` +
      `Check manually with /pending`,
      'HTML'
    );
  }
}

// Main polling loop
async function run() {
  console.log('\n🤖 Bards Telegram Bot started!');
  console.log(`📱 Bot Token: ${BOT_TOKEN.slice(0,10)}...`);
  console.log(`💬 Chat ID: ${CHAT_ID}`);
  console.log('\nListening for ABA payment notifications...');
  console.log('Commands: /pending  /confirm ORDER_ID  /stats  /help\n');

  // Send startup message
  await sendMessage(CHAT_ID,
    `🤖 <b>Bards Bot Online!</b>\n\n` +
    `✅ Auto-confirm enabled\n` +
    `📱 Listening for ABA payments\n\n` +
    `/help for commands`,
    'HTML'
  ).catch(() => {});

  while (true) {
    try {
      const updates = await getUpdates();
      for (const update of updates) {
        offset = update.update_id + 1;
        await processUpdate(update);
      }
    } catch(e) {
      console.error('Poll error:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

run();
