# 03 — Tasks Checklist

> อ้างอิงจาก `CLAUDE.md` หัวข้อ 11 (Roadmap)
> ไฟล์นี้ใช้ติดตามความคืบหน้าจริงของโค้ด (`bards-new/backend`, `bards-new/public`)
> เทียบกับ spec ใน `CLAUDE.md` — อัปเดตทุกครั้งที่มีการแก้ไข/ตรวจสอบ Phase ไหนเสร็จ
> (⚠️ `docs/05-payment-aba-payway.md` ที่เคยอ้างถึงตรงนี้ **ไม่มีไฟล์นี้อยู่จริง** ตรวจแล้ว 2026-07-22 —
> ค่า hash ABA ที่ถูกต้องอยู่ใน `CLAUDE.md` หัวข้อ 6.1 แทน)

---

## แยกเซิร์ฟเวอร์จริง 3 ตัว (bardskh.com / seller. / admin.bardskh.com) — Phase 0-3 ปิดครบแล้ว (เริ่ม 2026-07-28, ปิด 2026-07-31)

**เปลี่ยนสิ่งที่ Step 8 (ด้านล่าง) ตั้งใจไม่ทำให้กลายเป็นจริง** — Step 8 (2026-07-27) เขียนกำกับไว้ตรงๆ ว่า
"ไม่ใช่ apps/seller/apps/admin แยก service — เป็น Custom Domain เพิ่มเติมบน Web Service เดิม (`bards-shop`)
ตัวเดียว" งานนี้คือการรื้อฐาน deploy จริง แยกเป็น 3 Render Web Service อิสระ (`bards-customer`,
`bards-seller`, `bards-admin`) แต่ละตัวมีแค่โค้ด/หน้าเว็บของกลุ่มผู้ใช้ตัวเองจริงๆ ไม่ปนกันอีกต่อไป — เหตุผล/
ประเมินความเสี่ยงก่อนเริ่มงานทั้งหมดอยู่ในรายงานประเมิน (Artifact ที่ทำก่อนเริ่มเขียนโค้ด ไม่ได้เก็บเป็นไฟล์
ในโปรเจกต์ — สรุปสั้นๆ: ขนาดงานใกล้เคียง Step 7+8 รวมกัน, ความเสี่ยงหลักคือโครงสร้าง/ดูแลรักษาระยะยาว
ไม่ใช่เงิน/ความปลอดภัย)

**สถาปัตยกรรมที่ได้**: `backend/public-shared/` (ภายหลัง build เป็น `public-shared/` ที่ root) เก็บ
`api.js`/`products.js` เป็นแหล่งความจริงเดียว, `public-customer-src/`/`public-seller-src/`/
`public-admin-src/` เก็บหน้าเฉพาะกลุ่ม, `backend/scripts/build-public.js` ประกอบทั้งสองส่วนเป็น
`public-<audience>/` ที่แต่ละ service เสิร์ฟจริงตอน build (Render Build Command) — โฟลเดอร์ที่ generate
แล้วอยู่ใน `.gitignore` ห้ามแก้ตรง — ฝั่ง backend มี `server-customer.js`/`server-seller.js`/
`server-admin.js` (entry file ใหม่ 3 ไฟล์ mount เฉพาะ router ที่ตัวเองต้องใช้) โดยที่ `server.js`/`public/`
เดิมไม่ถูกแตะเลยตลอดทั้ง 4 Phase (คง `bards-shop` ไว้เป็น fallback จนกว่าจะเก็บกวาดจริงใน Phase 4 ที่ยังไม่ทำ)

### Phase 0 — เตรียมฐานร่วม (2026-07-28) — ปิดแล้ว

- [x] สร้าง `public-shared/`, `public-customer-src/`, `public-seller-src/`, `public-admin-src/` + copy
      ไฟล์ HTML ที่มีอยู่เข้ากลุ่มที่ถูกต้อง (ของเดิมใน `public/` ไม่ถูกแตะ)
- [x] `backend/scripts/build-public.js` — ประกอบ `public-shared/` + `public-<audience>-src/` เป็น
      `public-<audience>/` พร้อม comment "AUTO-GENERATED — DO NOT EDIT" บนทุกไฟล์ `.js` ที่ก็อปมา
- [x] `server-customer.js`/`server-seller.js`/`server-admin.js` — mount เฉพาะ router ที่จำเป็นจริงต่อ
      กลุ่มผู้ใช้ (ตรวจพบว่า `routes/seller.js`/`routes/shops.js` ใช้ร่วมกันจริงระหว่าง seller+admin,
      `services/paymentSettlement.js`/`abaPayway.js` ก็ใช้ร่วมกันเพราะปุ่ม "CHECK PAYMENT STATUS" ของ
      seller เรียกตรง)
- [x] **Additive-only refactor ของไฟล์เดิมที่ยัง live อยู่** (ปลอดภัยเพราะแค่ดึง inline handler ออกมาเป็น
      named function + export เพิ่ม ไม่เปลี่ยน behavior): `routes/auth.js` (แยก `services/session.js` ออก
      กันปัญหา `authSession.js` โหลด passport/Google strategy โดยไม่จำเป็น — เจอจากการจำลอง environment
      ว่างเปล่าก่อน deploy จริง ไม่ใช่เจอตอน production ล่ม), `routes/payment.js` (export
      `confirmHandler`), `routes/coupons.js` (export handler+schema แยก public/seller)
- [x] **ทดสอบ**: mount-test ทุก router ด้วย env จริง + จำลอง env ว่างเปล่า (ย้าย `.env` ออกชั่วคราว) ยืนยัน
      `authSession.js` ไม่ crash แม้ไม่มี `GOOGLE_CLIENT_ID` (ต่างจาก `routes/auth.js` เต็มที่ต้องมี) — รัน
      build script จริงยืนยัน `public-<audience>/` ไม่มีไฟล์ข้ามกลุ่มหลุดมาเลยสักไฟล์

### Phase 1 — Admin server (`bards-admin` / `admin.bardskh.com`) — ปิดแล้ว (2026-07-29)

Deploy service ใหม่ทดสอบ isolation ผ่าน curl ก่อน (ผ่านหมด) แล้วผูกโดเมนจริงเร็วกว่าแผนเดิม (แผนเดิมจะทดสอบ
บน URL ชั่วคราวให้ครบก่อน) เพราะพบว่า SSO/OAuth ข้ามโดเมน**ทดสอบเต็มรูปแบบบน URL ชั่วคราวไม่ได้จริง**
(cookie `Domain=.bardskh.com` ไม่มีทางไปถึง `*.onrender.com` เพราะเป็นคนละ site กันตามหลัก browser)

**บั๊กที่เจอ+แก้ระหว่างทาง (ทั้งหมดอยู่ในไฟล์ share กลาง ที่ Phase 2/3 ได้ประโยชน์ฟรีทันที ไม่ต้องแก้ซ้ำ)**:

- [x] **1 — เซิร์ฟเวอร์ crash/restart วนซ้ำเป็นระยะ** (`backend/db.js`) — `pg.Pool` ไม่มี `error` listener
      เลย connection idle ที่ Supabase pooler ตัดทิ้งทำให้ process ล่มทั้งตัว (Node's default behavior
      สำหรับ unhandled EventEmitter `error` คือ throw) — **บั๊กเดิมที่ซ่อนอยู่ในเว็บเก่าด้วย ไม่ใช่ของใหม่**
      เพิ่งเห็นชัดเพราะ service ใหม่มีคนใช้น้อย/ห่างๆ ตามจังหวะทดสอบ ทำให้ idle นานพอจะโดนตัด — แก้ด้วย
      `pool.on('error', ...)` บรรทัดเดียวตามที่ `pg` เอกสารแนะนำ ไม่ต้องมี retry logic เพิ่มเพราะ pool
      discard client เสียเองอยู่แล้ว — กระทบทุก service ที่ require ไฟล์นี้รวม `bards-shop` เดิมด้วย
- [x] **2 — Login สำเร็จแต่ไม่พากลับ admin.bardskh.com (ค้างที่ bardskh.com)** — `safeRedirect()`
      (client, `products.js`)/`isSafeRedirectPath()` (server, `routes/auth.js`) เดิมบล็อก URL แบบ
      absolute ทุกกรณี (กัน open-redirect) แต่ admin ต้องส่ง URL เต็มข้ามโดเมนกลับมาหลัง sign in ที่
      bardskh.com — แก้เป็น allow-list เฉพาะโดเมนของเราเอง (`BARDS_SAFE_REDIRECT_ORIGINS`) ยังบล็อกโดเมน
      แปลกปลอมเหมือนเดิม เพิ่ม `bardsSigninUrl()` ใน `products.js` เป็นจุดเดียวที่คำนวณ URL ไปหน้า signin
      ข้ามโดเมน (ใช้แทน hardcode `/signin` เดิมทั้ง 10 หน้า seller-\*/admin-\*.html) — **ต้องแก้
      `public/products.js` เดิม (ไฟล์ที่ยัง live จริงจนกว่าจะถึง Phase 3)** ด้วย เพราะ `bardskh.com/signin`
      ยังโหลดจากตรงนั้นตลอดช่วง Phase 1-2
- [x] **3 — วนไปมาไม่หยุดระหว่าง admin.bardskh.com ↔ bardskh.com/signin** — `Auth.isLoggedIn()`
      (`api.js`) เช็คแค่ "มี token อยู่ไหม" ไม่เคยเช็ค "หมดอายุหรือยัง" (access token อายุ 15 นาที) — token
      เก่าจากการทดสอบรอบก่อนที่ยังค้างอยู่ทำให้ `signin.html`'s "login อยู่แล้ว ข้าม form" shortcut เชื่อ
      token ตายแล้วเด้งกลับทันทีไม่ตรวจสอบ แก้โดยเพิ่ม decode `exp` claim ของ JWT (client-side, ไม่ใช่การ
      verify signature — แค่ใช้ตัดสินใจ UX ไม่เคยแทนที่การตรวจจริงฝั่ง server) ใน `isLoggedIn()`
- [x] **4 — Logout กด "Sign Out" แล้วบางครั้งไม่ตัด session จริง** — `Auth.logout()` เรียก
      `POST /auth/logout` แบบ fire-and-forget ไม่มี `keepalive` — พอ `location.href` เปลี่ยนหน้าทันทีหลัง
      จากนั้น browser อาจยกเลิก request กลางคันก่อนถึง server จริง แก้ด้วย `keepalive:true`
- [x] **5 — Logout จาก admin แล้ววนไปมาอีกรอบ (คนละสาเหตุกับข้อ 3)** — logout ล้าง session ได้แค่โดเมนที่
      กดปุ่ม (`localStorage` แยกตาม origin) — token ที่ยังค้างอยู่บน bardskh.com (จาก sign in ก่อนหน้าใน
      session เดียวกัน) ไม่ถูกล้างไปด้วย ทำให้ `signin.html` ยังเชื่อว่า login อยู่ แก้โดยเพิ่ม
      `?loggedout=1` marker ตอน redirect ไปหน้า signin ข้ามโดเมน — `signin.html` เห็น marker นี้แล้ว
      `Auth.clearSession()` ตัวเองก่อนเสมอ แทนที่จะเชื่อ token ที่มีอยู่
- [x] **ทดสอบ**: isolation ผ่าน curl ครบ (หน้า/API ของกลุ่มอื่นไม่หลุดเข้ามา, API scope ถูกต้อง) — ทดสอบจริง
      ครบ 3 ทาง login (email/password, Google, Telegram) + logout/re-login ข้ามโดเมน + ฟังก์ชันจริง
      (อนุมัติ/ระงับร้าน, สถิติ, จัดการหมวดหมู่+upload รูป) บน `admin.bardskh.com` จริง — commit:
      `26962d6`(Phase 0) `e479d55`(บั๊ก 1) `9e59744`(บั๊ก 2 ส่วน shared) `c0fb98d`(บั๊ก 2 ส่วน `public/`
      เดิม) `3d98e17`(บั๊ก 3) `8499dc2`(บั๊ก 4) `ec8d922`(บั๊ก 5)

### Phase 2 — Seller server (`bards-seller` / `seller.bardskh.com`) — ปิดแล้ว (2026-07-30)

ทำตามแบบ Phase 1 — isolation ผ่าน curl 21/21 จุดทั้ง URL ชั่วคราวและโดเมนจริง, ทดสอบด้วยบัญชี seller จริงที่
มีร้านอนุมัติแล้ว (เช็คจากฐานข้อมูลตรงๆ ก่อนทดสอบว่าใช้บัญชีไหนได้ ไม่ต้องเดา/สมัครร้านใหม่)

- [x] **ยืนยันแล้ว: บั๊กทั้ง 5 จุดจาก Phase 1 ไม่กลับมาอีกเลยสักจุด** — เพราะอยู่ในไฟล์ share กลางที่ deploy
      ไปแล้วอัตโนมัติทันทีที่ push ไม่ต้องแก้ซ้ำ พิสูจน์ว่าสถาปัตยกรรม single-source (Phase 0) ทำงานตามที่
      ออกแบบไว้จริง
- [x] **ปัญหาที่เจอ — ครั้งนี้เป็น Render config ไม่ใช่โค้ด**: Build Command ถูกวางค่าซ้ำกันแบบไม่มีตัวคั่น
      (`...js sellercd backend && npm install...`) กลายเป็นส่ง argument ผิดให้ `build-public.js` — สคริปต์
      ดักจับถูกต้องแล้ว exit ด้วย usage error (การป้องกันที่ตั้งใจออกแบบไว้ทำงานถูกต้อง) แต่ผลคือ build
      ล้มเหลว ไม่มี instance ไหน boot ขึ้นมาเลย (curl timeout 2 นาทีเต็มไม่มีอะไรตอบ) — วินิจฉัยได้จาก
      Render Logs เท่านั้น (curl มองไม่เห็นอะไรเพิ่มเมื่อ server ไม่ตอบเลยสักครั้ง) แก้โดยลบ Build Command
      ที่ซ้ำออก ไม่ต้องแก้โค้ดฝั่งไหนเลย — **บทเรียน**: service ที่ deploy แล้วไม่ตอบสนองเลยเกิน 1-2 นาที
      (ต่างจาก cold start ปกติ ~60 วิ) ให้เช็ค Render Logs ก่อนสงสัยว่าโค้ดมีปัญหา
- [x] **ทดสอบ**: login ผ่าน Google + logout/re-login ข้ามโดเมน (ไม่มีอาการวนซ้ำจาก Phase 1 เลย) +
      ฟังก์ชันจริงครบ (`seller.html` สถิติ, `seller-products.html` upload รูปผ่าน R2, `seller-orders.html`
      ปุ่ม "CHECK PAYMENT STATUS", `seller-coupons.html`, `seller-analytics.html`) — commit: `5cb79eb`
      (ดูรายละเอียดใน Phase 3 ด้านล่าง — commit นี้แก้ทั้ง 3 server พร้อมกัน)

### Phase 3 — Customer server (`bards-customer` / `bardskh.com`) — ปิดแล้ว (2026-07-31)

เสี่ยงสูงสุดในทั้ง 4 Phase (ผู้ใช้จริงจำนวนไม่ทราบแน่ชัดกำลังใช้ `bardskh.com` อยู่ ต่างจาก Phase 1/2 ที่มีแค่
เจ้าของโปรเจกต์/seller ทดสอบคนเดียว) — ลำดับที่ทำจริง: สร้าง service → ทดสอบ isolation → ทดสอบ
email/password auth + checkout/payment ผ่าน ABA sandbox บน URL ชั่วคราว (ข้าม Google/Telegram ไว้ก่อน
เพราะ callback URL ผูกกับ `bardskh.com` เท่านั้น ทดสอบไม่ได้จริงบน URL ชั่วคราว) → อัปเกรด paid plan →
สลับโดเมนจริง → smoke test เต็มรูปแบบ (รวม Google/Telegram ที่ข้ามไว้)

- [x] **isolation ผ่าน curl ครบ** — รวมถึงพิสูจน์ว่า path ข้ามกลุ่ม (เช่น `/seller`, `/admin-shops`) บน
      customer server **ไม่ leak เนื้อหาจริง** แม้จะตอบ 200 (SPA fallback serve `index.html` เสมอสำหรับ
      path ที่ไม่ match — พฤติกรรมนี้ต่างจาก seller/admin server ที่ 404 ตรงๆ ต้องเช็คเนื้อหา response ไม่ใช่
      แค่ status code)
- [x] **บั๊กที่เจอ — CORS allow-list ไม่มี URL ชั่วคราว** (`server-customer.js` และอีก 2 ไฟล์เพื่อความ
      สอดคล้องกัน) — credentialed fetch จากหน้าที่โหลดบน `bards-customer.onrender.com` ส่ง
      `Origin: https://bards-customer.onrender.com` มาด้วย ไม่ตรงกับ allow-list (มีแค่โดเมนจริง) `cors`
      middleware throw `Error: CORS blocked` ซึ่งไม่ถูกจับโดย route handler ไหนเลย (throw ก่อนถึง routing)
      หลุดไปเจอ global error handler กลายเป็น "Internal error." ที่หน้าเว็บ — **Phase 1/2 ไม่เคยเจอบั๊กนี้
      เพราะทั้งคู่ผูกโดเมนจริงก่อนจะทดสอบ credentialed fetch จริงจังบน URL ชั่วคราว** Phase 3 ตั้งใจทดสอบ
      auth เต็มรูปแบบบน URL ชั่วคราวก่อน (เพราะต้อง login ก่อนถึงจะ checkout ทดสอบได้) เลยเจอเป็นครั้งแรก
      — แก้โดยเพิ่ม URL ชั่วคราวทั้ง 4 ตัว (`bards-shop`/`bards-customer`/`bards-seller`/`bards-admin`
      `.onrender.com`) เข้า allow-list ของทั้ง 3 server (ไม่ใช่แค่ customer) กันปัญหาเดิมถ้าต้องทดสอบ URL
      ชั่วคราวซ้ำในอนาคต — วินิจฉัยได้จาก Render Logs (`Error: CORS blocked` ที่
      `server-customer.js:56:72`) หลัง curl replicate ตรงๆ (JSON body ปกติไม่มี `Origin` header)
      ไม่ reproduce เพราะ curl ไม่ส่ง header นี้โดย default — commit `5cb79eb`
- [x] **ทดสอบ auth + checkout/payment เต็มรูปแบบบน URL ชั่วคราว**: signup/signin email/password, cart,
      wishlist, ที่อยู่, ดูออเดอร์ตัวเอง, checkout + จ่ายจริงผ่าน ABA sandbox จนสถานะเปลี่ยนเป็น "ชำระแล้ว"
      — ผ่านหมดหลังแก้บั๊ก CORS ข้างบน
- [x] **อัปเกรด `bards-customer` เป็น paid plan** — ยืนยันผ่าน `/api/health` ตอบเร็วสม่ำเสมอ (~1s) ไม่มี
      cold start อีกต่อไป
- [x] **สลับโดเมนจริง `bardskh.com`/`www.bardskh.com` → `bards-customer`** — ทำตอนคนเข้าเว็บน้อย (เลือก
      "ทำเลยตอนนี้" หลังชั่งน้ำหนักแล้ว ไม่ได้รอช่วงกลางคืน) ยืนยันด้วย curl ทันทีหลังสลับ: `bardskh.com`
      301 ไป `www.bardskh.com` ตามปกติ (Cloudflare redirect เดิม ไม่เกี่ยวกับงานนี้) `www.bardskh.com`
      ตอบ `{"service":"customer"}` ถูกต้อง, TLS ไม่มี error, isolation ยัง 100% ถูกต้องบนโดเมนจริง (curl
      ซ้ำอีกรอบ) — `bards-shop` ยังไม่ถูกลบ เก็บไว้เป็น rollback fallback (Phase 4 ที่ยังไม่ทำ)
- [x] **Smoke test เต็มรูปแบบบนโดเมนจริงหลังสลับ**: หน้าเว็บ+isolation ผ่าน curl ครบ, email/password +
      Google + Telegram OAuth (ที่ข้ามไว้ตอนทดสอบ URL ชั่วคราว) ล้วนทำงานถูกต้องแล้วบนโดเมนจริง, order
      ทดสอบจริงอีกรอบผ่าน ABA sandbox สำเร็จ
- [x] **ABA PayWay webhook — ตรวจสอบแล้ว ไม่ใช่บั๊กจากการสลับโดเมน แต่ยังไม่ยืนยัน sandbox ยิงจริงหรือไม่**:
  - โค้ด (`services/abaPayway.js`) ส่ง field ชื่อ `return_url` (ไม่ใช่ `callback_url`) เป็นค่า
    **ไดนามิกที่สร้างใหม่ทุกครั้ง**ที่มีการสั่งซื้อ (`API_PUBLIC_URL` + path, base64-encode, รวมอยู่ใน hash
    ของ request) — ไม่ใช่ URL ตายตัวที่ลงทะเบียนไว้ล่วงหน้าฝั่ง ABA merchant แบบที่ Google/Telegram OAuth
    ต้องทำ (`GOOGLE_CALLBACK_URL` ใน `CLAUDE.md` §13)
  - ค้นทั้ง `docs/*.md` และ `CLAUDE.md` (มีบันทึกละเอียดเรื่องต่อ ABA PayWay ตั้งแต่ 2026-07-18) **ไม่พบการ
    ระบุข้อกำหนด whitelist โดเมนกับ ABA เลยสักที่** — เอกสารสาธารณะของ ABA
    (developer.payway.com.kh) ก็ไม่ได้พูดถึงพฤติกรรม sandbox vs production ของกลไก return_url นี้เช่นกัน
  - เพิ่ม unconditional log (`[WEBHOOK] received, tran_id=...`) ใน `routes/payment.js`'s
    `POST /webhook` (เดิม log แค่ตอน error/`tran_id` หาย — ถ้าสำเร็จเงียบๆ ไม่มี log อะไรเลย ทำให้ log
    ว่างเปล่าตีความไม่ได้ว่า "ไม่มาถึง" หรือ "มาถึงแล้วสำเร็จ") — commit `0323ecc`
  - **ผลทดสอบจริงหลังสลับโดเมน**: สั่งซื้อทดสอบจริง จ่ายผ่าน ABA sandbox สำเร็จ (ยืนยันผ่าน mechanism หลัก
    คือ active poll/`CHECK PAYMENT STATUS` ไม่ได้พึ่ง webhook) — เช็ค Render Logs ของ `bards-customer`
    ทันทีหลังจ่ายเสร็จ **ไม่พบ `[WEBHOOK]` log เลยสักบรรทัด**
  - **⚠️ สถานะ: sandbox webhook delivery ยังไม่ยืนยันว่าทำงานจริง — ไม่ใช่ blocker** ระบบยืนยันการจ่ายเงิน
    หลักผ่าน active polling (`POST /confirm/:orderId`, เรียกทั้งจากปุ่ม "CHECK PAYMENT STATUS" และ
    auto-poll ทุก 7 วิ) ซึ่งไม่พึ่ง webhook เลย ยืนยันทำงานถูกต้อง 100% ตลอดทั้ง Phase 1-3 — webhook เป็นแค่
    ทางเสริมให้เร็วขึ้น ไม่ใช่ทางเดียว — comment เดิมในโค้ด (`routes/payment.js`, เขียนไว้ตั้งแต่
    2026-07-24 **ก่อน**งานแยกเซิร์ฟเวอร์นี้จะเริ่มด้วยซ้ำ) ก็บันทึกไว้ตรงๆ อยู่แล้วว่า "this endpoint has
    never received a real webhook call end-to-end on production" — เป็น known gap เดิมที่ยังไม่เคยถูก
    พิสูจน์ ไม่ใช่สิ่งที่งานแยกโดเมนนี้ทำให้พังใหม่
  - **ต้องทำก่อน production จริง (ยังไม่ทำตอนนี้)**: ยืนยันกับ ABA support ว่า sandbox/production ยิง
    webhook จริงหรือไม่ต่างกันยังไง — ถ้ายิงจริงก็ดี (payment status อัปเดตเร็วขึ้นโดยไม่ต้องรอ poll รอบ
    ถัดไป) ถ้าไม่ยิงเลยก็ไม่กระทบการทำงานเพราะ poll เป็นทางหลักอยู่แล้ว แค่ควรรู้แน่ชัดก่อนสมัคร merchant
    credential จริง

### สถานะรวม

**ทั้ง 3 โดเมนจริง (`bardskh.com`/`seller.bardskh.com`/`admin.bardskh.com`) แยกเป็น Render service อิสระ
จริงแล้ว ("bards-customer"/"bards-seller"/"bards-admin") — ไม่ใช่ service เดียวเช็ค hostname เหมือน Step 8
เดิมอีกต่อไป**

**หมายเหตุระหว่างเฝ้าดูความเสถียร**: มีรายงาน `seller.bardskh.com` redirect กลับไป `bardskh.com` หนึ่งครั้ง —
เช็ค server-side ครบ (custom domain/TLS/`/api/health` ตอบ `service:"seller"` ถูกต้อง, bare `/` redirect
ถูกต้อง) ไม่พบปัญหาฝั่ง infra/โค้ดเลย — สาเหตุที่เป็นไปได้สูงสุดคือ role-based access control ทำงานถูกต้อง
(`seller.html`'s guard: `if (!['seller','admin'].includes(user.role)) location.href =
bardsCrossHubUrl('main','/')`) บวกกับ cookie `Domain=.bardskh.com` ที่แชร์ session ข้ามทั้ง 3 โดเมน — ถ้า
browser ตอนนั้นถือ session ของบัญชี role `customer` (จากการทดสอบข้าม account หลายครั้งช่วง Phase 3) ก็จะโดน
เด้งออกจาก seller dashboard ถูกต้องตามสิทธิ์ ไม่ใช่บั๊ก — **ยังไม่ได้รับการยืนยันกลับจากเจ้าของโปรเจกต์ว่าล็อกอิน
ด้วยบัญชี seller (`hnunghofficial@gmail.com`) แล้วแก้ปัญหาจริงหรือไม่** — บันทึกไว้เป็นจุดที่ควรติดตามต่อถ้า
เกิดซ้ำ

## Phase 4 — เก็บกวาด `bards-shop` — เริ่มแล้ว (2026-08-01), สถานะ: **Suspended** (ไม่ใช่ deleted)

ตรวจสอบครบ 3 ข้อก่อน suspend ตามที่วางแผนไว้ (ผ่านหมดทุกข้อ, เจ้าของโปรเจกต์ยืนยันเอง เพราะเป็นข้อมูลที่ดูได้
เฉพาะใน Render Dashboard/บริการภายนอกที่ Claude ไม่มีสิทธิ์เข้าถึง):

- [x] **Traffic เข้า `bards-shop` เกือบ 0** ในช่วง 2-3 วันหลังสลับโดเมนครบทั้ง 3 ตัว (เช็คจาก Render
      Metrics/Logs โดยตรง)
- [x] **ไม่มี external service ไหนชี้ไปที่ `bards-shop.onrender.com` ตรงๆ** — UptimeRobot (เครื่องมือเฝ้า
      ดูที่ใช้อยู่) ชี้ไปที่ `bardskh.com/api/health` เท่านั้น ไม่แตะ URL เก่าเลย — ตรวจโค้ดเพิ่มเติม (Claude)
      พบว่า `bards-shop.onrender.com` มีอยู่ในโค้ดแค่ 7 จุด ล้วนเป็น CORS/safe-redirect allow-list เฉยๆ
      (permission ที่รับ request มาจากโดเมนนั้น ไม่ใช่จุดที่โค้ดเรียกออกไปหา) — ไม่มีผลกระทบถ้า service เก่า
      หายไป, ยืนยันเพิ่มว่า `telegram-bot.js` (script แยกจาก web server, long-polling ไม่ใช่ webhook) **ไม่ได้
      ถูก deploy รันอยู่ที่ไหนเลยตอนนี้** (เคยรันแค่ local/manual) จึงไม่เกี่ยวกับ `bards-shop` ด้วย
- [x] **Environment variables ครบถ้วนในทั้ง 3 service ใหม่แล้ว** — เทียบกับ list ตัวแปรทั้งหมดที่โค้ดอ่านจริง
      (26 ตัว: `ADMIN_SECRET`, `API_PUBLIC_URL`, `DATABASE_URL`, `FACEBOOK_APP_ID/SECRET/CALLBACK_URL`,
      `FRONTEND_URL`, `GOOGLE_CALLBACK_URL/CLIENT_ID/CLIENT_SECRET`, `JWT_SECRET`, `MAIL_FROM`, `NODE_ENV`,
      `PORT`, `QR_EXPIRY_SECONDS`, `R2_ACCESS_KEY_ID/ACCOUNT_ID/BUCKET_NAME/PUBLIC_URL/SECRET_ACCESS_KEY`,
      `SESSION_SECRET`, `SMTP_PASS/USER`, `TELEGRAM_ALLOWED_IDS/BOT_TOKEN/CHAT_ID`,
      `ABA_PAYWAY_MERCHANT_ID/API_KEY/BASE_URL`) — เจ้าของโปรเจกต์เช็คตรงจาก Render Environment tab แล้ว

**เลือก Suspend ก่อน ไม่ลบทันที** — เหตุผล: Suspend เก็บ service/config/env vars ไว้ครบ (แค่หยุดรัน/หยุดคิด
เงิน) กด Resume กลับมาใช้ได้ทันทีถ้าจำเป็น ต่างจาก Delete ที่ถาวรกู้คืนไม่ได้ — สอดคล้องกับแนวทาง
risk-averse ที่ใช้มาตลอดทั้งงานแยกเซิร์ฟเวอร์นี้ (เก็บ fallback ไว้เสมอจนกว่าจะมั่นใจจริง) — **ก่อน suspend
ได้ backup ค่า Environment Variables ทั้งหมดของ `bards-shop` ไปเก็บไว้นอก Render แล้ว** (เผื่ออ้างอิงถ้าตัดสิน
ใจลบถาวรทีหลัง) — โค้ด/`server.js`/`public/` เดิมไม่ต้อง backup เพิ่มเพราะอยู่ใน git history ของ repo เดียวกับ
อีก 3 service อยู่แล้ว, ฐานข้อมูล Supabase ไม่เกี่ยวกับการ suspend service นี้เลยเพราะเป็น infra แยกที่ใช้ร่วม
กันอยู่แล้ว

**ที่ยังไม่ทำ (รอความเสถียรต่อก่อนตัดสินใจ)**: ลบ `bards-shop` ถาวร (delete จริง), ลบ route/require/ไฟล์
`public/` เดิมที่ไม่ใช้แล้วออกจาก repo ให้สะอาด (`server.js` เดิมยังคงอยู่เป็น dead-but-harmless ไฟล์ในนั้น
ไม่ได้ deploy ที่ไหนอีกแล้วตั้งแต่ suspend)

---

## Admin UI — แผนรวม 8 step (เริ่ม 2026-07-25) — **ปิดครบทั้ง 8 step แล้ว (2026-07-27)**

เป้าหมายรวม (ตกลงกับเจ้าของโปรเจกต์ก่อนเริ่มเขียนโค้ด — ไม่รวม audit log/สิทธิ์แบบละเอียด รอทำทีหลังตอนมี
ทีมงานใช้งานจริงหลายคน): อนุมัติ/ปฏิเสธร้านค้า, ภาพรวมออเดอร์ทั้งระบบ, จัดการหมวดหมู่ผ่านหน้าเว็บ, ค้นหา/
ระงับบัญชีลูกค้า, สถิติภาพรวมแพลตฟอร์ม, ตรวจสอบ seller dashboard เดิม, คูปองแยกตามร้าน, แยก domain
seller./admin.bardskh.com — เรียงลำดับตามความเสี่ยง/ความสำคัญ:

**1** อนุมัติ/ปฏิเสธ/ระงับร้านค้า → **2** ภาพรวมออเดอร์ทั้งระบบ → **3** สถิติภาพรวมระบบ → **4** จัดการ
หมวดหมู่ → **5** ค้นหา/ระงับบัญชีลูกค้า → **6** ตรวจสอบ seller dashboard เดิม (งานเบา ไม่ผูกกับใคร) →
**7** คูปองแยกตามร้าน (เสี่ยงสุด แตะ checkout math โดยตรง) → **8** แยก domain (infra, ทำหลังสุด)

**ข้อเท็จจริงที่ตรวจพบก่อนเริ่ม (กระทบลำดับ):**
- `GET /api/seller/stats` ตอน admin เรียก **มีให้เกือบหมดแล้ว** (revenue/order count/daily 7-day trend/
  status breakdown/top products ของทั้งแพลตฟอร์ม) ขาดแค่จำนวนร้านค้า+จำนวนลูกค้าที่ลงทะเบียนจริง — step 3
  จึงเบากว่าที่คิด
- `seller.html`/`seller-analytics.html` **มี stats/กราฟอยู่แล้วค่อนข้างสมบูรณ์** (Chart.js, stat card,
  revenue/status/top-products chart, period toggle 7/30/90 วัน) — step 6 อาจเป็นแค่รีวิว ไม่ใช่สร้างใหม่
- การระงับบัญชีลูกค้า **ยังไม่มีอะไรรองรับเลยสักส่วน** (ไม่มีคอลัมน์สถานะใน `users`, ไม่มี route, ไม่มีหน้า)
  ต่างจาก "ระงับร้านค้า" ที่มีอยู่แล้วผ่าน `shops.status`

### Step 1 — จัดการร้านค้า (อนุมัติ/ปฏิเสธ/ระงับ) — ปิดแล้ว (2026-07-25, commit `eb8be0c`)

- [x] **`public/admin-shops.html`** — หน้า admin-only หน้าแรกของโปรเจกต์ (เดิม admin ใช้หน้า
      `seller-*.html` ร่วมกับ seller เป๊ะ ไม่มีหน้าแยกเลย) — filter tab All/Pending/Approved/Rejected/
      Suspended, การ์ดแสดงชื่อร้าน/เจ้าของ/สถานะ พร้อมปุ่ม action ที่เลือกเฉพาะ transition ที่สมเหตุสมผล
      ต่อสถานะ (pending→Approve/Reject, approved→Suspend, rejected→Approve, suspended→Reinstate/Reject)
      — reject/suspend มี `confirm()` ก่อนเพราะกระทบสิทธิ์ขายของ seller จริง — ใช้ endpoint เดิม
      (`GET/PATCH /api/shops`) ที่มีอยู่ครบแล้ว ไม่ต้องเพิ่ม backend ใหม่นอกจากข้อถัดไป
- [x] **แก้ `backend/routes/shops.js`'s `PATCH /:id`** — เดิมไม่เช็คอะไรเลยนอกจาก enum ของ status
      เปลี่ยนเป็นสถานะเดิมซ้ำได้เงียบๆ (คลิก approve 2 ครั้งคืน 200 ทั้งคู่) เพิ่มเช็คว่าไม่ใช่สถานะเดิม
      (คืน 400 ถ้าซ้ำ) — **ตั้งใจไม่ทำ full state machine** เพราะการเปลี่ยนที่เหลือทั้งหมดระหว่าง 4 สถานะ
      เป็นการตัดสินใจที่ admin ทำได้จริงทุกแบบ (reinstate ร้านที่ suspended ผิดพลาด, เปลี่ยนใจจาก rejected
      เป็น approved) ไม่มีเหตุผลจะบล็อก
- [x] **Stored XSS prevention** — `shop.name`/`description`/`owner_name`/`owner_email` เป็นข้อความที่
      seller/user ควบคุมได้ (ผ่าน `POST /apply`, `PATCH /me`, หรือแค่สมัครบัญชี) escape ผ่าน
      `escapeHtml()` ทุกจุดก่อน render — ทดสอบด้วย payload `<script>`/`<img onerror>` จริงผ่าน DOM-stub
- [x] **เพิ่ม nav "Admin"** (ซ่อนด้วย default, เปิดเฉพาะ `user.role==='admin'` ใน auth-check block เดิม)
      ในทั้ง 5 ไฟล์ seller sidebar (`seller.html`, `seller-products.html`, `seller-orders.html`,
      `seller-coupons.html`, `seller-analytics.html`) ลิงก์ไป `/admin-shops` — ตั้งใจแยก branding
      "Admin Hub" ออกจาก "Seller Hub" ตั้งแต่ตอนนี้ เพื่อลดงานตอน step 8 (แยก domain) ในอนาคต
- [x] **ทดสอบ**: DOM-stub test 12 เคส (ปุ่ม action ถูกต้องตามสถานะ, XSS-safe ทุกฟิลด์, ไม่ crash ถ้า
      owner_email เป็น null) + live end-to-end test 16 เคสกับ local dev server จริง: สมัคร seller
      ทดสอบ 2 คน, สมัครร้านจริงผ่าน `POST /apply` (ร้านหนึ่งใส่ payload `<script>` ในชื่อจริง), ไล่ทุก
      transition จริง (approve/reject/reconsider/suspend/reinstate), ยืนยัน same-status guard คืน 400,
      ยืนยัน seller (non-admin) โดน 403 ทั้ง GET/PATCH, ยืนยัน invalid status/shop ไม่มีจริงคืน
      400/404 ถูกต้อง, ลบข้อมูลทดสอบออกหมดแล้ว
- [x] **ตั้ง `support@bardskh.com` เป็น `admin`** ใน local dev DB (เดิมไม่มี user role admin เลยสักคนใน
      local dev — ใช้ทดสอบ feature นี้เท่านั้น ไม่แตะ production)

### Step 2 — ภาพรวมออเดอร์ทั้งระบบ — ปิดแล้ว (2026-07-26, commit `074c820`)

- [x] **`public/admin-orders.html`** — ดัดแปลงจาก `seller-orders.html` (ใช้โค้ด table/filter/search/
      pagination/modal/status-workflow ชุดเดิมที่ทดสอบมาดีแล้วทั้งหมด) เพิ่มคอลัมน์ "Shop" ทั้งในตารางและ
      modal รายละเอียด — เดิม admin ไม่มีทางเห็นเลยว่า order แต่ละใบเป็นของร้านไหน แม้ backend จะคืนข้อมูล
      ทุกร้านให้ admin อยู่แล้วก็ตาม — gate เฉพาะ `role==='admin'` เท่านั้น (seller ยังใช้
      `seller-orders.html` เดิมสำหรับร้านตัวเอง)
- [x] **แก้ `backend/routes/seller.js`'s `GET /orders`** — เพิ่ม `LEFT JOIN shops` คืน `shop_name` มาด้วย
      (additive ล้วนๆ ไม่กระทบ field/scope เดิมเลย — `seller-orders.html` เพิกเฉยต่อ field ใหม่นี้ ไม่ต้อง
      แก้อะไร)
- [x] เพิ่มลิงก์ไขว้ระหว่าง `admin-shops.html` ↔ `admin-orders.html` ใน sidebar section "Platform" ของ
      ทั้งสองหน้า
- [x] **ทดสอบ**: DOM-stub test 8 เคส (ค้นหาด้วยชื่อร้าน, `shop_name` เป็น null ไม่ crash, ป้องกัน XSS ผ่าน
      ชื่อร้านได้จริง) + live test 9 เคสกับ local dev server จริง: ยืนยัน admin เห็น `shop_name` บน order
      จริง 137 ใบ, seller ยังเห็นเฉพาะร้านตัวเองเหมือนเดิมไม่กระทบ, สุ่มเช็คว่า `shop_name` ของ order จริง
      ตรงกับชื่อร้านจริงใน `shops` table

### Step 3 — สถิติภาพรวมระบบ (แดชบอร์ด, ตัวเลือกช่วงเวลา 7/30/90 วัน) — ปิดแล้ว (2026-07-26, commit `29def89`)

- [x] **`public/admin-stats.html`** — ดัดแปลงจาก `seller.html`'s dashboard (กราฟ Chart.js, stat card,
      order-status donut, top products) ผสมกับ UX period-toggle ของ `seller-analytics.html` (ปุ่ม
      7D/30D/90D) gate เฉพาะ `role==='admin'` — โชว์ 6 stat card: Revenue/Orders/Active Customers
      (scope ตามช่วงเวลาที่เลือก), Shops/Registered Customers (all-time snapshot ทั้งแพลตฟอร์ม ไม่ scope
      ตามช่วงเวลา — ตอบคำถาม "ตอนนี้มีเท่าไหร่" ไม่ใช่ "เข้าร่วมช่วงนี้กี่คน"), Pending Review (คิว
      operational ปัจจุบัน ก็ไม่ scope ตามช่วงเวลาเหมือนกันด้วยเหตุผลเดียวกัน)
- [x] **แก้ `backend/routes/seller.js`'s `GET /stats` (เฉพาะฝั่ง admin)**:
  - รับ `?days=7|30|90` (allowlist — ค่าอื่นใดก็ตาม ไม่ว่าจะไม่ส่งมา/ค่ามั่ว/ติดลบ fallback เป็น 7
    เหมือนพฤติกรรมเดิม) — `totalOrders`/`totalRevenue`/`totalCustomers`/`dailyRevenue`/
    `statusBreakdown`/`topProducts` scope ตามช่วงที่เลือกผ่าน `make_interval(days => $1)` (parameterized
    query จริง ไม่ใช่ string concat)
  - เพิ่ม `totalShops`/`totalRegisteredCustomers` (COUNT บน `shops`/`users WHERE role='customer'`) —
    ตั้งใจไม่ scope ตามช่วงเวลา (เหมือน `pendingOrders` เดิม)
  - **พบ+แก้บั๊กก่อน deploy จริง**: query เดิม group by ชื่อวัน (`Dy` เช่น Mon/Tue) ซึ่งใช้ได้ถูกต้องแค่กับ
    หน้าต่าง 7 วันพอดี — ถ้าขยายเป็น 30/90 วันโดยไม่แก้ จะรวมยอดขายทุก "จันทร์" ในช่วงนั้นเข้า bucket
    เดียวกันหมด (ควรมี 4-13 จุดแยกกันแต่จะเหลือแค่ 7 bucket ปนกัน) กราฟจะผิดทันที — แก้เป็น group by
    วันที่จริง (`YYYY-MM-DD`) ก่อนเขียนหน้าเว็บเลย ไม่ใช่เจอทีหลังจากทดสอบ
  - **ฝั่ง seller (non-admin) ไม่ถูกแตะเลย** — ยังคงหน้าต่าง 7 วันคงที่ group by ชื่อวันเหมือนเดิมทุก
    ประการ ไม่มี field ใหม่ปนเข้ามา — `seller.html` ไม่ต้องแก้อะไรเลย
- [x] เพิ่มลิงก์ "Stats" ใน sidebar ของทั้ง `admin-shops.html`/`admin-orders.html` (และ Stats page เองก็
      ลิงก์กลับไป Shops/Orders) — ครบ 3 หน้า admin เชื่อมกันหมดแล้ว
- [x] **ทดสอบ**: live test 22 เคสกับ local dev server จริง — ยืนยัน 7/30/90 คืนจำนวน bucket ถูกต้องพร้อม
      วันที่จริงไม่ซ้ำกัน (พิสูจน์ว่าบั๊ก day-name ถูกแก้จริง), `totalOrders`/`totalRevenue` เพิ่มขึ้นตาม
      ลำดับเมื่อขยายช่วงเวลา (90d ⊇ 30d ⊇ 7d), `totalShops`/`totalRegisteredCustomers`/`pendingOrders`
      เท่ากันทุกช่วงเวลา (พิสูจน์ว่าเป็น snapshot ไม่ได้ scope ผิดจุด), ค่าตรงกับ `COUNT(*)` ตรงจาก DB จริง,
      ค่ามั่ว/ติดลบ fallback เป็น 7 ปลอดภัย, ฝั่ง seller ไม่กระทบเลยแม้แต่บิตเดียว (ยังคง 7 bucket ชื่อวัน
      เหมือนเดิม ไม่มี field ใหม่หลุดเข้าไป)

### Step 4 — จัดการหมวดหมู่ผ่านหน้าเว็บ — ปิดแล้ว (2026-07-26)

- [x] **แก้ `backend/routes/categories.js`** — เดิมมีแค่ `GET /` (public, list เฉพาะ `is_active=true`, field
      จำกัด) เพิ่ม CRUD เต็มสำหรับ admin เท่านั้น (`requireAuth+requireRole('admin')` ทุก route, ไม่มี
      seller access เพราะหมวดหมู่เป็น platform-wide taxonomy ไม่ใช่ของแต่ละร้าน ต่างจาก products/coupons):
  - `GET /admin` — ทุกแถว (รวม inactive) พร้อม `product_count` ต่อหมวด (`LEFT JOIN products ON
    category_id`) ใช้ตัดสินใจว่าลบได้ไหมโดยไม่ต้องเดา — ประกาศก่อน route `/:id` กัน `"admin"` โดนจับเป็น
    param
  - `POST /` — สร้างใหม่ (zod validate: `slug` ต้องเป็น lowercase+ตัวเลข+ขีดกลางเท่านั้น กัน URL แตก,
    unique conflict → 409)
  - `PATCH /:id` — แก้ทีละ field (partial update pattern เดียวกับ `PATCH /shops/me`)
  - `DELETE /:id` — เช็คจำนวนสินค้าที่ผูกอยู่ก่อน (`COUNT(*) WHERE category_id=$1`) บล็อกพร้อมข้อความ
    บอกจำนวนจริงถ้ามี (409) แทนที่จะให้ FK constraint error ดิบๆ หลุดไปเป็น 500 — `products.category_id`
    ไม่มี `ON DELETE CASCADE` โดยตั้งใจอยู่แล้ว (ดู `CLAUDE.md` §4) นี่แค่ทำให้ error message เป็นมิตร
- [x] **`public/admin-categories.html`** — หน้าใหม่ (การ์ด list + modal add/edit) โครงตาม
      `admin-shops.html` (sidebar, toast, escapeHtml จาก `products.js`) ผสม modal form ตาม
      `seller-products.html` (name/slug/image/color/sort_order + toggle switch สำหรับ `is_active`/
      `show_on_homepage`) — slug auto-generate จากชื่อตอนสร้างใหม่ (ปิดอัตโนมัติตอนแก้ของเดิม กัน
      slug เปลี่ยนโดยไม่ตั้งใจ) — ปุ่ม "Upload" เรียก `POST /api/seller/upload` ตัวเดียวกับที่
      `seller-products.html` ใช้ (endpoint นี้อนุญาต `seller`/`admin` ทั้งคู่อยู่แล้วผ่าน `requireSeller`
      เดิม ไม่ต้องเพิ่ม route ใหม่) — การ์ดแสดง badge Visible/Hidden, In Filters/Not in Filters, จำนวน
      สินค้า — ปุ่ม Delete ขึ้น `confirm()` ก่อนเสมอ, error message จาก backend (บล็อกเพราะมีสินค้าผูกอยู่)
      โชว์ตรงผ่าน toast
- [x] **เพิ่มลิงก์ "Categories" ในทั้ง 4 หน้า admin** (`admin-shops.html`, `admin-orders.html`,
      `admin-stats.html`, `admin-categories.html` เอง) — **ไม่เพิ่ม** ลิงก์แยกใน 5 ไฟล์
      `seller-*.html` sidebar (ตามแบบเดิมที่ step 2/3 วางไว้ — seller sidebar มีแค่ลิงก์เดียวเป็น
      "ประตู" เข้า Admin Hub ผ่าน `/admin-shops`, จากนั้น admin เดินต่อผ่าน sidebar ของ Admin Hub เอง
      ไม่ต้อง duplicate ลิงก์ทุกหน้าย่อยกลับไปที่ seller sidebar)
- [x] **ทดสอบ**: DOM-stub test 11 เคส (`cardHTML()` — script-tag/`onerror`/style-attribute-breakout ใน
      name/image/color ทั้งหมดถูก escape ปลอดภัย, `onclick` ผูกกับ `c.id` (UUID จาก server) เท่านั้น
      ไม่เคยรับ name/slug เข้าไปเหมือนบั๊กเก่าที่เจอใน `categories.html`/`new-arrival.html`, ข้อความ
      เอกพจน์/พหูพจน์ "N product(s)" ถูกต้อง, badge Hidden/Not-in-Filters ขึ้นถูกเงื่อนไข) + live test
      12 เคสกับ local dev server จริง: non-admin (`role=customer`) โดน 403 ทั้ง `GET /categories/admin`
      และ `POST /categories`, admin list เห็น `product_count` ตรงจริง (Tops=7, Pants=3, Accessories=1,
      Skincare=0), slug ตัวพิมพ์ใหญ่/มีอักขระพิเศษโดน 400, สร้างหมวดพร้อม payload `<img
      src=x onerror=alert(1)>` ในชื่อสำเร็จ (เก็บดิบใน DB ตามหลักการ "escape ตอน render ไม่ใช่ตอน
      write" ที่ใช้ทั้งโปรเจกต์), สร้างซ้ำ slug เดิมโดน 409, PATCH แก้ name/color/is_active สำเร็จ, DELETE
      หมวดว่างสำเร็จ (200), DELETE ซ้ำ id เดิมที่ลบไปแล้วโดน 404, ผูกสินค้าจริง 1 ชิ้นเข้าหมวดทดสอบแล้ว
      DELETE โดนบล็อก 409 พร้อมข้อความบอกจำนวนถูกต้อง, `GET /api/products?category=` ยังหาสินค้าเจอปกติ
      แม้หมวดนั้นจะโดน block delete อยู่ (สมเหตุสมผล — แค่ลบไม่ได้ ไม่ได้แปลว่าใช้งานไม่ได้), `GET
      /api/categories` (public) ไม่กระทบเลย (ยังคืนแค่ active fields เท่าเดิม) — ลบ user/หมวด/แก้
      `category_id` ทดสอบคืนค่าเดิมหมดหลังทดสอบเสร็จ

### Step 5 — ค้นหา/ระงับบัญชีลูกค้า — ปิดแล้ว (2026-07-26)

ตรวจก่อนเริ่มพบว่า `GET /api/seller/customers` **มี route อยู่แล้วจริง** (list ลูกค้าทุกคนพร้อมยอดสั่งซื้อ
ไม่ scope ตาม shop) **แต่ไม่มี frontend page ไหนเรียกใช้เลยสักจุด** — เป็น route ที่เขียนไว้ตั้งแต่ก่อน
Admin UI plan แต่ไม่เคยต่อ UI จริง (ต่างจาก orders/stats ที่มี `seller-orders.html`/`seller.html` ให้
ดัดแปลงมาก่อน) ส่วนคอลัมน์สถานะบัญชี/route/หน้าสำหรับ suspend ไม่มีอยู่จริงตามที่บันทึกไว้ก่อนเริ่มแผนนี้

- [x] **`users.status` (schema, `db.js`)** — `TEXT NOT NULL DEFAULT 'active'` (`active`/`suspended`) ไม่มี
      CHECK constraint เหมือนทุก status field อื่นในโปรเจกต์นี้ (role/orders.status/shops.status) คุมแค่
      ระดับ app code — เพิ่ม `idx_users_status`
- [x] **Design decision (ตัดสินใจก่อนเขียนโค้ด, ไม่ได้ถามเจ้าของโปรเจกต์เพราะมี default ที่สมเหตุสมผล
      ชัดเจนจาก pattern เดิมของโปรเจกต์)**: **ไม่เพิ่มการเช็ค `status` เข้าไปใน `requireAuth`** (จะเพิ่ม DB
      query ให้ทุก request ที่ auth ทั้งแอป — cart/orders/wishlist/addresses/ฯลฯ ไม่ใช่แค่จุดที่เกี่ยวกับ
      suspend) แทนที่ด้วยการบล็อกที่ "choke point" การสร้าง/ต่ออายุ session แทน:
      `POST /auth/signin`, `POST /auth/refresh`, `GET /auth/google/callback`, Telegram callback ทั้ง 2
      ทาง (`GET /telegram/callback`, `POST /telegram/verify`), และ `GET /auth/me` (เช็คฟรีเพราะ query
      DB อยู่แล้ว, ให้ผลข้างเคียงที่ดีคือหน้าเว็บที่เรียก `AuthAPI.me()` ตอนโหลดทุกหน้าจะเด้งกลับ signin
      พร้อมข้อความทันทีถ้า token เก่ายังไม่หมดอายุแต่ถูก suspend ระหว่างนั้น) — suspend เพิ่ม revoke
      refresh token ทั้งหมดของ user นั้นทันที (`PATCH /seller/customers/:id/status`) ดังนั้นหน้าต่างสูงสุด
      ที่ session เก่ายังใช้ authenticated endpoint อื่นได้หลัง suspend คือแค่จนกว่า access token (15 นาที)
      จะหมดอายุเอง — **ไม่ได้แตะ Facebook OAuth callback** ตามคำสั่งเดิมใน CLAUDE.md §12 ("dead code ไม่ต้อง
      แตะถ้าไม่ได้รับคำสั่งให้เปิดใช้ใหม่") ความเสี่ยงต่ำมากเพราะ route นี้เข้าไม่ถึงจริงอยู่แล้ว (ปุ่มถูกซ่อน)
- [x] **`routes/auth.js`** — เพิ่ม `isSuspended(user)` + `SUSPENDED_MSG` ใช้ร่วมกันทุกจุดข้างบน — เช็ค
      "หลัง" verify รหัสผ่าน/OAuth/Telegram สำเร็จเสมอ ไม่ใช่ก่อน กันไม่ให้คนที่ไม่รู้รหัสผ่านรู้ได้ว่า
      email นี้มีบัญชีจริงและถูกระงับอยู่ (เหมือน pattern "prevent email enumeration" ที่ forgot-password
      ใช้อยู่แล้ว) — `POST /refresh` เจอ user ที่ suspended จะ revoke token ที่เหลือซ้ำอีกชั้น (กันเคส
      race ที่ token ใหม่ถูกออกในช่วงสั้นๆ ระหว่าง revoke query ตอน suspend กับ request ที่กำลังชนกันพอดี)
- [x] **`routes/seller.js`** — แก้ `GET /customers` เพิ่ม `?search=` (ILIKE name/email), `?status=` filter,
      คืน field `status` เพิ่ม, บั๊มพ์ `LIMIT` 100→200 (additive ล้วนๆ ไม่ส่ง query param ก็พฤติกรรมเดิม
      ทุกอย่าง — ไม่มีใครเรียกอยู่แล้วแต่รักษา backward-compat ไว้เผื่ออนาคต) — เพิ่ม
      `PATCH /customers/:id/status` **admin-only** (ไม่ใช้ `requireSeller` — seller ต้องระงับบัญชีลูกค้า
      ไม่ได้เด็ดขาด) เช็คว่า target ต้องเป็น `role='customer'` เท่านั้น (400 ถ้าไม่ใช่ — กัน admin เผลอ
      suspend บัญชี seller/admin ผ่าน endpoint นี้ ซึ่งมีเส้นทางของตัวเองอยู่แล้วคือ `shops.status`/
      เปลี่ยน role) same-status guard (400, pattern เดียวกับ `PATCH /shops/:id`) suspend สำเร็จ → revoke
      `refresh_tokens` ทั้งหมดของ user นั้นทันที
- [x] **`public/admin-customers.html`** — หน้าใหม่ โครง filter-bar/search-input/CSS-grid table ตาม
      `admin-orders.html` (ยังไม่มี frontend เดิมให้ต่อยอดเหมือน step 2/3 — เขียนใหม่ทั้งหน้า) filter tab
      All/Active/Suspended + search client-side (โหลดครั้งเดียว filter ในเบราว์เซอร์ เหมือน
      `admin-orders.html` ไม่ได้ debounce เรียก server ซ้ำ) ปุ่ม Suspend มี `confirm()` (บอกชัดว่าจะโดน
      sign out ทุกที่ทันที), Reactivate ไม่ต้อง confirm (symmetric กับ pattern shops's reinstate)
- [x] **เพิ่มลิงก์ "Customers" ในทั้ง 5 หน้า admin** (shops/orders/stats/categories/customers เอง)
- [x] **ทดสอบ**: DOM-stub test 13 เคส (`rowHTML()` — XSS ผ่าน name/email/avatar ถูก escape ปลอดภัยหมด,
      `onclick` ผูกกับ `c.id` (UUID) เท่านั้นไม่เคยรับ name, badge/action button ถูกต้องตามสถานะ, money
      format ปัดทศนิยม 2 ตำแหน่งแม้ Postgres คืน numeric เป็น string) + live test 14 เคสกับ local dev
      server จริง: non-admin โดน 403 ทั้งเรียก PATCH เอง, admin PATCH ซ้ำสถานะเดิม/ค่า invalid/self
      (admin เอง, role≠customer)/id ไม่มีจริง โดน 400/400/400/404 ถูกต้อง, suspend สำเร็จ (200) →
      **verify ตรงจาก DB ว่า `refresh_tokens` ทั้งหมดของ user นั้นโดน revoke ทันที** (2 token จริง
      revoked_at ไม่ null), access token เก่าที่ยังไม่หมดอายุยิง `GET /auth/me` โดน 403
      `ACCOUNT_SUSPENDED`, sign in ซ้ำด้วยรหัสผ่านถูกต้องโดน 403 เหมือนกัน, reactivate สำเร็จ (200) →
      sign in ใหม่ได้ปกติทันที, `?search=`/`?status=` filter ทำงานถูกต้อง — ลบ user ทดสอบ+refresh token
      คืนหมดหลังทดสอบเสร็จ

### Step 6 — ตรวจสอบ seller dashboard เดิม — ปิดแล้ว (2026-07-26)

Audit แบบ "หาก่อน ห้ามแก้" ทั้ง 5 ไฟล์ (`seller.html`, `seller-orders.html`, `seller-products.html`,
`seller-coupons.html`, `seller-analytics.html`) แล้วรายงานให้เจ้าของโปรเจกต์ตัดสินใจก่อนแก้ (pattern
เดียวกับ "Audit orders.html/payment.html" ก่อนหน้านี้) — เจอ 8 เรื่อง อนุมัติแก้ทั้งหมด:

- [x] **1 — `seller-products.html` stock=0 เป็น unlimited แทนที่จะเป็น 0**: `parseInt(...)||null` เดิม
      collapse `0` (falsy ใน JS) ไปเป็น `null` (unlimited) — seller ตั้งสินค้า "หมด" (0 ชิ้น) ผ่านฟอร์มไม่
      ได้เลย แก้เป็นเช็ค empty-string แยกจาก parse ตรงๆ (`stockRaw===''?null:parseInt(stockRaw)`) —
      ทดสอบ unit 6 เคส + ยิงจริง `PATCH /seller/products/:id {stock:0}` ยืนยัน DB เก็บ `0` จริงไม่ใช่ `null`
- [x] **2 — `seller-products.html` unescaped image URL ใน modal preview**: `renderImgGrid()`'s
      `<img src="${img.url}">` (ช่อง "paste Image URL") ไม่ผ่าน `escapeHtml()` เหมือนทุกจุดอื่นที่ render
      รูปสินค้า (product.html, product grid card, seller-orders.html's item preview ล้วน escape หมด) —
      self-XSS ผ่านการ paste URL ที่ปนโค้ดเข้าไป แก้ให้ escape เหมือนจุดอื่น — DOM-stub 2 เคสยืนยัน
- [x] **3 — `seller-orders.html`'s `saveNote()` แกล้งสำเร็จเงียบๆ เมื่อพัง**: catch block เดิมกลืน error
      ทุกชนิด (session หมดอายุ/500/เน็ตกระตุก) แล้วโชว์ "Note saved (local)" เหมือนสำเร็จ — เป็น workaround
      ค้างจากก่อนที่ endpoint `PATCH /seller/orders/:id/note` จะมีจริง (มีมาตั้งแต่ Phase 5 Step 2 แล้ว)
      แก้ให้โชว์ error จริงแทน — ทดสอบ happy-path จริงผ่าน live server
- [x] **4 — `seller.html`'s Recent Orders ไม่มี badge style สำหรับ `failed`**: เพิ่ม `.b-failed` CSS +
      เพิ่ม `failed:'Failed'` ใน `fmtStatus()` (seller-orders.html มี `.b-failed` อยู่แล้ว จุดนี้ขาดจุดเดียว)
- [x] **5 — `seller-analytics.html`'s trend badge (`aRevTrend`) ตายค้าง**: hardcode "up" ว่างเปล่า
      ไม่เคยถูกเซ็ตค่าจาก JS เลยสักจุด — เอาออก เปลี่ยน subtitle เป็นบอกช่วงเวลา/เกณฑ์แทน (ไม่ implement
      trend comparison จริงเพราะต้องเพิ่ม backend query ใหม่ นอกขอบเขตที่ขอ)
- [x] **6 — `seller-orders.html` mask backdrop มี inline `onclick` ที่ไม่ทำงาน**:
      `onclick="e=>e.target===this&&closeMask()"` เป็น arrow-function expression ที่สร้างแล้วไม่เคยถูก
      เรียกจริง (ไม่ error แค่ no-op) — ปิด-modal-เมื่อคลิก-นอก-modal ทำงานได้จริงจาก `addEventListener`
      แยกอีกจุดที่มีอยู่แล้ว — ลบ attribute ที่ตายทิ้ง
- [x] **7 — workflow "Pending Review"/pending_verification ตายแล้วทั้งระบบ**: ปุ่ม customer self-attest
      "I've Paid" ที่เคยตั้งสถานะนี้ถูกลบไปตั้งแต่ 2026-07-23 — ไม่มีจุดไหนตั้งสถานะนี้อีกเลย แต่ UI ยังเต็ม
      (seller.html's "Pending Review" stat+alert banner, seller-orders.html's "Review" tab+quickConfirm,
      seller-analytics.html's funnel "Reviewing" row) **ตรวจก่อนแก้เจอว่าอันตราย**: local dev DB มี
      **9 order จริงของร้าน "hnungh"** ยังค้างสถานะนี้อยู่จริง (ก่อนแก้ self-attest) ถามเจ้าของโปรเจกต์ก่อน
      ตัดสินใจ — เลือก **ลบ UI ทั้งหมดตามแผนเดิม** (ไม่ใช่เก็บ badge/alert แบบมีเงื่อนไข) โดยที่ backend ยัง
      resolve order เก่ากลุ่มนี้ได้ปกติ:
  - `routes/seller.js`'s `ALLOWED_TRANSITIONS.pending`: `['pending_verification','paid','cancelled']` →
    `['paid','cancelled']` (ตัด target ออก) — **`pending_verification: ['paid','cancelled']` เก็บไว้เป็น
    source เหมือนเดิม** ให้ order เก่าที่ยังค้างอยู่ resolve ได้ปกติ ไม่ใช่ตายค้างถาวร
  - `seller-orders.html`: ลบ "Review" filter tab, `quickConfirm()` + ปุ่ม quick-action, `pendingBadge`
    sidebar, `.act-btn.confirm` CSS ที่ตายตามไปด้วย — `ALLOWED_NEXT`/`PAYMENT_STATUS`/badge CSS สำหรับ
    `pending_verification` **เก็บไว้** ให้ order เก่าเปิดผ่าน "All" tab แล้วกด Confirm Payment/Cancel
    ปกติได้เหมือน order อื่น (ไม่มี fast-path พิเศษอีกต่อไปเฉยๆ)
  - `seller.html`: ลบ "Pending Review" stat card + `pendingAlert` banner + `pendingBadge` sidebar,
    `.stats-grid` ปรับ 4→3 คอลัมน์
  - `pendingOrders` field ใน `GET /seller/stats` **ไม่ได้ลบ** (ทั้ง admin/seller branch) — ยังมีประโยชน์
    จริง: เป็นวิธีเดียวที่ admin/seller จะสังเกตเห็นว่ามี order เก่าค้างอยู่กี่ใบ (ใช้ตรวจ 9 ใบข้างบนได้)
  - **ทดสอบจริง**: PATCH order `pending`→`pending_verification` ยืนยันโดน 400 (`allowedNext:
    ["paid","cancelled"]`) แล้ว, PATCH `pending`→`cancelled` ยังสำเร็จปกติ, seed order เก่าจำลอง
    `pending_verification`→`cancelled` (legacy resolve path) สำเร็จ 200, `statusBreakdown` คืนค่า
    `pending_verification` ถูกต้องเมื่อมีจริงในช่วงเวลาที่เลือก — ยืนยัน 9 order จริงของ "hnungh" **ไม่ถูก
    แตะเลย** (นับซ้ำก่อน/หลังทุกการเปลี่ยนแปลง เท่ากันทุกครั้ง)
- [x] **8 — `seller-analytics.html` คำนวณเองแทนเรียก `/seller/stats`**: เดิมดึง
      `GET /seller/orders?limit=500` มา aggregate เองทั้งหมด (revenue/AOV/conversion/top-products/funnel/
      กราฟ) แยกจาก `seller.html` ที่เรียก `/seller/stats` อยู่แล้ว — เสี่ยงตัวเลขเพี้ยนกันเอง (คนละ logic)
      และ undercount เงียบๆ ถ้าร้านมี order เกิน 500 ใบ — **แก้ให้เรียก `/seller/stats?days=N` แทนทั้งหมด**
      ต้องขยาย backend ก่อน เพราะ seller branch เดิม**ไม่รับ `?days=` เลยสักจุด** (ตอบ all-time/7-day คงที่
      เสมอไม่ว่าจะส่งอะไรมา — ค้นพบระหว่างแก้ ไม่ใช่รู้ล่วงหน้า):
  - `routes/seller.js`'s `GET /stats` — seller branch (ordersRes/revenueRes/customersRes/dailyRes/
    statusRes/topRes) เพิ่ม period filter (`make_interval(days=>$2)`) ให้ครบทุก query เหมือน admin branch
    (เดิมมีแค่ `dailyRes` ที่ scope 7 วันคงที่ ที่เหลือเป็น all-time หมด)
  - `dailyRes` (seller branch) เปลี่ยนจาก group by ชื่อวัน (`'Dy'`, ใช้ได้แค่ 7 วันพอดี) เป็น group by
    วันที่จริง (`'YYYY-MM-DD'`) — **บั๊กเดียวกับที่เจอ+แก้ไปแล้วฝั่ง admin ตอน Admin UI step 3** แต่ตอนนั้น
    ตั้งใจไม่แตะฝั่ง seller เพราะยังไม่มีใครเรียกด้วย `?days=` — ตอนนี้ต้องแก้เพราะ seller-analytics.html
    เรียกจริงแล้ว — เพิ่ม `COUNT(DISTINCT os.id) AS orders` ในควิรีเดียวกันเลย (คนละ field จาก revenue)
    เป็น field ใหม่ `dailyOrders` ในผลลัพธ์ (ใช้กราฟ "Orders Per Day" ที่ seller-analytics.html มีอยู่แล้ว)
  - `topRes` (seller branch) เพิ่ม `SUM(oi.quantity) AS units` (คอลัมน์ "Units" ใน Top Products table เดิม
    ใช้ field นี้ ถ้าไม่เพิ่มจะหายไปตอนสลับมาใช้ endpoint นี้) — เป็น field เสริมเฉพาะ seller branch, admin
    branch ไม่แตะ (admin-stats.html ไม่ใช้ field นี้)
  - `zeroStats()` (ไม่มีร้าน approved) แก้ให้รับ `periodDays` แทน hardcode 7-day-name เดิม เพื่อให้ shape
    ตรงกับ response จริงเสมอ
  - `seller-analytics.html` เขียนใหม่ทั้ง `<script>`: ลบ `groupByDay()`/`getDayLabels()`/`_allOrders` ทิ้ง
    หมด เรียก `/seller/stats?days=${_period}` ตรงๆ ผ่าน `setPeriod()` — stat card 4 ใบยังอยู่ครบ (Revenue/
    Orders/AOV/Conversion) แต่ Orders เปลี่ยนความหมายจาก "completed orders" (client filter เอง) เป็น
    "excl. cancelled & expired" (ตรงกับที่ `totalOrders` backend ให้จริง — ปรับ subtitle ให้ตรงด้วย) —
    AOV/Conversion derive จาก `statusBreakdown` ที่ได้มา (`paid+processing+shipped+delivered` count) หาร
    ด้วย revenue/totalOrders แทนการนับเองจาก order array — **funnel เปลี่ยนจาก bucket ตายตัว 6 อันเป็น
    data-driven จาก `statusBreakdown` จริง** — "Reviewing" (pending_verification) โผล่เฉพาะมีจริง (>0)
    ไม่ใช่แถวที่โชว์ 0 ตลอดแบบเดิม — ใช้ `fmtDayLabel()` เดียวกับ `admin-stats.html` แปลง `YYYY-MM-DD` เป็น
    "20 Jul" style
  - **ทดสอบจริง**: สร้างร้าน/สินค้า/ลูกค้าทดสอบเฉพาะกิจ ยิง order ตรงเข้า DB คุมวันที่เอง (0/1/3/10/40/85
    วันก่อน, สถานะผสม paid/delivered/cancelled/pending) แล้วเทียบเลขที่ `/seller/stats?days=7/30/90` ตอบ
    กับเลขที่คำนวณมือจากข้อมูลที่ seed ไว้ — **ตรงทุกตัวเลขทั้ง 3 ช่วงเวลา** (totalOrders/totalRevenue/
    statusBreakdown/topProducts.units) ยืนยัน bucket วันที่ไม่ชนกันข้าม 90 วัน (5 วันที่มีข้อมูลจริง
    กระจายเป็น 5 entry แยกกันถูกต้อง ไม่ยุบรวม), regression เช็ค `GET /seller/stats` (ไม่ส่ง `?days=`) กับ
    `GET /seller/orders` ยังทำงานปกติทุกอย่าง — DOM-stub 10 เคสเพิ่มเติมสำหรับ `buildFunnel()` (Reviewing
    ซ่อน/โผล่ถูกเงื่อนไข, Total sum ถูกต้อง) และ `buildTopProds()` (units แสดง `—` แทน `undefined` เมื่อไม่มี
    ค่า) — ลบข้อมูลทดสอบหมดแล้ว ยืนยัน order จริง 9 ใบของ "hnungh" ไม่กระทบ
- **syntax-check**: parse ทุกไฟล์ที่แก้ผ่าน `new Function()` ยืนยันไม่มี syntax error หลุดก่อน commit —
  ทุกหน้า seller-*.html ยังเสิร์ฟ 200 ปกติหลังแก้ครบ
- ~~**พบเพิ่มนอกขอบเขต ไม่ได้แก้**: `admin-orders.html`/`admin-stats.html` มี "Review" tab/
  `quickConfirm()`/"Pending Review" stat แบบเดียวกับ seller dashboard~~ **แก้แล้ว (2026-07-26, follow-up
  ทันทีหลัง Step 6)** — เจ้าของโปรเจกต์ขอให้จัดการต่อแบบเดียวกัน:
  - `admin-orders.html`: ลบ "Review" filter tab, `quickConfirm()` + ปุ่ม quick-action แถวตาราง,
    `.act-btn.confirm` CSS ที่ตายตามไป, `ALLOWED_NEXT.pending` ตัด `pending_verification` ออกจาก target
    (เก็บไว้เป็น source เหมือนเดิม) — เหมือน seller-orders.html เป๊ะ
  - `admin-stats.html`: ลบ "Pending Review" stat card (การ์ดที่ 6 จาก 6) + JS ที่ set ค่า + `.c-yellow`
    CSS ที่ตายตามไป (grid เหลือ 5 การ์ด ไม่ต้องปรับ column เพราะเดิมเป็น `repeat(3,1fr)` wrap 2 แถวอยู่แล้ว)
    — สถานะ `pending_verification` ใน status-breakdown donut chart **ไม่แตะ** (data-driven จริงอยู่แล้ว
    โผล่เฉพาะมีข้อมูลจริง ไม่ใช่ pattern ตายตัวแบบที่ลบไป)
  - **เจอเพิ่มระหว่างแก้ (ไม่ได้อยู่ใน request แต่เป็นบั๊กคลาสเดียวกันที่เพิ่งแก้ไปฝั่ง seller)**:
    `admin-orders.html`'s `saveNote()` มี silent-fallback "Note saved (local)" เหมือนที่เจอใน
    seller-orders.html เป๊ะ (ไฟล์นี้ก็อปมาจาก seller-orders.html ตั้งแต่ Admin UI step 2) และ mask backdrop
    มี dead inline `onclick` เดียวกันด้วย — แก้ตามไปพร้อมกันเลยเพราะเป็น fix pattern เดียวกันที่อนุมัติไปแล้ว
  - `pendingOrders` field ใน `/seller/stats` **ยังเก็บไว้เหมือนเดิม** (ไม่ได้ลบออกจาก backend) — ยังมี
    ประโยชน์เป็นข้อมูลดิบเผื่อใช้ต่อในอนาคต แค่ไม่มี UI การ์ดพิเศษโชว์อีกแล้ว
  - **ทดสอบจริง**: syntax-check ผ่านทั้ง 2 ไฟล์, grep หา marker ที่ลบไปแล้ว (`tab-pv`/`quickConfirm`/
    `sPending`) ไม่เจอเหลือค้างที่ไหนในโปรเจกต์เลย, ยิงจริง `GET /admin-orders`/`GET /admin-stats` คืน 200
    ไม่มี marker ที่ลบไปหลงเหลือใน HTML, `GET /api/seller/orders?limit=500`/`GET /api/seller/stats`
    (ทั้งไม่ส่ง `?days=` และ `?days=30`) ยิงจริงด้วย admin token ยังทำงานปกติทุกอย่าง, ยืนยัน order จริง 9
    ใบของ "hnungh" ที่ยังค้าง `pending_verification` **ไม่ถูกแตะเลย** (นับ count ก่อน/หลังเท่ากัน 9 เหมือนเดิม)

### Step 7 — คูปองแยกตามร้านจริง (เสี่ยงสุดในแผน 8 step — แตะ checkout math โดยตรง) — กำลังทำทีละ sub-step

สำรวจโค้ดก่อนเริ่ม (2026-07-26) พบว่า access control (ใครสร้าง/แก้/ลบคูปองได้) scope ตามร้านแล้วจริงตั้งแต่
"Part A" (2026-07-24) **แต่ discount computation ตอน checkout ไม่เคย scope ตามร้านเลย** —
`routes/payment.js`'s `POST /create` หา coupon จาก `code` อย่างเดียว ไม่เช็ค `shop_id` เทียบกับร้านที่มีของ
อยู่ในตะกร้าเลยสักจุด (มีคอมเมนต์ยอมรับไว้ตรงๆ ใน `routes/coupons.js`: "Deliberately NOT touching checkout
discount math here") — คูปองร้าน A ใช้ลดได้แม้ตะกร้าไม่มีของร้าน A เลย และถ้าตะกร้าผสม A+B จะลดจาก subtotal
รวมทั้งสองร้าน ไม่ใช่แค่ของร้าน A **Exposure ตอนสำรวจ**: ร้าน approved จริง 2 ร้าน, ตาราง `coupons` ว่างเปล่า
(ไม่มีคูปอง active เลย), ไม่มี multi-shop order เกิดขึ้นจริงเลย — ยืนยันว่าเป็นการแก้ก่อนเป็นปัญหาจริง ไม่ใช่
incident ที่กำลังเกิดอยู่

**Design decision (ถามเจ้าของโปรเจกต์ก่อนเขียนโค้ด)**: เลือก **แยกตามร้านจริง** — คูปองร้าน A ลดเฉพาะ
subtotal ของร้าน A ในตะกร้า (`min_order` เทียบกับยอดร้าน A เท่านั้น ไม่ใช่ยอดทั้งตะกร้า) ถ้าตะกร้าไม่มีของ
ร้าน A เลยจะใช้โค้ดไม่ได้ (error ชัดเจน) — คูปองส่วนกลาง (`shop_id IS NULL`) พฤติกรรมเดิมทุกอย่าง ลดทั้งตะกร้า

แบ่งเป็น 5 sub-step ตามความเสี่ยง ทำทีละอันแบบ audit-first (ทดสอบจริงก่อน commit ทุกอัน รอไฟเขียวก่อนไปต่อ
โดยเฉพาะ 7b ที่เสี่ยงสุด):

- [x] **7a — Schema (`db.js`)** — ปิดแล้ว (2026-07-26) — เพิ่ม `order_shops.discount NUMERIC(10,2) NOT
      NULL DEFAULT 0` (แยกจาก `subtotal` เหมือน `orders.subtotal`/`orders.discount` ที่เป็นคนละคอลัมน์กัน
      อยู่แล้ว) — แถวเก่าได้ `0` ตาม default ไม่ retroactive คำนวณย้อนหลัง (ยอมรับเป็น known limitation
      เหมือน shop_id backfill ตอน Phase 5 Step 1) — ยังไม่มี route ไหนอ่าน/เขียนคอลัมน์นี้จนกว่าจะถึง 7b
  - **ทดสอบจริง**: start server ยืนยัน migration รันไม่ error, query `information_schema.columns`
    ยืนยัน type `NUMERIC(10,2)`, `NOT NULL`, `default '0'` ตรงตามที่ตั้งใจ, สุ่มดูแถวเก่าจริง 5 แถว
    (137 แถวทั้งหมด) ยืนยัน `discount='0.00'` ไม่มีแถวไหนเป็น `NULL`, restart server รอบที่ 2 ยืนยัน
    idempotent (ไม่ error ซ้ำ), regression เช็ค `GET /api/health`/`GET /api/products` ยังทำงานปกติ
    (ไม่กระทบอะไรเลยเพราะเป็น additive ล้วนๆ)
- [x] **7b — `routes/payment.js`'s `POST /create`** — ปิดแล้ว (2026-07-27) — ย้าย shop-grouping (เดิมคำนวณ
      แค่สำหรับ Phase 5 dual-write ตอนท้าย) ขึ้นมาก่อน coupon block พร้อมคำนวณ `shopSubtotals` คู่กันไว้
      reuse ทั้งสองจุด (ไม่คำนวณซ้ำ) — คูปองร้าน (`c.shop_id` ไม่ null): เช็คว่าตะกร้ามีของร้านนั้นไหม
      (`shopGroups.has(c.shop_id)`) ถ้าไม่มีปฏิเสธทันที (400, `code:'COUPON_SHOP_MISMATCH'`, ข้อความมีชื่อ
      ร้านจริงจาก `LEFT JOIN shops`) — `min_order`/percent/fixed คำนวณจาก `shopSubtotals.get(c.shop_id)`
      (ยอดเฉพาะร้านนั้น) ไม่ใช่ยอดทั้งตะกร้า — คูปองส่วนกลาง (`shop_id IS NULL`) ยังคำนวณจาก `subtotal`
      ทั้งตะกร้าเหมือนเดิมทุกอย่าง — เพิ่ม `couponShopId` track ว่า discount ควร attribute ให้ `order_shops`
      แถวไหน (เป็น null ทั้งกรณี "ไม่มีคูปอง" และ "คูปองส่วนกลาง" — discount ทั้งตะกร้าไม่ attribute ให้
      ร้านใดร้านหนึ่งเป็นพิเศษ, ตั้งใจไม่ทำ proportional split เพราะไม่ได้อยู่ใน scope ที่ตกลงกันไว้) —
      `FOR UPDATE` เดิมเปลี่ยนเป็น `FOR UPDATE OF c` เพราะเพิ่ม `LEFT JOIN shops` แล้ว (Postgres ไม่ยอมให้
      lock ฝั่ง nullable ของ outer join)
  - **ทดสอบจริงกับ local dev server (สร้างร้านทดสอบ 2 ร้าน+สินค้าจริง+คูปองจริง)**: (1) ตะกร้าร้านเดียว+
    คูปองร้านนั้น → `discount=$2` ถูกต้อง (regression), (2) ตะกร้าผสม A($20)+B($30)+คูปองร้าน A → ลดแค่
    `$2` จากยอด A เท่านั้น ไม่ใช่ `$5` จากยอดทั้งตะกร้า, `order_shops`: A discount=2, B discount=0 ตรงตาม
    ออกแบบ, (3) ตะกร้ามีแต่ร้าน B + คูปองร้าน A → โดนปฏิเสธ 400 พร้อมชื่อร้านจริงในข้อความ, rollback สะอาด
    (stock/coupon usage/order ไม่ถูกสร้างค้าง), (4) ยิงจริงผ่าน ABA PayWay sandbox (ไม่ mock) ทุกเคสที่
    สำเร็จได้ QR จริงกลับมา + เรียก `POST /confirm` จริงสำเร็จ (คืน `pending` เพราะไม่ได้จ่ายจริง ยืนยันแค่
    integration path ไม่พัง) — **bonus tests ระหว่างทาง**: คูปองส่วนกลางบนตะกร้าผสมยังลดทั้งตะกร้าเหมือนเดิม
    (`order_shops.discount=0` ทั้งสองร้าน ตามดีไซน์), ไม่มีคูปองเลยไม่กระทบ, **`min_order` เทียบกับยอดร้าน
    นั้นจริงไม่ใช่ยอดทั้งตะกร้า** (สร้างเคสจงใจ: ตะกร้า A+B รวม $50 ผ่าน min_order$25 ถ้าเช็คทั้งตะกร้า แต่
    A เดี่ยวๆ แค่ $20 ไม่ถึง → ถูกปฏิเสธถูกต้อง — จุดที่เสี่ยงพลาดง่ายที่สุด), `GET /api/orders/:id` ยังทำงาน
    ปกติมี `shops[]` breakdown ครบ — ลบข้อมูลทดสอบหมดแล้ว ยืนยันร้านจริง 2 ร้าน + order ประวัติศาสตร์ไม่ถูก
    แตะเลย
- [x] **7c — `routes/coupons.js`'s `POST /validate`** — ปิดแล้ว (2026-07-27) — เพิ่มรับ `items` array
      (นอกเหนือจาก `total` เดิม) แล้ว re-derive price/shop_id จาก DB ต่อ item (หลักการเดียวกับ
      `payment.js` — ไม่เชื่อราคา/subtotal จาก client) คำนวณ `shopSubtotals` แบบเดียวกับ Step 7b เป๊ะ รวม
      เช็ค `COUPON_SHOP_MISMATCH` ด้วย — **ตั้งใจทำ backward-compatible**: ถ้า client ยังส่ง `{code,total}`
      แบบเดิม (ก่อน step 7d จะเปลี่ยน `checkout.html`) จะ fallback ไปพฤติกรรมเดิมทุกอย่าง (คำนวณจาก whole-cart
      total ที่ client ส่งมา ไม่เช็ค shop match เพราะไม่รู้ว่าตะกร้ามีอะไรบ้าง) — เหตุผล: ถ้าทำ breaking
      change ตรงๆ แล้ว deploy 7c ก่อน 7d จะเสร็จ (repo นี้ auto-deploy ทุก push ขึ้น main) หน้า checkout จริง
      จะพังทันทีเพราะ `checkout.html` ยังส่ง `total` อยู่ — backward-compat shim นี้ทำให้ deploy 7c เดี่ยวๆ
      ได้อย่างปลอดภัย 100% ตั้งใจลบ branch เดิมทิ้งตอน 7d เสร็จ (ไม่มีใครส่ง `total` อีกแล้ว)
  - **พบเพิ่มระหว่างสำรวจ (ไม่ใช่บั๊กที่ต้องรีบแก้ แต่แก้เองโดยอัตโนมัติหลัง 7d)**: `checkout.html`'s
    `applyCoupon()` เดิมส่ง `total = subtotal + shipCost` (รวมค่าส่ง) ไปให้ `/validate` ตรวจ `min_order` —
    ต่างจาก `payment.js`/endpoint นี้แบบใหม่ที่เช็ค `min_order` จาก subtotal อย่างเดียว (ไม่รวมค่าส่ง) —
    ความไม่ตรงกันเล็กน้อยนี้มีอยู่ก่อน Step 7 แล้ว จะหายไปเองพอ 7d เปลี่ยนไปส่ง `items` แทน (endpoint คำนวณ
    subtotal เองจาก DB ไม่ใช้เลขที่ client ส่งมาอีกต่อไป)
  - **ทดสอบจริง**: สร้างร้านทดสอบ 2 ร้าน+สินค้า+คูปองใหม่ (เหมือน 7b) — shape ใหม่ (`items`): ตะกร้าร้าน
    เดียว+คูปองร้านนั้น → discount=$2 ตรง, ตะกร้าผสม+คูปองร้าน A → discount=$2 (ไม่ใช่ $5), ตะกร้ามีแต่ร้าน
    B+คูปองร้าน A → 400 `COUPON_SHOP_MISMATCH`, คูปองส่วนกลางบนตะกร้าผสม → ลดทั้งตะกร้า ($5 จาก $50) ไม่
    เปลี่ยนพฤติกรรม, product id ปลอม/ไม่มีจริงปนอยู่ใน items → ถูกข้ามเงียบๆ ไม่ crash, `min_order` เทียบ
    กับยอดร้าน A เท่านั้นไม่ใช่ทั้งตะกร้า (เคสเดียวกับที่ทดสอบใน 7b) → ปฏิเสธถูกต้อง — shape เดิม
    (`{code,total}`) จำลอง checkout.html ก่อน 7d: total=50, คูปองร้าน A → discount=$5 (10% ของ 50 ตรงๆ
    ไม่เช็ค shop match) ยืนยัน backward-compat ทำงานตรงตามที่ตั้งใจ 100% — items ว่างเปล่า `[]` ไม่ crash
    (fallback เป็น 0) — ลบข้อมูลทดสอบหมดแล้ว ยืนยันร้านจริง 2 ร้าน + order ประวัติศาสตร์ไม่ถูกแตะเลย
- [x] **7d — `checkout.html`** — ปิดแล้ว (2026-07-27) — `applyCoupon()` เปลี่ยนจากส่ง
      `total = subtotal + shipCost` เป็นส่ง `ITEMS.map(it => ({id, quantity}))` ตรงๆ ให้ backend re-derive
      เอง — `api.js`'s `CouponsAPI.validate(code, total)` เปลี่ยน signature เป็น `validate(code, items)`
      (ใช้แค่จุดเดียวในโปรเจกต์ ตรวจแล้วก่อนแก้) — ไม่ต้องเพิ่ม error-handling พิเศษสำหรับ
      `COUPON_SHOP_MISMATCH` เลย เพราะ `errEl.textContent = e.message` ที่มีอยู่แล้วโชว์ข้อความจาก server
      ตรงๆ อยู่แล้ว (ตรวจ `apiFetch()`'s error throwing ยืนยันว่า `e.message` = `data.error` เป๊ะ) — **ลบ
      legacy `{code,total}` fallback ออกจาก `routes/coupons.js`'s `/validate` แล้ว** (Step 7c ทำไว้ชั่วคราว
      เพื่อความปลอดภัยตอน deploy คนละรอบ ตอนนี้ไม่มีใครส่ง `total` แล้วจริงๆ) — request ที่ไม่มี `items` เลย
      ตอนนี้ตอบ 400 `"Cart is empty."` แทนที่จะพยายามตีความ `total`
  - **ทดสอบจริง**: yิงตรงด้วย shape ใหม่ที่ `checkout.html` ส่งจริง (`{code, items:[{id,quantity}]}`) —
    ตะกร้าเดียว/ผสม/mismatch ตรงผลเหมือน 7c ทุกตัวเลข, ยิง shape เก่า (`{code,total}`) ยืนยันโดน
    `"Cart is empty."` อย่างปลอดภัยไม่ crash (ไม่มีใครส่งแบบนี้จริงแล้วเพราะ frontend เปลี่ยนแล้ว แค่ยืนยัน
    fail-safe), **end-to-end consistency check**: เรียก preview (`/coupons/validate`) แล้วเรียก checkout
    จริง (`/payment/create`) ด้วยตะกร้า+คูปองชุดเดียวกัน → discount preview ($2) ตรงกับ discount จริงที่
    เกิดขึ้นตอน checkout เป๊ะ (amount=$48 ตรงตามคาด) — ยืนยันว่า preview กับของจริงสอดคล้องกัน 100% ตาม
    เป้าหมายที่ตั้งไว้ตอนเริ่ม Step 7c — syntax-check ผ่านทั้ง `checkout.html`/`api.js`/`coupons.js` — ลบ
    ข้อมูลทดสอบหมดแล้ว ยืนยันร้านจริง 2 ร้าน + order ประวัติศาสตร์ไม่ถูกแตะเลย
- [x] **7e — Display** — ปิดแล้ว (2026-07-27) — **Step 7 ปิดครบทั้ง 5 sub-step แล้ว**
  - `routes/seller.js`'s `GET /orders` — เพิ่ม `os.discount AS own_discount` ใน SELECT + field `own_discount`
    ในผลลัพธ์ (คู่กับ `own_subtotal` เดิม — ทั้งคู่ยังไม่มีหน้าไหนใน UI render จริง เหมือน `own_subtotal`
    เดิมที่เพิ่มไว้ตั้งแต่ Phase 5 Step 2 ก็ไม่เคยถูกใช้ใน UI เหมือนกัน — เพิ่มไว้เป็น data parity/เผื่ออนาคต
    ตามที่ตกลงไว้ตอนวางแผน 7e ไม่ใช่ bug ที่ต้องรีบต่อ UI)
  - `routes/orders.js`'s `attachShops()` — เพิ่ม `os.discount` ใน SELECT + field `discount` ใน `shops[]`
    breakdown ที่คืนจาก `GET /orders`/`GET /orders/:id` (additive ล้วนๆ ตาม pattern เดิมของ Phase 5 Step 3
    เป๊ะ)
  - `order-detail.html`'s `renderShopBreakdown()` — เพิ่มบรรทัด "Discount: -$X" ต่อร้าน (โชว์เฉพาะร้านที่
    `discount>0` เท่านั้น) ในการ์ด "Fulfilled by N Shops" — ยังคง gate ด้วย `shops.length>1` เหมือนเดิม
    (order เดียวร้านเดียวไม่มีการ์ดนี้เลย ไม่กระทบ)
  - `success.html`'s `_renderItemsByShop()` — เพิ่ม note "· -$X off" ต่อท้ายชื่อร้านในหัวข้อกลุ่ม (โชว์
    เฉพาะร้านที่ `discount>0`) — escape ผ่าน `_esc()` เหมือนเดิม (XSS-safe แม้เพิ่ม note เข้าไป)
  - **ทดสอบจริง**: DOM-stub 8 เคส (`renderShopBreakdown()`/`_renderItemsByShop()` — โชว์ discount เฉพาะร้าน
    ที่มีจริง, ร้านอื่นในออเดอร์เดียวกันไม่โชว์, order เดียวร้านเดียวไม่ render breakdown เลย (unchanged),
    XSS-safe แม้มี discount note ต่อท้าย shop_name) + live test กับ local dev server จริง: สร้างร้าน/
    สินค้า/คูปองทดสอบ เดิน checkout จริงข้าม 2 ร้าน+คูปองร้าน A → `GET /orders/:id`'s `shops[]` คืน
    Shop A discount=2.00/Shop B discount=0.00 ตรงเป๊ะ, `GET /seller/orders` (มุมมอง admin) คืน
    `own_discount` ตรงกันทั้งสองร้าน, ทดสอบ regression order เดียวร้านเดียว+คูปอง → `shops[]` มี 1 entry
    discount=2.00 ถูกต้อง (breakdown card ไม่ขึ้นเพราะ `shops.length===1` ตามดีไซน์เดิม) — ลบข้อมูลทดสอบ
    หมดแล้ว ยืนยันร้านจริง 2 ร้าน + order ประวัติศาสตร์ไม่ถูกแตะเลยตลอดทั้ง 5 sub-step ของ Step 7

### Step 8 — แยก domain seller./admin.bardskh.com — ปิดครบแล้วทั้ง 8a-8e (เริ่ม 2026-07-27, ปิด 2026-07-27)

สำรวจ deploy config ก่อนเริ่มพบว่า Render มี Web Service เดียว (`bards-shop`) เสิร์ฟทั้ง API+static จาก
Express process เดียว — แผนคือเพิ่ม `seller.bardskh.com`/`admin.bardskh.com` เป็น Custom Domain เพิ่มเติม
บน service เดิม (ไม่สร้าง service ใหม่) แล้วทำ hostname-based routing ในแอปเอง

**Design decision (ถามเจ้าของโปรเจกต์ก่อนเขียนโค้ด)**: 1 คน 1 บัญชีเดียวกันทั้งหมด ไม่มีระบบสมัครแยก — เลือก
**แชร์ session ข้ามโดเมนผ่าน cookie `Domain=.bardskh.com`** (แทนที่จะให้แต่ละ subdomain login แยกกันจริงจัง)
เพราะ JWT ใน localStorage scope ตาม origin อยู่แล้ว (ไม่ share ข้าม subdomain ตาม browser spec) แต่ refresh
token cookie ตั้ง `Domain` ให้ share ได้ — ผสมกับกลไก silent-refresh-on-401 ที่มีอยู่แล้วใน `apiFetch()`
จะทำให้ข้ามโดเมนแล้วได้ access token ใหม่อัตโนมัติโดยไม่ต้องพิมพ์รหัสผ่านซ้ำ

**DNS ที่เจ้าของโปรเจกต์ต้องทำเอง**: เพิ่ม Custom Domain ทั้ง 2 ใน Render Dashboard (Web Service เดิม
`bards-shop`) → copy ค่า CNAME ที่ Render generate ให้ไปตั้งที่ DNS provider ของ `bardskh.com` — Step 8e
(smoke test จริง) ต้องรอ DNS propagate ก่อน

ทดสอบ 8a-8d ด้วยการปลอม `Host` header ยิงตรงไปที่ `localhost:3000` (ผ่าน Node's `http` module — PowerShell's
`Invoke-WebRequest` บล็อกการตั้ง `Host` header เอง) ไม่ต้องรอ DNS จริง — เหลือแค่ 8e ที่ต้องรอ

- [x] **8a — CORS allow-list + hostname-detection scaffold** — ปิดแล้ว (2026-07-27)
  - `server.js`: เพิ่ม `https://seller.bardskh.com`/`https://admin.bardskh.com` เข้า CORS `allowed` array
  - เพิ่ม `bardsHostKind(hostname)` (pure function) + middleware ที่ stamp `req.bardsHost` ('seller'|
    'admin'|'main') ทุก request — **ยังไม่เปลี่ยน behavior การ route ใดๆ เลย** แค่วาง detection ไว้ให้
    8c ใช้ต่อ — ตั้งใจ exact-match กับ hostname จริงเท่านั้น (ไม่ใช้ `startsWith('seller.')`) กัน
    hostname ปลอมที่ดูคล้าย (เช่น `sellerabc.bardskh.com`) โดนจับผิด
  - เพิ่ม `bardsHost` ใน response ของ `GET /api/health` — diagnostic ถาวร ไม่ใช่แค่ตอนทดสอบ (ใช้ตรวจ
    Step 8e ได้ทันทีตอน DNS จริงพร้อม: `curl https://seller.bardskh.com/api/health` ต้องเห็น
    `"bardsHost":"seller"`)
  - **ทดสอบจริง**: unit test `bardsHostKind()` 9 เคส (exact match ทั้ง 2 subdomain, apex/www/localhost
    เป็น main, lookalike prefix `sellerabc.bardskh.com` ไม่ถูกจับผิด, suffix-attack
    `seller.bardskh.com.evil.com` ไม่ถูกจับผิด, undefined/empty string ไม่ crash) — live test 7 เคสกับ
    local dev server จริงผ่านการปลอม Host header: `seller.bardskh.com`/`admin.bardskh.com`/
    `bardskh.com`/localhost ปกติ/`sellerabc.bardskh.com` (lookalike) → `bardsHost` ตรงตามคาดทุกเคส,
    CORS กับ `Origin: https://seller.bardskh.com` ผ่านแล้ว (ก่อนหน้านี้จะโดนบล็อก), `Origin:
    https://evil.com` ยังโดนบล็อกเหมือนเดิม (ไม่ใช่ regression — พฤติกรรม error 500 ตอนบล็อกเป็นของเดิม
    อยู่แล้ว ไม่เกี่ยวกับการแก้ครั้งนี้) — regression เช็ค `/`, `/seller`, `/admin-shops` ยังโหลดได้ปกติ
    ทั้งหมด
- [x] **8b — `Domain=.bardskh.com` ให้ refresh cookie (session sharing ข้ามโดเมน)** — ปิดแล้ว (2026-07-27)
  - `routes/auth.js`'s `setRefreshCookie()`/`clearRefreshCookie()` — เพิ่ม
    `REFRESH_COOKIE_DOMAIN = NODE_ENV==='production' ? '.bardskh.com' : undefined` แล้วส่งเข้า
    `domain:` option ทั้งสองฟังก์ชัน (ต้องแก้ `clearRefreshCookie()` คู่กันด้วยเสมอ — ถ้า Domain ไม่ตรงกับ
    ตอน set ตอน clear จะไม่เคลียร์ cookie จริงจากฝั่ง browser) — production เท่านั้น, local dev
    (`NODE_ENV` ไม่ใช่ `production`) ได้ `undefined` → `cookie` library ไม่ใส่ attribute `Domain` เลย
    (ไม่ใช่ literal `"Domain=undefined"`) พฤติกรรม host-only เดิมของ local dev ไม่เปลี่ยนแม้แต่นิดเดียว
  - **ไม่ retroactive**: cookie เก่าที่ browser มีอยู่แล้ว (ก่อน deploy การแก้นี้) ยังเป็น host-only ต่อไป
    จนกว่าจะหมุนรอบถัดไป (sign in ใหม่ หรือเรียก `/auth/refresh` ครั้งถัดไป — อย่างช้าไม่เกิน 30 วันตาม
    refresh token TTL เดิม)
  - **ทดสอบจริง**: สร้าง isolated Express app แยกต่างหาก (ไม่แตะ server จริง/ไม่แตะ DB เลย — กัน risk
    จากการลอง flip `NODE_ENV=production` กับ local dev server ตรงๆ ซึ่งจะทำให้ `db.js` พยายามต่อ Postgres
    local ด้วย SSL แล้วอาจต่อไม่ติด) จำลอง logic เดียวกันเป๊ะ ตรวจ raw `Set-Cookie` header จริงที่
    Express/`cookie` library ผลิตออกมา — ยืนยัน production: มี `Domain=.bardskh.com; ... HttpOnly;
    Secure; SameSite=Lax` ครบ, `clearCookie` เล็ง Domain เดียวกันถูกต้อง (ไม่งั้นจะเคลียร์ไม่ออกจริง) —
    development: ไม่มี `Domain=` เลยทั้ง set และ clear, ไม่มี `Secure` — จากนั้น live test เต็มวงจรกับ
    local dev server จริง (dev mode ปกติ ไม่แตะ `NODE_ENV`): signup → ยืนยัน cookie ไม่มี `Domain`
    attribute (ตามคาด) → `POST /auth/refresh` หมุน token สำเร็จ → `POST /auth/logout` สำเร็จ → ใช้
    cookie ที่ revoke แล้วซ้ำ → โดน 401 "Session revoked" ถูกต้อง (พิสูจน์ reuse-detection เดิมไม่พัง) —
    ลบ user ทดสอบหมดแล้ว
- [x] **8c — Hostname routing จริง (landing page + default redirect หลัง login)** — ปิดแล้ว (2026-07-27)
  - `server.js`: เพิ่ม `app.get('/', ...)` ก่อน `express.static()` — `req.bardsHost==='seller'` →
    `res.redirect('/seller')`, `==='admin'` → `res.redirect('/admin-shops')` — เป็น **real HTTP redirect**
    ไม่ใช่การ serve เนื้อหา seller.html เงียบๆ ที่ `/` (กัน URL bar/bookmark/refresh ไม่ตรงกับหน้าจริง) —
    กระทบแค่ path `/` เป๊ะๆ เท่านั้น path อื่นทั้งหมด (`/all-products`, `/seller` ตรงๆ, static asset,
    `/api/*`) ไม่ถูกแตะเลย ยังเสิร์ฟไฟล์เดียวกันทุกโดเมนเหมือนเดิม
  - `products.js`: เพิ่ม `bardsDefaultLanding()` ข้างๆ `safeRedirect()` เดิม (ทั้งสองไฟล์ `signin.html`/
    `signup.html` include `products.js` อยู่แล้ว) — คืน `/seller`/`/admin-shops` ตาม `location.hostname`
    หรือ `account.html` เหมือนเดิมถ้าไม่ใช่ subdomain ทั้งสอง — ใช้แทน hardcoded `'account.html'` ที่เป็น
    fallback เดิมตอนไม่มี `?redirect=` explicit (ซึ่ง `?redirect=` explicit ยัง**ชนะเสมอ**เหมือนเดิมทุก
    ที่ ไม่เปลี่ยน priority)
  - แก้ทุกจุดที่ hardcode `|| 'account.html'` เป็น `|| bardsDefaultLanding()`: `signin.html` 3 จุด (auth
    guard ตอนเข้าหน้าทั้งที่ login อยู่แล้ว, OAuth/Telegram callback handler, email/password signin
    สำเร็จ), `signup.html` 2 จุด (auth guard เดียวกัน, signup สำเร็จ) — Google/Telegram OAuth flow ของ
    `signup.html` ไม่ต้องแก้เพิ่มเพราะวนกลับไปผ่าน `signin.html`'s callback handler อยู่แล้วเสมอ (ใช้
    fallback เดียวกันที่จุดเดียว)
  - **ไม่ได้ทำ (นอกขอบเขต 8c ตามที่ตกลง)**: ไม่ block/redirect หน้าลูกค้า (เช่น `/all-products`) ออกจาก
    subdomain — ยังเสิร์ฟไฟล์เดียวกันได้ปกติถ้าเข้าตรงๆ ผ่าน seller./admin. (role-guard เดิมในตัวหน้า
    seller-*.html/admin-*.html ป้องกันการเข้าถึงข้อมูลอยู่แล้วไม่ว่าจะมาทางโดเมนไหน)
  - **ทดสอบจริง**: DOM-stub 6 เคส (`bardsDefaultLanding()` logic แยก mock `location.hostname`) + live
    test 7 เคสกับ local dev server จริงผ่านการปลอม Host header: `seller.bardskh.com`/`/` → 302 →
    `/seller`, `admin.bardskh.com`/`/` → 302 → `/admin-shops`, `bardskh.com`/`/` และ localhost ปกติ → 200
    ไม่ redirect (unchanged), `seller.bardskh.com`/`/all-products` → 200 ไม่ redirect (path อื่นไม่ถูก
    แตะ), `seller.bardskh.com`/`/seller` ตรงๆ → 200 ไม่ redirect loop, `sellerabc.bardskh.com`/`/`
    (lookalike) → 200 ไม่ redirect — regression เช็ค `/signin`/`/signup`/`/products.js` เสิร์ฟโค้ดที่แก้
    แล้วจริง (grep หา `bardsDefaultLanding` เจอในทั้ง 3 ไฟล์ที่ serve จริง)
- [x] **8d-1 — Auth guard bootstrap (silent refresh ก่อนเด้ง signin)** — ปิดแล้ว (2026-07-27)
  - **สำรวจก่อนเริ่ม พบปัญหาที่ใหญ่กว่าที่คิด**: หน้า `seller-*.html`/`admin-*.html` ทั้ง 10 ไฟล์ auth
    guard เช็คแค่ `Auth.isLoggedIn()` (= มี token ใน `localStorage` ของ origin ปัจจุบันไหม) ก่อนเด้งไป
    signin — ไม่เคยลอง silent-refresh จาก `bards_rt` cookie ที่แชร์ข้ามโดเมนแล้วจาก 8b เลย เพราะ
    `apiFetch()`'s silent-refresh เดิมทำงานเฉพาะตอนมี token อยู่แล้วแต่หมดอายุ (401 จาก request จริง) —
    ถ้าไม่มี token ตั้งแต่แรกจะ short-circuit ก่อนยิง request ด้วยซ้ำ (`if (!token) { Auth.logout();
    return; }`) ผลคือ user ที่ login ที่ bardskh.com อยู่แล้วไปเปิด seller./admin. subdomain ครั้งแรก
    (origin ใหม่ = localStorage ว่าง) จะโดนเด้งไป signin ทั้งที่ session จริงยังไม่หมดอายุ — ขัดกับเป้าหมาย
    หลักของ Step 8 ที่ตกลงกันไว้ตอนเริ่ม ("ไม่ต้อง login ซ้ำทุกครั้งที่ข้ามโดเมน")
  - แก้โดยเพิ่ม `Auth.ensureSession()` ใน `api.js` (เรียก `_refreshAccessToken()` ที่มีอยู่แล้วในไฟล์
    เดียวกัน — ไม่ต้อง export ข้ามสคริปต์เพราะเป็น method ที่นิยามอยู่ใน object เดียวกัน): ถ้ามี token
    อยู่แล้วคืน `true` ทันทีไม่ยิง network (ไม่มี latency เพิ่มสำหรับเคสปกติที่ยังอยู่ origin เดิม) ถ้าไม่มี
    ลอง `POST /auth/refresh` หนึ่งครั้งก่อน คืน `true`/`false` ตามผล (ไม่ throw — guard เช็คได้ตรงๆ)
  - เปลี่ยน auth guard ทั้ง 10 ไฟล์จาก `if (!Auth.isLoggedIn())` เป็น
    `if (!(await Auth.ensureSession()))` (ทุกไฟล์ guard อยู่ใน `async` handler อยู่แล้ว ไม่ต้องแก้
    structure อื่น): `seller.html`, `seller-orders.html`, `seller-products.html`,
    `seller-analytics.html`, `seller-coupons.html`, `admin-shops.html`, `admin-orders.html`,
    `admin-stats.html`, `admin-customers.html`, `admin-categories.html`
  - **ทดสอบจริง**: syntax-check ทั้ง 11 ไฟล์ที่แก้ (parse ผ่าน `new Function()`) — unit test
    `ensureSession()` logic แยก mock `isLoggedIn()`/`_refreshAccessToken()` 4 เคส (login อยู่แล้ว → `true`
    ไม่ยิง network, ไม่มี token+cookie ใช้ได้ → `true`, refresh ล้มเหลว → `false` ไม่ throw, refresh
    สำเร็จแต่ไม่มี token กลับมา → `false`) — live test กับ local dev server จริง: signup user ทดสอบ →
    `POST /auth/refresh` ด้วย cookie จริงที่ได้ → 200 + token/user ครบ (path ที่ `ensureSession()` ใช้ตอน
    สำเร็จ), ไม่มี cookie เลย → 401, cookie ปลอม → 401 (ทั้งสอง path ที่ `ensureSession()` ใช้ตอน false) —
    ลบ user ทดสอบออกจาก DB หมดแล้ว
  - **ยังไม่ทำ (แยกเป็น 8d-2)**: href ที่เป็น relative path ข้าม hub ("View Store" 6 ไฟล์ที่ใช้ `href="/"`
    ซึ่งชน redirect ที่ 8c เพิ่มเข้ามาที่ bare `/` บน seller./admin. — กดแล้ววนกลับ dashboard แทนที่จะเห็น
    หน้าร้านจริง, อีก 4 ไฟล์ที่ใช้ `href="index.html"` ไม่วนลูปแต่ค้าง URL ผิดโดเมน, ลิงก์ "Seller Hub"/
    "Shops" ข้าม hub ที่เป็น relative path เหมือนกัน) — เป็นปัญหาคนละมิติกับ auth bootstrap (navigation
    URL ไม่ใช่ session) แยกทำเพื่อลดขนาดการเปลี่ยนแปลงต่อรอบ
- [x] **8d-2 — Cross-hub link/redirect URL ให้ hostname-aware** — ปิดแล้ว (2026-07-27)
  - เพิ่ม `bardsCrossHubUrl(hub, path)` ใน `products.js` ข้างๆ `bardsDefaultLanding()` เดิม: ถ้าไม่ได้อยู่
    บน `seller.`/`admin.` subdomain จริง (local dev, apex `bardskh.com`, unknown host) คืน `path` เดิม
    เฉยๆ ไม่เปลี่ยนพฤติกรรมเลย ถ้าอยู่บน subdomain จริงคืน absolute URL ข้ามโดเมนแทน (`https://bardskh.com`
    /`https://seller.bardskh.com`/`https://admin.bardskh.com` + path)
  - แก้ href แบบ static ในทั้ง 10 ไฟล์ (`seller-*.html` 5 ไฟล์, `admin-*.html` 5 ไฟล์) ให้เป็น hostname-aware
    ผ่าน JS rewrite ตอน auth guard สำเร็จ (เพิ่ม `id` ให้ `<a>` ที่ต้อง rewrite แล้วเซ็ต `.href` ตรงๆ
    แทนการพึ่ง markup เฉยๆ):
    - **"View Store"** (ทุกไฟล์ทั้ง 10): `id="hubViewStoreLink"` → `bardsCrossHubUrl('main','/')` — เดิม 6
      ไฟล์ใช้ `href="/"` ตรงๆ (ชน redirect ที่ 8c เพิ่มไว้ที่ bare `/` บน seller./admin. → วนกลับ dashboard
      แทนที่จะเห็นหน้าร้านจริง) อีก 4 ไฟล์ใช้ `href="index.html"` (ไม่วนลูปแต่ค้าง URL ผิดโดเมน)
    - **"Seller Hub"** (5 ไฟล์ `admin-*.html`): `id="hubSellerLink"` → `bardsCrossHubUrl('seller','/seller')`
    - **"Shops"/Admin nav** (5 ไฟล์ `seller-*.html`, โชว์เฉพาะ role admin): reuse `id="adminNavLink"` เดิม
      (มีอยู่แล้วจาก Phase 4) → `bardsCrossHubUrl('admin','/admin-shops')`
  - **เจอบั๊กเพิ่มระหว่างสำรวจ ไม่ได้อยู่ในแผนเดิมแต่แก้พร้อมกันเพราะรากปัญหาเดียวกัน**: role-denial
    fallback (`if (user.role !== 'admin') { location.href = '/'; ... }` ใน `admin-*.html` ทั้ง 5,
    `if (!['seller','admin'].includes(user.role))` ใน `seller-*.html` ทั้ง 5) ก็ hardcode relative path
    เหมือนกัน — ที่ร้ายแรงสุด: `admin-*.html`/`seller-products.html` ใช้ `location.href='/'` ตรงๆ ซึ่งบน
    `admin.bardskh.com`/`seller.bardskh.com` จะชน redirect ของ 8c ที่ bare `/` ส่งกลับไป
    `/admin-shops`/`/seller` ทันที → guard เดิม (หรือ guard ของหน้าที่โดน redirect ไป) เจอ role ไม่ตรงอีก
    → redirect กลับ `/` อีก → **วนลูปไม่รู้จบ** (browser จะขึ้น "too many redirects") สำหรับ user ที่ role
    ไม่ตรง (เช่น customer หลงเข้ามาที่ subdomain ผิด) — แก้เป็น `bardsCrossHubUrl('main','/')` ทั้งหมด
    (10 ไฟล์) เหมือนกับ "View Store" ข้างบน
  - **ทดสอบจริง**: syntax-check ทั้ง 11 ไฟล์ที่แก้ + เช็คอัตโนมัติว่าทุก `id` ที่เพิ่มใน markup มีจุด
    rewrite คู่กันใน script จริง (ไม่มี id ค้างไม่ได้ใช้/rewrite ที่ชี้ id ที่ไม่มีจริง) — unit test
    `bardsCrossHubUrl()` แยก 8 เคส (ทั้ง 3 ทิศทางข้ามโดเมนบน subdomain จริง, unchanged relative บน
    apex/www/localhost, lookalike prefix ไม่ถูกจับผิด) — live test กับ local dev server จริงผ่านการปลอม
    Host header: fetch ทั้ง 10 หน้าจริงด้วย `Host: seller.bardskh.com` ยืนยันโค้ดที่ serve จริงมี
    `bardsCrossHubUrl(...)` + `id="hubViewStoreLink"` ครบ (กัน stale cache), เช็ค `admin-*.html` ทั้ง 5 มี
    `id="hubSellerLink"` + rewrite คู่กัน, เช็คไม่มี `location.href='/'`/`'index.html'` ตกค้างที่ยังไม่ผ่าน
    `bardsCrossHubUrl` เหลืออยู่เลยสักไฟล์ — regression: bare `/` บน seller./admin. ยังคง 302 ไป
    dashboard เหมือนเดิม (8c ไม่ถูกแตะ), main domain/localhost ยังคง 200 ปกติไม่ redirect
- [x] **8e — Smoke test ข้าม 3 โดเมนจริงบน production** — ปิดแล้ว (2026-07-27) **— Step 8 ปิดครบสมบูรณ์
  แล้วทั้ง 8a-8e, แผน Admin UI ทั้ง 8 step เสร็จสมบูรณ์**
  - DNS ตั้งเสร็จแล้ว (`seller.bardskh.com`/`admin.bardskh.com` ชี้ไป Render Web Service เดิม `bards-shop`
    ผ่าน Custom Domain) เจ้าของโปรเจกต์ verify ผ่านทั้งคู่ก่อนเริ่มทดสอบ
  - **เจอ deploy staleness ระหว่างเตรียมทดสอบ**: เช็ค `products.js`/`api.js` ที่ served จริงจาก
    `bardskh.com` (ตรง origin ผ่าน Render, ไม่ใช่ CDN cache — `cf-cache-status: DYNAMIC`) พบว่ายังเป็นโค้ด
    ของ commit 8c (`d31ab9d`) ไม่มี `bardsCrossHubUrl`/`ensureSession` จาก 8d-1/8d-2 (`9f44088`/`ccbaf62`)
    เลยแม้จะ push ไปแล้ว — Render ยังไม่ deploy commit ใหม่ (auto-deploy ล่าช้า/ค้าง ไม่ใช่ CDN cache) หยุด
    รอเจ้าของโปรเจกต์เช็ค/สั่ง deploy ผ่าน Render Dashboard เองก่อน ไม่ทดสอบต่อบนโค้ดเก่าเพราะจะให้ผลลัพธ์
    หลอก (fail เพราะโค้ดเก่าจริง หรือ pass โดยบังเอิญ) — deploy เสร็จแล้ว (commit `ccbaf62` live, ยืนยันซ้ำ
    จาก `last-modified` header ของ `products.js` ที่ขยับเวลาให้ตรงกับตอน deploy จริง) ก่อนทดสอบต่อ
  - **ทดสอบจริงบน production ทั้ง 5 ข้อที่วางแผนไว้**:
    1. `GET /api/health` ทั้ง 3 โดเมน (`bardskh.com`/`seller.bardskh.com`/`admin.bardskh.com`) — `bardsHost`
       ตรงตามคาด (`main`/`seller`/`admin`) ครบทุกโดเมน
    2. `GET /` บน `seller.bardskh.com`/`admin.bardskh.com` — 302 ไป `/seller`/`/admin-shops` ถูกต้อง,
       `bardskh.com`/`localhost` ยังคง 200 ปกติไม่ redirect (regression)
    3. **SSO ข้ามโดเมนจริง**: สมัคร throwaway account ผ่าน public signup API จริงที่ `bardskh.com` → ได้
       cookie `bards_rt` ที่มี `Domain=.bardskh.com` จริง (ยืนยัน attribute ตรงตาม 8b) → จำลอง browser
       carry cookie นี้ไป `POST seller.bardskh.com/api/auth/refresh` → **สำเร็จ 200 + token/user ครบ**
       (ไม่ต้อง login ซ้ำ) → cookie หมุน (rotate) รอบใหม่ตามดีไซน์เดิม → carry cookie ที่หมุนแล้วไป
       `POST admin.bardskh.com/api/auth/refresh` → **สำเร็จ 200 เช่นกัน** — พิสูจน์ SSO ทำงานจริงข้ามทั้ง
       3 โดเมนตามเป้าหมายหลักของ Step 8 (**หมายเหตุการทดสอบ**: รอบแรกลืม chain cookie ที่หมุนแล้วระหว่าง
       hop ทำให้ reuse cookie เก่าซ้ำ โดน reuse-detection ปฏิเสธ 401 — เป็นบั๊กของสคริปต์ทดสอบเอง ไม่ใช่
       ของระบบจริง เพราะ browser จริงจะเก็บแค่ cookie ล่าสุดในเวลาใดเวลาหนึ่งเสมออยู่แล้ว แก้สคริปต์ให้
       chain cookie ที่หมุนแล้วถูกต้องแล้วรันซ้ำผ่าน)
    4. **Cross-hub links**: ยืนยันโค้ดที่ served จริงจาก `seller.bardskh.com` มี `id="hubViewStoreLink"` +
       จุด rewrite คู่กันจริง (ตรงกับที่ unit/live test ผ่านแล้วตอน 8d-2 ในเครื่อง)
    5. **Role-denial ไม่วนลูป**: ยืนยันโค้ดที่ served จริงจาก `admin-shops.html` บน `admin.bardskh.com` มี
       `bardsCrossHubUrl('main',...)` ในจุด role-denial fallback แล้วจริง (ไม่ใช่ `location.href='/'` เปล่าๆ
       ที่จะชนกับ redirect ของ 8c)
    - **เพิ่มเติมนอกแผนเดิม**: ทดสอบ replay cookie ที่หมุนไปแล้ว (revoked) ซ้ำ — โดน 401 ถูกต้อง พิสูจน์ว่า
      reuse-detection defense เดิม (จาก 8b/refresh token spec) ไม่ได้ถูกทำให้อ่อนลงจากงาน 8d
  - **ข้อมูลทดสอบที่ยังไม่ได้ลบ**: throwaway account 2 บัญชี (`bards8e_smoketest_*@example.com`) ยังอยู่ใน
    production DB จริง — **ไม่มี delete-account endpoint ในระบบ และ credential DB ที่มีสำหรับ production
    เป็น read-only เท่านั้น** เจ้าของโปรเจกต์ต้องลบเองผ่าน Supabase Dashboard เมื่อสะดวก (อีเมลเต็มอยู่ใน
    output ของสคริปต์ทดสอบใน scratchpad)

---

## "Other" category ถูกลบแล้ว + แก้ show_on_homepage filtering gap (2026-07-25, commit `30b666c`)

หลัง step 4d เสร็จ เจ้าของโปรเจกต์รายงานว่า "Other" ยังโผล่ในแถบ filter chip ของหน้ารายการสินค้า
(all-products.html เป็นต้น) ทั้งที่ตั้ง `show_on_homepage=false` ไว้แล้ว — ตรวจแล้วพบ 2 เรื่อง:

- [x] **เช็คจำนวนสินค้าที่ผูกกับ "Other"**: local dev DB มี 1 ชิ้น (`polo shirt`, active), **production
      มี 0 ชิ้น** (query ผ่าน `PRODUCTION_DATABASE_URL_READONLY` — read-only ตามธรรมเนียมโปรเจกต์)
- [x] **ตัดสินใจ (เจ้าของโปรเจกต์เลือก)**: ย้าย `polo shirt` ไปหมวด `tops` แล้ว **ลบ** "Other" ออกจาก
      `categories` table ทั้ง 2 DB (ไม่ใช่แค่ซ่อน) — local dev ทำให้แล้ว (`UPDATE`+`DELETE` ตรง),
      production ต้องรัน SQL เองผ่าน Supabase Dashboard/psql (ดู note ท้ายหัวข้อนี้ — **ต้อง deploy โค้ด
      commit `30b666c` ก่อน/พร้อมกับรัน SQL** ไม่งั้น "Other" จะโผล่กลับมาใหม่)
- [x] **พบบั๊กจริงระหว่างทดสอบ**: ลบแถว "Other" ออกจาก local dev DB ตรงๆ แล้ว restart server อีกที —
      แถวกลับมาใหม่! สาเหตุ: `db.js`'s seed statement (`INSERT ... ON CONFLICT (slug) DO NOTHING`) ที่รัน
      ทุกครั้ง server boot ยังมี `('Other', 'other', NULL, 4, false)` อยู่ในโค้ด — `ON CONFLICT DO NOTHING`
      กันแค่ error ตอนมีแถวซ้ำ ไม่ได้กันไม่ให้แถวที่ถูกลบไปแล้วถูกสร้างใหม่ (เพราะไม่มี "conflict" อีกต่อไป
      หลังแถวหายไป) — แก้โดยลบบรรทัด 'Other' ออกจาก seed statement ใน `db.js` เอง ทดสอบ restart server 2
      รอบซ้อนยืนยันว่าไม่กลับมาอีกแล้ว
- [x] **แก้ root cause อีกจุด (ทั่วไป ไม่ใช่แค่ "Other")**: `show_on_homepage` เดิมกรองแค่การ์ดหมวดหน้าแรก
      (`renderCategories()` ใน `index.html`) — ตัว filter-chip/tab builder อีก 4 จุด
      (`index.html`'s `renderFilterChips()`, `all-products.html`'s `renderFilterChips()`,
      `new-arrival.html`'s `buildChips()`, `categories.html`'s `buildTabs()`) ไม่ได้กรองตามนี้เลย แสดง
      ทุกหมวดไม่มีเงื่อนไข — แก้ให้กรองด้วย `showOnHomepage` เหมือนกันหมดแล้ว (ยกเว้นหมวดที่ไม่มีอยู่ใน
      `CATEGORIES` เลย เช่น legacy category text เก่าที่ resolve ไม่เจอ ยังคง fallback แสดงเหมือนเดิม) —
      กันปัญหาเดิมไม่ให้เกิดซ้ำกับหมวดใหม่ในอนาคตที่ตั้งใจซ่อน
- [x] **ทดสอบ**: DOM-stub test 7 เคส (ครอบทั้ง 4 ไฟล์ รวมเคสหมวดซ่อนที่มีสินค้าจริงผูกอยู่ต้องยังถูกกรอง
      ออก และเคสหมวดที่ไม่มีใน CATEGORIES เลยต้องไม่ถูกกรอง) + ทดสอบจริงกับ local dev server: ยืนยัน
      "Other" หายจาก `GET /api/categories`, `polo shirt` ย้ายไป `tops` แล้ว, restart 2 รอบไม่กลับมาอีก,
      รัน regression suite ของทุก URL จาก step 4d ซ้ำอีกรอบ ไม่มีอะไรพัง

**⚠️ สิ่งที่เจ้าของโปรเจกต์ต้องทำเองสำหรับ production (ไม่ใช่ AI):**
1. Deploy commit `30b666c` ขึ้น production ก่อน (ผ่าน flow deploy ปกติของโปรเจกต์)
2. รัน SQL นี้ผ่าน Supabase SQL Editor หรือ `psql`:
   ```sql
   DELETE FROM categories WHERE slug='other';
   ```
   (production ไม่มีสินค้าผูกกับ "Other" อยู่แล้ว ไม่ต้อง UPDATE ย้ายสินค้าก่อนเหมือน local dev)
3. **ลำดับสำคัญ**: ต้องทำข้อ 1 ก่อนข้อ 2 (หรือพร้อมกัน) — ถ้ารัน DELETE ก่อน deploy โค้ดใหม่ แล้ว production
   server restart/redeploy ด้วยโค้ดเก่าที่ยังมี 'Other' ใน seed อีกครั้ง แถวจะกลับมาใหม่เหมือนที่เจอใน local
   dev

---

## Categories table migration — Step 1-3 ปิดแล้ว, Step 4 (frontend) กำลังทำทีละไฟล์ (2026-07-25)

เป้าหมาย: ย้าย 3 หมวดสินค้า (tops/pants/accessories) ที่เคย hardcode กระจายอยู่หลายไฟล์ ไปเป็นตาราง
`categories` จริงใน DB ที่เพิ่มหมวดใหม่ได้โดยไม่ต้องแก้โค้ด/deploy ไฟล์ใหม่ — วางแผนไว้ 4 step ตามที่คุยกับ
เจ้าของโปรเจกต์ (เลือกแบบ "เต็ม" คือ routing แบบ dynamic ไม่ต้องมีไฟล์ .html แยกต่อหมวดอีกต่อไปในระยะยาว —
ดู `CLAUDE.md` หัวข้อ 4/5/11):

- [x] **Step 1 — สร้างตาราง `categories` (`db.js`)** — `id, name, slug(UNIQUE), parent_id(nullable, ยัง
      ไม่ใช้ รองรับหมวดย่อยอนาคต), image, color, sort_order, is_active, show_on_homepage`. Seed ข้อมูล
      เดิมที่เคย hardcode 3 หมวด (`tops/pants/accessories`) เข้าไปจริง บวกหมวด `other` เพิ่ม
      (`show_on_homepage=false` — จำลอง behavior เดิมที่สินค้านอก 3 หมวดนี้ไม่เคยโชว์บนการ์ดหน้าแรกอยู่แล้ว)
- [x] **Step 2 — เชื่อม `products` เข้ากับ `categories` (`db.js`, `routes/seller.js`)** — เพิ่ม
      `products.category_id` (FK nullable, ไม่ join table เพราะตรวจ UI จริงแล้วสินค้า 1 ชิ้นเลือกได้แค่
      หมวดเดียวใน `seller-products.html`) + backfill จาก `products.category` (text) เดิมที่ตรงกับ
      `categories.slug` แบบ exact match, dual-write ทั้ง `POST`/`PATCH /seller/products` ให้เขียนทั้ง
      `category` (text เดิม, เก็บไว้เพื่อ backward-compat) และ `category_id` (ใหม่) พร้อมกันทุกครั้งที่
      สร้าง/แก้สินค้า — กัน `category_id` ค้าง NULL สำหรับสินค้าที่เพิ่ม/แก้หลังจากนี้
- [x] **Step 3 — Backend API (`routes/categories.js`, `routes/products.js`, `server.js`)** — เพิ่ม
      `GET /api/categories` (list หมวดที่ `is_active=true` เรียงตาม `sort_order`) และแก้
      `GET /api/products?category=` ให้ resolve ผ่าน `category_id` (join กับ `categories.slug`) ก่อน
      โดย fallback กลับไปเทียบ `p.category` (text) ด้วย `OR` เผื่อสินค้าที่ยังไม่มี `category_id` ตรง —
      ไม่ทำให้ query param เดิมที่ frontend ส่งอยู่แล้วพัง ทดสอบยิงจริงกับ local dev DB แล้ว: list หมวด
      คืนครบ 4 หมวด, filter ตาม `category=tops` คืนสินค้าตรงพร้อม `category_id` แนบมาด้วย
- [ ] **Step 4 — Frontend migration (แบ่งทีละไฟล์ตามที่เจ้าของโปรเจกต์ขอ)** — แทนที่ hardcoded category
      list/label ในแต่ละไฟล์ด้วยการดึงจาก `GET /api/categories`:
  - [x] **4a — `products.js` + `index.html`** (commit `718e431`, พร้อม schema/API มาจาก commit `0645b3d`
        และ `322164a`) — ลบ hardcoded `CATEGORIES` array ใน `products.js` แทนด้วย `fetchCategories()`
        (ดึงจาก API, map เป็น `{id,label,url,color,showOnHomepage}`) — `index.html`'s
        `DOMContentLoaded` await ทั้ง `fetchAndMerge()`/`fetchCategories()` ก่อน render, เพิ่ม
        `renderFilterChips()` สร้าง filter chip แบบไดนามิก, แก้ `updateCounts()`/`renderCategories()`
        ให้ loop ผ่าน `CATEGORIES` ที่โหลดมาแทน hardcode 3 หมวด — `renderCategories()` กรอง
        `showOnHomepage` (แทนพฤติกรรมเดิมที่ "Other" ไม่เคยโผล่บนการ์ดหน้าแรก) และ escape
        name/color/url ด้วย `escapeHtml()` เพราะตอนนี้เป็นข้อมูลจาก DB ไม่ใช่ constant ที่เชื่อได้ 100%
        เหมือนก่อน — ทดสอบผ่าน DOM-stub script มือ (ไม่มี `jsdom` ใน environment นี้) ครอบคลุม: จำนวน
        chip ที่สร้าง, ลำดับตาม `sort_order`, escape payload XSS ใน label/color/url, นับจำนวนสินค้าต่อ
        หมวดถูกต้อง, กรอง `showOnHomepage` ถูกต้อง — บวกทดสอบจริงกับ local dev server (
        `GET /api/categories`, `GET /api/products?category=tops`, เช็คว่าไฟล์ที่ serve จริงคือไฟล์ที่
        แก้แล้ว) ครบก่อน commit+push
  - [x] **4b — `seller-products.html`** (commit `cad6c99`) — เปลี่ยน `<select id="fCategory">` เดิมที่
        hardcode 4 `<option>` (`tops/pants/accessories/other`) เป็น populate ไดนามิกผ่าน
        `renderCategorySelect()` (loop `CATEGORIES` ที่โหลดจาก `fetchCategories()` — ใช้ตัวเดียวกับที่
        เพิ่มใน `products.js` ตอน step 4a เพราะไฟล์นี้ include `products.js` อยู่แล้ว) เรียกใน
        `DOMContentLoaded` ก่อน `loadProducts()` — พร้อมแก้บั๊กที่พบระหว่างสำรวจ: `openModal()`'s fallback
        เดิม `p?.category||'tees'` ใช้ `'tees'` ที่ไม่ตรง slug ไหนเลยใน 4 หมวดจริง (ค้างจาก naming scheme
        เก่า) ทำให้เปิด "Add Product" ครั้งแรกแล้ว select ไม่มี option ไหนถูกเลือกจริงๆ — เปลี่ยนเป็น
        fallback ไปหมวดแรกใน `CATEGORIES` (`CATEGORIES[0]?.id`) แทน — ทดสอบผ่าน DOM-stub script (render
        option ครบ, escape label ป้องกัน XSS, พฤติกรรม fallback บั๊กเดิม vs. ที่แก้แล้ว) บวกทดสอบจริงกับ
        local dev server: สร้างสินค้าจริงผ่าน `POST /api/seller/products` ด้วย payload รูปแบบเดียวกับที่
        `saveProduct()` ส่งจริง (`category:'pants'`) → `category_id` resolve ถูกต้อง →
        `GET /api/seller/products` คืนค่าตรงกับที่ edit form ต้องอ่าน → ลบสินค้าทดสอบออกจาก DB แล้ว
  - [x] **4c — `categories.html`** (commit `ac3930c`) — แก้ `labels` object ที่ hardcode ซ้ำกันทั้งใน
        `buildTabs()`/`updateHeader()` (key `tees/hoodies` ค้างจาก naming scheme เก่าที่ไม่ตรง slug จริง
        เลยสักตัว) ให้ดึง label จาก `CATEGORIES` (`fetchCategories()`, โหลดคู่กับ `fetchAndMerge()` ใน
        `init()` ผ่าน `Promise.all` แบบเดียวกับ 4a/4b) — **เจอบั๊ก stored XSS จริง 2 จุดระหว่างแก้ (ไม่ใช่
        แค่ label ผิด)**: `buildTabs()` เดิมต่อ HTML string ดิบทั้ง `innerHTML` และ
        `onclick="setcat('${c}')"` จาก `c` (=`product.category` ข้อความที่ seller กำหนดได้ผ่าน API ตรง
        โดยไม่ผ่าน dropdown ที่ step 4b ล็อกไว้แล้ว) — escape ผ่าน `escapeHtml()` อย่างเดียวไม่พอสำหรับฝั่ง
        `onclick` ด้วย (HTML entity จะถูก decode กลับเป็นตัวอักษรจริงก่อนกลายเป็น JS source ทำให้ escape
        แบบ HTML เจาะ single-quote ของ inline handler ได้อยู่ดี) แก้โดยเปลี่ยนไปสร้าง tab ผ่าน
        `createElement`+`.textContent`+function reference จริงสำหรับ `onclick` แทนการต่อ string ทั้งหมด
        (เทคนิคเดียวกับ `renderFilterChips()` ใน `index.html` จาก step 4a) — `setcat()` เปลี่ยนมาเรียก
        `buildTabs()` ซ้ำแทน logic เดิมที่ match active tab ด้วยข้อความ label (เปราะ พังทันทีถ้าชื่อหมวด
        ไม่ตรงกับ slug ตรงตัวอักษร) — ทดสอบผ่าน DOM-stub script (11 เคส รวมจำลอง malicious category value
        ยืนยันไม่มีทาง inject ได้ทั้ง 2 vector) บวกทดสอบจริงกับ local dev server: `/categories`,
        `/categories/tops` ตอบ 200 ทั้งคู่ และเช็คข้อมูลสินค้าจริงใน DB มีครบทั้ง
        tops/pants/accessories/other/null ตรงกับที่โค้ดใหม่รองรับ
  - [x] **4d — `tops.html`/`pants.html`/`accessories.html` + `server.js`'s `/categories/:cat` route**
        (commit `bb69d87`) — ตรวจแล้วพบว่า 3 ไฟล์เดิมเหมือนกันทุกตัวอักษร (ต่างแค่ comment/whitespace)
        ต่างกันแค่ `PAGE_CAT` ที่ derive จากชื่อไฟล์เอง (ไม่ใช่จาก routing) — รวมเหลือ `tops.html` ไฟล์
        เดียว (เก็บชื่อไฟล์เดิมไว้ ไม่สร้างไฟล์ใหม่ชื่อคล้าย `categories.html` จาก step 4c ที่จะสับสนได้
        ง่าย) ลบ `pants.html`/`accessories.html` จริง, แก้ `CAT_LABELS` hardcode ให้ดึงจาก `CATEGORIES`
        เหมือน step ก่อนหน้า — `server.js`'s `/categories/:cat` เปลี่ยนจากเช็คไฟล์ `${cat}.html` มีจริง
        ไหม (fallback ไป all-products.html ถ้าไม่มี) เป็นเสิร์ฟ `tops.html` ตรงๆ ทุก `:cat` โดยไม่แคร์ว่า
        หมวดนั้นมีอยู่จริงใน DB หรือไม่เลย (ปล่อยให้ client JS จัดการ, ไม่มีสินค้าก็แค่ empty state) —
        **ตามที่เจ้าของโปรเจกต์ขอชัดเจน (URL เก่าต้องไม่พัง)**: เพิ่ม route `/pants`, `/pants.html`,
        `/accessories`, `/accessories.html` ที่เสิร์ฟ `tops.html` เนื้อหาเดียวกันตรงๆ (ไม่ redirect —
        client อ่าน category จาก `location.pathname` จริงของ browser อยู่แล้ว ไม่ได้พึ่งพาไฟล์ที่ถูกส่งมา)
        ส่วน `/tops`/`/tops.html` ไม่ต้องเพิ่ม route เพราะไฟล์ยังอยู่จริง เสิร์ฟผ่าน
        `express.static`/auto-scan เดิมได้เลย
    - **พบเพิ่มนอกแผนเดิม (ไม่ใช่ 1 ใน 4 ไฟล์ที่เจ้าของโปรเจกต์ระบุตอนแรก) ระหว่าง audit ก่อนเริ่ม 4d**:
      `all-products.html` มี static hardcoded `<div class="f-chip" data-cat="tops">` ฯลฯ (รูปแบบเดียวกับ
      ที่ `index.html` เคยเป็นก่อน step 4a) และ `new-arrival.html`'s `buildChips()` มี hardcoded labels
      map + ต่อ HTML string ดิบเหมือน `categories.html`'s `buildTabs()` เดิม (stored XSS แบบเดียวกันทั้ง
      2 vector) — แก้ทั้งคู่ในคอมมิตเดียวกับ step 4d เพราะเป็นบัคคลาสเดียวกันที่ถ้าไม่แก้จะทำให้ live test
      เพิ่มหมวด skincare ด้านล่างเจอช่องว่างทันที — ทั้งสองไฟล์ตอนนี้ดึง label จาก `CATEGORIES` และสร้าง
      chip ผ่าน `createElement`+`textContent`/`append`+function reference เหมือน `categories.html`
    - **ทดสอบ**: DOM-stub test (11 เคส ครอบ `all-products.html`/`new-arrival.html` ทั้ง count/label/
      XSS-safety) + ทดสอบจริงกับ local dev server ครบทุก URL: `/tops(.html)`, `/pants(.html)`,
      `/accessories(.html)`, `/categories/tops`, `/categories/pants`, `/categories/accessories`,
      `/categories/<fake-slug>` ตอบ 200 หมด, ยืนยัน `/pants`/`/accessories.html`/หมวดปลอมเสิร์ฟ content
      "ตรงกันทุก byte" กับ `/tops.html` (พิสูจน์ว่า routing ไม่ผูกกับไฟล์จริง), `GET /api/products?
      category=` ทั้ง 3 หมวดจริงไม่มี cross-category leak — ระหว่างทดสอบเจอ process `node server.js`
      ค้างจาก step ก่อนหน้าที่ `pkill -f` ฆ่าไม่ตาย (ทำให้เจอ 500 ปลอมจากโค้ดเก่าที่ยังพยายาม sendFile
      `pants.html` ที่ถูกลบไปแล้ว) แก้โดย kill ตรง PID แล้ว restart ใหม่ ไม่ใช่บั๊กจากโค้ดที่แก้จริง

**หมายเหตุ:** งานนี้ตามคำขอเจ้าของโปรเจกต์ให้ทำทีละ step/ไฟล์แล้วสรุปให้ฟังก่อนไปต่อเสมอ — ห้าม batch
step 4b-4d รวดเดียวแม้จะดูคล้ายกัน

---

## Phase 5 — order_shops/order_items — Step 1-3 ปิดครบแล้ว (2026-07-24/25), Step 4 skip

เป้าหมาย Phase 5 เต็มรูปแบบ (แยก order จริงตามร้านเพื่อรองรับ settlement/payout ในอนาคต) วางแผนไว้เป็น
4 step ย่อย (ดู `CLAUDE.md` หัวข้อ 6.3/11) — ทำสำเร็จครบ 3 step แรกแล้ว ตามลำดับ:

### Step 1 — เพิ่มตารางใหม่ + backfill + dual-write (additive, ไม่แตะ read path) — ปิดแล้ว (2026-07-24)

step นี้ทำแค่ "เพิ่มตารางใหม่ + backfill + dual-write" **ไม่แตะ read path ไหนเลย** ตามที่ตกลงกันไว้
ก่อนเริ่ม (ลด risk ให้เหลือแค่ additive schema change)

- [x] **`order_shops`/`order_items` (schema, `db.js`)** — normalized breakdown ของ `orders.items`
      ต่อร้าน `order_shops`(order_id FK CASCADE, shop_id FK nullable, subtotal, status, seller_note,
      tracking_number, cancelled_by, cancel_reason) + `order_items`(order_shop_id FK CASCADE,
      product_id ไม่มี FK เหมือน `orders.items` เดิม, name/price snapshot, image/color/size/quantity)
      — `orders.items` JSONB **ไม่แตะเลย** ยังเป็น source ที่ทุก endpoint/หน้าเว็บอ่านอยู่ 100%
- [x] **Backfill (`backfillOrderShops()` ใน `db.js`, รันทุกครั้งที่ boot)** — group items ของแต่ละ
      order เดิมตาม `shop_id`, order เก่าก่อน Phase 4 Step 4 ที่ item ไม่มี `shop_id` เลย fallback ไป
      ร้านเดียวที่มีอยู่ (trick เดียวกับที่ backfill `products.shop_id` สำเร็จมาก่อน) — idempotent ผ่าน
      query เดียวเช็คว่า order ไหนมี `order_shops` อยู่แล้วบ้าง (ไม่ query ทีละ order) + chunk ทีละ 200
      order, แต่ละ order แยก transaction ของตัวเอง (order พังไม่ลากทั้งชุดตก)
- [x] **Dual-write (`routes/payment.js`'s `POST /payment/create`)** — insert `order_shops`/
      `order_items` ในทรานแซกชันเดียวกับที่ insert `orders` เดิม (ไม่มีทางมี order ที่มีแต่ฝั่งใดฝั่งหนึ่ง)
      — **ไม่ใช้ fallback เดายี่งร้านเดียวแบบ backfill** เพราะเป็น heuristic สำหรับข้อมูลเก่าเท่านั้น
      order ใหม่ที่ item ไม่มี shop_id จริงๆ ปล่อยเป็น NULL ตรงๆ ดีกว่าเดา
- [x] **ทดสอบจริงกับ local dev DB (137 order จริง)**: backfill รอบแรก → 137 order_shops / 139
      order_items ตรงกับผลรวมค่าจาก `orders.items` เป๊ะ ($3,682.87 ทั้งสองฝั่ง) ไม่มีแถว shop_id เป็น
      NULL เลย (ระบบมีร้านเดียว fallback ครอบคลุมหมด) — รัน backfill ซ้ำ 2 รอบ (เรียกฟังก์ชันตรง + restart
      server เต็มรอบ) ยืนยัน idempotent จริง (0 order ถูกประมวลผลซ้ำ) — checkout จริงข้าม 2 ร้าน (สร้างร้าน
      ทดสอบที่ 2) ได้ order_shops แยกถูกต้อง 2 แถว subtotal รวมตรงกับ `orders.subtotal` เป๊ะ —
      สุ่มเช็ค endpoint เดิมทั้งหมด (`/orders`, `/seller/orders`, `/seller/stats`, `/seller/products`,
      `/coupons/seller`, `/products`) ยังทำงานปกติ 200 ทุกตัว ลบข้อมูลทดสอบออกหมดแล้ว
- [x] **ยืนยันบน production จริงผ่าน `PRODUCTION_DATABASE_URL_READONLY`** (read-only, ไม่รันเซิร์ฟเวอร์
      ใส่ connection string นี้) — deploy สำเร็จ ตาราง `order_shops`/`order_items` มีจริง, backfill รัน
      สำเร็จ: **46 order จริง → 46 order_shops / 50 order_items**, 0 แถว NULL shop_id (production มี
      ร้านเดียวเหมือน local dev) — ตัวเลขสมเหตุสมผล ไม่มี error ใน migration
- commit `3ad130e`
- ⚠️ **หมายเหตุตอนปิด Step 1**: verify ตอนนั้นทำ**ทันทีหลัง push ไม่กี่นาที** ยังไม่มี "ช่วงเวลาสังเกตอาการ
  จริงบน production" ใดๆ เลย — **อัปเดต**: เจ้าของโปรเจกต์ยืนยันแล้วว่า Step 1 ผ่านการสังเกตจริงบน
  production ต่อมา (มีการสั่งซื้อจริงอย่างน้อย 1 ครั้ง ไม่มี error ใน Render logs) ก่อนจะเริ่ม Step 2 ตามที่
  ตกลงกันไว้

### Step 2 — ย้าย seller-facing reads/writes ไปใช้ order_shops/order_items — ปิดแล้ว (2026-07-25)

Migrate `GET /api/seller/orders`, `PATCH /api/seller/orders/:id` (status/tracking), `PATCH
/api/seller/orders/:id/note`, `GET /api/seller/stats` จาก unnest `orders.items` JSONB ไปอ่าน/เขียน
`order_shops`/`order_items` โดยตรงแทน

- [x] **Prep — sync `order_shops` จากทุกจุดที่เคยแก้ `orders.status` ตรงๆ**: เจอ 3 จุดที่ไม่ใช่ seller
      PATCH แต่ก็แก้ `orders.status` เหมือนกัน (`settleOrderPayment()`, `expireIfNeeded()`, ลูกค้า
      self-cancel `POST /orders/:id/cancel`) — ถ้าไม่ sync ตามไปด้วย seller-facing read ที่ migrate แล้ว
      จะเห็นสถานะเก่าค้าง ทั้ง 3 จุด apply แบบ uniform ได้ปลอดภัย (เกิดก่อนที่ order_shops จะ diverge กัน
      ได้เสมอ) — commit `2f215c1`
- [x] **Migrate `GET /orders`, `PATCH /orders/:id`, `PATCH /orders/:id/note`, `GET /stats`**: admin
      เห็น 1 แถวต่อ (order, shop) แทน 1 แถวต่อ order (multi-shop order แสดงแยกร้าน ยังไม่กระทบ order จริง
      เพราะมีร้านเดียว) seller cancel เฉพาะร้านตัวเอง คืน stock เฉพาะ item ร้านตัวเอง (ประโยชน์จริงของ
      Phase 5 ที่ทำได้จริงแล้ว) — **design decision ที่ถามก่อนเขียนโค้ด**: เมื่อ `order_shops` ของ order
      เดียวกัน diverge กัน (คนละสถานะ) ตัว `orders.status` ที่ dual-write กลับไป (ลูกค้ายังอ่านตรงนี้จนกว่า
      Step 3 จะเสร็จ) จะ **freeze ค้างไว้ที่ค่าล่าสุดที่ตรงกันทุกร้าน ไม่เดา aggregate ใหม่** แล้ว un-freeze
      อัตโนมัติเมื่อทุกร้าน converge กลับมาตรงกันอีกครั้ง — `seller_note`/`tracking_number` เป็น field
      เดี่ยว mirror ค่าล่าสุดที่เพิ่งเขียนเสมอ (last-writer-wins ถ้ามีมากกว่า 1 ร้านแก้ — ยอมรับเป็น known
      limitation จนกว่า Step 3 จะให้หน้าลูกค้าเห็นแยกร้านจริง) — commit `b31d839`
- [x] **ทดสอบจริง**: single-shop order (ทุก order จริงตอนนี้) — seller เปลี่ยน processing→shipped
      (พร้อม tracking)→delivered + แก้ note ครบ ลูกค้าเห็นการเปลี่ยนแปลงทันทีทุกจุดผ่าน `GET
      /api/orders/:id` (regression ที่กังวลไว้ตั้งแต่ก่อนเริ่ม Step 2 — ยืนยันไม่พัง) — multi-shop order
      (สร้างร้านทดสอบที่ 2 จริง, checkout จริงข้าม 2 ร้าน) — seller ร้าน A ขยับสถานะร้านตัวเองคนเดียวทำให้
      diverge, `orders.status` freeze ถูกต้อง, ร้าน B ไม่เห็นผลกระทบเลย, พอทั้งสองร้าน converge กลับมา
      `orders.status` un-freeze ถูกต้อง, seller A cancel เฉพาะร้านตัวเอง คืน stock แค่ item ร้านตัวเอง
      (ยืนยันด้วยตัวเลข stock จริงก่อน-หลัง) ร้าน B ไม่ถูกแตะเลย — admin เห็น 2 แถวแยกร้านถูกต้อง — เจอ
      บั๊กระหว่างเขียน (จับได้ก่อน deploy): PATCH response เดิมส่ง `order_shops` row's UUID เป็น `id` แทน
      order จริง ทำให้ frontend's `Object.assign(o, order)` จะพัง local cache — แก้ให้ response คืน
      order id จริงเสมอ

### Step 3 — ย้าย customer-facing reads ไปใช้ order_shops/order_items — ปิดแล้ว (2026-07-25)

สำรวจก่อนเขียนโค้ดพบว่าขอบเขตแคบกว่าที่วางแผนไว้ตอนแรก: `checkout.html`/`payment.html`/`pay.html`
**ไม่ต้องแก้เลย** เพราะอ่านแค่ `.status` (paid/expired/cancelled/failed) กับนับจำนวน `.items.length` —
ทั้งคู่เป็น concept ระดับ "ทั้งออเดอร์" โดยธรรมชาติ (1 payment/1 ABA transaction ต่อ 1 checkout ไม่ว่าจะกี่
ร้าน) ไม่ต้องมี per-shop granularity — บังคับให้อ่านจาก `order_shops` จะผิดความหมายเปล่าๆ

- [x] **Design decisions ที่ถามก่อนเขียนโค้ด**: (1) badge สถานะเดี่ยวใน `orders.html`/`account.html` (list
      card ไม่มีที่โชว์ per-shop breakdown) — ตกลงให้ยังโชว์ `orders.status` ที่ freeze ไว้เหมือนเดิม ไม่
      คิด aggregate ใหม่ (สอดคล้องกับ decision เดียวกันใน Step 2) (2) `order-detail.html` progress bar —
      ตกลงให้เก็บ tracker หลักอันเดียวไว้เหมือนเดิม (ขับเคลื่อนด้วย headline status เดิม) แล้วเพิ่ม section
      per-shop แยกต่างหากด้านล่างเสริมเข้าไป ไม่ใช่แทนที่
- [x] **Backend — `GET /api/orders`, `GET /api/orders/:id` แนบ `shops[]`**: additive ล้วนๆ field เดิม
      ทั้งหมด (`items`/`status`/`seller_note`/`tracking_number`/...) ไม่ถูกแตะเลย ยังอ่านจาก `orders`
      ตรงๆ เหมือนเดิม (ที่ Step 2 dual-write ให้ถูกต้องอยู่แล้ว) — `shops[]` คือข้อมูลใหม่สำหรับหน้าที่
      อยากได้ per-shop view จริงๆ เท่านั้น — commit `cb04bd5`
- [x] **Frontend — `order-detail.html` เพิ่ม "Fulfilled by N Shops" card, `success.html` group item
      list ตามร้าน**: ทั้งคู่ gate ด้วย `shops.length>1` — คืนค่าว่าง/ไม่ทำอะไรถ้ามีร้านเดียว (ทุก order
      จริงตอนนี้) หน้าตาเหมือนเดิม 100% สำหรับข้อมูลจริงทุกใบที่มีอยู่ — `checkout.html`/`payment.html`/
      `pay.html`/`orders.html`/`account.html` **ไม่แตะเลย** ตามที่สำรวจไว้ข้างบน — commit `101abc0`
- [x] **ทดสอบ**: backend response shape ยืนยันด้วย checkout จริงข้าม 2 ร้าน (single-shop → `shops` มี 1
      แถวตรงกับ field เดิมทุกอัน, multi-shop → 2 แถวแยกกันถูกต้อง ไม่มีข้อมูลข้ามร้านปนกัน) — render
      function ทั้งสองไฟล์ extract มารันนอก browser (session นี้ไม่มี browser automation tool) ด้วยข้อมูล
      จำลองรวม XSS payload ยืนยัน escape ถูกต้อง ไม่มี raw tag หลุด
- ⚠️ **ยังไม่ยืนยัน**: หน้าตาจริงในเบราว์เซอร์ (ไม่มี browser tool ให้ใช้ session นี้) — ตรวจแค่ HTML output
  string ถูกต้อง/ปลอดภัย ไม่ได้ screenshot จริง ควรเปิดดูจริงกับ multi-shop test order สักรอบ

### Step 4 — เลิก dual-write JSONB เดิม — **skip (ไม่ทำ ตามที่ตัดสินใจแล้ว)**

**ตัดสินใจแล้วว่าไม่ทำ** — `orders.items` JSONB ให้เก็บไว้ตลอดไปเป็น audit trail (ไม่มีต้นทุนอะไรที่ต้องเก็บ
ไว้) การเลิก dual-write จะต้องมั่นใจ 100% ว่าไม่มีจุดไหนเหลืออ่านจาก JSONB อีกเลย ซึ่งเป็นความเสี่ยงที่ไม่
คุ้มกับประโยชน์ที่ได้ (ประหยัดพื้นที่/ความซับซ้อนโค้ดเล็กน้อย) — ถ้าจะพิจารณาใหม่ในอนาคตต้องคุย scope ก่อน

---

## Seller stats/coupon scoping (Part A ของแผน Phase 5 planning) — ปิดแล้ว (2026-07-24)

- [x] **`GET /api/seller/stats` scope ตาม shop** — 5 query (ordersRes/customersRes/pendingRes/
      statusRes/topRes) เพิ่ม shop filter แบบเดียวกับ `/seller/orders`, 2 query (revenueRes/dailyRes)
      ต้อง rewrite ใหม่จาก `SUM(orders.total)` เป็น unnest items แล้ว sum เฉพาะ item ของร้านตัวเอง
      (ไม่งั้นรายได้ร้านอื่นจะรั่วปนเข้ามาในออเดอร์ multi-shop) เพิ่ม admin-vs-seller branch ครบทั้ง 7
      query (admin เห็นเหมือนเดิมทุกอย่าง ไม่เปลี่ยน) — `getOwnApprovedShop()` ย้ายจาก `routes/seller.js`
      ไปไว้ `middleware/auth.js` (ให้ `routes/coupons.js` เรียกใช้ร่วมกันได้ด้วย) — commit `50e383e`
- [x] **Coupon access control** — เพิ่ม `coupons.shop_id` (nullable, NULL = คูปองส่วนกลางใช้ได้ทุกร้าน,
      คูปองเดิมทั้งหมดกลายเป็นแบบนี้อัตโนมัติไม่ต้อง backfill) scope `GET/PATCH/DELETE /seller` ให้เห็น/
      แก้ได้เฉพาะร้านตัวเอง+คูปองส่วนกลาง, admin ไม่จำกัด — เจอว่าเดิมไม่มี ownership check เลยสักจุด (ร้าน
      ไหนก็แก้/ลบคูปองร้านอื่นได้) ไม่ใช่แค่ stats รั่ว เป็น access-control gap จริง — commit `77567a7`
- [x] **ทดสอบจริงด้วย checkout ข้าม 2 ร้าน**: สร้างร้านทดสอบที่ 2 จริง, order เดียวมี item จาก 2 ร้าน —
      ยืนยัน stats ร้าน A/B ไม่ปนกัน (แยกรายได้ถูกต้อง), admin เห็นยอดรวมแพลตฟอร์มไม่เปลี่ยน, seller B
      เห็น/แก้/ลบคูปองร้าน A ไม่ได้ (404 ทั้งคู่ ไม่ลบจริง), คูปองส่วนกลางเห็นได้ทั้งสองร้าน
- **ไม่ได้แตะ**: checkout discount computation (คูปองยังหักส่วนลดจาก subtotal ทั้งออเดอร์เหมือนเดิม
  ไม่ได้แยกตามร้าน — ผูกกับ Phase 5 เต็มรูปแบบ ตั้งใจเลื่อนไปทำทีหลัง)

---

## Audit orders.html/payment.html + แก้บั๊กที่เจอ — ปิดแล้ว (2026-07-24)

Audit แบบ "หาก่อน ห้ามแก้" รอบแรก (1.1-1.5) แล้วตกลง fix ทีละเรื่องตามลำดับ priority:

- [x] **1.2 — "Buy Again" ไม่ทำงานจริง**: `orders.html`'s `_addToCart()` เขียน localStorage ตรงๆ ไม่เคย
      เรียก `CartAPI.add()` sync ไป server เลย พอเปิด `cart.html` (เรียก `Cart.loadFromServer()` ทันทีถ้า
      login อยู่) ข้อมูล server เขียนทับ localStorage ทั้งก้อน item ที่เพิ่งกด Buy Again เลยหายไป — แก้โดย
      เรียก `Cart.add()` (helper กลางที่ใช้ทั่วแอปอยู่แล้ว) แทน — commit `d697686`
- [x] **1.5 — Payment status ไม่ auto-update (สำคัญที่สุด)**: root cause คือ poll เดิมทั้ง 3 จุด
      (`payment.html`/`pay.html`/`order-detail.html`) เป็น passive (อ่านค่า DB เฉยๆ ไม่เคยเรียก ABA เอง)
      ต้องรอ webhook อัปเดต DB ก่อน — webhook เองก็ไม่เคย verify end-to-end บน production URL จริง เปลี่ยน
      poll ทั้ง 3 จุดเป็น active (เรียก `/payment/confirm/:id` จริง, `pay.html` เพิ่ม endpoint ใหม่
      `POST /payment/link/:id/confirm` public+token-gated เพราะไม่มี login session) ไม่ต้องพึ่ง webhook
      อย่างเดียวอีกต่อไป (webhook ยังทำงานคู่ขนาน idempotent ไม่ชนกัน) แก้ webhook handler ให้ตอบ 200 เสมอ
      ตามที่ comment เดิมตั้งใจไว้ (เดิม 400 ถ้าหา tran_id ไม่เจอ ขัดกับ comment ที่บอกว่า "always 200 กัน
      retry storm") + log raw body ไว้ debug ถ้าเจอ payload หน้าตาไม่คาดคิดจริงในอนาคต interval 10s→7s —
      commit `3b34477`
- [x] **1.4 — ข้อความ "PromptPay" หลุดมา**: จุดเดียวในทั้งโปรเจกต์ (`order-detail.html:377`) hardcode
      "KHQR / PromptPay QR" ทั้งที่ระบบใช้ ABA PayWay/KHQR กัมพูชาอย่างเดียว ไม่มี PromptPay (ไทย)
      เกี่ยวข้องเลย แก้เป็น "KHQR (ABA PayWay)" — commit `76da665`
- [x] **1.3 bonus cleanup**: `order-detail.html`'s `renderFooter()` มี `cancelled`/`expired` branch ซ้ำ
      กัน 2 จุด (condition เดียวกัน) จุดแรกไม่ set `btns` เลย (footer เลยหายทั้งก้อน) จุดสอง (มีปุ่ม
      "Shop Again" จริง) เลย unreachable ตลอด — ลบก้อนซ้ำ เอาปุ่มที่ใช้งานได้จริงขึ้นมาแทน + เพิ่ม branch
      `status='failed'` ที่ไม่มีมาก่อนเลย (ปุ่ม "Try Again" เรียก `buyAgain()` เดิม) ทั้ง
      `order-detail.html` และ `orders.html`'s `reorderBtn` — commit `6e536a0`
- [x] **1.1 — ตรวจ "โค้ดรั่วไหล" แล้วไม่พบ**: ไม่มี secret/API key hardcode, ไม่มี console.log หลุดข้อมูล
      อ่อนไหว, `GET /api/orders`/`:id` scope ด้วย `user_id` ถูกต้อง ไม่มี cross-user leak — สรุปว่าไม่ใช่
      บั๊ก (รายงานตรงๆ ว่าตรวจแล้วไม่เจอ)

---

## orders.html/order-detail.html wording rework (สไตล์ TikTok Shop/Shopee) — ปิดแล้ว (2026-07-23)

- [x] **ขั้น 3 — Badge label + progress bar wording**: `STATUS_LBL` แยก label ครบทุก 9 status ไม่รวมคำ
      (To Pay/Verifying Payment/Paid/Preparing/Shipped/Completed/Cancelled/Expired/Payment Failed)
      ทั้ง `orders.html`/`order-detail.html` — progress bar bucket wording คนละแบบกันโดยตั้งใจ
      (`orders.html` 4-step merge pending+pending_verification และ paid+processing, `order-detail.html`
      5-step แยก paid/processing คนละ step — เจอความไม่ตรงกันนี้ระหว่างทำ ไม่ใช่บั๊ก แค่คนละ design)
      `seller-orders.html` เก็บ wording operational เดิมไว้ตามที่ตกลง แต่เจอว่า `failed` ไม่มี handling
      เลยสักจุด (badge CSS/label/payment-status/progress) เพิ่มให้ครบเหมือน `cancelled`/`expired` —
      commit `be7792a`
- [x] **ขั้น 4 — Filter tab wording**: `orders.html`'s filter tabs เปลี่ยนจาก raw status เดี่ยวเป็น
      bucket เดียวกับ progress bar (`statuses:[...]` array ต่อ tab แทน `id` เดี่ยว) — "Cancelled" รวม
      `expired`/`failed` เข้าไปด้วย (ก่อนหน้านี้ 2 status นี้ไม่มี tab เลย เห็นได้แค่ผ่าน "All") ยืนยัน
      ครบทั้ง 9 status ต่อ tab เดียวไม่ซ้ำไม่ขาด — commit `946a85a`

---

## orders.html status-mapping bug + dead code cleanup — ปิดแล้ว (2026-07-23)

- [x] **`processing`/`pending_verification`/`failed` ไม่มี entry ใน `orders.html`'s
      `STATUS_LBL`/`STATUS_CSS`/`TRACK_IDX`** — เช็ค status ที่เป็นไปได้จริงจาก `ALLOWED_TRANSITIONS`
      (`routes/seller.js`) + compensating transaction ตอน ABA purchase ล้มเหลว (`routes/payment.js`) ได้
      ครบ 9 status (ไม่ใช่แค่ 6 ที่เคย map ไว้) — order ที่ `processing` (จ่ายแล้วจริง) เคย fallback โชว์
      badge "Pending" หลอกลูกค้าว่ายังไม่จ่าย, timeline ก็ fallback เป็น step 0 เพิ่ม 3 status ที่ขาดครบ
      (สี badge ตามที่ `seller-orders.html` ใช้อยู่แล้ว ไม่ได้คิดใหม่) `order-detail.html` ขาดแค่ `failed`
      ตัวเดียว (processing/pending_verification มีอยู่แล้ว) เพิ่มให้ครบเหมือนกัน — **ไม่แตะ** `reorderBtn`
      logic ใน orders.html (ยังมี `failed` ตกไปโชว์ "Buy Again" อยู่ — รู้แล้ว เก็บไว้รอบ wording ถัดไป
      ตามที่ตกลงกัน ไม่ขยาย scope) — ทดสอบจริง: สร้าง order จริง 3 ใบ ตั้ง status ตรงกับที่ backend ใช้จริง
      แล้วรัน mapping object ปัจจุบันของทั้ง 2 ไฟล์กับข้อมูลจริง ยืนยันไม่มี fallback เกิดขึ้นเลยสักตัว —
      commit `74b81fa`
- [x] **ลบ `POST /api/payment/send-link/:orderId`** — ยืนยันแล้วว่าไม่มีจุดไหนในโปรเจกต์เรียกใช้เลย (เช็ค
      ทุกหน้า frontend + `telegram-bot.js`) ลบออกจาก `routes/payment.js` ไม่มี helper function แยกที่ใช้
      เฉพาะ route นี้ต้องลบตาม — **ไม่แตะ** `pay.html` หรือ `GET /api/payment/link/:orderId` (คนละ endpoint
      กัน, เป็นปลายทางจริงของปุ่ม Pay Now) ทดสอบจริง: endpoint ที่ลบยิงแล้ว 404, `GET /link/:orderId` (ที่
      `pay.html`/Pay Now ใช้จริง) ยังทำงานปกติ 100% หลังลบ — commit `6782b9a`

---

## Shop logo/name บนหน้าสินค้า — ปิดแล้ว (2026-07-23)

- [x] **`product.html` โชว์ "BARDS" hardcode ทุกสินค้า ไม่ว่าเป็นของร้านไหน** — `routes/products.js`'s
      `GET /` (list) และ `GET /:id` ทั้งคู่ LEFT JOIN `shops` ผ่าน `products.shop_id` คืน `shop_name`/
      `shop_logo` มาด้วย (ต้องเติม `p.`/`s.` prefix ทุกคอลัมน์ใน query list เพราะ `shops`/`products` มี
      คอลัมน์ `name` ชนกัน — ไม่ทำแบบนี้จะได้ ambiguous column error) `product.html` เพิ่ม
      `renderSellerBadge()` เรียกหลังโหลดสินค้าเสร็จ ใช้ `P.shop_name`/`P.shop_logo` (ได้มาฟรีจาก
      `normalizeProduct()`'s `...p` spread อยู่แล้ว ไม่ต้องแก้ normalize) fallback เป็น "BARDS"/อักษรย่อ 2
      ตัวถ้าไม่มีร้าน/โลโก้ — commit `d7089f7`
  - ทดสอบจริง: สร้างร้านที่ 2 จริง (seller คนละคน, ชื่อ "Neon Threads Co", มี logo) + อนุมัติ + สร้างสินค้า
    ให้ ยืนยันว่า `GET /products` (list) และ `GET /products/:id` คืน `shop_name`/`shop_logo` ถูกต้องแยกกัน
    ระหว่าง 2 ร้าน (ร้านที่มี logo แสดงรูปจริง, ร้านที่ไม่มี logo fallback เป็นอักษรย่อ) ยืนยันด้วยว่า
    `escapeHtml()` กัน attribute-breakout XSS ผ่าน `shop_logo` ได้จริง (payload ทดสอบ `x" onerror="..."`)
  - **ไม่แตะ** `pay.html`/`payment.html`'s "BARDS Store"/"BARDS SHOP" — เป็น platform branding ของหน้า
    จ่ายเงิน (1 order อาจมีสินค้าหลายร้านปนกัน ไม่มี "ร้านเดียว" ที่ถูกต้องให้โชว์ตรงนั้น) คนละ concept กับ
    per-product badge ของ product.html

---

## รอบ UX เร่งด่วน + Telegram iOS + deploy trust check — ปิดเกือบครบ (2026-07-23, เหลือ Telegram รอยืนยัน)

- [x] **Checkout สร้าง order ซ้ำได้ถ้ากด back** — order สร้างจริงตอนกด PLACE ORDER (ถูกต้องแล้ว) แต่
      ตะกร้าไม่ถูกล้างจนกว่าจะจ่ายเงินสำเร็จ กด back ไปเช็คเอาต์ใหม่สร้างซ้ำ+ตัด stock ซ้ำได้ — ย้ายจุดล้าง
      ตะกร้ามาทำทันทีตอนสร้าง order สำเร็จ (ลบเฉพาะ item ที่สั่งจริง ไม่ clear ทั้งตะกร้า) — commit `6ebceff`
- [x] **Buy Now** — รอบก่อนเข้าใจผิดว่าให้ลบ ที่จริงต้องแก้ให้ "ซื้อเลย" ข้ามตะกร้าไปเช็คเอาต์ตรงๆ จริงๆ —
      คืนปุ่มแล้วสร้างใหม่ให้ถูก (ไม่แตะ persistent cart เลย ใช้ CHECKOUT_ITEMS ไปตรง checkout.html) —
      commit `3b34c51`
- [x] **payment.html ไม่มีทางออก** — เพิ่มปุ่ม "I'll pay later" ให้ออกจากหน้าได้โดยไม่ต้องรอ/กดอะไรตอนนี้
      — commit `a53af4e`
- [x] **ปุ่ม "Verifying..." ที่ order-detail.html** — ลบออก (แพลตฟอร์มอื่นไม่มี) — commit `a53af4e`
- [x] **สินค้าปลอม 8 ชิ้น hardcode ใน products.js** — โผล่ปนกับสินค้าจริงทุกหน้า catalog มาตลอด (ไม่มีใคร
      ลบออกจาก `fetchAndMerge()` ได้เพราะมันแค่เพิ่ม/ทับ) กดเข้าไปซื้อไม่ได้จริงเพราะไม่มีใน DB — ลบออก
      หมด, แก้ CATEGORIES การ์ดหน้าแรกไม่ให้พึ่ง fake image, เพิ่ม fetchAndMerge() ให้ cart.html's
      recommended-products (เดิมไม่เคยเรียกเลย) — commit `278a935`
- [x] **ปุ่ม wishlist ทับรูปสินค้า** — ย้ายมาอยู่แถวราคา/สต็อก ชิดขวา ตรงกับ Shopee/Lazada/TikTok —
      commit `3b34c51`
- [~] **Telegram login พังบน iPhone — แก้ไปแล้วแต่ยังไม่ยืนยันด้วยการทดสอบจริงบน iPhone** — **แก้ผิดจุดใน
      รอบแรก**: เปลี่ยน flow เป็น full-page redirect ไป oauth.telegram.org (commit `5941e18`) โดยอ้างอิงจาก
      "ปัญหาทั่วไปของ iOS Safari popup" ซึ่ง**ไม่ได้ทดสอบบนอุปกรณ์จริงเลย** เจ้าของโปรเจกต์ทักท้วงว่าเคย
      ทดสอบ Telegram popup บน iPhone จริงแล้วทำงานปกติดี ไม่เคยมีปัญหา — **revert กลับไปใช้ popup flow เดิม**
      (commit `32ba550`) แล้วเสนอทฤษฎีที่ 2: Helmet เปิด `Cross-Origin-Opener-Policy: same-origin` เป็น
      default (ยืนยันจาก response header จริงของ bardskh.com) ซึ่งตามหลักการตัดการเชื่อมต่อ `window.opener`
      ระหว่างหน้ากับ popup ที่เปิดไป origin อื่น ปรับเป็น `same-origin-allow-popups` แล้ว (commit `e08ca46`)
      **แต่พบระหว่างอ่านเอกสารรอบนี้ (2026-07-23) ว่าทฤษฎีนี้ก็มีคำถามค้างอยู่เหมือนกัน**: section "Security
      hardening — Helmet" ด้านล่างในไฟล์นี้ (บันทึกไว้ตั้งแต่ 2026-07-21) บอกว่า Telegram widget ใช้
      `postMessage` ซึ่งไม่ถูก COOP บล็อกตามทฤษฎี และ `docs/04-deploy-render.md` หัวข้อ 8 ก็บันทึกว่าทดสอบ
      Telegram login ผ่านโดเมนจริงแล้วสรุปว่า COOP ไม่ใช่ปัญหา (2026-07-22) — ทั้งสองข้อสรุปเก่านี้ก็ไม่มี
      หลักฐานว่าทดสอบบน iPhone จริงโดยเฉพาะเหมือนกัน **สรุป: ยังไม่รู้แน่ชัดว่า COOP คือสาเหตุจริงหรือไม่** การ
      ปรับ COOP เป็นการป้องกันไว้ก่อนที่ความเสี่ยงต่ำ (ไม่กระทบอะไรถ้าไม่ใช่สาเหตุจริง) แต่**ต้องรอผลทดสอบจริง
      บน iPhone ของเจ้าของโปรเจกต์หลัง deploy ก่อนถึงจะถือว่าปิดเคสนี้ได้**
      **บทเรียน**: ต้องแยกให้ชัดระหว่าง "อนุมานจากความรู้ทั่วไป" กับ "ทดสอบแล้วจริง" ก่อนเสนอเป็นข้อสรุป —
      ไม่ใช่ทั้งหมดของงานเซสชันนี้มีปัญหานี้ (XSS/checkout/fake-products/order-detail-poll ฯลฯ ล้วน
      ทดสอบจริงด้วยข้อมูลจริงผ่าน API จริงก่อนสรุปทุกครั้ง) แต่ Telegram เป็นจุดเดียวที่พลาดเสนอความมั่นใจ
      เกินกว่าที่ตรวจสอบจริง — และเป็นจุดที่มีข้อสรุปเก่าขัดแย้งกันเองในเอกสารด้วย ต้องระวังไม่ให้เกิดซ้ำ
  - เจอ bug แถมระหว่างทดสอบ (ไม่เกี่ยวกับ Telegram โดยตรง): local dev DB มี `users.email` เป็น NOT NULL
    ค้างจาก schema เก่า (ตรวจ production ผ่าน `PRODUCTION_DATABASE_URL_READONLY` แล้วว่า nullable ถูกต้อง
    อยู่แล้ว ไม่ใช่บั๊ก production) แก้แค่ local dev ให้ตรงกัน
- [x] **เจ้าของโปรเจกต์สงสัยว่า deploy ไม่ทำงาน** — ตรวจแล้วพบว่า deploy ทำงานถูกต้อง (เทียบ response
    จริงจาก bardskh.com กับโค้ดที่ push แต่ละรอบ) มีแค่ queue ของ Render ที่ตามหลังอยู่บ้างเวลา push
    ติดกันหลายรอบเร็วๆ (ใช้เวลาหลายนาทีกว่าจะ deploy ทัน HEAD จริง) ไม่ใช่ deploy พัง

---

## "ทำไมจ่ายแล้วไม่ auto-update" + self-attested confirm cleanup — ปิดแล้ว (2026-07-23)

เจ้าของโปรเจกต์รายงานว่า order ที่จ่ายแล้วไม่เห็น auto-update สถานะ + ขอตรวจ UX/ไฟล์ที่ไม่มีประโยชน์ทั้งหมด
พบและแก้ 4 เรื่องจริงจากการอ่านโค้ด (ไม่ใช่เดา):

- [x] **root cause ของ "ไม่ auto-update"**: `order-detail.html` **ไม่มี poll เลย** (มีแค่ countdown timer)
      ต่างจาก `payment.html`/`pay.html` ที่ poll ทุก 10 วิอยู่แล้ว — เพิ่ม poll แบบเดียวกัน (`GET
      /api/orders/:id` ทุก 10 วิ ระหว่าง `pending`/`pending_verification`, re-render เฉพาะตอน status
      เปลี่ยนจริง) — ทดสอบจริง: จำลอง pending→paid แล้วยืนยันว่า poll เห็นการเปลี่ยนแปลง — commit `131a547`
- [x] **ปุ่ม "I've Paid" เป็นบั๊กจริง ไม่ใช่แค่ไม่มีประโยชน์**: กดตอน `pending_verification` (จุดเดียวที่
      โผล่) เรียก endpoint เดิมที่เช็ค `WHERE status='pending'` เท่านั้น → update 0 row เสมอ แต่ UI ขึ้น
      "✓ Sent!" หลอกว่าสำเร็จ ที่ร้ายแรงกว่าคือ `payment.html`'s เวอร์ชันขึ้น "✓ ORDER PLACED!" + redirect
      ทันทีโดยไม่เช็คอะไรกับ ABA เลย และฝั่ง seller (`quickConfirm`/`doAction`'s "Confirm Payment") PATCH
      `status='paid'` ตรงๆ ไม่เช็ค ABA เหมือนกัน (seller mark paid เองได้โดยไม่มีเงินเข้าจริง) — เจ้าของ
      โปรเจกต์ตัดสินใจ: ลบปุ่มฝั่ง customer ออกทั้งหมด (auto-poll ครอบคลุมพอแล้ว, ตรงกับที่ Shopee/Lazada/
      TikTok ไม่มีปุ่มแบบนี้ให้ลูกค้ากด) ส่วนที่เหลือทุกจุดเปลี่ยนไปเรียก `POST /payment/confirm/:orderId`
      จริง (เช็คกับ ABA ผ่าน `settleOrderPayment()`) แทนการเซ็ต status ตรงๆ — ทดสอบจริงครบ: endpoint เดิม
      ลบแล้ว 404, `/confirm` คืน `status:'pending'` ตอนยังไม่จ่ายจริง และ `status:'paid'` หลัง settle ทั้ง
      จากมุมมอง owner และ seller (non-owner) — commit `47f02f1`
- [x] **Cancel button เท่ากับ Pay Now เป๊ะตอน `pending`** — inconsistent กับ `pending_verification` ที่ลด
      ขนาด Cancel ไว้แล้ว (`flex:.5`) แก้ให้เหมือนกัน ให้ Pay Now เด่นกว่า (commit เดียวกับข้อบน)
- [x] **Dead code cleanup**: ลบ legacy static-KHQR builder (76 บรรทัด comment ทิ้งไว้ใน `payment.js`,
      เลิกใช้จริงตั้งแต่ 2026-07-18) และลบ `GET /api/seller/public/products`(`/:id`) — **เจอว่า diagnosis
      เดิมในเอกสารผิด**: `:id` variant ใช้งานจริงโดย `product.html` (หน้า product detail จริง) ไม่ใช่ของค้าง
      แก้โดยสลับ `product.html` ไปเรียก `/api/products/:id` (query/response เหมือนกันเป๊ะ) ก่อนค่อยลบ route
      — commit `42c169a`. Facebook OAuth ถามแล้ว **เก็บไว้เหมือนเดิม** ตามคำสั่ง (ยังเป็น roadmap ที่ยังไม่
      เปิดใช้ ไม่ใช่ของทิ้ง)

---

## UX/Security audit follow-up — ปิดแล้ว 3 ข้อ (2026-07-22)

หลังทำ audit เต็มรอบ (เทียบ roadmap เดิม + payment auto-update + UI/UX+security + multi-domain assessment)
เจ้าของโปรเจกต์สั่งทำ 3 ข้อเรียงลำดับ ห้ามข้าม ทำทีละข้อ ทดสอบก่อนไปข้อถัดไป — ปิดครบแล้วทั้ง 3:

- [x] **Stored XSS ทุกจุดที่ interpolate `${variable}` เข้า `innerHTML` โดยไม่ผ่าน `escapeHtml()`** — แก้ 11
      ไฟล์ (`categories.html`, `order-detail.html`, `seller-orders.html`, `success.html`, `cart.html`,
      `seller.html`, `seller-analytics.html`, `seller-coupons.html`, `seller-products.html`,
      `orders.html`, `checkout.html`) มี 2 ทิศทางที่ exploit ได้จริงก่อนแก้: customer→seller/admin (ชื่อ/
      อีเมล/ที่อยู่ในหน้า dashboard) และ seller→customer (ชื่อ/รูปสินค้า, `seller_note`) — เจอบั๊กย่อยด้วย:
      `success.html`'s `_esc()` เดิม escape แค่ `&<>` ขาด `"`/`'` (attribute-context gap), `seller-orders.html`'s
      note `<textarea>` เสี่ยง breakout (`</textarea><script>`) เพราะ inject เข้า element content ตรงๆ —
      ทดสอบจริงด้วยการยิง payload (`<script>`, `<img onerror=...>`, `</textarea><script>`) ผ่าน API จริง
      (signup/checkout/seller-note) แล้ว verify ว่า output เป็น escaped text ล้วน ไม่มี tag/attribute ที่
      execute ได้ — commit `6024b79`
- [x] **`pay.html` hardcode `localhost:3000` + ไม่มี auto-refresh** — เปลี่ยนไปใช้ `api.js`'s `API_BASE`
      (ก่อนหน้านี้หน้านี้ใช้งานไม่ได้เลยนอก localhost) และเพิ่ม poll ทุก 10 วิ (`GET /payment/link/:id`) แบบ
      เดียวกับที่ `payment.html` มีอยู่แล้ว — เหตุผล: เป็นหน้าจ่ายเงินเหมือนกัน ควร behavior เดียวกัน — ทดสอบ
      จริงด้วย order จริง: ยืนยันว่า endpoint คืน `status:'pending'` พร้อม QR ก่อน แล้วคืน `status:'paid'` ตรง
      เงื่อนไขที่ poll เช็คหลัง settle — commit `868f8be`
- [x] **`orders.pay_token` กัน payment link เดา orderId ได้** — `GET /api/payment/link/:orderId` เดิมเช็คแค่
      order id (random จริงมีแค่ ~4 ตัวอักษร base36 จาก `makeOrderId()`) และเป็น public endpoint คืนที่อยู่/
      เบอร์โทร/QR เต็ม — เพิ่ม `orders.pay_token` (random 32-byte hex ต่อ order, backfill order เก่าทุกใบ
      อัตโนมัติใน `db.js` เพราะ per-row randomness ต้องทำใน JS ไม่ใช่ SQL) endpoint ต้องมี `?token=` ตรงกัน
      (เช็คด้วย `crypto.timingSafeEqual`) ถึงจะคืนข้อมูล — token ผิด/ไม่มี/order ไม่มีจริง คืน 404 ข้อความ
      เดียวกันหมด (ไม่บอกว่า order มีจริงไหม) `POST /send-link/:orderId` และ `order-detail.html`'s
      `goToPay()` แนบ token ให้อัตโนมัติแล้ว — ทดสอบจริงครบ 4 เคส (token ถูก/ผิด/ไม่มี/order ไม่มีจริง) —
      commit `37225ca`

**ปิดเพิ่มอีก 2 ข้อที่เคยเก็บไว้คุยทีหลัง (2026-07-22, commit `910bc80`):**

- [x] **Pay Now CTA แทน "Buy Again" สำหรับออเดอร์ที่ยังไม่จ่าย** — `orders.html`'s list card เดิมโชว์ปุ่ม
      "Buy Again" ให้ทุกสถานะยกเว้น `cancelled` (รวมถึง `pending` ที่ยังไม่จ่ายเงินด้วย ซึ่งไม่มีความหมาย) —
      แก้ให้ตรงกับ rule ที่ `order-detail.html`'s `renderFooter` ใช้อยู่แล้ว (ซ่อน Buy Again ตอน pending):
      `pending` → ปุ่ม "Pay Now" สีส้ม พาไป `pay.html` ตรงด้วย `pay_token` ที่ `GET /api/orders` คืนมาให้อยู่
      แล้ว (ไม่ต้องเปิด detail page ก่อน), `pending_verification`/`cancelled`/`expired` → label สถานะปิดไว้
      แทนปุ่มที่กดไม่ได้ผล — ทดสอบจริง: สร้าง order จริง ยืนยันว่า `GET /api/orders` (list) คืน `pay_token`
      มาด้วย และ URL ที่ `quickPayNow()` สร้างยิงไปที่ `GET /api/payment/link/:id?token=...` แล้วได้ 200
      จริง
- [x] **Auto-refresh `orders.html` + `seller-orders.html`** — poll list ใหม่ทุก 15 วิ (แนวคิดเดียวกับ
      `payment.html`/`pay.html`'s 10 วิ แค่เว้นถี่น้อยกว่าเพราะไม่ใช่ countdown ที่ time-critical เท่า) —
      `orders.html` เช็ค signature (id+status+tracking) ก่อน re-render จริง กัน `.fu` fade-up animation
      เล่นซ้ำทุก 15 วิทั้งที่ไม่มีอะไรเปลี่ยน, `seller-orders.html` ข้าม poll ทั้งรอบถ้า modal
      (`#mask.on`) เปิดอยู่ กัน `_allOrders` ถูกแทนที่กลางคันตอนกำลังดู/แก้ order อยู่ — ทดสอบจริง: จำลอง
      order เปลี่ยนจาก `pending`→`paid` แล้วยืนยันด้วย signature diff function ตัวจริงว่า detect การ
      เปลี่ยนแปลงได้ถูกต้อง (unit test เพิ่ม: เนื้อหาเดิมไม่ trigger re-render, มีอะไรเปลี่ยนถึง trigger)

**หมายเหตุการตัดสินใจ:** ตอนแรกเสนอว่า "เจ้าของ order login อยู่" ควรแยกไปหน้า auth-gated ต่างหากจาก
`pay.html` (public link) แต่สุดท้ายเลือก**ไม่แยก** — ให้ list ใช้เส้นทางเดียวกับที่ `order-detail.html`'s
`goToPay()` ทำอยู่แล้วอยู่แล้ว (ไปที่ `pay.html` พร้อม `pay_token` ของ order ตัวเอง) เพราะระบบยังไม่มีหน้า
auth-gated แยกจริง การสร้างหน้าใหม่แค่เพื่อ "เจ้าของ order เห็นข้อมูลที่ตัวเองมีสิทธิ์เห็นอยู่แล้ว" ซ้ำ ไม่คุ้ม
ความซับซ้อนที่เพิ่มขึ้น — ไม่ใช่ช่องโหว่เพิ่มเติมเพราะ token มาจาก endpoint ที่ authenticated อยู่แล้ว
(`GET /api/orders`)

---

## ใส่สินค้าจริงเข้า production — เริ่มแล้ว (2026-07-22)

- [x] เพิ่มสินค้าจริงผ่าน `seller-products` dashboard สำเร็จ — ยืนยันแล้วว่ามีสินค้า `is_active=true`
      บน production DB จริง (Supabase) ไม่ว่างเปล่าอีกต่อไป (ก่อนหน้านี้ 0 สินค้ามาตลอด)
- [ ] ที่เหลือก่อนเปิดขายจริง: swap ABA credential เป็น production (พักไว้ก่อน — ยังไม่สมัคร merchant
      account จริง), อัปเกรด Render/Supabase จาก free plan

---

## งานเล็ก (🟡) หลัง Phase 4 — ปิดแล้ว 2 ข้อ (2026-07-22)

- [x] **`users.role` default schema drift** — เช็คก่อนแก้แล้วพบว่า production ไม่มี drift เลย (แก้แค่
      local dev DB) — ดูรายละเอียดเต็มใน section "Phase 1 (auth part)" ด้านล่าง
- [x] **รวม `requireSeller` copy-paste 3 จุด** (`seller.js`, `coupons.js`, inline ใน `payment.js`) เป็น
      `requireRole()` กลางใน `middleware/auth.js` — `seller.js`/`coupons.js` ประกาศ
      `const requireSeller = requireRole('seller','admin')` ในไฟล์ตัวเอง (ไม่ต้องแก้ 15+ จุดที่เรียกใช้ชื่อ
      `requireSeller` เดิม), `payment.js`'s `/confirm/:orderId` ใช้ `getUserRole()` helper เปล่า (ไม่ใช่
      middleware เพราะ route นี้เช็ค role แบบมีเงื่อนไข เฉพาะตอนคนเรียกไม่ใช่เจ้าของ order) —
      `requireRole()` stamp `req.userRole` ให้ด้วยเสมอ (ของเดิมที่ `seller.js`'s shop-scoping ใช้อยู่)
  - เจอบั๊กเล็กระหว่างทำ: ย้าย `const requireSeller = requireRole(...)` ไปไว้หลัง route ที่เรียกใช้ครั้ง
    แรก (`POST /upload`) ทำให้ server crash ด้วย `ReferenceError: Cannot access 'requireSeller' before
    initialization` (temporal dead zone ของ `const`) — แก้โดยย้าย declaration ไปไว้บนสุดของไฟล์ก่อน route
    แรกที่ใช้
  - ทดสอบ local ครบ: seller/coupons routes ยัง 200 สำหรับ seller, 403 สำหรับ customer เหมือนเดิม,
    `payment.js`'s confirm ยัง allow เจ้าของ order หรือ seller/admin เท่านั้น (ทดสอบ unrelated customer→403,
    owner→ผ่าน, seller ที่ไม่ใช่ owner→ผ่าน), `PATCH /orders/:id` (ที่พึ่ง `req.userRole`) ยังทำงานถูกต้อง
    หลังรวม middleware แล้ว — ยืนยันด้วยผ่าน production ด้วย (`/api/health` + unauthenticated request ยัง
    401 ถูกต้อง)

---

## Infra — Render sleep + Supabase auto-pause — ปิดแล้ว (2026-07-22)

**ความเสี่ยง:** Render Free Web Service sleep หลังไม่มีคนใช้ 15 นาที (ตื่นช้า 30-60 วิรอบแรก) และ Supabase
free-tier project auto-pause หลังไม่มี API activity ~7 วัน (หยุดทำงานเงียบๆ จนกว่าจะ manual restore จาก
dashboard) — ทั้งสองอย่างเสี่ยงมากขึ้นในช่วงนี้เพราะพัก ABA production credential ไว้ก่อน (ยังไม่ได้สมัคร
merchant account จริงกับ ABA) เลยยังไม่รู้ว่าจะกลับมาแตะ production ถี่แค่ไหน

**ไม่สามารถเช็ค Supabase plan (Free/Pro) ได้จาก Claude Code เอง** — เป็นข้อมูลระดับ dashboard/billing ไม่
เปิดผ่าน Postgres connection ธรรมดา (ลองเช็ค `max_connections` เป็น signal อ้อมแล้วแต่สรุปไม่ได้ เพราะ
ขนาด compute เริ่มต้นเหมือนกันทั้ง Free/Pro — ต่างกันแค่ pause policy) ต้องเช็คเองผ่าน Supabase Dashboard

- [x] **แก้แล้ว**: ตั้ง UptimeRobot ยิง `https://bardskh.com/api/health` ทุก 5 นาที — แก้ปัญหาทั้งสองอย่าง
      พร้อมกัน (traffic สม่ำเสมอกัน Render sleep และนับเป็น activity กัน Supabase pause) โดยไม่ต้องอัปเกรด
      แผนจ่ายเงินตอนนี้ — เพียงพอสำหรับช่วงที่ยังไม่เปิดขายจริง
- [ ] **ควรทำก่อนเปิดขายจริง**: ตอนใกล้ launch จริง (มีลูกค้าจริงใช้งาน) ควรอัปเกรด Render Web Service +
      Supabase เป็น paid plan อยู่ดี เพื่อประสิทธิภาพ/ความเสถียรที่ดีกว่าการพึ่ง keep-alive ping เฉยๆ — ดู
      `docs/04-deploy-render.md` หัวข้อท้ายไฟล์

---

## Multi-vendor (shops) — ปิดครบ 4 step แล้ว (2026-07-22)

> **หมายเหตุการตั้งชื่อ:** ระหว่างคุยงานเรียกงานชุดนี้ว่า "Phase 4" — คนละความหมายกับ "Phase 4 — Payment"
> ที่ `CLAUDE.md` ใช้เรียกงาน ABA PayWay (ดูหัวข้อถัดไปด้านล่าง) อย่าสับสนสอง "Phase 4"

ตัดสินใจ scope ร่วมกันก่อนเริ่ม: ทำแบบ "filter การมองเห็นตามร้าน" ไม่ใช่แยก order/payment จริงตามร้าน
(เพื่อไม่แตะ payment/stock/lifecycle code ที่ทดสอบแล้ว) — sequence: shops table → admin approve →
`products.shop_id` + seller scoping → order visibility scoping

- [x] **Step 1 — `shops` table + apply/approve flow**
  - `shops` table (`owner_user_id UNIQUE` — 1 seller = 1 ร้านตอนนี้), status
    pending/approved/rejected/suspended
  - Migration one-time: backfill ร้าน `approved` ให้ account ที่เป็น seller/admin **ก่อน** ระบบนี้มีอยู่แล้ว
    (กันไม่ให้ seller เดิม/เจ้าของโปรเจกต์เองโดนล็อกออกจากการจัดการสินค้า) — เช็คแล้วก่อนเริ่มว่า production
    มี seller/admin แค่ 1 คน (ตัวเจ้าของโปรเจกต์เอง) ไม่กระทบใครอื่น
  - Routes ใหม่ (`routes/shops.js`): `POST /apply`, `GET/PATCH /me`, `GET /` (admin list, ?status=),
    `PATCH /:id` (admin approve/reject/suspend)
  - ทดสอบ local ครบ: backfill ถูกต้อง, GET /me คืนร้านที่ backfill มา, POST /apply ซ้ำ→409, customer
    (ไม่ใช่ seller) สมัครไม่ได้→403, non-admin เข้า admin list ไม่ได้→403, apply→admin list→approve
    ครบวงจร, PATCH /me แก้ข้อมูลได้, ส่ง status ผิด enum→400 พร้อมชื่อ field
  - ยืนยัน migration รันสำเร็จบน production ด้วย (Supabase มี `shops` table + backfill ร้านของเจ้าของ
    โปรเจกต์ถูกต้อง)
- [x] **Step 2 — Admin UI อนุมัติร้าน**: **ข้ามไปก่อนตามที่ตกลง** — endpoint มีครบจาก Step 1 แล้ว ยิง API
      ตรงอนุมัติได้อยู่แล้วถ้าจำเป็น ยังไม่จำเป็นต้องมี UI เพราะมีแค่ร้านเดียวในระบบ
- [x] **Step 3 — `products.shop_id` + seller scoping**
  - เพิ่ม `products.shop_id` (nullable, **ไม่มี** `ON DELETE CASCADE` เจตนา — ลบร้านต้องไม่ทำสินค้าหายเงียบๆ)
  - Backfill เฉพาะกรณีไม่กำกวม (มีร้านเดียวในระบบตอน migration รัน) — production/local ตอนนั้นมีร้านเดียว
    พอดี เลย backfill ได้ครบ (local 12 สินค้าเดิม, production 0 สินค้า)
  - Scope `/api/seller/products` (GET/POST/PATCH/DELETE): admin เห็น/แก้ได้ทุกร้านเหมือนเดิม, seller
    เห็น/แก้/ลบเฉพาะร้านตัวเอง, สร้างสินค้าใหม่ต้องมีร้าน approved ก่อน (403 ถ้าไม่มี) `shop_id` มาจากร้าน
    ของ caller เสมอ ไม่รับจาก client
  - ทดสอบ local ด้วย seller 2 คนจริง (คนละร้าน) + admin: isolation ระหว่าง seller ครบ (เห็นแค่ของตัวเอง),
    cross-shop PATCH→404, cross-shop DELETE เป็น no-op ปลอดภัย (verify ว่าของไม่หายจริง), admin เห็น/แก้
    ได้ทุกร้าน, seller ที่ไม่มีร้าน approved โดนบล็อกสร้างสินค้าด้วยข้อความชัดเจน
  - เจอ FK constraint ทำงานถูกต้องตอน cleanup test data (ลบร้านที่ยังมีสินค้าอยู่ไม่ได้ — ต้องลบสินค้าก่อน)
    ยืนยันว่า "ไม่มี cascade delete" ตามที่ตั้งใจทำงานจริง
- [x] **Step 4 — Order visibility scoping (item-level)**
  - `POST /api/payment/create` stamp `shop_id` ลงแต่ละ item ใน `orders.items` ตอน checkout (จาก product
    row เดียวกับที่คำนวณราคา/ตัด stock อยู่แล้ว — ไม่เพิ่ม query, ไม่แตะ payment logic เลย)
  - `GET /api/seller/orders`: seller เห็นเฉพาะ order ที่มี item ร้านตัวเอง, `items` กรองเหลือแค่ของตัวเอง
    + เพิ่ม `own_subtotal`, admin ไม่ถูก filter
  - `PATCH /orders/:id`, `PATCH /orders/:id/note`: seller ทำได้เฉพาะ order ที่มี item ร้านตัวเอง (404 ถ้า
    ไม่มี — pattern เดียวกับ products)
  - ทดสอบด้วย **checkout จริงผ่าน API** (ไม่ใช่ synthetic data) ผสม item จาก 2 ร้านในออเดอร์เดียว: ยืนยัน
    `shop_id` ติดถูกต้องต่อ item, seller แต่ละคนเห็นแค่ item/own_subtotal ของตัวเองในออเดอร์เดียวกัน,
    admin เห็นครบ 2 items, cross-shop PATCH (ทั้ง status และ note) บล็อกด้วย 404, same-shop PATCH ผ่านปกติ
  - **ยืนยัน trade-off ที่รู้อยู่แล้วด้วยการทดสอบจริง**: cancel ออเดอร์ที่มีของหลายร้านปนกัน คืน stock/
    เปลี่ยนสถานะ**ทั้งออเดอร์** (กระทบร้านอื่นที่ปนอยู่ด้วย) — ไม่ใช่บั๊ก เป็นผลธรรมชาติของการเลือกทำ "filter
    การมองเห็น" แทน "แยก order จริง" ตามที่ตัดสินใจไว้แต่แรก
- [x] อัปเดต `CLAUDE.md` หัวข้อ 1/2/4/5/6.3/11/12 ให้ตรงกับของจริงหลังทำครบ 4 step

**ยังไม่ได้ทำ (พบระหว่างทำ ตั้งใจเก็บเป็นงานแยก ไม่ใช่ bug):**
- ~~`GET /api/seller/stats` ยังไม่ scope ตาม shop~~ **แก้แล้ว (2026-07-24)** — ดู section "Seller
  stats/coupon scoping" ด้านบนของไฟล์นี้ — commit `50e383e`
- ~~คูปองยังไม่ scope ตามร้าน~~ **access control แก้แล้ว (2026-07-24, commit `77567a7`)** — เห็น/แก้ได้
  เฉพาะร้านตัวเอง+คูปองส่วนกลางแล้ว **แต่ discount computation ตอน checkout ยังไม่ scope** (ยังหักจาก
  subtotal ทั้งออเดอร์เหมือนเดิม ไม่ได้แยกตามร้าน) — ตั้งใจเลื่อนไปผูกกับ Phase 5 เต็มรูปแบบ ไม่ใช่ bug
- ยังไม่มี admin UI สำหรับ approve ร้าน — endpoint มีครบ ยิง API ตรงได้ ยังไม่จำเป็นเพราะมีร้านเดียว

---

## ขั้น 0–2 ปิดครบแล้ว (2026-07-21/22) — post-launch hardening + smoke test เต็มรอบ

เว็บ deploy จริงขึ้น Render สำเร็จแล้วระหว่างช่วงนี้ (`bardskh.com`, DB คือ **Supabase** ไม่ใช่ Render
Postgres — ดู `docs/04-deploy-render.md` หัวข้อ note ต้นไฟล์) หลังจากนั้นไล่ปิดงาน 3 ขั้นตามลำดับ:

### ขั้น 0 — ปิดช่องโหว่ `make-seller`
- [x] Audit แล้วว่าไม่มีใครใช้ช่องโหว่นี้ปลอมเป็น seller จริง (เช็ค local DB — มีแค่ seller เดียวคือ
      เจ้าของโปรเจกต์เอง)
- [x] เพิ่ม `requireRole()` middleware กลางใน `middleware/auth.js` + gate
      `POST /api/seller/make-seller` ด้วย `requireAuth + requireRole('admin')` (secret ยังเช็คต่อเป็น
      ชั้นที่สอง) — ทดสอบยิงตรงกับ production ยืนยันทำงานถูก (401/403/403 คนละข้อความตามชั้นที่ fail)
- [x] Promote `hnunghofficial@gmail.com` เป็น `admin` บน production DB จริง (Supabase) — ยืนยัน
      table/count ก่อนรัน `UPDATE` ตามที่ตกลงกันไว้
- [x] เจอระหว่างทาง: **production DB ตัวจริงคือ Supabase ไม่ใช่ Render Postgres** ที่วางแผนไว้ตอนแรก —
      แก้ `.env` local ให้กลับไปใช้ `bards_db` (local dev เดิม) แยกจาก
      `PRODUCTION_DATABASE_URL_READONLY` (ใช้เฉพาะตอน debug production เท่านั้น ห้ามรันเซิร์ฟเวอร์ปกติ)
      — Render Postgres ที่สร้างไว้เฉยๆ ไม่ได้ใช้ เจ้าของโปรเจกต์ลบเองผ่าน Dashboard แล้ว

### ขั้น 1 — ยืนยันจ่ายจริงผ่าน ABA (ดูรายละเอียดเต็มใน section "Phase 4 — Payment" ด้านล่าง)
- [x] ยืนยันแล้วว่า logic `isPaid()`/`payment_status: "APPROVED"` ที่เคยเป็นการอนุมานถูกต้อง 100%
      เทียบกับ response จริงจาก ABA sandbox

### ขั้น 2 — ไล่ smoke test checklist เต็มรอบบนเบราว์เซอร์จริง (`docs/04-deploy-render.md` หัวข้อ 8)
ปิดครบทุกข้อยกเว้น 2 ข้อสุดท้ายที่ตั้งใจเลื่อนไปทำใกล้ launch (production ABA credential) — ระหว่างทาง
เจอบั๊กนอกแผนหลายตัวที่ล้วนกระทบผู้ใช้จริง:

- [x] **`NODE_ENV` ไม่ได้เป็น `production` จริงบน Render** — พบตอนเช็ค signup cookie (ขาด `Secure`
      attribute) กระทบ 4 จุดพร้อมกัน (cookie secure flag, DB SSL, SMTP TLS validation, dev logger) แก้ที่
      Render Environment แล้ว
- [x] **`app.set('trust proxy', ...)` ไม่เคยตั้งเลย** — เจอตอนไล่บั๊ก cookie `bards_rt` หายบน Google OAuth
      callback (JSON response ปกติมี cookี แต่ redirect response ไม่มี) ไล่ root cause ยาว (ไม่ใช่ CORS/
      host-mismatch/Cloudflare cache — ทดสอบตัดออกทีละทฤษฎีด้วย curl+DB) สุดท้ายคือ trust proxy ที่ขาด —
      เพิ่ม `app.set('trust proxy', 1)` แก้ได้จริง เป็น side-effect ดีเพิ่มด้วยคือ rate-limit key ถูกต้อง
      ตาม client IP จริง (เดิม key รวมกันทุก user เพราะ `req.ip` เป็น proxy IP เดียวกันหมด)
- [x] **`TELEGRAM_BOT_ID`/`TELEGRAM_BOT_TOKEN` เลขสลับตำแหน่งกัน** (`8174154915` ที่ถูกคือ
      `8741549115`) — ทั้ง frontend (`signin.html`/`signup.html`) และ backend env var บน Render ผิด
      ตรงกันทั้งคู่ (fix รอบแรกก่อนหน้านี้ sync frontend ให้ตรงกับ backend ที่ผิดอยู่แล้ว เลยยังไม่หาย) แก้
      ครบทั้ง 3 จุด (frontend 2 ไฟล์ + Render env var) แล้ว
- [x] **`checkout.html`'s `selectSavedAddr()` ทำที่อยู่หายเหลือแค่จุดเดียว** — user report จริงพร้อม
      screenshot, reproduce ได้ 100% — root cause: `querySelector('div>div>div')` เจตนาเล็ง radio-circle
      indicator แต่ ancestor combinator ไม่ได้ถูกจำกัดด้วย element ที่เรียก query (`el`'s parent จริงก็
      เป็น `<div>` ด้วย) เลยไปโดน flex-row wrapper ที่ห่อทั้ง circle+ข้อความ ตื้นไปหนึ่งชั้น — auto-select
      default address ยิง `.innerHTML=` ทับทั้งก้อนเหลือแค่ dot เล็กๆ แก้ด้วย class hook แทน position
- [x] **`seller-products.html` ส่ง `colors` เป็น object แทน string** — save สินค้าทุกครั้งพัง zod
      validation ด้วย error "Invalid input" ที่ไม่บอก field (ดูเหมือนเกี่ยวกับ "new arrival" toggle แต่
      จริงๆ คือบั๊กเดียวกัน) แก้ทั้งฝั่งส่งข้อมูล + ปรับ `middleware/validate.js` ให้บอกชื่อ field เสมอ
- [x] **`product.html`'s `handleConfirm()` บังคับเลือกสี/ไซส์แม้สินค้าไม่มี variant** — เขียนโค้ดแก้ไว้
      ตั้งแต่ 19/7 ตอนเตรียมสินค้าทดสอบ ABA แต่**ลืม commit/push** จนถึง 22/7 (กระทบสินค้าจริงบน
      production มาตลอดโดยไม่รู้ตัว) — นี่คือเคสที่ทำให้ตั้ง standard ใหม่ขึ้นมา (ดูล่าง)

**Standard ใหม่ที่ตกลงกัน (2026-07-22):** ทุกครั้งที่แก้บั๊ก/โค้ดเสร็จและเจ้าของโปรเจกต์ยืนยันว่า deploy
ได้ ให้ commit+push ทันทีโดยไม่ต้องรอถาม — ถ้าจะเว้นไว้ไม่ push (เช่น รอทดสอบในเครื่องก่อน) ต้องบอกชัดเจน
ในข้อความทุกครั้งว่า "แก้เสร็จแล้วแต่ยังไม่ push รอทดสอบ/ยืนยันก่อน" (บันทึกไว้ใน memory ของ agent ด้วย
แล้ว ใช้ได้ข้าม session)

---

## Security hardening — Helmet + input validation (2026-07-21)

ตอบ `CLAUDE.md` §8 สองข้อที่เคยเป็น ❌: Helmet middleware และ input validation library

- [x] **Helmet** — เพิ่ม `app.use(helmet({ contentSecurityPolicy: false }))` ใน `server.js` — ปิด CSP
      เจตนา เพราะ frontend เป็น static HTML ล้วนที่มี `onclick="..."` และ inline `<style>/<script>`
      กระจายอยู่ทั่ว (ไม่มี build step ไม่มี nonce/hash) CSP default ของ Helmet จะบล็อกทั้งเว็บ — ต้อง
      ทำ pass แยกกับ frontend ก่อนถึงจะเปิด CSP จริงได้ (ยังไม่ทำตอนนี้)
  - ทดสอบแล้ว: header ครบ (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`
    ฯลฯ), static page ยังโหลดได้ปกติ, signup/signin ยังทำงานปกติ
  - ⚠️ **COOP vs Telegram popup — ยังไม่สรุปแน่ชัด ณ 2026-07-23**: บันทึกไว้ตอนนั้นว่า Telegram widget ใช้
    `postMessage` ซึ่งไม่ถูก COOP บล็อกตามทฤษฎี และ `docs/04-deploy-render.md` หัวข้อ 8 ก็บันทึกว่าทดสอบ
    Telegram login ผ่านโดเมนจริงแล้วสรุปว่า "COOP ไม่ใช่ปัญหาจริง" (2026-07-22) — **แต่ทั้งสองข้อสรุปนี้ไม่มี
    หลักฐานว่าทดสอบบน iPhone จริงโดยเฉพาะ** เมื่อเจ้าของโปรเจกต์รายงานปัญหา Telegram login พังเฉพาะบน iPhone
    (2026-07-23) มีการเสนอ 2 ทฤษฎี: (1) iOS Safari จัดการ popup ไม่นิ่ง — เจ้าของโปรเจกต์ยืนยันว่าเคยทดสอบ
    iPhone จริงแล้วผ่านฉลุย ทฤษฎีนี้เลยตกไป (2) COOP `same-origin` ตัด `window.opener` — แต่ข้อสรุปเดิมที่นี่
    (2026-07-21) ก็บอกว่า COOP ไม่กระทบเพราะใช้ `postMessage` เช่นกัน **ยังไม่ชัดว่าข้อไหนถูก** ปรับ COOP เป็น
    `same-origin-allow-popups` ไปแล้วเป็นการป้องกันไว้ก่อน (ความเสี่ยงต่ำ ไม่กระทบอะไรถ้าไม่ใช่สาเหตุจริง) แต่
    **ยังไม่มีการยืนยันด้วยการทดสอบจริงบน iPhone หลัง deploy** ว่าแก้ปัญหาได้จริงหรือไม่ — รอผลทดสอบจาก
    เจ้าของโปรเจกต์ก่อนจะถือว่าปิดเคสนี้ได้
- [x] **zod validation** — เพิ่ม `middleware/validate.js` (adapter ทั่วไป: zod schema → Express
      middleware) + เขียน schema เฉพาะจุดใน 6 ไฟล์: `auth.js` (signup/profile/change-password),
      `payment.js` (create order — cap จำนวน item ≤50, validate address shape, cap couponCode),
      `seller.js` (product create/update — price/stock ต้องเป็นตัวเลขจริงไม่ใช่ NaN, cap ความยาว
      string/array ทุกฟิลด์), `addresses.js`, `coupons.js` (create+update, **ปิดช่องโหว่ที่ PATCH เดิม
      ไม่เช็ค `type` enum เหมือน POST**), `cart.js`
  - ของเดิม (checkout math: merge/clamp quantity 1-10, recompute price จาก DB) **ไม่ได้แตะ** — validation
    คุมแค่ shape/size ก่อนเข้า logic เดิม
  - แก้เพิ่มระหว่างทาง: R2 upload (avatar + product images) เปลี่ยนมา derive file extension จาก
    mimetype ที่ validate แล้วแทนการเชื่อ `originalname` ของ client ตรงๆ (กัน path/extension injection
    เข้า storage key), `POST /api/seller/make-seller` เปลี่ยนจาก `secret !== ADMIN_SECRET` เป็น
    `crypto.timingSafeEqual` (กัน timing attack)
  - ทดสอบจริงกับ DB: regression เต็มรอบ (signup→address→cart→checkout→cancel) ผ่านหมด + rejection test
    11 เคส (ชื่อยาวเกิน, email ผิดรูปแบบ, order เกิน 50 item, address ยาวเกิน, ราคาติดลบ/เท่ากับ 0,
    coupon PATCH พยายามตั้ง type มั่วๆ, secret ผิด/ถูก) ผ่านครบ — ลบ test data ออกหมดแล้ว
- [x] Push ขึ้น `origin/main` แล้ว (`e5e3580..17ff837`)

---

## Git — push ครั้งแรกของงานทั้งหมดข้างล่างนี้ (2026-07-21)

พบว่า `bards-new/` เป็น git repo อยู่แล้ว (แยกจาก root ที่ไฟล์นี้อยู่ — `CLAUDE.md`/`docs/`/`migrate.sql`
**ไม่ได้อยู่ใน repo นี้** ตั้งใจ เพราะ `bards-new/` คือหน่วย deploy จริง) ผูก remote `origin` ไว้กับ
`https://github.com/nmjbds/bards-shop.git`, branch `main` อยู่แล้ว แต่มีงานค้าง commit สะสมอยู่ในเครื่อง
(ของ session ก่อนหน้าที่ไม่เคย commit + งานของ session นี้) — commit แยกเป็น 3 หน่วยตามงาน แล้ว push ขึ้น
`origin/main` แล้ว (`9b983e7..e5e3580`):
1. `2b640c0` ABA PayWay integration จริง + stock locking + order lifecycle (งานค้างจาก session ก่อน)
2. `3223b56` Refresh token system (งานของ session นี้)
3. `e5e3580` แก้ `routes/addresses.js` + backfill migration (งานของ session นี้)

**ยังไม่ deploy จริง** — push ขึ้น GitHub แล้วเท่านั้น ถ้าจะให้ขึ้น bardskh.com ต้อง trigger deploy บน
Render (หรือ host ที่ผูกกับ repo นี้) เอง และตรวจว่า env vars บน host (`JWT_SECRET`, `DATABASE_URL`,
ABA/R2 keys ฯลฯ) ตรงกับที่ใช้ทดสอบ local — ไฟล์ `.env` ไม่ได้ถูก push ขึ้นไป (อยู่ใน `.gitignore` ถูกต้อง)

---

## Phase 4 — Payment (ABA PayWay) — งานล่าสุด

- [x] **บั๊ก #1 — stock oversell**: ทำ `SELECT ... FOR UPDATE` ล็อก stock ใน DB transaction ตอน checkout,
      คำนวณ price/subtotal/discount ใหม่จาก server (ไม่เชื่อ client), คืน stock อัตโนมัติเมื่อ order
      expired/cancelled ทุกจุด — ทดสอบ concurrency จริงกับ DB ผ่าน 3/3 รอบ
- [x] **บั๊ก #2 — payment confirm ปลอมสถานะได้ / qr_string หาย**:
  - เปลี่ยนจาก static KHQR (`ABA_MERCHANT_PAYLOAD`) เป็นเรียก ABA PayWay Purchase API จริง
    (เก็บโค้ดเดิม comment ไว้ใน `routes/payment.js` ไม่ได้ลบ)
  - แก้ hash formula ตามที่ธนาคารยืนยัน: hash เฉพาะ field ที่ส่งจริง
    (`req_time+merchant_id+tran_id+amount+payment_option+return_url+currency`) ไม่ใช่ padding ครบ 24 field ตาม doc เดิม
  - แก้บั๊ก field casing ไม่คงที่จาก ABA (`qrString` vs `qr_string`) ที่ทำให้ purchase สำเร็จแต่ระบบเข้าใจว่า fail
  - `/api/payment/confirm/:orderId` ไม่รับสถานะจาก client โดยตรงอีกต่อไป — เรียก ABA `check-transaction-2` จริงเสมอ
  - เพิ่ม `/api/payment/webhook` — ก็ไม่เชื่อ payload ตรงๆ เหมือนกัน (re-verify ผ่าน ABA เสมอ)
  - เพิ่มตาราง `payments` (order_id, provider, provider_ref=tran_id, status, raw_response, paid_at)
  - ทดสอบ webhook จำลอง callback ผ่าน 4/4 เคส (รวมเคสพยายามปลอม `status=success` ใน payload — ระบบเมิน ไม่เชื่อ)
- [x] **ยืนยันจ่ายจริงผ่าน sandbox แล้ว (2026-07-21)** — ABA ตอบกลับพร้อม simulator app ให้ทดสอบ scan QR
      จำลองการจ่ายสำเร็จใน sandbox ได้จริง — checkout ผ่านหน้าเว็บจริง (product `TEST REAL PAYMENT`,
      $1.00 + shipping $1.00 = total $2.00) ได้ order `BRD-MRUHLN22-6XTZ`, scan ผ่าน simulator แล้วเรียก
      `settleOrderPayment()` (path เดียวกับ `/api/payment/confirm`) ตรง — ABA `check-transaction-2` คืนค่า
      จริง `payment_status: "APPROVED"`, `payment_status_code: 0`, มี `apv` (approval code) จริงด้วย —
      **ค่าที่เคยอนุมานไว้ใน `abaPayway.js` ถูกต้อง 100%** ไม่ต้องแก้ logic ใดๆ อัปเดตคอมเมนต์ใน
      `services/abaPayway.js` แล้วให้ตรงกับที่ยืนยันจริง (ลบคำว่า "inferred/not yet observed" ออก)
      order นี้ status เปลี่ยนเป็น `paid` จริงใน local dev DB (`bards_db`) เรียบร้อย — เคสก่อนหน้า
      (`BRD-MRRCP2TM-CH24`) หมดอายุไปแล้วก่อนได้ทดสอบ ไม่ใช่ order ที่ใช้ยืนยันเคสนี้
- [x] ตั้ง `API_PUBLIC_URL` เป็น URL จริงบน Render แล้ว (local `.env` ยังตั้งใจเป็น `http://localhost:3000`
      สำหรับ dev เท่านั้น — ปกติ)
- [ ] **เลื่อนไปทำใกล้ launch จริง**: swap `ABA_PAYWAY_*` เป็น production credential + ทดสอบจ่ายจริง 1
      รอบผ่าน production webhook — ดู `docs/04-deploy-render.md` หัวข้อ 8 รายการสุดท้าย

---

## Phase 1 (auth part) — Refresh Token System — เสร็จ 2026-07-21

- [x] เพิ่มตาราง `refresh_tokens` ใน `db.js` (`user_id`, `token_hash` sha256, `expires_at`,
      `revoked_at`, `replaced_by`, `user_agent`) + cleanup query ลบแถวเก่ากว่า 60 วันตอน `initDb()` start
      (ไม่มี cron ในโปรเจกต์นี้ เลยทำความสะอาดตอน boot แทน)
- [x] `sign()` (access token) เปลี่ยนอายุจาก 7 วัน → 15 นาที
- [x] เพิ่ม helper ใน `routes/auth.js`: `getCookie()` (parse `req.headers.cookie` เอง ไม่ต้องเพิ่ม
      dependency `cookie-parser`), `hashToken()`, `issueRefreshToken()` (รองรับ rotation ผ่าน
      `replacesId`), `setRefreshCookie()`/`clearRefreshCookie()` (cookie ชื่อ `bards_rt`, httpOnly,
      path=`/api/auth`, sameSite=lax, secure เฉพาะ production), `issueSession()` (orchestrator ที่ทุก
      login path เรียก)
- [x] ทุก login path (`/signup`, `/signin`, `/google/callback`, `/facebook/callback`,
      `/telegram/callback`, `/telegram/verify`) เปลี่ยนจากเรียก `sign(user)` ตรงๆ เป็น
      `await issueSession(user, req, res)`
- [x] เพิ่ม `POST /api/auth/refresh` — rotate token, มี reuse-detection (token ที่ revoked แล้วถูกเอามาใช้
      ซ้ำ → revoke session ทั้งหมดของ user นั้นทันที)
- [x] เพิ่ม `POST /api/auth/logout` — revoke refresh token ปัจจุบัน (best-effort)
- [x] `public/api.js`: `apiFetch()` เพิ่ม silent-refresh-and-retry เมื่อโดน 401 (concurrent 401 แชร์
      in-flight refresh promise เดียวกัน กัน race), `Auth.logout()` เรียก `POST /auth/logout` แบบ
      fire-and-forget ก่อน clear localStorage (ยังคง sync-callable เหมือนเดิม ไม่กระทบ onclick handler
      เดิม 7 จุดใน `account.html`/`seller*.html`)
- [x] ทดสอบจริงด้วย `curl` + cookie jar ผ่าน dev server กับ DB จริง: signup ได้ access token อายุ 15 นาที
      + `Set-Cookie: bards_rt`, `/refresh` rotate สำเร็จ (cookie ใหม่ต่างจากเดิม), replay cookie เก่าที่
      rotate ไปแล้ว → 401 และ revoke cookie ที่ยัง valid อยู่ด้วย (reuse-detection ทำงานถูก), `/logout`
      แล้ว `/refresh` ตามหลัง → 401, `GET /auth/me` ด้วย access token ใหม่ → 200 ปกติ (`requireAuth` ไม่ต้อง
      แก้อะไรเลย)
- [ ] **ยังไม่ได้ทดสอบผ่านเบราว์เซอร์จริง** (sign in ที่ `signin.html`, ปล่อย token หมดอายุแล้วเช็คว่า
      silent-refresh ทำงานใน `account.html`) — session นี้ไม่มี browser automation tool ให้ใช้ ทดสอบแค่
      ระดับ HTTP/curl กับ `node -c` syntax check เท่านั้น
- [x] อัปเดต `CLAUDE.md` §3 (Auth Architecture), §4 (DB Schema), §8 (Security Checklist), §11
      (Roadmap) ให้ตรงกับของจริง

**แก้แล้ว (2026-07-22)** — วินิจฉัยรอบแรก (21/7) เข้าใจผิดว่า "DB จริง" หมายถึง production แต่ที่จริงเป็น
**local dev DB (`bards_db`) เท่านั้น** ที่มี column default เพี้ยนเป็น `'user'` — เช็คตรงกับ production
(Supabase) แล้วพบว่า production มี `role='customer'` ครบทั้ง 8 บัญชีลูกค้าจริง **ตรงกับที่ `db.js` ประกาศไว้
อยู่แล้ว 100%** (ไม่มี drift บน production เลย) เพราะงั้นการ "แก้" ที่ถูกต้องคือฝั่งตรงข้ามจากที่เข้าใจไว้แต่
แรก — **ไม่แตะ `db.js`** (`'customer'` ถูกต้องอยู่แล้ว ตรงกับ production และตรงกับ
`routes/seller.js:574`'s `WHERE u.role = 'customer'` ที่ query อยู่) **แก้แค่ local dev DB**: รัน
`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'customer'` (เฉพาะ local, เช็ค host ก่อนรันแล้วว่าเป็น
`localhost` จริง) ไม่กระทบ row เดิมที่มีอยู่แล้วเลย (ยัง seller:1, customer:1, user:4 เหมือนเดิม — 4 แถวที่
เป็น `'user'` คือของเก่าจากก่อนแก้ ปล่อยไว้แบบนั้น ไม่ไปแก้ข้อมูลเดิม) แค่ทำให้ default ของ column ตรงกับ
production สำหรับ insert ใหม่ในอนาคต

---

## บั๊กแยก — `routes/addresses.js` column mismatch (พบระหว่างสำรวจโค้ด 2026-07-19, แก้จริง 2026-07-21)

**รอบ 1 (เช้า 2026-07-21) — วินิจฉัยผิด:** เข้าใจว่า `full_name`/`address_line` ไม่มีอยู่จริงใน DB
(อิงจาก `db.js`'s `CREATE TABLE` ที่ประกาศแค่ `name`/`address`) เลยแก้ route ให้อ่าน/เขียน `name`/`address`
ตรงๆ — `GET`/`POST`/`PATCH` ทั้งหมด ผ่าน `node -c` แต่**ไม่ได้ทดสอบยิง endpoint จริงกับ DB ตอนนั้น**

**รอบ 2 (บ่าย 2026-07-21) — พบว่าวินิจฉัยรอบ 1 ผิด หลังทดสอบยิง endpoint จริงกับ DB:**
- `POST /api/addresses` พังจริง: `null value in column "full_name" ... violates not-null constraint`
  — DB ที่ deploy อยู่จริงมีคอลัมน์ legacy `full_name`(NOT NULL)/`address_line`(NOT NULL)/`label`/`country`
  หลงเหลือจาก schema รุ่นก่อนหน้า `db.js` จะเปลี่ยนมาใช้ `name`/`address` — **ไม่ใช่คอลัมน์ที่ไม่มีอยู่จริง
  ตามที่เข้าใจตอนแรก** และมี**ที่อยู่จริงของลูกค้า 2 คนอยู่ในคอลัมน์เก่านี้** (`full_name`/`address_line`)
  ส่วน `name`/`address` (คอลัมน์ใหม่ที่ `db.js` เพิ่มด้วย `ALTER ADD COLUMN IF NOT EXISTS`) ว่างเปล่ามาตลอด
  เพราะไม่เคยมีการ backfill ข้อมูลเก่ามาลง
- นี่คือสาเหตุจริงของบั๊กที่ผู้ใช้รายงาน ("เลือกที่อยู่ที่บันทึกไว้ในหน้า checkout แล้วไม่เห็นที่อยู่เต็มๆ")
  — โค้ดรอบ 1 อ่าน `name`/`address` ที่ว่างเปล่าของทั้ง 2 บัญชีจริง เลยแสดงที่อยู่ไม่ครบ (และหลังรอบ 1
  บันทึกที่อยู่ใหม่ไม่ได้เลยด้วย เพราะ INSERT พังตาม constraint เก่า)
- [x] **แก้จริง**: เพิ่ม migration ใน `db.js` (ในบล็อก addresses) — `UPDATE addresses SET name=full_name
      WHERE name IS NULL AND full_name IS NOT NULL` (และเหมือนกันสำหรับ `address`/`address_line`) แล้ว
      `ALTER TABLE addresses ALTER COLUMN full_name DROP NOT NULL` (เหมือนกันสำหรับ `address_line`) —
      idempotent (เช็ค `IF EXISTS`/`WHERE name IS NULL` ก่อนทุกครั้ง), **ไม่ลบคอลัมน์/ข้อมูลเดิม** แค่เลิก
      บังคับให้ INSERT ใหม่ต้องเติมคอลัมน์เก่า
  - Route (`GET`/`POST`/`PATCH`/`DELETE`/`set-default`) ใช้ `name`/`address` เหมือนเดิมจากรอบ 1 — ถูกต้อง
    แล้วหลัง migration ทำงาน ไม่ต้องแก้โค้ด route เพิ่ม
  - ลบ `console.log('[DEBUG] user = ...')` ที่ค้างอยู่ใน `POST /` ออกจากรอบ 1 แล้ว
- [x] **ทดสอบจริงกับ DB ครบ**: restart server ให้ migration รัน → query ตรงตรวจว่า 2 บัญชีจริงมี
      `name`/`address` ถูก backfill แล้ว (ยืนยันด้วย `SELECT` ตรง) → `POST /api/addresses` ด้วย test user
      ใหม่ → `201` (ก่อนหน้านี้พังด้วย 500) → `GET /api/addresses` คืนค่าตรงกับที่ `checkout.html`/
      `account.html` ต้องการ (`name`, `phone`, `address`, `city`, `province`, `is_default`) → ลบ test user
      ที่สร้างไว้ทดสอบออกจาก DB แล้ว
- [x] อัปเดต `CLAUDE.md` หัวข้อ 4/12 ให้ตรงกับสิ่งที่พบจริงในรอบ 2 แล้ว

---

## ภาพรวม Phase อื่นๆ (ประวัติเดิมจาก 2026-07-19/21 — ⚠️ ตกยุคบางส่วนแล้ว ดู multi-vendor section ด้านบนก่อน)

- [x] **Phase 1 — Auth + Shop**: Auth ใช้งานได้จริง มี refresh token + revoke แล้ว (access token 15 นาที +
      refresh cookie 30 วัน — ดู `CLAUDE.md` หัวข้อ 3) ส่วน **Shop/multi-vendor ตอนนี้มีแล้ว** (เดิมบรรทัด
      นี้เคยเขียนว่า "ไม่มีเลย" — ล้าสมัยแล้ว ดู section "Multi-vendor (shops)" ด้านบนของไฟล์นี้)
- [~] **Phase 2 — Product**: มี `products`/`cart_items` แต่ schema แบนกว่า spec มาก — ไม่มี
      `product_variants`, `product_images`, `categories` table (สี/ไซส์/รูปเก็บเป็น JSONB ในตัว product เดียว)
      ตอนนี้มี `shop_id` แล้ว (ดู multi-vendor section)
- [~] **Phase 3 — Cart & Checkout**: Cart ใช้งานได้ปกติ. Checkout เดิมไม่มี stock lock (แก้แล้วในบั๊ก #1
      ด้านบน)
- [x] **Phase 4 — Payment**: ดูรายละเอียดด้านบน — ยืนยันจ่ายจริงผ่าน sandbox แล้ว เหลือ swap production
      credential
- [x] **Phase 5 — Order Multi-shop**: **เสร็จครบ 3 step แล้ว (2026-07-24/25)** — เดิมบรรทัดนี้เคยเขียนว่า
      "ตัดสินใจแล้วว่าจะไม่ทำ order_shops/order_items" ซึ่งล้าสมัยไปแล้ว ดู section "Phase 5" ต้นไฟล์นี้
      สำหรับรายละเอียดเต็ม — Step 1 (schema+backfill+dual-write, commit `3ad130e`), Step 2
      (seller-facing reads/writes migrate ไปใช้ตารางใหม่ + cancel/stock scope ตามร้านจริงแล้ว, commit
      `2f215c1`+`b31d839`), Step 3 (customer-facing reads แนบ per-shop breakdown, commit
      `cb04bd5`+`101abc0`) ทั้งหมดปิดแล้ว ทดสอบจริงด้วย checkout ข้าม 2 ร้านทุก step — Step 4 (เลิก
      dual-write JSONB เดิม) **ตัดสินใจ skip ไม่ทำ** เก็บ `orders.items` ไว้เป็น audit trail ตลอดไป —
      order visibility/scoping ตอนนี้ทำงานผ่าน `order_shops`/`order_items` จริงแล้วทั้ง read และ write
      ฝั่ง seller, ฝั่งลูกค้าเห็น per-shop breakdown เสริมเมื่อมีมากกว่า 1 ร้าน (ยังไม่มี order จริงที่เป็น
      multi-shop ในระบบตอนนี้ — ทุกอย่างข้างบน test ผ่านร้านทดสอบที่สร้างขึ้นเฉพาะกิจแล้วลบทิ้ง)
- [ ] **Phase 6 — Review/Notification/Settlement**: ไม่มีตาราง `reviews`. Notification ใช้ Telegram
      bot แทน (ไม่ตรง spec). ไม่มีระบบ settlement/commission แยกจ่ายเงินตามร้านจริง (ต่างจาก order
      visibility ที่ทำแล้ว)
- [ ] **Phase 7 — Multi-domain**: ไม่มีเลย — deploy โดเมนเดียว ไม่มี `apps/seller`, `apps/admin`

**หมายเหตุ (อัปเดต 2026-07-22):** โค้ดเริ่มจาก single-store แล้วเปลี่ยนผ่านมาเป็น multi-vendor บางส่วนแล้ว
(shops + product/order scoping — ดู section ด้านบนสุดของไฟล์นี้) ยังไม่ใช่ multi-vendor เต็มรูปแบบตาม spec
เดิมทั้งหมด (ไม่มี separate order_shops/order_items, ไม่มี settlement, ไม่มี multi-domain) — งานที่เหลือ
ต้องคุย scope ก่อนเริ่มเหมือนเดิม (ดู `CLAUDE.md` หัวข้อ 11)

**แก้แล้ว (2026-07-22)** — `users.role` default ที่ค้างมาตั้งแต่ 21/7 ดูรายละเอียดเต็มด้านบน (หัวข้อ
"Phase 1 (auth part)") — สรุปสั้นๆ: production ไม่มี drift เลย (`'customer'` ตรงกับ `db.js` อยู่แล้ว) มีแค่
local dev DB ที่เพี้ยน แก้แค่ local ด้วย `ALTER COLUMN ... SET DEFAULT` ไม่แตะ `db.js`/production
