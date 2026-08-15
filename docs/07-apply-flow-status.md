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
- **Phase 6: Popup สรุปตรวจสอบก่อน submit + atomic submit — เริ่มสำรวจแล้ว (2026-08-15), ยังไม่เขียนโค้ด
  จริง** แผนเต็มอยู่ในรายงานแยกต่างหาก (ดูบทสนทนา 2026-08-15) สรุปสั้น:
  - **จุด save-as-you-go ปัจจุบันทั้งหมด**: Step1→2 `POST /apply` หรือ `PATCH /me {name}`, Step2→3
    `PATCH /me {category_id}`, Step3→4 `PATCH /me {business_type}`, Step4→5 `PATCH /me
    {full_name,id_number,birthdate,address}` (ข้ามถ้า business), Step5→6 `PATCH /me {phone}`,
    Step6 submit `POST /me/resubmit` (เฉพาะ rejected/needs_info) — บวก `handleDocUpload()` ที่ upload
    ทันทีตอนเลือกไฟล์ (`POST /me/documents`, ต้องมี `STATE.shop` อยู่ก่อนถึงจะยิงได้)
  - **Backend ไม่ต้องแก้เลย**: เช็คแล้ว `shopApplySchema`/`shopUpdateSchema` (`routes/shops.js`) รับ field
    เต็มชุดอยู่แล้วในคำขอเดียว (`name` บังคับอย่างเดียว ที่เหลือ optional ทั้งหมด) — ยืนยันแผน "เก็บ state
    ฝั่ง client แล้วยิงทีเดียวตอน submit" ทำได้จริงโดยไม่แตะ backend
  - **ความเสี่ยง/จุดที่ต้องเปลี่ยน flow**: (1) Step 1 เป็นจุดสร้าง shop row จริง (`POST /apply`) — เลื่อนไป
    submit ตอนจบ แปลว่า `STATE.shop` เป็น null ตลอด step 1-5 ของผู้สมัครใหม่ ต้องตัด guard เดิมใน
    `handleDocUpload` (`if(!STATE.shop)`) ออก เปลี่ยนเป็นเก็บ `File` object ไว้ใน memory
    (`STATE._pendingDocs`) แทนการ upload ทันที พร้อม preview ท้องถิ่น (`URL.createObjectURL` สำหรับรูป,
    badge "PDF" เหมือนเดิมสำหรับ PDF) และควรเพิ่ม client-side validate ชนิด/ขนาดไฟล์ทันที (mirror
    `MIME_EXT`/10MB limit ฝั่ง backend) เพื่อไม่ให้ error โผล่ครั้งแรกตอนกด submit ท้ายสุด — (2) phone
    verification (`ShopsAPI.startPhoneVerification`/`checkPhoneVerification`) **ต้องยิงทันทีเหมือนเดิม
    ห้ามเลื่อน** เพราะเป็น real-time SMS OTP loop ผ่าน Twilio ต้องมีมือถือจริงตอนนั้น — เลื่อนได้แค่การ save
    `phone` ลง shop row (`PATCH /me {phone}`) เท่านั้น ส่วน verified-status ก็ไม่เคย persist
    server-side อยู่แล้ว (reset ทุก reload เหมือนเดิม ไม่กระทบ) — (3) `prefillFromShop()`/`ShopsAPI.me()`
    ตอน `init()` ไม่กระทบเลย ยังโหลดครั้งเดียวตอนเปิดหน้าเหมือนเดิม (สำหรับ resuming application) — จุดที่
    เปลี่ยนคือหลังจากนั้น ทุก step ไม่ยิง PATCH ต่อ step อีกต่อไป อ่านค่าจาก DOM ตรงๆ ตอน submit จริง
    (ฟังก์ชัน `collectStepXFields()` ที่มีอยู่แล้วใช้ต่อได้เกือบทั้งหมด) — (4) **retry ไม่ atomic จริงในแง่
    DB**: ทำ backend transaction เดียวคลุม apply+upload+resubmit ไม่ได้ (ไม่แก้ backend endpoint ตามที่ตกลง)
    ถ้า `POST /apply` สำเร็จแต่ `POST /me/documents` fail (เช่น เน็ตหลุด) shop จะถูกสร้างไปแล้วแบบไม่มี
    เอกสาร — ต้องออกแบบ retry ให้ idempotent (เช็คว่า `STATE.shop` ถูกสร้างไปแล้วหรือยัง ถ้าใช่ให้ข้ามไปยิง
    `PATCH /me` แทน `POST /apply` ตอนกด submit ซ้ำ)
  - **Popup**: เสนอโชว์ read-only: ชื่อร้าน, หมวดหมู่ (ชื่อจาก dropdown ไม่ใช่ id), ประเภทธุรกิจ, full_name/
    id_number/birthdate/address (เฉพาะ individual) หรือชื่อไฟล์ business license (เฉพาะ business), เบอร์
    โทร+badge "Verified", อีเมล (read-only จาก session) — ปุ่ม "Submit"/"Back" (ปิด popup กลับไปแก้ในฟอร์ม
    ไม่ submit) — **มีทางเลือกออกแบบที่ยังไม่ฟันธง รอ confirm**: (A) เก็บ Step 6 "Review & Submit" เดิม
    (3 checkbox agreement) ไว้เหมือนเดิมทั้งหมด แล้วเพิ่ม popup เป็นชั้นยืนยันซ้อนอีกชั้นตอนกด "Submit
    Application" หรือ (B) ยุบ Step 6 เข้า popup ไปเลย (เหลือฟอร์ม 5 step ตรงกับ reference doc เป๊ะๆ, ย้าย 3
    checkbox agreement เข้าไปอยู่ใน popup) — เอนเอียงไปทาง (B) เพราะตรงกับ spec ในเอกสารอ้างอิงมากกว่า
    (5-step form + popup ท้ายสุด ไม่ใช่ 6 step) แต่เป็นการเปลี่ยนโครงสร้าง step ที่เห็นชัดเจน ควรถามก่อนเริ่ม
    เขียนโค้ดจริง — implementation: overlay `<div>` ใหม่ในไฟล์ `apply.html` เอง (ไม่แยก component/ไฟล์ใหม่ —
    ตรงกับ convention เดิมของโปรเจกต์ที่ไม่มี component framework) reuse `.bc-card` style เดิม
  - **beforeunload**: ความเสี่ยงเดิม (ปิด/รีเฟรชแล้วไฟล์ที่เลือกไว้หายหมด ต้องเลือกใหม่) **หนักขึ้นกว่าเดิม**
    ในโมเดล deferred เพราะตอนนี้ไม่มีอะไร save ระหว่างทางเลย (เดิม auto-save ทุก step กันไว้ระดับหนึ่ง) —
    เสนอ `window.addEventListener('beforeunload', ...)` ที่ trigger ทันทีที่มีการกรอกข้อมูล/เลือกไฟล์ใดๆ
    (ไม่ใช่แค่ตอนมีไฟล์) จนกว่าจะ submit สำเร็จ — browser สมัยใหม่ไม่ให้ custom message แล้ว (แค่ prompt
    native ทั่วไป) แต่ยังคุ้มกันอุบัติเหตุพื้นฐานได้
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
