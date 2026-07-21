const { query, pool } = require('../db');
const aba = require('./abaPayway');

// The ONLY path that is allowed to mark an order 'paid'. Both the client's
// POST /api/payment/confirm/:orderId and ABA's own webhook call into this —
// neither is trusted directly; both just trigger a re-check against ABA's
// check-transaction-2 API, which is the actual source of truth.
async function settleOrderPayment(orderId) {
  const orderRes = await query('SELECT * FROM orders WHERE id=$1', [orderId]);
  const order = orderRes.rows[0];
  if (!order) return { ok: false, httpStatus: 404, error: 'Order not found.' };

  // Already in a terminal (or non-payable) state — idempotent no-op.
  if (!['pending', 'pending_verification'].includes(order.status)) {
    return { ok: true, order, status: order.status };
  }

  const payRes = await query(
    'SELECT * FROM payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1',
    [orderId]
  );
  const payment = payRes.rows[0];
  if (!payment || !payment.provider_ref) {
    return { ok: false, httpStatus: 409, error: 'No ABA PayWay transaction on file for this order yet.' };
  }

  const { httpOk, data } = await aba.checkTransaction(payment.provider_ref);
  if (!httpOk) {
    return { ok: false, httpStatus: 502, error: 'ABA PayWay check-transaction request failed.' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE payments SET raw_response=$1 WHERE id=$2', [JSON.stringify(data), payment.id]);

    if (aba.isPaid(data)) {
      await client.query("UPDATE payments SET status='success', paid_at=NOW() WHERE id=$1", [payment.id]);
      const upd = await client.query(
        `UPDATE orders SET status='paid', confirmed_at=NOW()
         WHERE id=$1 AND status IN ('pending','pending_verification')
         RETURNING *`,
        [orderId]
      );
      await client.query('COMMIT');
      return { ok: true, order: upd.rows[0] || order, status: 'paid' };
    }

    await client.query('COMMIT');
    return { ok: true, order, status: order.status }; // ABA hasn't seen the payment yet
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { settleOrderPayment };
