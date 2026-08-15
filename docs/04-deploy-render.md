# 04 — Deploy บน Render.com (ครั้งแรก)

> เขียนขึ้น 2026-07-21 ก่อน deploy จริงครั้งแรก — ยังไม่เคย deploy มาก่อนเลย
> อ้างอิงจาก `CLAUDE.md` หัวข้อ 7 (Deployment) และหัวข้อ 13 (Environment Variables)
> **สถานะสำคัญที่พบตอนเตรียม deploy:** `DATABASE_URL` ปัจจุบันชี้ไป `localhost` — ยังไม่มี cloud DB เลย
> ต้องสร้างใหม่ + ย้ายข้อมูล (มี user จริง 6, สินค้า 12, order 129, ที่อยู่ลูกค้าจริง 2 คน) เป็นขั้นตอนแรก

> ## ⚠️ อัปเดตหลัง deploy จริง (2026-07-21, พบภายหลัง) — DB จริงคือ Supabase ไม่ใช่ Render Postgres
> แผนในหัวข้อ 2 ด้านล่าง (สร้าง Render Postgres + `pg_dump`/`pg_restore` ย้ายข้อมูลเข้าไป) **ไม่ได้ถูกทำตาม
> จริง** — ระหว่างทางพบว่าเว็บที่ deploy จริงต่อกับ **Supabase Postgres** (host
> `aws-1-ap-southeast-1.pooler.supabase.com`) อยู่แล้ว ใช้งานได้จริง ไม่มีเหตุผลทางเทคนิคที่ต้องย้ายไป
> Render Postgres ตามแผนเดิม เจ้าของโปรเจกต์ตัดสินใจ**ใช้ Supabase ต่อไป**
>
> ผลคือมี **Render Postgres instance ที่สร้างไว้ตามหัวข้อ 2 (ชื่อ DB `bards_db_4rob`) ค้างอยู่โดยไม่ได้ใช้
> งานจริง** (ไม่มี table แม้แต่ตัวเดียว — ไม่เคย restore ข้อมูลเข้าไปจริง) — **เจ้าของโปรเจกต์ต้องเข้า Render
> Dashboard ไปลบ Postgres instance นี้เองด้วยมือ** (agent ไม่ได้รันคำสั่งลบให้ ตามที่ตกลงกันไว้ว่างานลบ
> resource บน cloud ต้องให้เจ้าของโปรเจกต์ทำเองผ่าน dashboard):
> - [ ] เข้า Render Dashboard → หา Postgres instance ชื่อ `bards-db`/`bards_db_4rob` (ตามที่ตั้งไว้ในหัวข้อ
>       2.1) → ลบทิ้ง (กัน confusion ในอนาคต + ไม่เสียโควต้า/บิลฟรีโดยเปล่าประโยชน์)
> - [ ] ตรวจ Web Service (`bards-shop`) → Environment → `DATABASE_URL` ให้ชี้ไป Supabase connection string
>       ตัวเดียวกับที่ local `.env` ใช้ (ไม่ใช่ Render Postgres ตัวไหนเลย)
> - [ ] หัวข้อ 2/2.1/2.2/2.3 ด้านล่างนี้ **เก็บไว้เป็นประวัติเฉยๆ** (เผื่อวันหน้าอยากย้ายจริง) — ไม่ต้องทำตาม
>       สำหรับ deploy ที่ใช้งานอยู่ตอนนี้
> - อัปเดตแล้วที่ `CLAUDE.md` หัวข้อ 1/7/13 ให้ตรงกับข้อเท็จจริงนี้เช่นกัน

---

## 0. สิ่งที่ต้องมีก่อนเริ่ม

- โค้ดถูก push ขึ้น `https://github.com/nmjbds/bards-shop.git` (branch `main`) แล้ว ✅ (ทำไปแล้วตอนนี้)
- **repo root ของ git คือ `bards-new/`** ไม่ใช่ root ของโปรเจกต์ทั้งหมด — เวลาตั้งค่า Render ต้องระบุ
  **Root Directory = `backend`** (สัมพัทธ์กับ repo root) เพราะ `package.json`/`server.js` อยู่ที่
  `bards-new/backend/` ส่วน static frontend อยู่ที่ `bards-new/public/` (ถูก serve ผ่าน
  `path.join(__dirname,'../public')` ใน `server.js` ซึ่งจะทำงานถูกต้องเองแม้ตั้ง Root Directory เป็น
  `backend` เพราะ Render clone ทั้ง repo มาเสมอ ไม่ใช่แค่โฟลเดอร์ที่ระบุ)
- **สังเกตเห็นว่า `server.js`'s CORS allow-list มี `https://bards-shop.onrender.com` hardcode ไว้อยู่แล้ว**
  แปลว่าตอนตั้งชื่อ Render Web Service ควรตั้งชื่อ **`bards-shop`** ให้ตรง (Render จะ auto-generate URL
  เป็น `<ชื่อ service>.onrender.com`) ถ้าตั้งชื่ออื่นต้องกลับมาแก้ array `allowed` ใน `server.js` เพิ่มด้วย
- Postgres client tools (`psql`, `pg_dump`) มีอยู่แล้วในเครื่อง (`C:\Program Files\PostgreSQL\17\bin`)
  ใช้สำหรับย้ายข้อมูลในขั้นตอนที่ 2

---

## 1. สมัคร/เข้า Render.com

1. ไปที่ https://render.com → Sign up (แนะนำ sign up ด้วย GitHub account เดียวกับที่มี repo
   `nmjbds/bards-shop` จะได้เชื่อม repo ได้ง่ายและไม่ต้องตั้งค่า deploy key เอง)
2. ยืนยันอีเมลถ้า Render ขอ

---

## 2. สร้าง Postgres Database + ย้ายข้อมูลเดิม

### 2.1 สร้าง DB บน Render

1. Dashboard → **New** → **PostgreSQL**
2. ตั้งชื่อ (เช่น `bards-db`), เลือก region ใกล้ผู้ใช้จริงที่สุด (สิงคโปร์/Singapore ถ้ามี — ใกล้กัมพูชา
   ที่สุดในบรรดา region ที่ Render มีให้เลือก ลด latency)
3. Plan: เริ่มจาก Free หรือ Starter ก็ได้สำหรับทดสอบ (Free tier ของ Render Postgres จะถูกลบอัตโนมัติหลัง
   90 วันถ้าไม่อัปเกรด — ถ้าจะใช้จริงระยะยาวควรอัปเกรดเป็น paid plan ก่อนหรือหลัง verify ว่าทุกอย่างทำงาน
   ก็ได้)
4. กด Create — รอสักครู่จนสถานะเป็น Available
5. เข้าไปที่หน้า database ที่สร้าง → หา **"External Database URL"** (ไม่ใช่ Internal — Internal ใช้ได้
   เฉพาะตอน service อื่นบน Render เชื่อมกันเอง, External ใช้สำหรับต่อจากเครื่อง local ตอนย้ายข้อมูล)
   copy เก็บไว้ (รูปแบบ `postgres://user:password@host/dbname`)

### 2.2 ย้ายข้อมูลเดิมจาก local ไป Render

**อย่าพิมพ์ External Database URL ลงในแชทนี้ตรงๆ (มีรหัสผ่านอยู่ในนั้น)** ให้ทำสองทางนี้ทางใดทางหนึ่ง:

**ทางที่ 1 (แนะนำ — ทำเองในเทอร์มินัลของคุณ):**
```bash
# 1. Dump ข้อมูล local ทั้งหมดออกมาเป็นไฟล์ (รันจาก bards-new/backend/)
"C:\Program Files\PostgreSQL\17\bin\pg_dump" "postgresql://<local_user>:<local_pass>@localhost:5432/bards_db" -F c -f bards_backup.dump

# 2. Restore เข้า Render Postgres (แทน <RENDER_EXTERNAL_URL> ด้วย External Database URL ที่ copy มา)
"C:\Program Files\PostgreSQL\17\bin\pg_restore" --clean --if-exists --no-owner --no-privileges -d "<RENDER_EXTERNAL_URL>" bards_backup.dump
```
`--no-owner --no-privileges` จำเป็น เพราะ role ใน local DB (`<local_user>`) ไม่มีอยู่จริงบน Render —
ไม่งั้น restore จะ error เรื่อง role ไม่พบ (ข้อมูลยังเข้าไปได้ปกติ แค่ไม่ต้อง set owner)

**ทางที่ 2 (ให้ผมรันให้ผ่าน Claude Code):** เพิ่มบรรทัด `RENDER_DATABASE_URL=<External Database URL>`
ต่อท้ายไฟล์ `bards-new/backend/.env` เอง (ไฟล์นี้อยู่ใน `.gitignore` แล้ว ไม่มีทางหลุดขึ้น git) แล้วบอกผมว่า
"เพิ่มแล้ว ช่วยรัน migrate ให้หน่อย" — ผมจะอ่านค่าจากไฟล์ (ไม่พิมพ์ค่าจริงในแชท) แล้วรัน `pg_dump`/
`pg_restore` ให้ พอเสร็จแล้วค่อยลบบรรทัดนั้นออกจาก `.env` ทิ้ง

### 2.3 ตรวจว่าย้ายสำเร็จ

หลัง restore เสร็จ ตรวจ row count ให้ตรงกับ local (`users=6, products=12, orders=129, payments=9,
addresses=2` ฯลฯ ตามที่เช็คไว้ก่อน deploy) — ผมช่วยเช็คให้ได้ถ้าใช้ทางที่ 2 ข้างบน

**หมายเหตุ:** `orders` 129 แถวปนอยู่กับ order ทดสอบ ABA sandbox เก่าๆ (ไม่ได้แยกลบออกตามที่ตกลงกันไว้ —
ย้ายไปทั้งหมด) ลบทีหลังได้ผ่าน seller dashboard (`/seller-orders`) ถ้าต้องการเก็บเฉพาะของจริง

---

## 3. สร้าง Web Service

1. Dashboard → **New** → **Web Service**
2. เชื่อม GitHub repo `nmjbds/bards-shop` (ถ้ายังไม่เคยเชื่อม Render จะขอ authorize เข้า GitHub ก่อน —
   อนุญาตเฉพาะ repo นี้ก็พอ ไม่ต้องให้สิทธิ์ทุก repo)
3. ตั้งค่า:
   - **Name:** `bards-shop` (สำคัญ — ดูหัวข้อ 0 ด้านบนว่าทำไม)
   - **Region:** เดียวกับ database ที่สร้างไว้ (ลด latency ระหว่าง service กับ DB)
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free ใช้ทดสอบได้ก่อน (ข้อจำกัด: sleep หลังไม่มีคนเข้าใช้ 15 นาที ตื่นช้า ~30-60 วิ รอบแรก
     — ถ้าจะเปิดใช้งานจริงกับลูกค้าควรอัปเกรดเป็น paid plan เพื่อไม่ให้ระบบ sleep)
4. **อย่าเพิ่งกด Create** — เลื่อนลงไปใส่ Environment Variables ในขั้นตอนถัดไปก่อน (ใส่ทีหลังก็ได้ แต่ใส่
   พร้อมกันตอนสร้างจะได้ deploy รอบแรกผ่านเลยไม่ต้อง redeploy ซ้ำ)

---

## 4. Environment Variables

ใส่ทั้งหมดนี้ในหน้า **Environment** ของ Web Service (ค่าจริงคัดลอกจาก `bards-new/backend/.env` เอง — ผมจะ
ไม่พิมพ์ค่าจริงในนี้เพราะเป็นความลับ):

| ตัวแปร | ค่าที่ควรใส่บน Render | หมายเหตุ |
|---|---|---|
| `NODE_ENV` | `production` | **สำคัญมาก** — `db.js` เช็คค่านี้เพื่อเปิด SSL ตอนต่อ Postgres (`ssl:{rejectUnauthorized:false}`) Render Postgres **บังคับ SSL** ถ้าไม่ตั้งค่านี้ต่อ DB ไม่ติดแน่นอน แถมยังคุม `secure` flag ของ refresh-token cookie (`bards_rt`) กับ session cookie ด้วย |
| `PORT` | **ไม่ต้องใส่** | Render inject ให้เองอัตโนมัติ โค้ดอ่านจาก `process.env.PORT` อยู่แล้ว ถ้าใส่เองอาจชนกับค่าที่ Render กำหนด |
| `DATABASE_URL` | **⚠️ ไม่ใช้ DB จากข้อ 2 แล้ว** — ใช้ Supabase Postgres connection string ตัวเดียวกับที่ local `.env` ใช้ (host `aws-1-ap-southeast-1.pooler.supabase.com`) ดู note ท้ายไฟล์นี้ | ตัดสินใจ 2026-07-21 ไม่ย้ายไป Render Postgres — Render Postgres ในข้อ 2 เป็นของค้างที่ไม่ได้ใช้ ต้องลบทิ้ง |
| `JWT_SECRET` | ค่าใหม่ที่สุ่มขึ้นมา ไม่ต้องใช้ค่าเดิมจาก local ก็ได้ (แนะนำ) | ถ้าเปลี่ยนจากที่ local ใช้ — user ที่ login ไว้ตอนทดสอบ local จะต้อง login ใหม่ (คนละ token) ไม่กระทบข้อมูล |
| `SESSION_SECRET` | ค่าใหม่ที่สุ่มขึ้นมา | ใช้แค่ตอน OAuth handshake ชั่วคราว เปลี่ยนได้อิสระ |
| `FRONTEND_URL` | `https://bardskh.com` (หรือ `https://bards-shop.onrender.com` ถ้ายังไม่ผูกโดเมนตอนแรก) | ใช้สร้าง redirect URL หลัง OAuth/Telegram login สำเร็จ |
| `API_PUBLIC_URL` | เหมือน `FRONTEND_URL` ด้านบน (หรือ URL ของ backend เองถ้าแยกโดเมน) | **ABA PayWay ต้องยิง webhook มาถึง URL นี้ได้จริงจากอินเทอร์เน็ต** — ผิดแล้ว payment จะไม่ confirm อัตโนมัติ |
| `ADMIN_SECRET` | เปลี่ยนเป็นค่าใหม่ที่คาดเดายากกว่าค่าที่ใช้ตอน dev | ป้องกัน `POST /api/seller/make-seller` — ดู `CLAUDE.md` หัวข้อ 8 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | เหมือน local ได้ (ถ้าไม่แยก OAuth app ต่างหากสำหรับ prod) | ดูขั้นตอน 6 ด้านล่าง ต้องอัปเดต callback URL ที่ Google Console ด้วย |
| `GOOGLE_CALLBACK_URL` | `https://bardskh.com/api/auth/google/callback` | ต้องตรงกับที่ตั้งใน Google Console เป๊ะๆ |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` / `FACEBOOK_CALLBACK_URL` | ใส่ไว้เหมือนเดิมได้ | dead code (ปุ่มซ่อนอยู่) ไม่กระทบอะไรถ้าไม่ตั้งให้ถูกก็ได้ แต่ใส่ไว้เผื่ออนาคต |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `TELEGRAM_ALLOWED_IDS` | เหมือน local | ใช้ทั้ง Telegram Login และ telegram-bot.js (ตัวแจ้งเตือน — ดูหมายเหตุท้ายไฟล์นี้) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | เหมือน local | ส่ง OTP ลืมรหัสผ่าน |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_PUBLIC_URL` | เหมือน local | อัปโหลดรูปสินค้า/avatar — เป็น service ภายนอกอยู่แล้ว ไม่ผูกกับ localhost ไม่ต้องแก้ |
| `ABA_PAYWAY_MERCHANT_ID` / `ABA_PAYWAY_API_KEY` / `ABA_PAYWAY_BASE_URL` | **เช็คกับ ABA ก่อน** ว่าค่าที่ใช้ตอนนี้เป็น sandbox หรือ production credential | ถ้ายังเป็น sandbox — เว็บจริงจะ "รับเงิน" แบบไม่ใช่เงินจริง ต้องขอ production credential จาก ABA ก่อนเปิดขายจริง (ดูหัวข้อ 7) |
| `QR_EXPIRY_SECONDS` | `86400` (หรือไม่ใส่ก็ได้ โค้ด default เป็นค่านี้อยู่แล้ว) | |

---

## 5. Deploy ครั้งแรก

1. กด **Create Web Service** — Render จะ build + start อัตโนมัติ
2. ดูที่แท็บ **Logs** — รอจนเห็น `✅ Database ready` และ `🚀 Bards → http://localhost:<port>` (initDb()
   จะรัน migration ทั้งหมดอัตโนมัติตอนนี้ รวมถึง 2 migration ที่เพิ่งเพิ่มวันนี้ — refresh_tokens +
   backfill ที่อยู่เก่า)
3. ถ้า deploy fail ที่ `initDb()` (error เกี่ยวกับ SSL/connection) → กลับไปเช็ค `NODE_ENV=production`
   กับ `DATABASE_URL` (ต้องเป็น Internal URL ของ DB เดียวกัน) ก่อนอื่น
4. เปิด URL ที่ Render ให้มา (`https://bards-shop.onrender.com`) → เช็ค `/api/health` ต้องได้
   `{"ok":true,...}`

---

## 6. อัปเดต OAuth callback URLs

**Google Cloud Console** (https://console.cloud.google.com → APIs & Services → Credentials → OAuth
Client ที่ใช้อยู่):
- เพิ่ม Authorized redirect URI: `https://bardskh.com/api/auth/google/callback` (หรือ URL จริงที่ใช้)
- เพิ่ม Authorized JavaScript origin: `https://bardskh.com`
- **ไม่ต้องลบของ localhost ออก** — เก็บไว้เผื่อยัง dev ต่อได้ปกติ

**Telegram Login Widget** (ผ่าน @BotFather):
- ส่ง `/setdomain` ให้ BotFather เลือก bot ที่ใช้ → ใส่โดเมนจริง `bardskh.com` (Telegram Login Widget
  บังคับให้ domain ที่ฝัง widget ต้องลงทะเบียนไว้กับ BotFather ก่อนถึงจะทำงาน ไม่งั้นปุ่ม login จะ error)

---

## 7. ผูกโดเมน bardskh.com

1. Render Web Service → แท็บ **Settings** → **Custom Domains** → Add `bardskh.com` และ `www.bardskh.com`
2. Render จะให้ค่า DNS record (CNAME หรือ A record แล้วแต่กรณี) ให้ไปตั้งที่ผู้ให้บริการโดเมน (ที่จด
   `bardskh.com` ไว้)
3. รอ DNS propagate (มักไม่กี่นาทีถึงไม่กี่ชั่วโมง) — Render จะออก SSL certificate ให้อัตโนมัติ (Let's
   Encrypt) ไม่ต้องทำอะไรเพิ่ม
4. หลังโดเมนผูกสำเร็จ **กลับไปแก้ `FRONTEND_URL`/`API_PUBLIC_URL`/`GOOGLE_CALLBACK_URL` ในหัวข้อ 4 ให้เป็น
   `https://bardskh.com` แทน `.onrender.com`** แล้ว redeploy (Render redeploy อัตโนมัติเมื่อแก้ env var)

---

## 8. Smoke test หลัง deploy จริง (ทำให้ครบก่อนประกาศเปิดขาย)

**สถานะ: ปิดครบทุกข้อแล้ว (2026-07-22)** ยกเว้น 2 ข้อสุดท้ายที่ตั้งใจเลื่อนไปทำใกล้ launch จริง (ดูหมายเหตุ)

- [x] `/api/health` ตอบ 200
- [x] หน้าเว็บหลัก (`/`, `/checkout`, `/all-products`) เปิดได้ปกติ ไม่มี asset 404
- [x] Signup/signin ด้วย email ได้ token ใหม่ (อายุ 15 นาที) + cookie `bards_rt` (เช็คผ่าน DevTools →
      Application → Cookies — `HttpOnly`/`Secure`/`SameSite=Lax` ติ๊กครบ) — ระหว่างทางเจอว่า `NODE_ENV`
      บน Render ไม่ได้เป็น `production` จริง (cookie ขาด `Secure`) แก้แล้ว
- [x] Google login ได้จริงผ่านโดเมนจริง — เจอบั๊ก cookie `bards_rt` หายไปเลยหลัง OAuth callback (JSON
      response จาก signup ปกติมี cookie แต่ redirect response จาก `/google/callback` ไม่มี) ไล่ทาง root
      cause ยาว (ไม่ใช่ CORS/host-mismatch/Cloudflare cache) สุดท้ายคือ `app.set('trust proxy', 1)` ที่
      ขาดหายไปตั้งแต่แรก — แก้แล้ว ทดสอบผ่านจริง
- [x] Telegram login ได้จริงผ่านโดเมนจริง (2026-07-22) — เจอบั๊กเพิ่ม: `TELEGRAM_BOT_ID` (frontend) กับ
      `TELEGRAM_BOT_TOKEN` (backend env var บน Render) มีเลขสลับตำแหน่งกันทั้งคู่ (`8174154915` ที่ถูกคือ
      `8741549115`) ทำให้ HMAC verify ล้มเหลวเงียบๆ ตลอด แก้ทั้ง 2 จุด + trust proxy fix ก็ช่วยเรื่อง
      COOP/popup ด้วย — ทดสอบผ่านจริงแล้ว (ที่กังวลเรื่อง COOP ไม่ใช่ปัญหาจริง)
  - ⚠️ **ประเด็นนี้ถูกเปิดใหม่ 2026-07-23**: เจ้าของโปรเจกต์รายงานว่า Telegram login พังเฉพาะบน iPhone
    (คอม/Android ปกติดี) — บันทึกข้างบนนี้ไม่ได้ระบุว่าทดสอบบน iPhone จริงโดยเฉพาะ (แค่ "ผ่านโดเมนจริง")
    ตรวจสอบซ้ำแล้วยังสรุปแน่ชัดไม่ได้ว่า COOP เป็นสาเหตุจริงหรือไม่ — ปรับ `Cross-Origin-Opener-Policy`
    เป็น `same-origin-allow-popups` ไปแล้วเป็นการป้องกันไว้ก่อน (ความเสี่ยงต่ำ) รายละเอียดเต็มดู
    `docs/03-tasks-checklist.md` หัวข้อบนสุด — **รอผลทดสอบจริงบน iPhone ก่อนถือว่าปิดเคสนี้ได้จริง**
- [x] บันทึกที่อยู่ใหม่ได้ + แสดงครบ — เจอบั๊กจริงตอนทดสอบ: `checkout.html`'s `selectSavedAddr()` ใช้
      `querySelector('div>div>div')` ผิดจุด ทำให้ address card ที่ auto-select (default address) เหลือ
      แค่จุดกลมๆ ไม่มีข้อความเลย แก้แล้ว (ดู `CLAUDE.md` หัวข้อ 12) — ที่อยู่ legacy 2 บัญชีเดิมที่เคย
      กังวลเรื่อง `full_name`/`address_line` ไม่เกี่ยวกับ production DB จริง (Supabase ไม่มีคอลัมน์ legacy
      พวกนี้เลย เป็นปัญหาที่เจอเฉพาะ local dev DB เท่านั้น)
- [x] เข้าสู่ระบบเป็น seller/admin → ดู order/สินค้าทั้งหมดได้ปกติ — ทุกหน้า (`/seller`, `/seller-orders`,
      `/seller-products` ฯลฯ) โหลดได้ปกติ — ระหว่างทดสอบเพิ่มสินค้าจริงเจอบั๊กเพิ่ม: `seller-products.html`
      ส่ง `colors` เป็น array ของ object `{name,hex}` แทนที่จะเป็น string เฉยๆ ทำให้ save พังทุกครั้งด้วย
      error "Invalid input" ที่ไม่บอกว่า field ไหนผิด แก้แล้วทั้งฝั่งที่ส่งข้อมูลกับข้อความ error
- [ ] **เลื่อนไปทำใกล้ launch จริง**: เพิ่มสินค้าลงตะกร้า → checkout → ได้ QR จริงจาก ABA **production**
      credential (ตอนนี้ยัง sandbox อยู่ตั้งใจ — ดูหัวข้อ 4 แถว `ABA_PAYWAY_*`) — payment flow เองยืนยัน
      ถูกต้อง 100% แล้วผ่าน sandbox (ดู `docs/03-tasks-checklist.md`) เหลือแค่ swap credential
- [ ] **เลื่อนไปทำใกล้ launch จริง**: จ่ายเงินทดสอบ 1 รอบด้วย production credential (ยอดน้อยๆ) → เช็คว่า
      webhook จาก ABA ยิงมาถึง `API_PUBLIC_URL/api/payment/webhook` จริงบน production URL (ไม่ใช่แค่ sandbox
      ที่ทดสอบผ่าน local dev server ไปแล้ว)

---

## หมายเหตุท้ายไฟล์

- **`telegram-bot.js`** (สคริปต์แจ้งเตือนออเดอร์ผ่าน Telegram) **ไม่ได้ mount กับ `server.js`** — ถ้าอยาก
  ให้แจ้งเตือนทำงานบน production ต้องรันแยกเป็นอีก Background Worker บน Render (หรือ process แยกอีกตัว)
  ไม่ใช่แค่ deploy Web Service ตัวนี้ตัวเดียว — ยังไม่ได้ทำเป็นส่วนหนึ่งของ guide นี้ ถ้าต้องการให้เพิ่มทีหลัง
- Render Free Web Service sleep หลังไม่มีคนใช้ 15 นาที + Supabase free-tier auto-pause หลังไม่มี activity
  ~7 วัน — **บรรเทาแล้ว (2026-07-22)** ด้วย UptimeRobot ยิง `/api/health` ทุก 5 นาที (แก้ทั้งสองเรื่อง
  พร้อมกัน โดยไม่ต้องอัปเกรดแผนจ่ายเงินตอนนี้) — แต่ก่อนเปิดขายจริงกับลูกค้าจริงยังควรอัปเกรดเป็น paid plan
  ทั้ง Render Web Service และ Supabase อยู่ดี เพื่อประสิทธิภาพ/ความเสถียรที่ดีกว่าการพึ่ง keep-alive ping
