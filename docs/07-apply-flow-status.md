# apply.html Rebuild — สถานะงาน (อ้างอิง docs/tiktok-seller-onboarding-flow.md)

> ไฟล์นี้คือ tracker หลักของงานรื้อ apply flow ทั้งชุด — อัปเดตทุกครั้งที่จบ phase ใดๆ ก่อนรายงานผลกลับ
> เสมอ ไม่ต้องรอให้สั่ง (ตกลงกันไว้ 2026-08-15)
>
> ย้ายเข้ามาอยู่ใน `bards-new/docs/` เมื่อ 2026-08-15 (จากเดิม `docs/` ที่ root โปรเจกต์) เพื่อให้ commit
> เข้า git ได้จริง — ดูหัวข้อ "หมายเหตุ" ท้ายไฟล์สำหรับสถานะของเอกสารอ้างอิงอื่นๆ ที่ยังอยู่นอก repo

## เสร็จแล้ว + push แล้ว
- Phase 1: DB schema (id_number, birthdate, auto-slug, bank fields optional)
- Phase 2: Backend เต็มรูปแบบสำหรับ id_number/birthdate
- Phase 3: Restructure apply.html step order ตาม TikTok ref, ตัด field นอก scope
- Phase 3B: Step 4 แยกตาม business type + preview ไฟล์

## เขียนโค้ดเสร็จ แต่ยังไม่ push
Phase 4: Twilio Verify SMS OTP — โค้ด backend+frontend เสร็จสมบูรณ์ทั้งหมดแล้ว แต่หยุดการทดสอบ end-to-end ไว้ก่อน สาเหตุ:
- ไม่มีเบอร์กัมพูชาจริงให้ทดสอบ ลองใช้เบอร์ไทย (+66936406304) แทนแต่ Twilio trial account บล็อกการ verify caller ID ของเบอร์ไทยทั้ง SMS และ Call (ประเทศที่ถูกจำกัด)
- ลองหาทาง Twilio Verify test/magic phone number (+85512345678) แต่ไม่ยืนยันได้ชัดว่า Twilio Verify API รองรับ test credentials แบบเดียวกับ Messages API จริงหรือไม่ (เอกสาร Twilio ไม่ชัดเจนพอ)
- เคย verify เบอร์ไทยผ่านได้ 1 ครั้ง แต่กลับพบว่า verified caller ID list ว่างเปล่าตอน query ผ่าน API ตรง (สงสัยว่าเป็นคนละ Twilio Project แต่เช็คแล้ว Account SID ตรงกัน — สาเหตุจริงยังไม่ชัดเจน) หลังจากนั้นลบเบอร์แล้วเพิ่มใหม่ไม่ได้อีกเลย (ติด restricted country ซ้ำ)
- ทางแก้ที่เหลือคือ upgrade Twilio เป็น paid account (เสียเงินจริง เครดิตทดลอง $15.50 ไม่ carry over) หรือรอเบอร์กัมพูชาจริงมาทดสอบ
- ตัดสินใจ: หยุดพยายามแก้ตอนนี้ เลื่อนไปทดสอบตอนใกล้เปิดใช้งานจริง (ตอนนั้นจะ upgrade Twilio อยู่แล้ว) ไปทำ Phase 5-8 ต่อก่อน
- TODO ค้าง: ต้องเพิ่ม validation จำกัดเฉพาะเบอร์กัมพูชาหลังทดสอบผ่าน

**Phase 5: signup.html → email-only + Resend — เสร็จแล้ว (2026-08-15), ทดสอบผ่านครบ, ยังไม่ push**
- `services/mailer.js`'s `sendMail()` เปลี่ยนจาก Gmail SMTP ไปใช้ Resend (`RESEND_API_KEY` ใน `.env`,
  โดเมน bardskh.com verified บน Resend แล้วโดยเจ้าของโปรเจกต์ก่อนเริ่มงาน) ส่งจาก
  `Bards <no-reply@bardskh.com>` — เช็คก่อนแก้แล้วว่า `sendMail()` มีผู้เรียกจุดเดียวในโปรเจกต์คือ
  `routes/authSeller.js` (forgot-password ของ customer ใน `routes/auth.js` กับ `services/notify.js` เรียก
  `transporter` ของ Gmail ตรงๆ คนละทาง ไม่ผ่าน `sendMail()` เลย) — จึงแก้ implementation ของ `sendMail()`
  ตรงๆ ได้เลยโดยไม่กระทบ flow อื่น ไม่ต้องเพิ่ม provider parameter ตามที่กังวลไว้แต่แรก (export `transporter`
  ดิบยังอยู่เหมือนเดิม ไม่แตะ) เพิ่ม dependency `resend` (`npm install resend`, อยู่ใน `package.json`/
  `package-lock.json` แล้ว)
- ตัด phone ออกจาก seller signup ทั้ง stack: `public-seller-src/signup.html` (เอา phone input+validate+
  ตัวแปร `_phone` ออกจาก Step 1), `public-shared/api.js`'s `SellerAuthAPI.signup()` (ไม่ส่ง `phone` ใน
  body แล้ว), `routes/authSeller.js`'s `signupSchema`+`POST /signup` (ไม่รับ/ไม่ insert `phone`), DB:
  `seller_accounts.phone` เปลี่ยนจาก `NOT NULL UNIQUE` เป็น `UNIQUE` เฉยๆ (nullable) ผ่าน
  `ALTER TABLE ... DROP NOT NULL` ใน `db.js` (เช็คก่อนแก้: มี seller จริงอยู่แล้ว 3 คน ทุกคนมี phone ครบอยู่
  แล้ว ไม่มีแถวไหนถูกกระทบ/เสียข้อมูล — migration รันจริงผ่าน `initDb()` แล้ว ยืนยัน `is_nullable='YES'`)
  phone/SMS verification ยังอยู่ที่ `apply.html` Step 5 เหมือนเดิมทุกประการ ไม่ได้แตะ
- **ทดสอบแล้ว**: รัน `server-seller.js` local ชี้ DB จริง (Supabase ตัวเดียวกับ production — โปรเจกต์นี้ไม่มี
  DB แยก dev/prod) → สมัคร seller ทดสอบ 1 คนแบบ end-to-end จริงผ่าน API (request-otp → verify-otp →
  signup) ยืนยัน: (1) `POST /signup` ไม่ต้องส่ง `phone` เลย สร้างบัญชีสำเร็จ `phone:null`, (2) เช็คผ่าน
  Resend API ตรง (`GET /emails`) ว่าอีเมลที่ส่งจริงมี `"from":"Bards <no-reply@bardskh.com>"` และ
  `last_event:"delivered"` จริง (ไม่ใช่แค่เช็คว่า request ไม่ error) — ลบบัญชี/OTP ทดสอบทิ้งจาก DB หมดแล้ว
  หลังทดสอบ **หมายเหตุ**: ไม่ได้เปิดอีเมลจริงเพื่อดู header ด้วยตาเจ้าของโปรเจกต์เอง (ไม่มีสิทธิ์เข้าถึง
  inbox) — ใช้ Resend API เป็นหลักฐานแทน แนะนำให้เจ้าของโปรเจกต์เปิดอีเมลที่ได้รับจริง (ส่งไปที่
  `hnunghofficial+bardstest1@gmail.com`) ดูอีกรอบเพื่อความชัวร์ก่อน push
- **เช็คแล้ว**: `public-admin-src`/`public-customer-src` มีจุดเดียวที่โชว์ "Phone" ในบริบท seller คือ
  `admin-shops.html:275` (`s.phone` ใน shop detail panel) — ตรวจแล้วว่านี่คือ `shops.phone` (คนละคอลัมน์
  กับ `seller_accounts.phone`, มาจาก `SELECT * FROM shops WHERE id=$1` ใน `GET /api/shops/:id`) คือเบอร์ที่
  apply.html Step 5 เก็บ+verify ผ่าน Twilio ต่างหาก **ไม่ใช่**คอลัมน์ที่เพิ่งแก้เป็น nullable รอบนี้เลย —
  ไม่มีความเสี่ยงกระทบหน้าไหน

## ยังไม่เริ่ม
- Phase 6: Popup สรุปตรวจสอบก่อน submit + เปลี่ยนเป็น atomic submit
- Phase 7: หน้า /settle/verification + /settle/verification-result
- Phase 8: ปรับ UI ให้มีภาพประกอบ/สีสัน มืออาชีพแบบ TikTok

## หมายเหตุ
- R2 credential แก้แล้ว (ใช้ "R2 Account Token" scope ครบ 2 bucket)
- Twilio เป็น trial อยู่ ($15.50 credit ไม่ carry over ถ้า upgrade) — เพิ่ม friendly error message สำหรับ
  Twilio error 21608 (เบอร์ไม่อยู่ใน Verified Caller ID list ของ trial account) ใน
  `POST /api/shops/verify-phone/start` แล้ว (commit `81e90f6`) เจอระหว่างทดสอบ Phase 4 ด้านบน — ไม่นับเป็น
  ความคืบหน้าใหม่ของ Phase 4 เอง แค่ทำ error handling ที่ทดสอบไปแล้วให้สมบูรณ์ก่อนพักไว้ ยัง**ไม่ได้แก้**
  ปัญหาหลัก (ไม่มีเบอร์กัมพูชาจริงทดสอบ) — สถานะ Phase 4 โดยรวมยังเหมือนเดิมทุกประการ
- ~~เอกสารอ้างอิงอื่น (`tiktok-seller-onboarding-flow.md`, `03-tasks-checklist.md`, `04-deploy-render.md`,
  `05-seller-onboarding-blueprint.md`, `06-shop-profile-follow-blueprint.md`) ยังอยู่ที่ `docs/` เดิม (นอก
  git repo)~~ — **ย้ายเข้ามาอยู่ใน `bards-new/docs/` ครบทุกไฟล์แล้ว** (commit `84bc8c2`) `docs/` ที่ root
  โปรเจกต์เดิมตอนนี้ไม่มีเอกสารเหลืออยู่แล้ว (เช็คแล้ว 2026-08-15) — root โปรเจกต์เองยังไม่ใช่ git repo (มีแค่
  `bards-new/` ที่เป็น repo จริง) แต่ไม่กระทบไฟล์เอกสารกลุ่มนี้อีกต่อไปเพราะย้ายเข้ามาอยู่ใน repo หมดแล้ว
- **`bards-new/public/` เช็คแล้ว (2026-08-15) — ยังไม่ตาย** เข้าใจผิดว่าอาจเป็น dead code หลังรื้อ deploy
  เป็น 3 service จริง (`bards-customer`/`bards-seller`/`bards-admin`, ดู `03-tasks-checklist.md` หัวข้อ
  "แยกเซิร์ฟเวอร์จริง 3 ตัว") — ตรวจโค้ดจริงแล้วพบว่า `server.js`/`public/` เดิมยังเป็น service คู่ขนานที่
  deploy อยู่จริง (`bards-shop`) ตั้งใจเก็บไว้เป็น fallback ตามที่เอกสารนั้นระบุไว้ตรงๆ — การ cleanup ลบ
  service เดิมทิ้งจริงเป็น "Phase 4" ของงานนั้นที่ยังไม่เริ่ม **ไม่เกี่ยวกับ scope apply flow rebuild ในไฟล์
  นี้เลย** บันทึกไว้ที่นี่เผื่ออนาคตหยิบกลับมาทำ ไม่ใช่ TODO ของ tracker นี้
