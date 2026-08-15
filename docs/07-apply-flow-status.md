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

## เขียนโค้ดเสร็จ แต่ยังไม่ push — หยุดไว้ก่อน
Phase 4: Twilio Verify SMS OTP — โค้ด backend+frontend เสร็จสมบูรณ์ทั้งหมดแล้ว แต่หยุดการทดสอบ end-to-end ไว้ก่อน สาเหตุ:
- ไม่มีเบอร์กัมพูชาจริงให้ทดสอบ ลองใช้เบอร์ไทย (+66936406304) แทนแต่ Twilio trial account บล็อกการ verify caller ID ของเบอร์ไทยทั้ง SMS และ Call (ประเทศที่ถูกจำกัด)
- ลองหาทาง Twilio Verify test/magic phone number (+85512345678) แต่ไม่ยืนยันได้ชัดว่า Twilio Verify API รองรับ test credentials แบบเดียวกับ Messages API จริงหรือไม่ (เอกสาร Twilio ไม่ชัดเจนพอ)
- เคย verify เบอร์ไทยผ่านได้ 1 ครั้ง แต่กลับพบว่า verified caller ID list ว่างเปล่าตอน query ผ่าน API ตรง (สงสัยว่าเป็นคนละ Twilio Project แต่เช็คแล้ว Account SID ตรงกัน — สาเหตุจริงยังไม่ชัดเจน) หลังจากนั้นลบเบอร์แล้วเพิ่มใหม่ไม่ได้อีกเลย (ติด restricted country ซ้ำ)
- ทางแก้ที่เหลือคือ upgrade Twilio เป็น paid account (เสียเงินจริง เครดิตทดลอง $15.50 ไม่ carry over) หรือรอเบอร์กัมพูชาจริงมาทดสอบ
- ตัดสินใจ: หยุดพยายามแก้ตอนนี้ เลื่อนไปทดสอบตอนใกล้เปิดใช้งานจริง (ตอนนั้นจะ upgrade Twilio อยู่แล้ว) ไปทำ Phase 5-8 ต่อก่อน
- TODO ค้าง: ต้องเพิ่ม validation จำกัดเฉพาะเบอร์กัมพูชาหลังทดสอบผ่าน

## ยังไม่เริ่ม
- **Phase 5: signup.html → email-only + ยืนยันด้วยโค้ดอีเมลจาก no-reply@bardskh.com — เริ่มสำรวจแล้ว
  (2026-08-15), ยังไม่แก้โค้ด** ผลสำรวจ:
  - `public-seller-src/signup.html` ตอนนี้เป็น 4-step flow: Step 1 = Email+**Phone** (ทั้งคู่ required) →
    ปุ่ม "SEND CODE" เรียก email OTP, Step 2 = กรอกโค้ด OTP 6 หลักที่ส่งไปอีเมล, Step 3 = Password+Confirm
    → `POST /signup`, Step 4 = success → ไป `/apply` — **มีระบบ email OTP ที่สมบูรณ์อยู่แล้ว** ไม่ต้องสร้าง
    ใหม่ทั้งหมดตามที่กังวลไว้แต่แรก
  - Backend `routes/authSeller.js` มี endpoint ครบ: `/request-otp` (purpose signup/signin),
    `/verify-otp` (คืน short-lived otpToken ให้ `/signup` ใช้ต่อ), `/signup`, `/signin`, `/signin-otp`,
    `/refresh`, `/logout`, `/me` — ส่งอีเมลผ่าน `services/mailer.js`'s `sendMail()` (shared
    nodemailer/Gmail SMTP transporter ตัวเดียวกับ forgot-password ของ customer)
  - `seller_accounts.email_verified_at` (TIMESTAMPTZ, nullable) คือ verified-status column ที่มีอยู่แล้ว
    — set เป็น `NOW()` ทันทีตอน `POST /signup` สำเร็จ เพราะ OTP บังคับ verify ก่อนสร้าง account เสมออยู่
    แล้ว (ไม่มี state "สมัครแล้วแต่ยัง verify ไม่ผ่าน" ค้างอยู่เลย)
  - **ส่งจากอีเมลอะไรจริง**: เช็ค `.env` แล้ว `MAIL_FROM="Bards" <hnunghofficial@gmail.com>`,
    `SMTP_USER=hnunghofficial@gmail.com` — **ส่งจาก Gmail ส่วนตัวจริง ไม่ใช่ no-reply@bardskh.com** ไม่มี
    config ใดๆ ในระบบอ้างถึง mail ของโดเมน bardskh.com เลยตอนนี้ — เปลี่ยนเป็น no-reply@bardskh.com ได้ 2
    ทาง (**ต้องคุยกับเจ้าของโปรเจกต์ก่อนเริ่ม ไม่ใช่แค่เปลี่ยนโค้ด**): (a) ตั้ง `no-reply@bardskh.com` เป็น
    Gmail "Send As" alias ในบัญชี `hnunghofficial@gmail.com` เดิม — เร็ว/ฟรี แต่บาง mail client อาจยังโชว์
    "via gmail.com" และ SPF/DKIM ไม่เต็มร้อย หรือ (b) ตั้ง domain email จริงของ bardskh.com (Google
    Workspace หรือ transactional email service เช่น SendGrid/SES ที่ verify DNS ของโดเมนเอง) — infra งาน
    แยกต่างหาก ไม่ใช่แค่แก้ `.env`
  - **ช่องเบอร์โทรตอนนี้ required ทั้งสองฝั่ง** (frontend JS validate ความยาว≥6, backend zod
    `phoneSchema` เดียวกัน, DB column `seller_accounts.phone` เป็น `NOT NULL UNIQUE`) **แต่ไม่ verify ผ่าน
    SMS ที่ signup เลย** — เก็บไว้เฉยๆ เช็คแล้วพบว่า `apply.html` Step 5 (Phase 4, Twilio Verify) เก็บเบอร์
    โทร**อีกรอบหนึ่งต่างหาก**และ verify ด้วย SMS OTP จริงตรงนั้น — เบอร์ที่กรอกตอน signup กับตอน apply เป็น
    คนละช่อง ไม่มี prefill/sync ข้ามกันเลย → **เบอร์ที่ signup ซ้ำซ้อน 100% กับของ apply.html และไม่เคยถูก
    verify จริง** ตรงกับที่ต้องการตัดออกทั้งหมด ให้เหลือ signup ด้วยอีเมล+รหัสผ่านอย่างเดียว (phone/SMS
    verification ยังทำที่ apply.html เหมือนเดิม ไม่กระทบ)
  - **สรุปแนวทางที่แนะนำ (ยังไม่ได้เริ่มเขียนโค้ด รอคำสั่ง)**: (1) ตัด field เบอร์โทร + step ที่เกี่ยวข้อง
    ออกจาก `signup.html`, แก้ `SellerAuthAPI.signup()` (`public-shared/api.js:339`) ให้ไม่ส่ง `phone`,
    (2) แก้ `signupSchema`/`POST /signup` ใน `routes/authSeller.js` ให้ไม่ต้องรับ/บังคับ `phone`, (3) แก้
    schema DB: `seller_accounts.phone` ต้องเปลี่ยนจาก `NOT NULL UNIQUE` เป็น nullable (ต้อง ALTER COLUMN,
    กระทบแถวเดิมถ้ามี — ต้องเช็คว่ามี seller จริงสมัครแล้วกี่คนก่อนแก้), (4) ตัดสินใจเรื่อง MAIL_FROM ก่อน
    (ข้อบนสุด) แล้วอัปเดต `.env`/mailer config ตาม — ยังไม่ได้ประเมิน `public-customer-src`/`public-admin-src`
    ว่ามีจุดไหนอ้างอิง `seller_accounts.phone` แบบคาดว่ามีค่าเสมอหรือไม่ (เช่น admin ดูรายชื่อ seller) ต้อง
    เช็คเพิ่มก่อนแก้ schema จริง
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
