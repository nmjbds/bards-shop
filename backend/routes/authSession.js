const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { refreshHandler, logoutHandler, meHandler } = require('../services/session');
const router = express.Router();

// Mounted at /api/auth on the seller./admin. servers (2026-07-28, multi-domain
// split, Phase 0/1). Those two servers have no signin/signup/OAuth pages of
// their own — a signed-out visitor is redirected to bardskh.com/signin — so
// they only need session maintenance (refresh/logout/me), not the full
// account-creation surface (signup, OAuth strategies, password reset, avatar
// upload, etc.) that routes/auth.js carries for the customer server.
//
// Imports straight from services/session.js, NOT routes/auth.js — requiring
// routes/auth.js also runs its top-level `passport.use(new GoogleStrategy)`
// call, which throws synchronously if GOOGLE_CLIENT_ID isn't set. A freshly
// created Render service has no env vars configured until you add them, so
// that path would crash this server at boot (caught in Phase 1 prep by
// simulating an empty environment locally — see services/session.js's
// header comment for the full story). Going through services/session.js
// directly means this file never touches passport/OAuth/nodemailer/R2 at
// all, and there is still exactly one copy of the security-sensitive logic
// (refresh-token hashing/rotation/reuse detection, cookie flags, suspension
// checks) in the whole codebase regardless of how many servers mount a
// route to it.
router.post('/refresh', refreshHandler);
router.post('/logout', logoutHandler);
router.get('/me', requireAuth, meHandler);

module.exports = router;
