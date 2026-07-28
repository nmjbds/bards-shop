const express = require('express');
const { requireAuth } = require('../middleware/auth');
const coupons = require('./coupons');
const router = express.Router();

// Mounted at /api/coupons on the customer server (2026-07-28, multi-domain
// split, Phase 0). Only the checkout-facing routes — coupon preview at
// checkout, and the legacy used_count bump — belong here; the /seller CRUD
// group (routes/couponsSeller.js) is a seller-server-only concern.
//
// Handlers are reused from routes/coupons.js's additive exports, not
// reimplemented, so there is exactly one copy of the discount-computation
// logic regardless of how many servers mount a route to it.
router.post('/validate', coupons.validateHandler);
router.post('/use', requireAuth, coupons.useHandler);

module.exports = router;
