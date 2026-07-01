require('dotenv').config();
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
    `);
    console.log('✅ Database ready');
  } catch(e) {
    console.error('❌ DB init error:', e.message);
    throw e;
  }
}

module.exports = { query, pool, initDb };