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
- **Phase 5: signup.html → email-only + Resend** — ดูรายละเอียดเต็มในหัวข้อ "รายละเอียด" ด้านล่าง
- **Phase 6: Popup สรุปตรวจสอบ + atomic submit — เสร็จสมบูรณ์แล้ว (2026-08-16)** รวมทุกอย่างในรอบนี้:
  ฟอร์ม 5 step + deferred save, popup แทน Step 6 เดิม, phone field รื้อ UI ตาม TikTok reference (country
  selector/text-link/OTP แสดงตลอด), popup redesign รอบสอง (vertical layout/badge) — เจ้าของโปรเจกต์ทดสอบ
  ด้วยตาจริงผ่านครบทุกจุดแล้ว (5 step, file preview, popup สรุป, `beforeunload` prompt) **temporary phone-
  verify bypass (`SKIP_PHONE_VERIFY`) ที่ใช้ช่วยทดสอบถูกลบออกจากโค้ดหมดแล้ว** (commit `3044b10`) — ไม่มี
  bypass หลงเหลืออยู่ในโค้ดอีกต่อไป ดูรายละเอียดเต็มในหัวข้อ "รายละเอียด" ด้านล่าง

## รายละเอียด
(ประวัติงานแบบละเอียด — Phase 4 ด้านล่างยัง block อยู่จริง ส่วนที่เหลือเสร็จ+push แล้วทั้งหมด เก็บ
รายละเอียดไว้อ้างอิง)

**Phase 4: Twilio Verify SMS OTP — ยังไม่ push, ยัง block อยู่ (ไม่เกี่ยวกับงานอื่นด้านล่าง)** — โค้ด backend+frontend เสร็จสมบูรณ์ทั้งหมดแล้ว แต่หยุดการทดสอบ end-to-end ไว้ก่อน สาเหตุ:
- ไม่มีเบอร์กัมพูชาจริงให้ทดสอบ ลองใช้เบอร์ไทย (+66936406304) แทนแต่ Twilio trial account บล็อกการ verify caller ID ของเบอร์ไทยทั้ง SMS และ Call (ประเทศที่ถูกจำกัด)
- ลองหาทาง Twilio Verify test/magic phone number (+85512345678) แต่ไม่ยืนยันได้ชัดว่า Twilio Verify API รองรับ test credentials แบบเดียวกับ Messages API จริงหรือไม่ (เอกสาร Twilio ไม่ชัดเจนพอ)
- เคย verify เบอร์ไทยผ่านได้ 1 ครั้ง แต่กลับพบว่า verified caller ID list ว่างเปล่าตอน query ผ่าน API ตรง (สงสัยว่าเป็นคนละ Twilio Project แต่เช็คแล้ว Account SID ตรงกัน — สาเหตุจริงยังไม่ชัดเจน) หลังจากนั้นลบเบอร์แล้วเพิ่มใหม่ไม่ได้อีกเลย (ติด restricted country ซ้ำ)
- ทางแก้ที่เหลือคือ upgrade Twilio เป็น paid account (เสียเงินจริง เครดิตทดลอง $15.50 ไม่ carry over) หรือรอเบอร์กัมพูชาจริงมาทดสอบ
- ตัดสินใจ: หยุดพยายามแก้ตอนนี้ เลื่อนไปทดสอบตอนใกล้เปิดใช้งานจริง (ตอนนั้นจะ upgrade Twilio อยู่แล้ว) ไปทำ Phase 5-8 ต่อก่อน
- TODO ค้าง: ต้องเพิ่ม validation จำกัดเฉพาะเบอร์กัมพูชาหลังทดสอบผ่าน

**Phase 5: signup.html → email-only + Resend — เสร็จแล้ว, ทดสอบผ่านครบ, push แล้ว**
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

**Phase 6: Popup สรุปตรวจสอบ + atomic submit — เสร็จสมบูรณ์แล้ว, ทดสอบผ่านครบทุกจุดด้วยตาจริง, push แล้ว,
bypass ที่ใช้ช่วยทดสอบลบออกหมดแล้ว**
`public-seller-src/apply.html` เปลี่ยนจาก save-as-you-go (6 step, PATCH ทุก step) เป็น deferred-save (5
step + popup, ยิงครั้งเดียวตอนจบ) — commit แยก 5 อันตามลำดับที่วางแผนไว้:
- **1/5**: `continueFromStep1()`-`continueFromStep4()` (เดิมชื่อ `saveStepXAndContinue`) เหลือแค่ client-side
  validate + `goStep()` ไม่ยิง API แล้ว — Step 5's `continueFromStep5()` แยกสองทาง: shop `status='approved'`
  (แก้ profile หลัง approve แล้ว) เรียก `handleFinalSubmit()` ตรงๆ ไม่ผ่าน popup, อื่นๆ เปิด popup
- **2/5**: `handleDocUpload()` → `handleDocSelect()` — validate type/size ฝั่ง client ทันที (mirror
  `MIME_EXT`/10MB limit จาก `middleware/validate.js`/`routes/shops.js` เป๊ะ) เก็บ `File` object ไว้ใน
  `STATE._pendingDocs` แทนการ upload ทันที, preview ท้องถิ่นผ่าน `URL.createObjectURL()` (รูป) หรือ badge
  "PDF" (เหมือนเดิม) — ตัด guard เดิม `if(!STATE.shop)` ออกเพราะ shop ยังไม่ถูกสร้างตอนนี้แล้ว
- **3/5**: ยุบ Step 6 ("Review & Submit") เข้า popup overlay ใหม่ (`#reviewModal`, full-viewport, สร้างใน
  ไฟล์เดียวกันไม่แยก component — ตรงกับ convention เดิม) — ฟอร์มเหลือ 5 step ตรงกับ reference doc เป๊ะ ย้าย
  3 checkbox agreement เข้า popup, เพิ่ม read-only summary (ชื่อร้าน/หมวดหมู่/ประเภทธุรกิจ/ข้อมูลบัตรหรือ
  business license/เบอร์+verified/อีเมล) — `showErr()`/`clearErr()` แก้ให้ popup-aware (error banner คนละ
  ตัวข้างในและข้างนอก popup เพราะ backdrop บังของเดิม)
- **4/5**: `handleFinalSubmit()` เขียนใหม่ทั้งหมด — `collectAllFields()` รวบ field ทั้งหมดยิงครั้งเดียว
  (`POST /apply` ถ้ายังไม่มี shop, `PATCH /me` ถ้ามีแล้ว — **ไม่แก้ backend endpoint เลยตามแผน**) แล้ว
  upload เอกสารที่ pending ทีละไฟล์ แล้ว `resubmit()` ถ้าจำเป็น — **idempotent ไม่ใช่ atomic จริง** (ยัง 3
  endpoint แยกกัน) แต่ retry ปลอดภัย: เช็ค `STATE.shop` ก่อนว่าสร้างไปหรือยังทุกครั้ง (POST ซ้ำจะ 409 —
  ยืนยันด้วยการทดสอบจริงข้างล่าง) และไฟล์ที่ upload สำเร็จแล้วจะถูกลบออกจาก `STATE._pendingDocs` ทันที
  (retry ครั้งถัดไปข้ามไฟล์นั้นอัตโนมัติ) — error message บอกด้วยว่า stage ไหนพัง + ยืนยันว่า retry ปลอดภัย
  ถ้า shop ถูกสร้างไปแล้ว
- **5/5**: `beforeunload` guard — `markDirty()`/`clearUnsavedGuard()`, delegated `input`/`change` listener
  บน `.wrap` ครอบ field ทั่วไป + เรียกตรงจาก `setBusinessType()`/`toggleTerm()`/`handleDocSelect()` (เป็น
  custom `onclick` div ไม่ใช่ native form control เลย delegation ไม่ครอบ) — เตือนตั้งแต่แตะฟอร์มจนกว่า submit
  สำเร็จ

**ทดสอบ**: build `public-seller/` ใหม่แล้ว (`node scripts/build-public.js seller`) รัน `server-seller.js`
local ชี้ DB จริง (Supabase เดียวกับ production) **หมายเหตุสำคัญ — ข้อจำกัดการทดสอบรอบนี้**: environment
นี้ไม่มี browser automation tool (ไม่มี Playwright/Puppeteer) เลยไม่สามารถ "คลิกจริง" ผ่าน popup/UI ในเบราว์
เซอร์ได้ด้วยตัวเอง — สิ่งที่ทำแทน: (1) syntax-check inline script ทุก commit ผ่าน `node --check`-equivalent,
(2) grep เช็คว่าไม่มี reference ค้างไปหาชื่อฟังก์ชันเดิมที่ลบไปแล้ว, (3) **ทดสอบ backend contract แบบ
end-to-end จริงผ่าน API ตรงๆ** จำลอง exact payload ที่ `collectAllFields()`/`handleFinalSubmit()` จะส่งจริง
ทุกจุด (ไม่ใช่ mock) — สร้าง seller ทดสอบ 2 บัญชีถาวร (**ไม่ลบ ตามที่ขอ**) ให้เจ้าของโปรเจกต์เข้าไปคลิกดูจริง
เองได้:
  - `hnunghofficial+bardsphase6indiv@gmail.com` / `testpass123` — path individual: `POST /apply` field
    เต็มชุด (name/category_id/business_type/phone/full_name/id_number/birthdate/address) → 201 สำเร็จ →
    ยืนยัน `POST /apply` ซ้ำ 409 จริง (พิสูจน์ premise ของ retry-logic ว่าทำไมต้องเช็ค `STATE.shop` ก่อนสลับ
    ไป `PATCH`) → `PATCH /me` ซ้ำ (จำลอง retry) 200 ผ่าน → upload `id_card` (PNG) 201 → `GET /me` เห็น
    เอกสารครบ → จำลอง branch resubmit: admin flip status เป็น `needs_info` ตรงๆ ผ่าน DB → `PATCH /me` +
    `POST /me/resubmit` → กลับเป็น `pending` จริง — shop สุดท้ายอยู่ที่ status `pending`
  - `hnunghofficial+bardsphase6biz@gmail.com` / `testpass123` — path business: `POST /apply` ไม่ส่ง
    full_name/id_number/birthdate/address เลย (ตรงกับ `collectStep4Fields()` คืน `{}`) → ยืนยัน field
    พวกนั้นเป็น `null` จริงใน response → upload `business_license` (PDF) 201 → `GET /me` เห็นเอกสารถูกต้อง —
    shop อยู่ที่ status `pending`
  - **เจ้าของโปรเจกต์ทดสอบด้วยตาจริงแล้ว** — พบ 2 บั๊ก (แก้แล้ว, ดูหัวข้อ "หมายเหตุ") + ขอปรับ layout
    popup เพิ่ม (ดู "Popup redesign" ด้านล่าง, approve แล้ว) `beforeunload` prompt/file preview ยังไม่มี
    รายงานปัญหาเพิ่มเติมหลังจากนั้น

**✅ Temporary phone-verify bypass — เพิ่ม 2026-08-16 (commit `b44f674`), ลบออกหมดแล้ว 2026-08-16 เช่นกัน
(commit `3044b10`, push แล้ว) — เจ้าของโปรเจกต์ทดสอบ Phase 6 ครบทุกจุดแล้วตามที่ตกลงไว้ (ดูหัวข้อ "เสร็จแล้ว
+ push แล้ว" ด้านบน) ไม่มี bypass หลงเหลืออยู่ในโค้ดอีกต่อไป — เก็บรายละเอียดข้างล่างไว้เป็นบันทึกว่าเคยมี
อะไรและทำไม (ประโยชน์ถ้าต้องทำ bypass แบบเดียวกันอีกครั้งช่วง Phase 4/Twilio launch prep ในอนาคต):**
- **สาเหตุ**: Twilio trial account ยังบล็อกส่ง SMS จริงส่วนใหญ่ (รู้อยู่แล้วตั้งแต่ Phase 4) ทำให้ทดสอบ
  ต่อจาก Step 5 ไป popup/submit ด้วยตาจริงไม่ได้เลยถ้าไม่มีเบอร์ที่ verify ผ่านได้จริง — ไม่ใช่บั๊ก เป็น
  ข้อจำกัด infra ที่รู้อยู่แล้ว
- **เปิดใช้งานยังไง**: `backend/.env` (local เท่านั้น ไม่อยู่ใน git — `.env` อยู่ใน `.gitignore`) มีบรรทัด
  `SKIP_PHONE_VERIFY=true` เพิ่มไว้แล้ว (คอมเมนต์กำกับไว้ในไฟล์ว่าเป็น temporary + ห้ามใส่ใน Render)
- **ปิดใช้งาน**: ลบบรรทัด `SKIP_PHONE_VERIFY=true` ออกจาก `backend/.env` แล้ว restart server-seller.js
  (หรือแค่เปลี่ยนเป็น `false`/comment ออกก็พอ ไม่ต้องลบทั้งบรรทัดถ้าจะเปิดกลับมาใช้อีก)
- **กลไกความปลอดภัย (double-gate) — ยืนยันด้วยการทดสอบจริงแล้ว ไม่ใช่แค่อ่านโค้ด**: `server-seller.js`'s
  `GET /api/dev-flags` คืน `phoneVerifyBypass:true` ก็ต่อเมื่อ `NODE_ENV !== 'production'` **และ**
  `SKIP_PHONE_VERIFY === 'true'` พร้อมกันทั้งคู่ — ทดสอบจริงด้วยการรัน server 2 instance env เดียวกันทุก
  อย่างยกเว้น `NODE_ENV`: `NODE_ENV=development` → `{phoneVerifyBypass:true}`,
  `NODE_ENV=production` → `{phoneVerifyBypass:false}` (แม้ `SKIP_PHONE_VERIFY=true` ยังอยู่ใน `.env`
  เหมือนเดิม) — Render ตั้ง `NODE_ENV=production` เสมออยู่แล้ว (ยืนยันไว้ใน CLAUDE.md หัวข้อ 8 ตั้งแต่ก่อน
  หน้านี้) เลยไม่มีทางที่ bypass จะทำงานจริงบน production ได้แม้จะมีคนเผลอ copy `.env` ทั้งไฟล์ขึ้นไปก็ตาม
- **ไม่ได้แตะ Twilio integration/validation เดิมเลย**: `verify-phone/start`/`verify-phone/check` +
  `phoneVerifySchema`/`phoneVerifyCheckSchema` + `normalizePhoneKH()` เหมือนเดิมทุกตัวอักษร ยังบังคับ
  verify จริงสำหรับทุกคนที่ไม่ได้เปิด bypass — bypass แค่ข้าม `apply.html`'s client-side check
  (`continueFromStep5()`) เท่านั้น ตัวเดียว
- **UI**: โชว์ banner สีเหลือง (`#phoneBypassBanner`) เหนือช่องเบอร์เวลา bypass active ("⚠️ DEV: Phone
  verification bypass is active...") popup summary ก็โชว์ badge "Dev bypass" สีเหลือง (ดู popup redesign
  ด้านล่าง — ตอนแรกเป็นข้อความ "(dev bypass — not verified)" ปนอยู่ในค่า ภายหลังแยกเป็น badge ต่างหากแล้ว)
  แทนที่จะขึ้น "✓ Verified" ปลอมๆ
- **ลบครบทุกจุดแล้ว (2026-08-16, commit `3044b10`, "chore: remove temporary phone-verify bypass after
  Phase 6 testing")**: 1) `server-seller.js`'s `/api/dev-flags` block ทั้งก้อน — ยืนยันแล้วว่า endpoint นี้
  404 จริงหลังลบ 2) `apply.html`'s fetch เรียก `/dev-flags` + `STATE._phoneVerifyBypass` + banner
  element/CSS + `continueFromStep5()`'s bypass branch + popup summary's bypass branch (`.bc-badge--dev-
  bypass` CSS ลบด้วย, `.bc-badge--verified` เก็บไว้เพราะเป็น badge จริงของ "Twilio ยืนยันแล้ว" ไม่เกี่ยวกับ
  bypass) 3) `backend/.env`'s `SKIP_PHONE_VERIFY=true` (ไฟล์นี้ไม่อยู่ใน git ต้องลบเองตรงๆ ไม่โผล่ใน diff)
  — grep ทั้ง `backend`/`public-seller-src`/`public-shared` แล้วไม่มี reference เหลือเลยสักจุด ไม่แตะ
  Twilio integration/validation จริงเลยตลอดทั้งช่วงที่มี bypass และตอนลบ

**Popup redesign ให้ใกล้เคียง TikTok reference มากขึ้น (2026-08-16) — commit `827efb3`, เจ้าของโปรเจกต์
ดูเทียบแล้ว approve, push แล้ว**
- `.review-row` เปลี่ยนจาก label-ซ้าย/value-ขวาแนวนอน เป็น label เล็กสีเทาบนบรรทัดบน + value ตัวใหญ่หนา
  บรรทัดล่าง (แนวตั้ง) ตรงกับ reference
- Padding ต่อ row เพิ่มจาก `9px` เป็น `16px` บน/ล่าง ยังมีเส้นคั่นบางๆ ระหว่าง field เหมือนเดิม
- คำอธิบายใต้หัวข้อ popup มีอยู่แล้วตั้งแต่สร้าง popup ครั้งแรก ("Please confirm everything below is
  correct — we'll use it to verify your identity.") ไม่ต้องเพิ่มใหม่
- สถานะ verify ของเบอร์ (Verified/Dev bypass) แยกออกจากข้อความ value เป็น badge ต่างหากแล้ว — **reuse
  `.bc-badge` ที่มีอยู่แล้วใน `components.css`** (เดิมทำไว้สำหรับ order-status pill) เพิ่มแค่ 2 color
  modifier ใหม่เฉพาะหน้านี้ (`--verified` เขียว, `--dev-bypass` เหลือง) แทนที่จะสร้าง badge class แยกใหม่
  ทั้งหมด — ไม่แตะ `tokens.css`/`components.css` เอง ตามที่สั่งให้ reuse ของเดิม
- **ทดสอบด้วยตา**: ไม่มี browser automation ในนี้เหมือนเดิม เลยสร้าง before/after mockup จาก CSS จริง
  (ไม่ใช่ sketch คร่าวๆ) เป็น Artifact ให้เจ้าของโปรเจกต์ดูเทียบเอง — ดูแล้ว **approve ตรงตามที่ต้องการ**

**Phase 7: หน้า /settle/verification + /settle/verification-result — เขียนโค้ดเสร็จ (2026-08-16),
ทดสอบผ่านครบ, ยังไม่ push**
- **ไฟล์ใหม่**: `public-seller-src/settle/verification.html` (หน้ารอตรวจสอบ, read-only) และ
  `public-seller-src/settle/verification-result.html` (หน้าผลลัพธ์) — reuse `tokens.css`/`components.css`
  + visual language เดียวกับ apply.html's เดิม `.done-state`/`.done-icon`/`.done-title`/`.done-sub`
  (ยกมาจาก panel "Done" เดิมที่ถูกลบออกไปแล้ว — ดูข้างล่าง)
- **routing**: ยืนยันแล้วว่า `walkHtmlFiles()` (`server-seller.js`) เดินแบบ recursive จริงตามที่เคยสำรวจไว้
  — ไม่ต้องแก้โค้ด routing เลย แค่วางไฟล์ในโฟลเดอร์ `settle/` แล้ว build ก็ได้ clean URL `/settle/
  verification`/`/settle/verification-result` อัตโนมัติ (ทดสอบจริงผ่าน curl: ทั้งคู่ตอบ 200, `.html` ต่อท้าย
  ยัง 404 ตาม Clean URLs Phase 2 เดิม) — `backend/scripts/build-public.js`'s `copyTree()` ก็ recursive
  อยู่แล้วเช่นกัน ไม่ต้องแก้
  - **ข้อควรระวังที่เจอ**: หน้าที่อยู่ลึกกว่า top-level (เช่น `/settle/verification`) **ต้องใช้ absolute
    path** (`/tokens.css` ไม่ใช่ `tokens.css`) สำหรับทุก asset/link เพราะ browser resolve relative path
    ตาม "directory" ของ URL ปัจจุบัน — `/settle/verification` มี directory เป็น `/settle/` ไม่ใช่ `/` ต่างจาก
    หน้าเดิมอย่าง `/apply` ที่ relative path ใช้ได้เพราะบังเอิญ resolve ไปที่ root พอดี (ยืนยัน pattern นี้ตรง
    กับที่ `public/en/`,`public/kh/` ใน monolith เดิมใช้อยู่แล้วด้วย)
- **Loading/error state**: ทั้ง 2 หน้ามี spinner skeleton ระหว่างโหลด (`.spinner-lg`, ไม่ใช่หน้าเปล่า) และ
  error state ที่ไม่ fallback ไปหน้ากรอกฟอร์ม/ข้อความ "ยังไม่ได้สมัคร" เด็ดขาด — แค่ error message ชัดเจน
  + ปุ่ม "Try Again" ที่เรียก `loadStatus()` ซ้ำ (function เดียวกับตอน mount ครั้งแรก, retry กี่ครั้งก็ไม่
  throw จนหน้าขาว)
- **State routing เต็มรูปแบบ (ตัดสินใจเพิ่มเติมนอกเหนือจาก spec ที่ระบุแค่ pending/approved/rejected)**:
  ทั้ง 2 หน้าดึง `GET /api/shops/me` สดทุกครั้งที่โหลด/retry ไม่เชื่อ cache แล้ว routing ตาม status จริง —
  `approved`→ redirect `/seller`, `rejected` (จากหน้า verification) → redirect ไปหน้า result,
  `pending`/`needs_info`-ไม่มี (จากหน้า result) → redirect กลับไปหน้า verification (เพราะผลยังไม่ตัดสิน
  ไม่ควรโชว์อะไรค้างที่หน้า result), `needs_info`/`suspended` → redirect ไป `/apply` (ใช้ UI ที่มีอยู่แล้ว
  ของทั้งสองสถานะนี้ ไม่สร้างซ้ำ), `shop:null` → โชว์ "No Application Found" + ลิงก์ไป Seller Center (ไม่ใช่
  ฟอร์ม) — spec ต้นฉบับพูดถึงแค่ 3 สถานะ (pending/approved/rejected) แต่ระบบจริงมี 5 สถานะ
  (+needs_info+suspended) ตัดสินใจ route ทั้งหมดให้สมเหตุสมผลแทนปล่อยว่าง
- **"ไปที่หน้าแรก" ตีความเป็น `/seller` ไม่ใช่ `seller-landing.html`** (จุดที่ต้อง confirm กับเจ้าของโปรเจกต์):
  เช็ค `seller.html` แล้วพบว่าไม่ gate บน shop status เลย (แสดง dashboard เสมอสำหรับ seller ที่ login อยู่
  ไม่ว่า shop จะ approved หรือยัง) ตีความว่านี่คือ "Seller Center home" จริงตามที่ reference พูดถึง ต่างจาก
  `seller-landing.html` ที่เป็นหน้า marketing ก่อนสมัคร (ไม่เกี่ยวกับ seller ที่ signed-in อยู่แล้ว) — ปุ่ม
  "สมัครใหม่" ในหน้า rejected ยังใช้ `seller-landing.html` (จริงๆ คือ `/` ซึ่ง `server-seller.js` serve
  `seller-landing.html` ตรงๆ อยู่แล้วสำหรับ bare `/`) ตามที่สั่งไว้ตรงๆ ไม่เปลี่ยน
- **แก้ apply.html**: `handleFinalSubmit()`'s success branch (path ที่ไม่ใช่ `alreadyApproved`) เปลี่ยนจาก
  `showOnly('panelDone')` เป็น `location.href = '/settle/verification'` — **ลบ panel "Done" เดิมออกจาก
  apply.html ทั้งหมด** (ตายแล้วจริง ไม่มีทางเข้าถึงได้อีกหลัง redirect) ยืนยันด้วย grep ไม่มี reference
  เหลือ — path "already approved, editing profile" ไม่กระทบเลย (ยังโชว์ toast "Changes saved" เหมือนเดิม
  ไม่ redirect)
- **ทดสอบ**: (1) routing/asset-path ผ่าน curl จริงตามข้างบน (2) **execute โค้ด `loadStatus()` จริงของทั้ง
  2 ไฟล์** ผ่าน Node `vm` context (mock `ShopsAPI`/`document`/`location`) ครบทั้ง 7 เคสสถานะต่อไฟล์ (no
  shop/pending/needs_info/suspended/approved/rejected/network error) — **ผ่านหมดตรงตามที่ออกแบบไว้ทุก
  เคส** (14/14) — นี่คือรันโค้ดจริงที่ extract จากไฟล์ ไม่ใช่แค่ประเมินจากการอ่านโค้ด (3) ทดสอบ state
  transition จริงผ่าน DB+API กับ seller ทดสอบที่มีอยู่แล้ว: `bardsphase6freshbiz` เดินสมัครจริงผ่าน
  `POST /apply` (ไม่มี shop มาก่อน) → ยืนยัน `GET /me` คืน `pending` ถูกต้อง แล้ว flip เป็น `approved` (จำลอง
  admin) ยืนยันสถานะเปลี่ยนถูกต้อง, `bardsphase6biz` flip เป็น `rejected` พร้อม reason ยืนยันข้อมูลถูกต้อง
  (4) **ไม่ได้ทดสอบ error state ด้วยตาจริงในเบราว์เซอร์เอง** (ปิด wifi/throttle DevTools) เพราะไม่มี browser
  ในสภาพแวดล้อมนี้ — โค้ด error-handling ตรวจสอบแล้วว่าเป็น try/catch ธรรมดาไม่มี edge case ที่จะพังแบบไม่ดัก
  แต่แนะนำให้เจ้าของโปรเจกต์ลองปิดเน็ตจริงดูเองตามที่เสนอไว้แต่แรก เพื่อความชัวร์ 100%
- **บัญชีทดสอบหลังจบรอบนี้ (เผื่อเจ้าของโปรเจกต์อยากดูเองต่อ)**: `bardsphase6indiv` = pending (ไม่แตะ),
  `bardsphase6biz` = **rejected** (เปลี่ยนจาก pending เพื่อทดสอบ — fixture ดีสำหรับดู
  verification-result.html หน้า reject), `bardsphase6freshindiv` = pending (ไม่แตะ — บัญชีที่เจ้าของ
  โปรเจกต์เดินฟอร์มเองตอน Phase 6), `bardsphase6freshbiz` = **approved** (เปลี่ยนจาก ไม่มี shop เลย —
  fixture ดีสำหรับดู redirect ไป `/seller`) รหัสผ่านทั้งหมด `testpass123`

**บั๊กที่เจอระหว่างทดสอบ Phase 7 ด้วยตาจริง (2026-08-16), แก้แล้วทั้งคู่ — commit `5ddf45b` +
commit ของ apply.html rename ด้านล่าง:**
1. **`signin.html` route ตาม "มี shop ไหม" เฉยๆ ไม่เช็ค status เลย** — login เป็น seller ที่มี shop
   `rejected` แล้วโดนส่งเข้า `/seller` ตรงๆ แทนที่จะไป `/settle/verification-result` เช็ค DB แล้วยืนยันว่า
   สถานะยังเป็น `rejected` จริง (ไม่ได้ถูก reset ระหว่างทดสอบรอบก่อน) สรุปว่าเป็นบั๊ก routing จริง ไม่ใช่ข้อมูล
   เพี้ยน — root cause: `initRedirect()`/`landAfterSignin()` (2 จุดในไฟล์เดียวกัน) เช็คแค่
   `d?.shop ? '/seller' : '/apply'` เป็นบั๊กเก่าที่มีอยู่ก่อน Phase 7 (ไม่ใช่งานใหม่ของ Phase 7 เอง แค่เพิ่งมี
   หน้า `/settle/*` ให้เทียบจึงเห็นชัด) แก้โดยรวมเป็น `routeByShopStatus()` เดียว mirror routing table
   เดียวกับหน้า verification ทั้งสองเป๊ะ ยืนยันด้วยการรัน logic จริงผ่าน `vm` ครบ 6 เคสสถานะ
2. **ปุ่ม "Apply Again" ในหน้า rejected ยังลิงก์ไป `/apply`** — เป็นงานที่ตกหล่นจากตอนวางแผนก่อน Phase 6
   (เคยคุยกันไว้ว่าจะย้าย apply.html ไปเป็น `/settle/form` ตาม namespace เดียวกับ verification/
   verification-result แต่ไม่เคยสั่งทำจริง) — ดูรายละเอียดเต็มด้านล่าง

**apply.html → settle/form.html (2026-08-16) — เขียนโค้ดเสร็จ, ทดสอบผ่านครบ, ยังไม่ push:**
- **Rename ไฟล์จริง** (`git mv`, ไม่ใช่แค่เปลี่ยน route) — จำเป็นต้อง move ไฟล์จริงเพราะ clean URL
  gen จาก path ของไฟล์ตรงๆ (`walkHtmlFiles()`) ไม่มีทาง alias `/apply` ให้ชี้ไปไฟล์อื่นโดยไม่ย้ายไฟล์จริง
  — แก้ asset path ในไฟล์ที่ย้ายเป็น absolute (`/tokens.css` ฯลฯ) เหมือนที่ทำกับ verification.html/
  verification-result.html ตอน Phase 7 เป๊ะ (เจอปัญหาเดิมซ้ำ — คาดไว้แล้ว)
- **grep ทั้งโปรเจกต์หา `/apply`/`apply.html` แล้วแก้ทุกจุดที่เป็น frontend page link จริง** (ไม่ใช่ backend
  API `POST /api/shops/apply` ซึ่งเป็นคนละอย่างกัน ไม่แตะ): `signup.html` (CTA "CONTINUE TO APPLICATION" +
  already-signed-in skip), `signin.html` (`routeByShopStatus()`'s 2 branch), `settle/verification.html`/
  `verification-result.html` (needs_info/suspended redirect target + comment), `seller.html`
  (onboarding checklist `href` 2 จุด), `seller-landing.html` (CTA "Start Selling" 3 จุด),
  `server-seller.js` (comment อธิบาย bare `/`) — เช็คซ้ำด้วย grep ว่าไม่มี `href="/apply"`/
  `location.href = '/apply'`/`href: '/apply'` เหลือเลยสักจุดในโปรเจกต์
- **ตัดสินใจ**: **ไม่ทำ compat redirect จาก `/apply` เดิม** — ปล่อย hard 404 ตาม convention เดิมของโปรเจกต์
  (Clean URLs Phase 2: "ไม่มี SEO ต้อง preserve, ยังไม่มี seller จริงใช้งาน") ยืนยันจริงว่า `/apply` 404,
  `/settle/form` 200 พร้อม asset โหลดถูกต้องหมด
- **สังเกตเจอระหว่างทาง (นอกขอบเขต ไม่ได้แก้)**: `05-seller-onboarding-blueprint.md` เคยเขียนไว้ว่าปุ่ม
  "Start Selling" ควรพาไป `/signup` ไม่ใช่ `/apply`/`/settle/form` ตรงๆ — แต่โค้ดจริงพาไปฟอร์มตรงๆ มาตลอด
  (พฤติกรรมเดิมไม่เปลี่ยน แค่เปลี่ยน path ปลายทาง) ไม่ใช่ scope งานรอบนี้ บันทึกไว้เผื่ออนาคตอยากปรับ
- **ทดสอบ**: routing จริงผ่าน curl (`/settle/form` 200 + asset path ถูกต้อง, `/apply` 404),
  `routeByShopStatus()` (`signin.html`) รันจริงผ่าน `vm` ซ้ำอีกรอบหลังแก้ path ครบ 6 เคสตรงตามที่ออกแบบ
  ทุกหน้าที่แตะ (signin/signup/seller/seller-landing/settle ทั้ง 3) syntax-check ผ่านหมด + serve จริง
  200 ทุกหน้า

**ทดสอบ error/retry state แบบ programmatic แทนการทดสอบ manual (2026-08-16)** — เจ้าของโปรเจกต์ทดสอบ
manual ผิดวิธีรอบก่อน (เปิด "Offline" เต็มรูปแบบ + reload ทั้งหน้า เจอหน้า dinosaur ของ Chrome เอง ไม่ใช่
error UI ของเรา เพราะ browser บล็อกการโหลดหน้าตั้งแต่ request แรกก่อน JS จะรันด้วยซ้ำ) — เขียน test จำลอง
**เฉพาะ `ShopsAPI.me()` fail** (ไม่แตะทั้งหน้า/เบราว์เซอร์) รัน `loadStatus()` จริงของทั้ง 2 ไฟล์ผ่าน `vm`
3 รอบต่อไฟล์: (1) เรียกครั้งแรก API fail → ต้องขึ้น error state (2) กด "Try Again" (เรียก `loadStatus()`
ซ้ำ) คราวนี้ API กลับมาทำงาน → ต้องกลับมาโชว์ content จริง (3) กด "Try Again" อีกรอบแต่ API ยังพังอยู่ → ต้อง
กลับไป error state อีกครั้ง ไม่ค้าง ไม่ throw จนพัง — **ผ่านหมดทั้ง 2 ไฟล์ × 3 รอบ = 6/6** ยืนยันว่า retry
logic ทำงานถูกต้องจริงเวลามีแค่ API call เดียวที่ fail ไม่ต้องพึ่งการทดสอบ manual ที่เจ็บบ่อยจากการปิดเน็ต
ทั้งเบราว์เซอร์อีกต่อไป

## ยังไม่เริ่ม
- Phase 8: ปรับ UI ให้มีภาพประกอบ/สีสัน มืออาชีพแบบ TikTok
- **Phase 11**: สร้างหน้า `/homepage` เป็น landing page ก่อนเข้า dashboard จริง (`/seller`) สำหรับ seller
  ที่ approved แล้ว — ตอนนี้ approved seller เข้า `/seller` ตรงๆ ต้องการมีหน้ากลางก่อน (รายละเอียด
  UI/เนื้อหายังไม่ได้คุยกัน รอวางแผนตอนถึงคิว)

## TODO ที่พบระหว่างทาง (ยังไม่ตัดสินใจว่าจะทำเมื่อไหร่)
- ปุ่ม "Start Selling" ใน `seller-landing.html` พาไปฟอร์มสมัคร (`/settle/form`) ตรงๆ แต่ตาม
  `05-seller-onboarding-blueprint.md` ควรพาไป `/signup` ก่อน (สมัครบัญชีก่อนค่อยกรอกฟอร์ม) — เป็นความไม่
  ตรงกันระหว่าง design เดิมกับโค้ดจริง ตัดสินใจเก็บไว้ก่อน ยังไม่แก้ตอนนี้

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
- **บั๊กที่เจอระหว่างเจ้าของโปรเจกต์ทดสอบ Phase 6 ด้วยตาจริง (2026-08-15):**
  1. `seller-products.html`'s "Add Product" → upload รูป ขึ้น "No token. Please sign in." ทั้งที่ login
     seller อยู่จริง — root cause: `handleFiles()` อ่าน token ผ่าน `Auth.getToken()` (customer/admin
     identity) ตรงๆ แทนที่จะผ่าน `_activeAuth()` (seller-aware helper, `public-shared/api.js`) เหมือนจุด
     อื่นทั้งหมดในไฟล์เดียวกัน — seller session จริงมีแต่ `SellerAuth` token ไม่มี `Auth` token เลย
     `Auth.getToken()` เลย null เสมอ ไม่ส่ง `Authorization` header ไปเลย ใช้ได้แค่ตอน admin เข้าข้าม domain
     ผ่าน shared `Auth` session เท่านั้น (เป็นบั๊กเก่าที่มีมาก่อน Phase 5/6 ไม่เกี่ยวกับงานรอบนี้ แค่เพิ่งเจอ
     ระหว่างทดสอบ) แก้แล้ว (commit `be3a898`) ยืนยันด้วยการยิง `POST /seller/upload` จริงด้วย seller JWT
     ผ่าน 200 คืน URL จริง
  2. บัญชีทดสอบ Phase 6 เดิม (`bardsphase6indiv`/`bardsphase6biz`) มี shop ติดมาจากตอนทดสอบ backend API
     รอบก่อน (status `pending`) ทำให้ login แล้วเด้งเข้า `/seller` dashboard ตรงๆ แทนที่จะเจอฟอร์ม `/apply`
     ตั้งแต่ Step 1 — สร้างบัญชีทดสอบใหม่เพิ่ม 2 บัญชีที่**ยังไม่มี shop เลย** (signup อย่างเดียว ไม่ยิง
     `POST /apply` ให้): `hnunghofficial+bardsphase6freshindiv@gmail.com` /
     `hnunghofficial+bardsphase6freshbiz@gmail.com` (รหัสผ่าน `testpass123` ทั้งคู่) ยืนยันแล้วว่า
     `shop_id IS NULL` ทั้งสองบัญชี — ใช้เดินฟอร์มตั้งแต่ Step 1 ได้จริง (บัญชีเดิม 2 อันที่มี shop แล้วยัง
     เก็บไว้เหมือนเดิม ใช้ทดสอบ "resume" ของ Phase 6 ได้ต่อ)
  - เรื่องแยกต่างหาก (ไม่ใช่บั๊กจริง แค่ตั้งค่าทดสอบผิด): "SEND CODE" ขึ้น "Internal error" รอบแรกที่ทดสอบ
    เพราะรัน local server ที่ port `3034` ซึ่งไม่อยู่ใน CORS allow-list ของ `server-seller.js`
    (`localhost:3000`/`5500` เท่านั้นที่อนุญาตไว้) ทำให้ทุก request รวมถึงโหลด `api.js` เองโดนบล็อกไปด้วย —
    ย้ายไปรัน local server ที่ port `3000` แทน ไม่เกี่ยวกับ Resend/Phase 5 เลย ไม่ต้องแก้โค้ดอะไร
- **Step 5 (Contact) phone field รื้อ UI ตาม TikTok reference (2026-08-15) — เขียนโค้ดเสร็จ, push แล้ว**
  เจอระหว่างเจ้าของโปรเจกต์ทดสอบ Phase 6 ด้วยตาจริง แก้ 3 จุด (commit `f31170f`):
  1. ช่อง OTP (`#otpRow`) แสดงตลอดใต้ช่องเบอร์แล้ว (ไม่ `display:none` จนกว่าจะกด "Send code" อีกต่อไป) —
     แค่ disabled จนกว่าจะมีโค้ดที่ส่งไปจริงให้กรอก
  2. "Send Code" เดิมเป็นปุ่มเต็มความกว้าง ย่อเหลือเป็น text link เล็กๆ (`.phone-send-link`) อยู่ในกรอบ
     เดียวกับช่องเบอร์ (มุมขวา) แทน
  3. เพิ่ม country dial-code selector (`#fDialCode`, 173 ประเทศ, generate จาก data array เหมือน
     `#fCategory`) อยู่ในกรอบเดียวกับช่องเบอร์ (`.phone-box`) — เปิดเลือกได้ทุกประเทศตามที่สั่ง (**TODO
     ค้าง: ล็อกเหลือแค่ +855 หลังทดสอบผ่าน+upgrade Twilio แล้ว**) default `+855` (กัมพูชา ปักหมุดบนสุดของ
     list เสมอ ไม่ว่าจะ sort ตามชื่อประเทศยังไง)
  4. `normalizePhoneKH()` (`services/twilioVerify.js`) รับ dial code จาก UI เป็น parameter ที่สอง แทนที่จะ
     เดา `+855` เสมอ — ยัง strip leading-0 ของเบอร์ local เหมือนเดิม แค่ต่อกับ dial code ที่เลือกจริงแทน
     `phoneVerifySchema`/`phoneVerifyCheckSchema` (`routes/shops.js`) เพิ่ม field `dial_code` (optional,
     fallback `+855` ฝั่ง backend ถ้าไม่ส่งมา) `ShopsAPI.startPhoneVerification()`/`checkPhoneVerification()`
     (`public-shared/api.js`) ส่งต่อให้ — `shops.phone` เปลี่ยนไปเก็บเป็น E.164 เต็ม (dial code+เบอร์ local
     ตัด 0 นำหน้าแล้ว) แทนที่จะเก็บแค่เบอร์ local ดิบเหมือนเดิม — `prefillFromShop()` แยกกลับเป็น 2 ช่องตอน
     resume application เก่า
  **ทดสอบแล้ว**: unit-test `normalizePhoneKH()` ตรงๆ 8 เคส (KH/TH/US, มี/ไม่มีเลข 0 นำหน้า, ส่ง E.164 มา
  แล้วเลย, ไม่ส่ง dial code มาเลย) ผ่านหมด — ยืนยันผ่าน API จริงบน server ที่ restart แล้ว (ต้อง restart
  จริงๆ เพราะแก้ backend route/service — เจอรอบแรกว่า process เก่ายัง cache โค้ดเดิมอยู่ ทดสอบไม่ผ่านเพราะ
  เหตุนี้ ไม่ใช่บั๊ก): `dial_code` รูปแบบผิด (ไม่มี `+`) ถูก validate ปฏิเสธก่อนถึง Twilio จริง, `dial_code`
  ถูกต้อง (`+66`) ไหลผ่านไปถึง Twilio จริง (ยืนยันด้วย error response ของ Twilio เองสำหรับเบอร์ปลอมที่ตั้งใจ
  ใส่ — **ไม่ได้ส่ง SMS จริง** ตามข้อจำกัด Twilio trial account ที่รู้อยู่แล้วจาก Phase 4) เช็ค
  `DIAL_CODES` ทั้ง 173 รายการแล้วว่าไม่มี ISO code ซ้ำและทุก dial code ผ่าน regex ฝั่ง backend ครบ
  **อัปเดต**: เจ้าของโปรเจกต์ทดสอบด้วยตาจริงแล้วผ่าน `localhost:3000` จริง (bypass ด้านล่างช่วยให้ข้าม
  Step 5 ไปถึง popup ได้) — popup layout เอง edit เพิ่มอีกรอบ (ดู "Popup redesign" ด้านล่าง) แต่ dropdown/
  text-link ของช่องเบอร์เองไม่มีรายงานปัญหา ถือว่าผ่าน
