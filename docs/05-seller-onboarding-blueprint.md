# BARDS Marketplace — Seller Onboarding Blueprint

**สถานะ:** Implemented — Step 1 ของ flow (สร้างบัญชี/login) ถูกออกแบบใหม่ทั้งหมดตาม Revision note
(2026-08-09) ด้านล่าง ส่วน Step 2-6 (ข้อมูลร้าน/เอกสาร/บัญชีธนาคาร/terms) ยังตรงกับที่เอกสารนี้ระบุไว้เดิม
**เป้าหมาย:** ออกแบบ flow การสมัครเป็นผู้ขายทั้งระบบ ก่อนเริ่มเขียนโค้ดจริง
**หลักการ:** Seller สมัครและกรอกข้อมูลเองทั้งหมด แอดมินมีหน้าที่แค่ตรวจสอบ/อนุมัติ ไม่ใช่สร้างร้านแทน — เพื่อให้ระบบ scale ได้ถึงหลักพัน-หลักหมื่นร้านโดยไม่ต้องพึ่งแรงงานแอดมินทุกขั้นตอน (สถาปัตยกรรมแบบ Shopee/Lazada/TikTok Shop)

**Revision note (2026-08-09) — Seller Identity Split (Approach B), ทับ revision 2026-07-31 ด้านล่าง
เฉพาะเรื่อง "ใครคือ seller":** เจ้าของโปรเจกต์ตัดสินใจกลับด้านการตัดสินใจข้อ 2 ของ revision 2026-07-31
ทั้งหมด — **seller ไม่ใช่ `role='customer'` ที่ยืมบัญชีมาจาก `users` อีกต่อไป** แต่เป็น **identity แยกจาก
`users` โดยสิ้นเชิง** อยู่ใน table ใหม่ `seller_accounts` (ดู `CLAUDE.md` §3 "Seller Identity Split" สำหรับ
รายละเอียดสถาปัตยกรรมเต็ม) เหตุผล/สิ่งที่เปลี่ยนไปจากที่เอกสารนี้เคยระบุไว้:
1. **seller.bardskh.com มี signup/signin ของตัวเอง** (`/signup`, `/signin`) — ไม่ใช้ session ของ
   bardskh.com ร่วมกันอีกต่อไป (เดิม "no separate seller login needed" — **ข้อความนี้ไม่จริงแล้ว** ดู
   Step 1 ใหม่ด้านล่าง) ยกเว้น **admin** ที่ยัง auto-login ข้ามโดเมนได้เหมือนเดิมผ่าน shared cookie
2. **ไม่มี `role='seller'` ใน `users` table อีกต่อไป** — สมัคร signup สำเร็จ = มี `seller_accounts` row
   ทันที ไม่มีสถานะ "customer ที่กำลังรอ approve" คั่นกลางแบบเดิม role ของ `users` เหลือแค่
   `customer`/`admin` สองค่า
3. **Admin approve ไม่ต้อง role-flip อีกต่อไป** — เดิม (revision 2026-07-31) approve ต้องทำ 2 คำสั่งใน
   transaction เดียว (`shops.status='approved'` + `users.role='seller'`) เพราะกลัวเหลือ customer ค้าง
   ตอนนี้เหลือแค่ `UPDATE shops SET status='approved'...` คำสั่งเดียวเหมือน branch อื่น — **ง่ายขึ้น ไม่ใช่
   ซับซ้อนขึ้น**
4. **`POST /api/seller/make-seller` ถูกลบไปแล้ว** (ไม่ใช่ "ยังเก็บไว้เผื่อกรณีพิเศษ" ตามที่ revision เดิม
   บอก) — ไม่มีความหมายอีกต่อไปเพราะไม่มี `role='seller'` ให้ promote
5. Verification: Email OTP (6 หลัก, หมดอายุ 15 นาที) ก่อนตั้งรหัสผ่าน — คัดลอก pattern จาก
   forgot-password flow เดิมของ customer ตรงๆ **ไม่ใช่ SMS OTP** (ตัดสินใจแล้วว่าไม่คุ้มค่าใช้จ่าย/effort
   หา SMS gateway ใหม่ ในเมื่อ infra อีเมลพร้อมอยู่แล้ว 100%) เบอร์โทรที่กรอกตอน signup **เก็บไว้เป็นข้อมูล
   เท่านั้น ไม่ได้ verify ผ่าน SMS**

**Revision note (2026-07-31)** (ประวัติเดิม — ยังใช้ได้กับ Step 2-6/schema ส่วนที่เหลือ ยกเว้นข้อ 2 ที่ถูก
Revision 2026-08-09 ทับด้านบนไปแล้ว): เวอร์ชันนี้แก้ทั้งฉบับตามการตัดสินใจของเจ้าของโปรเจกต์หลัง review
รอบแรกเทียบกับโค้ดจริง — ตัดสินใจหลัก 4 ข้อ:
1. **ไม่สร้าง `sellers`/`seller_applications` แยก** — รวมเข้า `shops` table ที่มีอยู่แล้ว (Phase 4) เพิ่ม
   คอลัมน์ใหม่เข้าไปแทน (`seller_documents` ยังแยกตาราง แต่ FK ไป `shops.id`) — **ยังจริงอยู่**
   `shops.seller_account_id` (เดิมชื่อ `owner_user_id`) อ้าง `seller_accounts.id` แทน `users.id` แล้ว
2. ~~Self-serve apply — ปรับ POST /api/shops/apply เดิมให้ role='customer' เรียกได้ด้วย...~~ **ถูกแทนที่
   ทั้งหมดโดย Revision 2026-08-09 ด้านบน**
3. **Product review ผูกกับ `is_active`** — สินค้าใหม่สร้างมา `is_active=false` จนกว่า admin approve —
   ยังจริงอยู่ ไม่เปลี่ยน
4. **Enum ทั้งหมด → `TEXT`** ตาม convention เดิมของโปรเจกต์ (ไม่มีตัวไหนในระบบใช้ Postgres native ENUM) —
   ยังจริงอยู่ ไม่เปลี่ยน

R2 signed URL สำหรับเอกสาร (ข้อ 8 เดิม) ยืนยันแล้วว่าเป็นงาน infra ใหม่ที่ไม่มีของเดิมรองรับ (ระบบตอนนี้
upload ขึ้น R2 แบบ public URL ทั้งหมด) — กันเวลา implement ไว้เพิ่มสำหรับส่วนนี้โดยเฉพาะ แยกจาก milestone อื่น

---

## 1. ภาพรวมสถานะร้าน (Store Status Lifecycle)

ใช้ `shops.status` เดิมที่มีอยู่แล้ว (`pending | approved | rejected | suspended`) **ขยายเพิ่ม `needs_info`
เข้าไปอีก 1 ค่า** — ไม่มี state แยก "application_submitted" กับ "active" อีกต่อไป (ยุบรวมเข้ากับ
`pending`/`approved` ที่มีอยู่แล้ว เพราะระบบปัจจุบันถือว่า `approved` = ไปขายได้ทันที ไม่มี step
"activation" แยกจาก "approval"):

```
apply → pending → approved            (go live ทันที)
              ↳ needs_info → pending  (seller แก้ไขแล้ว resubmit)
              ↳ rejected   → pending  (seller resubmit ใหม่ทั้งฟอร์ม)
approved → suspended                  (นอก scope เอกสารนี้ แต่ schema เดิมรองรับอยู่แล้ว)
```

| สถานะ (`shops.status`, TEXT — ไม่มี CHECK constraint คุมแค่ระดับ app code เหมือนคอลัมน์อื่นทั้งหมดในระบบ) | ความหมาย |
|---|---|
| `pending` | Seller กรอกฟอร์มครบและกด Submit แล้ว (หรือ resubmit หลัง rejected/needs_info) รอแอดมินตรวจ — ค่าเดิมของระบบ ไม่ใช่ค่าใหม่ |
| `needs_info` | แอดมินขอข้อมูล/เอกสารเพิ่ม (`info_requested_note`) — seller ต้องแก้ไขและ resubmit **(ค่าใหม่)** |
| `rejected` | ปฏิเสธ พร้อมเหตุผล (`rejection_reason`) — seller resubmit ใหม่ได้ — ค่าเดิมของระบบ |
| `approved` | อนุมัติแล้ว **ร้านไปขายได้ทันที** (ไม่มี "active" แยกอีก step) — ค่าเดิมของระบบ |
| `suspended` | ถูกระงับ — ค่าเดิมของระบบ (นอก scope เอกสารนี้) |

---

## 2. User Flow — ฝั่ง Seller

### Entry point
- ปุ่ม **"Become a Seller"** อยู่บน `bardskh.com` (หน้าแรกหรือ footer/nav) หรือปุ่ม **"Start Selling"** บน
  `seller.bardskh.com` เอง (หน้า landing page สาธารณะ `seller-landing.html`)
- กด → ไปหน้า `seller.bardskh.com/signup`

### Step 1 — สร้างบัญชีผู้ขาย (Seller Identity Split, Approach B — เขียนใหม่ทั้งหมด 2026-08-09)
**นี่คือจุดที่เปลี่ยนไปจากดีไซน์เดิมของเอกสารนี้มากที่สุด** — ไม่มี "user ที่ login อยู่แล้วเรียก
`POST /api/shops/apply` ได้ทันที" อีกต่อไป เพราะ seller.bardskh.com **ไม่รับ session ของ bardskh.com เลย**
ไม่ว่าจะเป็น customer หรือไม่ก็ตาม (auto-login ข้ามโดเมนถูกปิดเจตนา — ยกเว้น admin เท่านั้น) ต้องผ่านฟอร์ม
สมัคร/login ของ seller.bardskh.com เองเสมอ:

- **สมัครใหม่ (`seller.bardskh.com/signup`)**: กรอก Email + Phone → ระบบส่ง **Email OTP 6 หลัก**
  (หมดอายุ 15 นาที, table `seller_otp_codes`) → กรอกโค้ดยืนยัน → ตั้งรหัสผ่าน → สร้าง `seller_accounts`
  row ทันที (ไม่ใช่ SMS OTP — ตัดสินใจแล้วว่าไม่คุ้ม infra ใหม่ในเมื่อมี email infra พร้อมอยู่แล้ว เบอร์โทร
  เก็บไว้เป็นข้อมูลอย่างเดียว ไม่ verify) — **ไม่มี Google/Telegram login สำหรับ path นี้**
- **Login ซ้ำ (`seller.bardskh.com/signin`)**: Email/Phone + Password หรือสลับไปใช้ Email OTP แทนรหัสผ่านก็ได้
- Session ของ seller เก็บคนละที่จาก customer/admin โดยสิ้นเชิง (`seller_accounts`/`seller_refresh_tokens`,
  cookie `bards_seller_rt` host-only ไม่มี `Domain=.bardskh.com` เลย) — ดู `CLAUDE.md` §3 สำหรับ
  สถาปัตยกรรมเต็ม
- **ไม่มีสถานะ "candidate"/"pending seller" บน `users` table อีกต่อไป เพราะไม่แตะ `users` เลย** — สมัคร
  สำเร็จ = มี `seller_accounts` row ทันที คนละเรื่องกับว่า**ร้าน** (`shops` row) ของเขาจะ `approved`
  เมื่อไหร่ (ดู Step 6 ด้านล่าง) — `role` ของ `users` table เหลือแค่ `customer`/`admin` สองค่า ไม่มี
  `'seller'` อีกต่อไป — `POST /api/seller/make-seller` (endpoint เดิมที่เอกสารรุ่นก่อนบอกว่า "ยังเก็บไว้
  เผื่อกรณีพิเศษ") **ถูกลบออกจากโค้ดจริงแล้ว** ไม่มีความหมายเพราะไม่มี `role='seller'` ให้ promote
- ผู้ใช้ที่มีบัญชี customer อยู่แล้ว (อีเมล/เบอร์เดียวกัน) สมัคร seller ใหม่ได้ตามปกติ — เป็นคนละ
  identity/คนละ record กันโดยสิ้นเชิง ไม่มีการ link/merge บัญชีทั้งสองฝั่งใดๆ

### Step 2 — ข้อมูลผู้ขาย
- Business Type: `individual` หรือ `business` (TEXT, ไม่ใช่ Postgres ENUM — คุมค่าที่ app layer)
- Full Name, Phone, Country, Province, Address

### Step 3 — ข้อมูลร้าน
- Store Name, Store Slug (unique, validate เหมือน `categories.slug`: lowercase+ตัวเลข+ขีดกลางเท่านั้น,
  กัน reserved word เช่น `admin`,`api`,`seller`,`shop`)
- Store Logo, Store Cover (อัปโหลดผ่าน Cloudflare R2 — pattern เดียวกับ `POST /api/seller/upload` ที่มีอยู่แล้ว, public URL เหมือนรูปสินค้า — ไม่ต้อง signed URL เพราะโลโก้/cover โชว์สาธารณะอยู่แล้ว)
- Description
- Category (`category_id` FK → `categories.id` ที่มีอยู่แล้ว — เป็น category **ระดับร้าน** คนละ concept
  กับ `products.category_id` ที่ผูกต่อสินค้า อย่าสับสนตอน implement)

### Step 4 — เอกสาร
- Upload: ID Card / Passport (required), Business License (ถ้า `business_type='business'`), Tax
  Document (optional)
- เก็บใน `seller_documents` table (FK → `shops.id`) — R2 bucket แยก path
  `seller-documents/{shop_id}/` **ต้องเป็น private/signed URL ไม่ใช่ public เหมือนรูปสินค้า/โลโก้**
  **⚠️ งาน infra ใหม่ที่ระบบยังไม่มี** — R2 upload ปัจจุบันทั้งหมด (product images, avatar, shop
  logo/cover) คืน public URL ตรงจาก `R2_PUBLIC_URL` ล้วนๆ ยังไม่มี presigned-URL/private-bucket
  capability เลย ต้อง implement แยกเป็น sub-task ของตัวเอง ก่อนจะเขียน route upload เอกสารได้จริง

### Step 5 — บัญชีรับเงิน
- ธนาคาร (TEXT, dropdown ฝั่ง app: ABA / ACLEDA / Wing / Chip Mong), Bank Account Name, Account Number
- สกุลเงิน (TEXT: `KHR` / `USD`)

### Step 6 — ยอมรับเงื่อนไข
- ☑ Marketplace Agreement / Privacy Policy / Commission structure
- ปุ่ม **Submit Application** → เรียก `POST /api/shops/apply` (gate ด้วย `requireSellerAccount` — ต้องมี
  `seller_accounts` session ของตัวเองแล้วเท่านั้น ไม่รับ `role='customer'`/admin อีกต่อไป — ดูหัวข้อ 5) —
  `shops.status` เริ่ม `pending` เหมือนเดิม

### หลัง Submit
- `shops.status='pending'` — ไม่มี `role` อะไรให้พูดถึงอีกต่อไป (seller identity ไม่ผูกกับ `users.role`
  เลย ตั้งแต่ signup สำเร็จ)
- Seller login ได้ปกติ แต่หน้า seller dashboard (`seller.bardskh.com`) โชว์แค่ **"Pending Approval"**
  banner ทำอะไรอื่นไม่ได้จนกว่าจะ approved — auth guard ของหน้า dashboard เช็คแค่ "มี `SellerAuth` session
  ที่ valid ไหม" (`SellerAuth.ensureSession()`) ไม่ต้องเช็ค "มี `shops` row ไหม" แยกต่างหากเหมือนที่เอกสาร
  รุ่นก่อนเคยระบุไว้ — signup สำเร็จ = login ได้เสมอไม่ว่าร้านจะ approved หรือยัง หน้า dashboard เองที่
  ตัดสินใจโชว์ banner ไหนตาม `GET /api/shops/me`'s `status`

### ถ้า Admin กด "Request More Information"
- `shops.status='needs_info'`, `info_requested_note` บอกจุดที่ต้องแก้
- Notification (Email + Telegram bot ที่มีอยู่แล้ว)
- Seller กด Edit → เรียก `PATCH /api/shops/me` (เดิม, ขยาย field ที่รับ) แก้เฉพาะจุดที่ถูกขอ → เรียก
  `POST /api/shops/me/resubmit` (ใหม่ — ดูหัวข้อ 5) → status กลับไป `pending`

### ถ้า Admin Reject
- `shops.status='rejected'`, `rejection_reason` บอกเหตุผล
- Seller แก้ไขทั้งฟอร์มใหม่ได้ผ่าน `PATCH /api/shops/me` แล้ว `POST /api/shops/me/resubmit` → กลับไป
  `pending` (ไม่มี state "application_submitted" แยกจาก "pending" อีกต่อไป — ยุบรวมเป็นค่าเดียว)

### ถ้า Admin Approve
- **ไม่ต้องทำ transaction สองคำสั่งอีกต่อไป** (revision 2026-07-31 เคยระบุว่าต้อง `BEGIN/COMMIT`
  `shops.status='approved'` คู่กับ `UPDATE users SET role='seller'` กัน race condition — **ข้อนี้หายไป
  พร้อมกับ Seller Identity Split**: seller ไม่เคยเป็น `role='customer'` มาก่อนตั้งแต่แรก ไม่มี role อะไรให้
  ต้อง flip) เหลือแค่ `UPDATE shops SET status='approved', reviewed_by=$1, reviewed_at=NOW(),
  updated_at=NOW() WHERE id=$2` คำสั่งเดียว เหมือน branch `rejected`/`needs_info` ทุกอย่าง — **ง่ายขึ้นจาก
  ดีไซน์เดิม ไม่ใช่ซับซ้อนขึ้น**
- ไม่ต้อง "สร้าง Store ID/namespace" แยกอะไรเพิ่ม — `shops.id` ที่มีอยู่แล้วตั้งแต่ตอน apply คือ store id
  เดียวที่ใช้จริงทั้งระบบ (products.shop_id, order_shops.shop_id, coupons.shop_id อ้างตัวนี้อยู่แล้ว)
- ร้าน**ไปขายได้ทันที** ไม่มี "active" step แยกจาก "approved" อีก

### Seller Login ครั้งแรกหลัง Approved
- เห็น onboarding checklist พร้อม progress bar — เก็บใน `shops.onboarding_checklist` (JSONB column ใหม่
  บน `shops`, ไม่ใช่ table แยก): `{profile, store, bank, add_product, shipping, return_address,
  first_product}` แต่ละ key เป็น boolean, progress % คำนวณจากจำนวน key ที่ true

### เพิ่มสินค้าชิ้นแรก
- ต้องกรอก Shipping/Return Address/Warehouse/Courier ก่อน publish สินค้าได้ (schema/route ของส่วนนี้ยัง
  ไม่ได้ออกแบบในเอกสารนี้ — นอก scope รอบนี้ เก็บไว้เป็น prerequisite ที่ต้องคุยแยก)
- กด Publish → **`products.is_active=false`, `review_status='pending_review'`** (ไม่ขึ้นขายทันที —
  ต่างจากพฤติกรรมเดิมของระบบที่ตอนนี้ `is_active=true` ทันทีตอนสร้าง ดูหัวข้อ 4)
- Admin approve → `is_active=true`, `review_status='approved'`
- **หลังร้านมี track record ดี** → เปิด `shops.auto_approve_products=true` ให้ร้านนั้น (คอลัมน์ใหม่บน
  `shops`) — สินค้าใหม่จากร้านนี้จะ `is_active=true` ทันทีไม่ต้องรอ review

---

## 3. Admin Flow

### หน้า Seller Applications — **ต่อยอดจาก `admin-shops.html` เดิม ไม่ใช่หน้าใหม่แยก**
Tab แยกตาม `shops.status`: `Pending` / `Needs Info` / `Rejected` / `Approved` / `Suspended` (ชื่อ tab ตรง
กับ status value จริง ไม่มี "Need Documents" แยกเหมือนร่างแรก — เอกสารที่ยังไม่ครบเป็นส่วนหนึ่งของเหตุผลตอน
กด "Request More Information" ธรรมดา ไม่ใช่ tab ของตัวเอง)

กดเข้าดูรายละเอียดผู้สมัคร (**ต้องเพิ่ม `GET /api/shops/:id` — ยังไม่มี endpoint นี้ในระบบปัจจุบัน** มีแค่
list กับ `/me`) เห็น: ข้อมูลทั้งหมดจาก `shops` row + list เอกสารจาก `seller_documents`

ปุ่มดำเนินการ: **Approve** / **Reject** / **Request More Information** — ทั้งหมดผ่าน `PATCH
/api/shops/:id` เดิม (ขยาย logic ไม่ใช่ endpoint ใหม่ — ดูหัวข้อ 5)

### หน้า Store Detail (หลัง approved)
Tab: Overview / Documents / Products / Orders / Payout / Commission / Violations / Logs — **Payout/
Commission/Violations/Logs อยู่นอก scope เอกสารนี้** (ดูหัวข้อ 9) เก็บไว้เป็น placeholder tab เฉยๆ ก่อน

---

## 4. Database Flow

**ไม่สร้าง `sellers`/`seller_applications` แยก** — เพิ่มคอลัมน์เข้า `shops` table เดิมทั้งหมด ตาม
zero-downtime pattern เดิมของโปรเจกต์ (`ALTER TABLE ADD COLUMN IF NOT EXISTS` ใน `initDb()`,
nullable ทุกคอลัมน์ใหม่เพราะ `shops` มีแถวจริงอยู่แล้วบน production) — **ข้อความนี้ยังจริงอยู่** แต่
**Seller Identity Split (2026-08-09) เพิ่ม 3 ตารางใหม่แยกต่างหากจาก `shops` เข้ามาอีกชุด** สำหรับตัว
identity ของ seller เอง (คนละเรื่องกับ "ข้อมูลร้าน" ที่หัวข้อนี้พูดถึง): `seller_accounts` (แทน `users`
สำหรับ seller), `seller_refresh_tokens` (แทน `refresh_tokens`), `seller_otp_codes` (แทน `password_resets`
— ใช้ตอน signup/signin-otp) — โครงสร้างเต็มดู `CLAUDE.md` §3/§4 **`shops.owner_user_id` (REFERENCES
`users.id`) ถูก retarget เป็น `shops.seller_account_id` (REFERENCES `seller_accounts.id`) แล้ว** — ทุกจุด
ในเอกสารนี้ที่พูดถึง `owner_user_id` ด้านล่างให้อ่านเป็น `seller_account_id` แทน (ไม่ได้ไล่แก้ทุกจุดในเอกสาร
นี้ เพราะเนื้อหาโครงสร้าง field/column อื่นๆ ยังตรงเป๊ะ เปลี่ยนแค่ FK target)

### แก้ตาราง `shops` (เดิม — ดู CLAUDE.md §4)
```sql
-- คอลัมน์ใหม่ทั้งหมด nullable (แถวเดิมที่มีอยู่แล้วไม่มีข้อมูลเหล่านี้ ไม่ backfill ย้อนหลัง)
ALTER TABLE shops ADD COLUMN IF NOT EXISTS business_type         TEXT;  -- 'individual' | 'business' — TEXT ไม่ใช่ ENUM ตาม convention เดิม
ALTER TABLE shops ADD COLUMN IF NOT EXISTS full_name             TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS phone                 TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS country               TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS province              TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS address               TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS store_slug            TEXT;  -- UNIQUE index แยกด้านล่าง (nullable ก่อน unique เพราะร้านเก่าไม่มีค่านี้)
ALTER TABLE shops ADD COLUMN IF NOT EXISTS cover_url             TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS category_id           UUID REFERENCES categories(id);  -- category ระดับร้าน คนละอันกับ products.category_id
ALTER TABLE shops ADD COLUMN IF NOT EXISTS bank_name             TEXT;  -- 'ABA' | 'ACLEDA' | 'Wing' | 'Chip Mong' — TEXT, dropdown ฝั่ง app
ALTER TABLE shops ADD COLUMN IF NOT EXISTS bank_account_name     TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS bank_account_number   TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS currency              TEXT;  -- 'KHR' | 'USD'
ALTER TABLE shops ADD COLUMN IF NOT EXISTS rejection_reason      TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS info_requested_note   TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS onboarding_checklist  JSONB NOT NULL DEFAULT '{}';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS auto_approve_products BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS submitted_at          TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS reviewed_at           TIMESTAMPTZ;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS reviewed_by           UUID REFERENCES users(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_store_slug ON shops(store_slug) WHERE store_slug IS NOT NULL;
```
`shops.status` (มีอยู่แล้ว, TEXT) — เพิ่มค่าที่ยอมรับ `needs_info` เข้าไปในชุดที่คุมระดับ app code เดิม
(`pending|approved|rejected|suspended` → `pending|needs_info|rejected|approved|suspended`) ไม่มี CHECK
constraint ต้องแก้ที่ DB — แก้แค่ zod schema (`shopStatusSchema` ใน `routes/shops.js`) ให้ enum ยาวขึ้น

### `seller_documents` (ตารางใหม่ — FK ไป `shops.id` ไม่ใช่ `seller_applications.id`)
```sql
CREATE TABLE IF NOT EXISTS seller_documents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  doc_type   TEXT NOT NULL,  -- 'id_card' | 'business_license' | 'tax_document' — TEXT ตาม convention
  file_url   TEXT NOT NULL,  -- R2 signed URL — ดูหมายเหตุ private-bucket ในหัวข้อ 2 Step 4
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seller_documents_shop ON seller_documents(shop_id);
```

### แก้ตาราง `products`
```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending_review';
                      -- 'pending_review' | 'approved' | 'rejected' — TEXT ตาม convention
ALTER TABLE products ADD COLUMN IF NOT EXISTS reviewed_by   UUID REFERENCES users(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ;

-- Backfill ครั้งเดียว (สำคัญ — ห้ามลืม): สินค้าที่มีอยู่แล้วบน production ทุกชิ้น is_active=true อยู่แล้ว
-- และไม่ได้ผ่าน review flow นี้มา ถ้าไม่ backfill จะกลายเป็น 'pending_review' ทั้งหมดทันทีที่ column
-- เพิ่มเข้ามา (default ชนกับของเก่า) ต้องรันครั้งเดียวตอน migration:
UPDATE products SET review_status = 'approved' WHERE is_active = true AND review_status = 'pending_review';
```
**หมายเหตุสำคัญเรื่อง `is_active`:** ไม่แก้ DB-level `DEFAULT` ของคอลัมน์นี้ (ยังเป็น `DEFAULT true` เหมือน
เดิม กันกระทบ insert path อื่นที่อาจมีในอนาคต) — การ "สินค้าใหม่ = `is_active=false` จนกว่า approve" ต้อง
ทำที่ **app layer**: แก้ `INSERT` ใน `routes/seller.js`'s `POST /products` (บรรทัด ~712 ปัจจุบัน) ให้ส่ง
`is_active=false` ตรงๆ ตอน insert (ยกเว้นร้านที่ `shops.auto_approve_products=true` → ส่ง `true` เหมือน
เดิม) — ไม่ใช่แก้ schema default เฉยๆ เพราะ `GET /api/products`/`GET /api/seller/products` (list ฝั่ง
seller เห็นสินค้าตัวเองทุกสถานะ) ต้องแก้คู่กันให้ query แยก `review_status` ให้ seller เห็น tab
pending/approved/rejected ของตัวเองได้ (ปัจจุบัน `GET /api/seller/products` ไม่ filter สถานะเลย)

---

## 5. API Flow

รวม endpoint ใหม่เข้า namespace `/api/shops` และ `/api/seller` เดิม **ไม่สร้าง `/api/admin/seller-applications`
namespace ใหม่** (สอดคล้องกับที่ระบบปัจจุบันให้ admin ใช้ route เดิมของ `/api/shops`, `/api/seller` ร่วมกับ
seller เสมอ คุมด้วย role check ข้างในแต่ละ route ไม่ใช่แยก path ตาม role)

**Seller Identity Split เพิ่ม endpoint ใหม่ทั้งชุดสำหรับ auth เอง** (namespace `/api/auth/seller`,
mount เฉพาะบน `server-seller.js` คู่ขนานกับ `/api/auth` เดิมที่ยังรับใช้ admin fallback อยู่ — ไม่ปนกัน):
`POST /request-otp`, `POST /verify-otp`, `POST /signup`, `POST /signin`, `POST /signin-otp`,
`POST /refresh`, `POST /logout`, `GET /me` — รายละเอียดเต็มดู `CLAUDE.md` §3/§5

| Method | Endpoint | สถานะ | คำอธิบาย |
|---|---|---|---|
| POST | `/api/shops/apply` | **แก้ของเดิม (2 รอบ)** | รอบแรก (2026-07-31) เคยอนุญาต `role='customer'` เรียกได้ด้วย — **ถูกแทนที่แล้ว**: ตอนนี้ gate ด้วย `requireSellerAccount` (ต้องมี `seller_accounts` session เท่านั้น ไม่รับ `users`-based role ใดๆ อีกต่อไป ทั้ง customer และ admin) DB unique constraint กันซ้ำยังอยู่ (ย้ายจาก `owner_user_id` เป็น `seller_account_id`) body รับ field เดิมทั้งหมดในหัวข้อ 4 ไม่เปลี่ยน |
| GET | `/api/shops/me` | **แก้ของเดิม** | คืน field ใหม่ทั้งหมด + `onboarding_checklist` + list จาก `seller_documents` — ใช้แทน `GET /api/seller/application/status` ที่ร่างแรกเสนอไว้ (ไม่ต้องมี endpoint คู่ขนาน เพราะ "ร้าน" กับ "ใบสมัคร" คือ record เดียวกันแล้ว) |
| PATCH | `/api/shops/me` | **แก้ของเดิม** | ขยาย field ที่รับ (ทุกคอลัมน์ใหม่ในหัวข้อ 4) — ยังคง "ไม่แตะ `status`" เหมือนเดิม |
| POST | `/api/shops/me/resubmit` | **ใหม่** | seller เรียกหลังแก้ไขเสร็จตอน `status IN ('rejected','needs_info')` → flip กลับเป็น `pending` — เป็น status-mutation จุดเดียวที่ seller ทำเองได้ (ข้อยกเว้นเดียวจากกฎ "status เป็น admin-only" — เหมือน pattern ที่ orders ให้ customer เรียก `POST /:id/cancel` เป็น action แยกจาก `PATCH` ทั่วไป) |
| POST | `/api/shops/me/documents` | **ใหม่** | อัปโหลดเอกสาร (ID/business license/tax) ผูกกับร้านตัวเอง — ต้องรอ private/signed-URL infra เสร็จก่อน (ดูหัวข้อ 2/4) |
| PATCH | `/api/shops/me/onboarding-checklist` | **ใหม่** | อัปเดต `onboarding_checklist` JSONB ทีละ key |
| GET | `/api/shops` | **ไม่เปลี่ยน** | admin list, `?status=` filter — ใช้ค่า status ใหม่ (`needs_info`) ได้ทันทีเพราะเป็น query param ธรรมดา |
| GET | `/api/shops/:id` | **ใหม่** | admin ดูรายละเอียดร้าน + `seller_documents` ของร้านนั้น — ร่างแรกลืมเพิ่ม endpoint นี้ ปัจจุบันไม่มีทางดูรายละเอียดร้านเดี่ยวๆเลย มีแต่ list กับ `/me` |
| PATCH | `/api/shops/:id` | **แก้ของเดิม** | เดิมรับแค่ `{status}` — ขยายรับ `rejection_reason` (คู่กับ `status='rejected'`), `info_requested_note` (คู่กับ `status='needs_info'`) — same-status guard เดิมยังอยู่ **`status='approved'` ไม่ทำ transaction คู่กับ `users` อีกต่อไป** (ดูหัวข้อ 2 "ถ้า Admin Approve" — Seller Identity Split ตัดขั้นตอนนี้ออกไปแล้ว) |
| GET | `/api/seller/products` | **แก้ของเดิม** | เพิ่ม `?review_status=` filter (ปัจจุบันไม่ filter อะไรเลย) ให้ seller เห็น tab pending/approved/rejected ของร้านตัวเอง, admin เห็นข้าม shop ได้เหมือนเดิม |
| POST | `/api/seller/products/:id/review` | **ใหม่, admin-only** | approve/reject สินค้า — set `review_status`, flip `is_active` ตาม, `reviewed_by`/`reviewed_at` — แทนที่ `GET /api/admin/products/pending-review` + `POST /api/admin/products/:id/approve` ของร่างแรก (รวมเป็น namespace เดียวกับ product CRUD ที่มีอยู่แล้วใน `/api/seller`) |

**Endpoint ที่ร่างแรกเสนอแล้ว "ตัดออก" ในเวอร์ชันนี้** (ไม่ต้องมีเพราะรวม concept เข้ากับของเดิมแล้ว):
`POST /api/seller/apply`, `GET /api/seller/application/status`, `PATCH /api/seller/application/resubmit`,
`GET /api/admin/seller-applications`, `GET /api/admin/seller-applications/:id`, `POST
/api/admin/seller-applications/:id/{approve,reject,request-info}`, `GET /api/seller/onboarding-checklist`
(รวมเข้า `GET /api/shops/me` แล้ว), `PATCH /api/seller/onboarding-checklist` (ย้ายไป
`/api/shops/me/onboarding-checklist`), `GET /api/admin/products/pending-review`

**`POST /api/seller/make-seller` — ลบออกจากโค้ดจริงแล้ว (2026-08-09)** เอกสาร revision ก่อนหน้านี้บอกว่า
"ไม่แตะ ไม่ลบ เผื่อกรณีพิเศษ" — **ไม่จริงแล้ว**: promote `users.role='seller'` ไม่มีความหมายอีกต่อไปเพราะ
seller ไม่เคยอยู่ใน `users` เลยตั้งแต่ Seller Identity Split

**Auth/permission:** self-serve routes (`/api/shops/apply`, `/me`, `/me/resubmit`, `/me/documents`,
`/me/branding`, `/me/onboarding-checklist`) ใช้ `requireAuth` + `requireSellerAccount`
(`middleware/auth.js`) — ต้องมี `seller_accounts` session เท่านั้น ไม่มี role อะไรให้เช็คอีกต่อไป admin-only
routes (`GET /`, `GET /:id`, `PATCH /:id`, auto-approve-products) ยังใช้ `requireRole('admin')` เดิม —
routes ที่ seller กับ admin ใช้ร่วมกัน (`/api/seller/*`, `/api/coupons/seller/*`) ใช้
`requireSellerOrAdmin` ใหม่ (เช็ค `seller_accounts` หรือ `users.role='admin'` แล้วแต่ claim `kind` ใน JWT)

---

## 6. Screen Flow — โดเมนไหนอยู่ที่ไหน

| หน้า | โดเมน | หมายเหตุ |
|---|---|---|
| Become a Seller (landing/CTA) | `bardskh.com`, `seller.bardskh.com` (`seller-landing.html`) | ปุ่ม "Start Selling" พาไป `/signup` ไม่ใช่ `/apply` ตรงๆ อีกต่อไป |
| **Signup / Signin (ใหม่)** | `seller.bardskh.com/signup`, `/signin` | **หน้าใหม่ทั้งคู่** — seller.bardskh.com มี auth ของตัวเองแล้ว ไม่พึ่ง `bardskh.com/signin` เหมือนหน้า dashboard อื่น |
| ฟอร์มสมัคร Step 1-5 (เดิมเรียก Step 1-6 — Step "Account" เดิมถูกย้ายไปเป็นหน้า signup/signin แยกแล้ว) | `seller.bardskh.com/apply` | auth guard: `SellerAuth.ensureSession()` — ต้องผ่าน signup/signin ของ seller.bardskh.com เองมาก่อนเสมอ |
| Seller Dashboard (pending/needs_info/rejected state) | `seller.bardskh.com` | โชว์ banner ตาม `shops.status`, ล็อกฟีเจอร์อื่นจนกว่า `approved` |
| Seller Dashboard (approved) | `seller.bardskh.com` | เหมือนเดิมทุกอย่าง (ไม่มีการเปลี่ยนพฤติกรรมหลัง approved) |
| Seller Applications list/detail | `admin.bardskh.com` | **ต่อยอดจาก `admin-shops.html` เดิม** ไม่ใช่หน้าใหม่แยก (ดูหัวข้อ 3) |
| Product pending review | `admin.bardskh.com` | เพจใหม่ หรือ tab เพิ่มใน `admin-shops.html`/หน้า product ที่มีอยู่ — เลือกตอน implement |

**ข้อควรระวัง (แก้ทั้งหมด 2026-08-09 — Seller Identity Split):** ย่อหน้าเดิมตรงนี้เคยบอกว่า
"`seller.bardskh.com` เช็ค role จาก cookie ที่แชร์ข้าม 3 โดเมน" — **ไม่จริงแล้ว โดยเจตนา** นี่คือ
ใจความหลักของ Seller Identity Split: `seller.bardskh.com` **ไม่รับ cookie ที่แชร์ข้ามโดเมนสำหรับ
customer เลย** (คุก host-only คนละคุกกี้ชื่อ `bards_seller_rt`) — ยกเว้น **admin** เท่านั้นที่ยัง auto-login
ข้ามโดเมนได้ตามเดิมผ่าน cookie ที่แชร์ (`bards_rt`, `Domain=.bardskh.com`) เพื่อให้ยังใช้ "Seller Hub" cross-
domain link จาก `admin.bardskh.com` ได้เหมือนเดิม — รายละเอียดกลไกแยกคุกกี้/ทำไม admin ยกเว้น ดู
`CLAUDE.md` §3

---

## 7. Notification Flow

ใช้ระบบที่มีอยู่แล้ว (Email + Telegram bot) — ปรับชื่อ event ให้ตรงกับ `shops.status` จริง:

| Event | ช่องทาง |
|---|---|
| Submit application (`status→pending`) | Email confirmation ถึง seller |
| Needs info (`status→needs_info`) | Email + Telegram |
| Rejected (`status→rejected`) | Email + Telegram |
| Approved (`status→approved`) | Email + Telegram (welcome message) — ไม่มี "role flip" อีกต่อไป |
| Product `review_status='pending_review'` ค้าง > 24h | Telegram ถึง admin (reminder) |

---

## 8. Edge Cases ที่ต้องคิดให้ครบก่อน implement

1. **Store slug ชนกัน** — validate unique ตอน submit (`idx_shops_store_slug`), เสนอ slug ใกล้เคียงถ้าซ้ำ
2. **~~User เดิมมี 2 role พร้อมกัน~~ ไม่เกิดขึ้นเลยตั้งแต่ต้น (Seller Identity Split, 2026-08-09)** —
   revision ก่อนหน้าแก้ปัญหานี้ด้วย "user ยังเป็น `role='customer'` ตลอดช่วงสมัคร แล้ว role พลิกเป็น
   `seller` ตอน approved" ซึ่งใช้ได้จริงตอนนั้น — **ตอนนี้ปัญหานี้หายไปเองทั้งหมด** เพราะ seller ไม่เคยแตะ
   `users`/`role` เลยตั้งแต่ signup ไม่มี dual-role หรือ role-flip ให้ต้องจัดการอีกต่อไป
3. **Reject แล้ว resubmit หลายรอบ** — overwrite ข้อมูลเดิมใน `shops` (ไม่เก็บ history versioning ในเอกสาร
   นี้ — ถ้าต้องการ audit log ของการเปลี่ยนแปลงแต่ละรอบ ต้องคุย scope เพิ่มแยก ไม่ได้อยู่ในแผนตอนนี้)
4. **เอกสารอัปโหลดผิดไฟล์ (ไม่ใช่รูป/PDF)** — validate file type/size ก่อนอัป R2 (รอ signed-URL infra
   เสร็จก่อนถึงจะ implement route นี้ได้จริง)
5. **Seller ปิด tab กลางฟอร์ม 6 step** — save แต่ละ step ลง `shops` row ตรงๆ ทันที (ไม่ใช่ draft table
   แยก) เพราะ `PATCH /api/shops/me` เป็น partial update อยู่แล้ว — กลับมาทำต่อได้โดย `GET /api/shops/me`
   คืนค่าที่กรอกไปแล้วบางส่วน
6. **Auto-approve product เปิดแล้วแต่สินค้ามีปัญหา** — ต้องมีทาง flag/takedown สินค้าย้อนหลังได้ (นอก
   scope เอกสารนี้ — ใช้ `PATCH /api/seller/products/:id`'s `is_active` ที่มีอยู่แล้วได้เป็น manual
   takedown ไปก่อน)
7. **Admin approve แล้วแต่สร้าง store ซ้ำ (race condition)** — **แก้ไปแล้วโดยธรรมชาติของการตัดสินใจข้อ 1**:
   ไม่มี "สร้าง store ใหม่" ตอน approve อีกต่อไป (`shops.id` มีอยู่แล้วตั้งแต่ apply) — revision ก่อนหน้านี้
   (2026-07-31) เหลือ race ระหว่าง `UPDATE shops.status` กับ `UPDATE users.role` สองคำสั่ง แก้ด้วยการทำใน
   ทรานแซกชันเดียว **Seller Identity Split (2026-08-09) ตัด `UPDATE users.role` ออกไปเลย** เหลือ
   `UPDATE shops.status` คำสั่งเดียว ไม่มี race ระหว่าง 2 ตารางให้ต้องกังวลอีกต่อไป

---

## 9. สิ่งที่ยังไม่รวมใน Blueprint นี้ (Scope ถัดไป)

- Commission/GP calculation logic (module "Payment & Settlement" แยก)
- Seller suspend/violation workflow (schema `shops.status='suspended'` มีอยู่แล้ว แต่ flow/UI ยังไม่ออกแบบ)
- Multi-warehouse ต่อร้าน
- Seller analytics dashboard เชิงลึก
- Shipping/Return Address/Warehouse/Courier ก่อน publish สินค้าชิ้นแรก (พูดถึงในหัวข้อ 2 แต่ schema/route
  ยังไม่ได้ออกแบบในเอกสารนี้)
- R2 signed URL / private bucket infrastructure — **prerequisite ของ Step 4 (เอกสาร)** แต่เป็นงานแยกเป็น
  ของตัวเอง ไม่ใช่ส่วนหนึ่งของ seller-onboarding logic โดยตรง

---

## 10. ลำดับ Implementation ที่แนะนำ (เมื่อ approve blueprint แล้ว)

1. **R2 signed URL / private bucket infra** — ทำก่อนสุดเพราะ Step 4 (เอกสาร) และ `seller_documents`
   table รอสิ่งนี้อยู่ ถ้าไม่ทำก่อนจะ block งานข้อ 4-5 ด้านล่าง
2. DB migration: ขยาย `shops` (คอลัมน์ใหม่ทั้งหมดในหัวข้อ 4), `seller_documents` table, `products`
   (`review_status`,`reviewed_by`,`reviewed_at` + backfill `review_status='approved'` ให้สินค้าเก่า)
3. Backend API: `POST /api/shops/apply` (เปิดรับ `customer`), `POST /api/shops/me/resubmit`, `GET
   /api/shops/:id`, ขยาย `PATCH /api/shops/:id` (role-flip transaction), ขยาย `PATCH /api/shops/me`
4. Backend API: `POST /api/shops/me/documents` (รอข้อ 1 เสร็จ)
5. Frontend: ฟอร์มสมัคร 6 step บน `seller.bardskh.com/apply` + auth guard แบบใหม่ (เช็ค shop record ไม่ใช่
   role ล้วนๆ)
6. Frontend: ต่อยอด `admin-shops.html` ให้รองรับ tab/field ใหม่ (`needs_info`, เอกสาร, detail view)
7. Onboarding checklist UI + progress bar (`shops.onboarding_checklist`)
8. Product review flow: แก้ `POST /api/seller/products` (`is_active=false` default), เพิ่ม `?review_status=`
   filter ใน `GET /api/seller/products`, เพิ่ม `POST /api/seller/products/:id/review`
9. Notification hooks (Email/Telegram) ทุกจุดเปลี่ยน `shops.status`
10. Auto-approve product flag (`shops.auto_approve_products`) — เปิดทีหลังเมื่อร้านมี track record

---

*เอกสารนี้เป็น design doc — revision นี้แก้ตามการตัดสินใจหลัง review รอบแรกแล้ว รอ review รอบสุดท้ายก่อนเริ่ม implement จริง*
