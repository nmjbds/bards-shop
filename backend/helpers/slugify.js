// backend/helpers/slugify.js
//
// Turns a display name (e.g. a shop's `name`) into a URL-safe slug:
// lowercase, non-alphanumeric runs collapsed to a single hyphen, leading/
// trailing hyphens trimmed. Used by routes/shops.js's POST /apply to
// auto-generate `store_slug` from `name` when the caller doesn't supply one
// (see docs/tiktok-seller-onboarding-flow.md — the target flow doesn't ask
// for a store URL at signup at all).
//
// A name written entirely in a non-Latin script (e.g. Khmer — this is a
// Cambodia-market storefront) collapses to an empty string once every
// character is stripped; SLUG_FALLBACK covers that case so the caller
// always gets a non-empty, regex-valid candidate to try/retry against the
// idx_shops_store_slug unique index.
const SLUG_FALLBACK = 'shop';
const MAX_BASE_LENGTH = 60; // leaves headroom under storeSlugSchema's max(80) once a retry suffix (e.g. "-12") is appended

function slugify(text) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, ''); // slice() above can leave a trailing hyphen mid-word

  return base || SLUG_FALLBACK;
}

module.exports = { slugify };
