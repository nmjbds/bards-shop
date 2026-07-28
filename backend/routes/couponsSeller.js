const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const coupons = require('./coupons');
const router = express.Router();

// Mounted at /api/coupons on the seller server (2026-07-28, multi-domain
// split, Phase 0). Only the /seller CRUD group — seller-coupons.html is
// where this is managed, and admin reaches the same page via the
// "Seller Hub" cross-hub link from admin.bardskh.com (there's no separate
// admin coupons page — see CLAUDE.md §5/§6.3). The public checkout-facing
// /validate route (routes/couponsPublic.js) is a customer-server-only
// concern; checkout never happens on seller.bardskh.com.
//
// Handlers/schemas/gate are reused from routes/coupons.js's additive
// exports, not reimplemented, so there is exactly one copy of the
// ownership/discount logic regardless of how many servers mount a route to it.
router.get('/seller', requireAuth, coupons.requireSeller, coupons.sellerListHandler);
router.post('/seller', requireAuth, coupons.requireSeller, validate(coupons.couponCreateSchema), coupons.sellerCreateHandler);
router.patch('/seller/:id', requireAuth, coupons.requireSeller, validate(coupons.couponUpdateSchema), coupons.sellerUpdateHandler);
router.delete('/seller/:id', requireAuth, coupons.requireSeller, coupons.sellerDeleteHandler);

module.exports = router;
