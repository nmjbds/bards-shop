require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// Phase 5 Step 1 backfill (2026-07-25) — builds order_shops/order_items from
// existing orders.items JSONB. Purely additive: never touches orders.items,
// never deletes anything, and is idempotent per order — an order that
// already has any order_shops row (checked in one query up front, not one
// query per order) is skipped entirely on every subsequent run, so re-running
// this after a partial failure or on every future boot is always safe. Each
// order's insert runs in its own small transaction, chunked, so one bad order
// can't take down the whole run and a large backlog doesn't hold one giant
// transaction open for the whole boot.
async function backfillOrderShops() {
  const CHUNK = 200;
  const stats = { ordersProcessed: 0, orderShopsCreated: 0, orderItemsCreated: 0, ordersFailed: 0 };

  const doneRes = await query('SELECT DISTINCT order_id FROM order_shops');
  const done = new Set(doneRes.rows.map(r => r.order_id));

  // Same "exactly one shop exists → unambiguous fallback" trick already used
  // for products.shop_id — only applies here, to historical data. Items with
  // no shop_id at all (orders that predate Phase 4 Step 4) or an explicit
  // null (product had no shop_id at purchase time) fall back to this if
  // it's unambiguous; if more than one shop exists, they're left under a
  // genuine NULL order_shops row instead of guessing wrong.
  const shopsRes = await query('SELECT id FROM shops');
  const singleShopId = shopsRes.rows.length === 1 ? shopsRes.rows[0].id : null;

  const ordersRes = await query(
    `SELECT id, items, status, seller_note, tracking_number, cancelled_by, cancel_reason, created_at
     FROM orders ORDER BY created_at ASC`
  );
  const todo = ordersRes.rows.filter(o => !done.has(o.id));

  for (let i = 0; i < todo.length; i += CHUNK) {
    for (const order of todo.slice(i, i + CHUNK)) {
      const items = Array.isArray(order.items) ? order.items : [];
      if (!items.length) { stats.ordersProcessed++; continue; }

      const groups = new Map(); // shop_id (or null) -> items[]
      for (const item of items) {
        const key = item?.shop_id || null;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const [rawShopId, groupItems] of groups) {
          const resolvedShopId = rawShopId || singleShopId || null;
          const subtotal = Math.round(
            groupItems.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0) * 100
          ) / 100;

          const osRes = await client.query(
            `INSERT INTO order_shops(order_id, shop_id, subtotal, status, seller_note, tracking_number, cancelled_by, cancel_reason, created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [order.id, resolvedShopId, subtotal, order.status, order.seller_note,
             order.tracking_number, order.cancelled_by, order.cancel_reason, order.created_at]
          );
          const orderShopId = osRes.rows[0].id;
          stats.orderShopsCreated++;

          for (const item of groupItems) {
            await client.query(
              `INSERT INTO order_items(order_shop_id, product_id, name, price, image, color, size, quantity)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
              [orderShopId, item.id || null, item.name || 'Unknown', Number(item.price || 0),
               item.image || null, item.color || null, item.size || null, Number(item.quantity || 1)]
            );
            stats.orderItemsCreated++;
          }
        }
        await client.query('COMMIT');
        stats.ordersProcessed++;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        stats.ordersFailed++;
        console.error(`[BACKFILL order_shops] order ${order.id} failed:`, e.message);
      } finally {
        client.release();
      }
    }
  }

  return stats;
}

async function initDb() {
  try {
    // enable pg_trgm สำหรับ ILIKE search บน index
    await query('CREATE EXTENSION IF NOT EXISTS pg_trgm').catch(()=>{});
    await query(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT        NOT NULL,
        email       TEXT        UNIQUE,
        password    TEXT,
        avatar      TEXT,
        provider    TEXT        NOT NULL DEFAULT 'email',
        provider_id TEXT,
        role        TEXT        NOT NULL DEFAULT 'customer',
        joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ
      );

      -- Add missing columns to users if they don't exist
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar      TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS provider    TEXT NOT NULL DEFAULT 'email';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role        TEXT NOT NULL DEFAULT 'customer';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ;

      -- Orders table
      CREATE TABLE IF NOT EXISTS orders (
        id           TEXT          PRIMARY KEY,
        user_id      UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        items        JSONB         NOT NULL DEFAULT '[]',
        subtotal     NUMERIC(10,2) NOT NULL DEFAULT 0,
        shipping     NUMERIC(10,2) NOT NULL DEFAULT 0,
        total        NUMERIC(10,2) NOT NULL DEFAULT 0,
        address      JSONB         NOT NULL DEFAULT '{}',
        status       TEXT          NOT NULL DEFAULT 'pending',
        payment_ref  TEXT,
        qr_payload   TEXT,
        seller_note  TEXT,
        expires_at   TIMESTAMPTZ,
        confirmed_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_note  TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ref  TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS qr_payload   TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number   TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount          NUMERIC(10,2) NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code       TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by      TEXT; -- 'customer' | 'seller' | 'system'
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason     TEXT;
      -- pay_token: required to view GET /api/payment/link/:orderId (public
      -- endpoint, returns address/phone/QR). Without it, the order id alone
      -- (only ~4 base36 random chars) is guessable. Backfilled below in JS
      -- since it needs real per-row randomness that plain SQL can't do
      -- without pgcrypto.
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_token         TEXT;

      -- Payments (ABA PayWay) — order_id is TEXT to match orders.id (not UUID)
      CREATE TABLE IF NOT EXISTS payments (
        id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id      TEXT          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        provider      TEXT          NOT NULL DEFAULT 'aba_payway',
        provider_ref  TEXT,         -- ABA tran_id (== orders.id in this app)
        amount        NUMERIC(10,2) NOT NULL,
        status        TEXT          NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','success','failed')),
        raw_response  JSONB,        -- last ABA API response, kept for debugging/audit
        paid_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider_ref) WHERE provider_ref IS NOT NULL;

      -- Wishlists
      CREATE TABLE IF NOT EXISTS wishlists (
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL,
        added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, product_id)
      );

      -- Password resets
      CREATE TABLE IF NOT EXISTS password_resets (
        user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE PRIMARY KEY,
        code       TEXT        NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used       BOOLEAN     NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Addresses
      CREATE TABLE IF NOT EXISTS addresses (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT        NOT NULL,
        phone       TEXT,
        address     TEXT        NOT NULL,
        city        TEXT,
        province    TEXT,
        postal_code TEXT,
        is_default  BOOLEAN     NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE addresses ADD COLUMN IF NOT EXISTS user_id     UUID REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE addresses ADD COLUMN IF NOT EXISTS name        TEXT;
      ALTER TABLE addresses ADD COLUMN IF NOT EXISTS phone       TEXT;
      ALTER TABLE addresses ADD COLUMN IF NOT EXISTS address     TEXT;
      ALTER TABLE addresses ADD COLUMN IF NOT EXISTS city        TEXT;
      ALTER TABLE addresses ADD COLUMN IF NOT EXISTS province    TEXT;
      ALTER TABLE addresses ADD COLUMN IF NOT EXISTS postal_code TEXT;
      ALTER TABLE addresses ADD COLUMN IF NOT EXISTS is_default  BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE addresses ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();

      -- Migration: DB ที่มีอยู่ก่อนหน้านี้บางชุดถูกสร้างด้วย schema รุ่นเก่ากว่า ที่ใช้ชื่อคอลัมน์
      -- full_name/address_line (NOT NULL, ไม่มี default) แทน name/address — ALTER ADD COLUMN IF NOT
      -- EXISTS ด้านบนเลยแค่เพิ่ม name/address เข้าไปแบบว่างเปล่า ไม่ได้ย้ายข้อมูลเก่ามาให้ ทำให้ที่อยู่ที่
      -- ผู้ใช้จริงเคยบันทึกไว้อยู่ในคอลัมน์เก่า (full_name/address_line) แต่โค้ดปัจจุบันอ่าน/เขียนที่คอลัมน์
      -- ใหม่ (name/address) — backfill ข้อมูลเก่ามาลงคอลัมน์ใหม่ครั้งเดียว แล้วปลด NOT NULL ของคอลัมน์เก่า
      -- ทิ้ง (ไม่ลบคอลัมน์/ข้อมูลเดิม แค่ไม่บังคับให้ INSERT ใหม่ต้องเติมมันอีกต่อไป)
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='addresses' AND column_name='full_name') THEN
          UPDATE addresses SET name = full_name WHERE name IS NULL AND full_name IS NOT NULL;
          ALTER TABLE addresses ALTER COLUMN full_name DROP NOT NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='addresses' AND column_name='address_line') THEN
          UPDATE addresses SET address = address_line WHERE address IS NULL AND address_line IS NOT NULL;
          ALTER TABLE addresses ALTER COLUMN address_line DROP NOT NULL;
        END IF;
      END $$;

      -- Coupons
      CREATE TABLE IF NOT EXISTS coupons (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        code        TEXT        UNIQUE NOT NULL,
        description TEXT,
        type        TEXT        NOT NULL CHECK (type IN ('percent','fixed','freeship')),
        value       NUMERIC(10,2) DEFAULT 0,
        min_order   NUMERIC(10,2) DEFAULT 0,
        usage_limit INTEGER     DEFAULT 0,
        used_count  INTEGER     DEFAULT 0,
        start_date  DATE,
        expiry_date DATE,
        active      BOOLEAN     NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE coupons ADD COLUMN IF NOT EXISTS description TEXT;

      -- Products
      CREATE TABLE IF NOT EXISTS products (
        id          TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name        TEXT          NOT NULL,
        description TEXT,
        price       NUMERIC(10,2) NOT NULL,
        sale_price  NUMERIC(10,2),
        category    TEXT,
        images      JSONB         NOT NULL DEFAULT '[]',
        colors      JSONB         NOT NULL DEFAULT '[]',
        sizes       JSONB         NOT NULL DEFAULT '[]',
        tags        JSONB         NOT NULL DEFAULT '[]',
        stock       INTEGER       DEFAULT 100,
        is_new      BOOLEAN       NOT NULL DEFAULT false,
        is_active   BOOLEAN       NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
      -- Migration: เพิ่ม columns ใหม่ถ้ายังไม่มี
      ALTER TABLE products ADD COLUMN IF NOT EXISTS tags       JSONB NOT NULL DEFAULT '[]';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      -- ── Migration: แปลง text[] → JSONB ถ้า DB เก่าสร้างด้วย text[] ──
      -- ต้อง DROP DEFAULT ก่อน เพราะ DEFAULT '{}' ของ text[] cast ไป jsonb ตรงๆ ไม่ได้
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='products' AND column_name='images' AND data_type='ARRAY'
        ) THEN
          ALTER TABLE products ALTER COLUMN images DROP DEFAULT;
          ALTER TABLE products ALTER COLUMN colors DROP DEFAULT;
          ALTER TABLE products ALTER COLUMN sizes  DROP DEFAULT;
          ALTER TABLE products ALTER COLUMN tags   DROP DEFAULT;

          ALTER TABLE products ALTER COLUMN images TYPE JSONB USING to_jsonb(images);
          ALTER TABLE products ALTER COLUMN colors TYPE JSONB USING to_jsonb(colors);
          ALTER TABLE products ALTER COLUMN sizes  TYPE JSONB USING to_jsonb(sizes);
          ALTER TABLE products ALTER COLUMN tags   TYPE JSONB USING to_jsonb(tags);

          ALTER TABLE products ALTER COLUMN images SET DEFAULT '[]'::jsonb;
          ALTER TABLE products ALTER COLUMN colors SET DEFAULT '[]'::jsonb;
          ALTER TABLE products ALTER COLUMN sizes  SET DEFAULT '[]'::jsonb;
          ALTER TABLE products ALTER COLUMN tags   SET DEFAULT '[]'::jsonb;
        END IF;
      END $$;
      -- Indexes สำหรับ search/filter/pagination (สำคัญมากสำหรับสินค้าหลายหมื่นชิ้น)
      CREATE INDEX IF NOT EXISTS idx_products_active    ON products(is_active) WHERE is_active=true;
      CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category)  WHERE is_active=true;
      CREATE INDEX IF NOT EXISTS idx_products_new       ON products(is_new)    WHERE is_active=true AND is_new=true;
      CREATE INDEX IF NOT EXISTS idx_products_price     ON products(price)     WHERE is_active=true;
      CREATE INDEX IF NOT EXISTS idx_products_created   ON products(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin(name gin_trgm_ops);

      -- Cart table
      CREATE TABLE IF NOT EXISTS carts (
      user_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT          NOT NULL,
      name       TEXT          NOT NULL,
      price      NUMERIC(10,2) NOT NULL,
      image      TEXT,
      color      TEXT          NOT NULL DEFAULT '',
      size       TEXT          NOT NULL DEFAULT '',
      quantity   INTEGER       NOT NULL DEFAULT 1,
      added_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, product_id, color, size)
      );

      -- Migration: rename "active" → "is_active" ถ้าตารางเดิมใช้ชื่อเก่า
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='products' AND column_name='active'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='products' AND column_name='is_active'
        ) THEN
          ALTER TABLE products RENAME COLUMN active TO is_active;
        END IF;
      END $$;
      -- เพิ่ม columns ที่อาจขาดในตารางเดิม
      ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price  NUMERIC(10,2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS is_new      BOOLEAN DEFAULT false;

      -- Refresh tokens — one row per issued/rotated session. token_hash is a
      -- sha256 of the raw token; the raw value is never stored server-side.
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash   TEXT        NOT NULL,
        expires_at   TIMESTAMPTZ NOT NULL,
        revoked_at   TIMESTAMPTZ,
        replaced_by  UUID        REFERENCES refresh_tokens(id),
        user_agent   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

      -- Shops (multi-vendor, Phase 4) — one shop per seller for now
      -- (owner_user_id UNIQUE). status: pending | approved | rejected | suspended
      CREATE TABLE IF NOT EXISTS shops (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        name          TEXT        NOT NULL,
        description   TEXT,
        logo          TEXT,
        status        TEXT        NOT NULL DEFAULT 'pending',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_shops_owner  ON shops(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_shops_status ON shops(status);

      -- Migration (one-time grandfather-in): accounts that were already
      -- seller/admin before the shops system existed get an auto-approved
      -- shop so they aren't locked out of product management. This does NOT
      -- apply going forward — new sellers go through apply -> admin approve.
      INSERT INTO shops (owner_user_id, name, status)
      SELECT id, COALESCE(NULLIF(TRIM(name), ''), 'My Shop'), 'approved'
      FROM users
      WHERE role IN ('seller','admin')
        AND id NOT IN (SELECT owner_user_id FROM shops)
      ON CONFLICT (owner_user_id) DO NOTHING;

      -- Phase 4 Step 3: products belong to a shop. Nullable (not every
      -- product is guaranteed a shop the instant this column appears) —
      -- app code (routes/seller.js) enforces "must have an approved shop"
      -- at create-time; this column just needs to exist first.
      ALTER TABLE products ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id);
      CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);

      -- Backfill (unambiguous case only): if exactly one shop exists at
      -- migration time, every orphan product obviously belongs to it. If
      -- more than one shop already exists, don't guess — leave shop_id
      -- NULL and let it be fixed manually (ambiguous which seller owns it).
      DO $$ BEGIN
        IF (SELECT COUNT(*) FROM shops) = 1 THEN
          UPDATE products SET shop_id = (SELECT id FROM shops LIMIT 1) WHERE shop_id IS NULL;
        END IF;
      END $$;

      -- Coupon access control (2026-07-25) — nullable: NULL means a
      -- platform-wide coupon usable by/visible to every seller (this is also
      -- what every existing coupon becomes automatically, since they were
      -- already de facto shared across all sellers before this column
      -- existed — no backfill needed, NULL preserves current behaviour for
      -- them exactly). A non-null shop_id scopes GET/PATCH/DELETE /seller in
      -- routes/coupons.js to that shop's owner + admin only. Deliberately NOT
      -- used anywhere in checkout discount math yet — a shop-scoped coupon
      -- still discounts the whole order subtotal today, same as always; only
      -- who can see/edit/delete the coupon row is scoped by this column (see
      -- CLAUDE.md's Phase 5 planning notes for why the discount-math half is
      -- deferred).
      ALTER TABLE coupons ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id);
      CREATE INDEX IF NOT EXISTS idx_coupons_shop ON coupons(shop_id);

      -- Phase 5 Step 1 (2026-07-25) — order_shops/order_items are a
      -- normalized, per-shop breakdown of orders.items, built ADDITIVELY
      -- alongside it. orders.items JSONB is NOT touched, dropped, or
      -- replaced by this — it remains the only thing any existing
      -- endpoint/page reads. These two tables exist purely so a future step
      -- can migrate reads over one at a time and eventually support real
      -- per-shop settlement (see CLAUDE.md's Phase 5 planning notes for the
      -- full design — 1 payment/1 orders row per checkout still, split into
      -- N order_shops rows, one per shop involved).
      -- shop_id nullable: an item with no attributable shop (ambiguous
      -- historical data, or a product that genuinely had none at purchase
      -- time) still needs somewhere to live — same "leave it null rather
      -- than guess wrong" precedent as products.shop_id.
      CREATE TABLE IF NOT EXISTS order_shops (
        id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id        TEXT          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        shop_id         UUID          REFERENCES shops(id),
        subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
        status          TEXT          NOT NULL DEFAULT 'pending',
        seller_note     TEXT,
        tracking_number TEXT,
        cancelled_by    TEXT,
        cancel_reason   TEXT,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ
      );
      -- Not a hard uniqueness guarantee against re-running the backfill (two
      -- NULL shop_ids don't conflict under Postgres's NULL-is-distinct rule)
      -- — the real idempotency guard is the backfill script's own "does this
      -- order already have any order_shops row at all" check before it does
      -- anything. This just blocks the one case it *can* catch for free: the
      -- same non-null shop appearing twice for the same order.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_order_shops_unique ON order_shops(order_id, shop_id) WHERE shop_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_order_shops_order ON order_shops(order_id);
      CREATE INDEX IF NOT EXISTS idx_order_shops_shop  ON order_shops(shop_id);

      -- No FK on product_id (matches orders.items' existing convention) — a
      -- deleted/deactivated product must not make historical order lines
      -- unreadable. price/name are a snapshot at purchase time, also matching
      -- what orders.items already stores.
      CREATE TABLE IF NOT EXISTS order_items (
        id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        order_shop_id UUID          NOT NULL REFERENCES order_shops(id) ON DELETE CASCADE,
        product_id    TEXT,
        name          TEXT          NOT NULL,
        price         NUMERIC(10,2) NOT NULL,
        image         TEXT,
        color         TEXT,
        size          TEXT,
        quantity      INTEGER       NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_shop ON order_items(order_shop_id);

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_orders_user     ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wishlist_user   ON wishlists(user_id);
      CREATE INDEX IF NOT EXISTS idx_addresses_user  ON addresses(user_id);
      CREATE INDEX IF NOT EXISTS idx_products_cat    ON products(category) WHERE is_active=true;
      CREATE INDEX IF NOT EXISTS idx_coupons_code    ON coupons(UPPER(code));
      CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
      CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pay_token ON orders(pay_token) WHERE pay_token IS NOT NULL;
    `);

    // One-time backfill: orders created before pay_token existed don't have
    // one yet. Generated per-row in JS (crypto.randomBytes) rather than SQL
    // since that needs pgcrypto, which isn't guaranteed to be installed.
    const untokenized = await query('SELECT id FROM orders WHERE pay_token IS NULL');
    for (const row of untokenized.rows) {
      await query('UPDATE orders SET pay_token=$1 WHERE id=$2', [crypto.randomBytes(32).toString('hex'), row.id]);
    }

    // Phase 5 Step 1 backfill — safe to run every boot (idempotent, skips
    // anything already done in one query up front — see backfillOrderShops()).
    const backfillStats = await backfillOrderShops();
    if (backfillStats.orderShopsCreated || backfillStats.ordersFailed) {
      console.log(
        `[BACKFILL order_shops] processed ${backfillStats.ordersProcessed} order(s), ` +
        `created ${backfillStats.orderShopsCreated} order_shops / ${backfillStats.orderItemsCreated} order_items row(s)` +
        (backfillStats.ordersFailed ? `, ${backfillStats.ordersFailed} order(s) FAILED (see errors above)` : '')
      );
    }

    console.log('✅ Database ready');

    // Best-effort cleanup — refresh_tokens grows one row per login and one
    // per rotation, no cron/migration framework in this project to do it
    // elsewhere, so sweep long-dead rows on every boot instead.
    await query(
      `DELETE FROM refresh_tokens WHERE revoked_at < NOW() - INTERVAL '60 days' OR expires_at < NOW() - INTERVAL '60 days'`
    ).catch(e => console.warn('[DB] refresh_tokens cleanup skipped:', e.message));
  } catch(e) {
    console.error('❌ DB init error:', e.message);
    throw e;
  }
}

module.exports = { query, pool, initDb, backfillOrderShops };