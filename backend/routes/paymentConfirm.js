const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { confirmHandler } = require('./payment');
const router = express.Router();

// Mounted at /api/payment on the seller./admin. servers (2026-07-28,
// multi-domain split, Phase 0). Those servers don't run checkout — no cart,
// no ABA "create purchase" call, no QR generation — but seller-orders.html
// and admin-orders.html's "CHECK PAYMENT STATUS" button both call
// POST /api/payment/confirm/:orderId directly, so this one route needs to
// exist there too.
//
// Reuses confirmHandler from routes/payment.js (not reimplemented), so the
// actual ABA verification logic (services/paymentSettlement.js's
// settleOrderPayment, which this handler calls) has exactly one copy.
router.post('/confirm/:orderId', requireAuth, confirmHandler);

module.exports = router;
