# BARDS Marketplace — Shop Profile Page & Follow System Blueprint

**สถานะ:** Design Doc — รอ Claude Code สำรวจโค้ดเดิมก่อน implement จริง
**เป้าหมาย:** สร้างหน้าโปรไฟล์ร้านค้า (storefront) ที่โชว์สินค้าทั้งหมดของร้าน พร้อมระบบติดตามร้านจริง (follow/unfollow) ตามมาตรฐาน TikTok Shop / Shopee / Lazada

---

## 1. ภาพรวม

หน้านี้คือหน้าที่ลูกค้าเห็นเมื่อคลิกเข้าไปดูร้านค้าใดร้านหนึ่ง (เช่นคลิกชื่อร้านจากหน้าสินค้า หรือค้นหาร้านโดยตรง) ต้องให้ความรู้สึกเหมือนเข้า "หน้าร้าน" ของผู้ขายรายนั้น ไม่ใช่แค่ list สินค้าธรรมดา

**อ้างอิงจากแพลตฟอร์มใหญ่:**
- **Shopee/Lazada**: Header ร้านมีโลโก้ + ชื่อร้าน + สถิติ (ผู้ติดตาม, สินค้า, การให้คะแนน, อัตราตอบกลับ) + ปุ่ม Follow เด่นชัด + ปุ่ม Chat
- **TikTok Shop**: เน้นภาพ/วิดีโอปกร้านใหญ่ + badge ความน่าเชื่อถือ (เช่น "Verified", "Mall") + แท็บสินค้า/รีวิว/เกี่ยวกับร้าน

---

## 2. URL Structure

```
bardskh.com/shop/{store_slug}
```

ใช้ `shops.store_slug` ที่มีอยู่แล้ว (จาก Seller Onboarding module) — ไม่ต้องสร้างระบบ slug ใหม่ ตรงกับ Clean URL convention ที่ทำไปแล้ว (ไม่มี `.html` ต่อท้าย)

---

## 3. โครงหน้า (Layout)

### 3.1 Shop Header (ส่วนบนสุด)
- **Cover banner** — ใช้ `shops.cover_url` ที่มีอยู่แล้ว
- **โลโก้ร้าน** — ใช้ `shops.logo_url` (หรือ field เทียบเท่าที่มีอยู่)
- **ชื่อร้าน** — `shops.store_name`
- **Badge สถานะร้าน** (ถ้ามี track record ดี เช่น `auto_approve_products=true` อาจโชว์ badge "Trusted Seller" — เป็น idea เสริม ไม่บังคับ)
- **สถิติร้าน** (แถวเดียวกัน):
  - จำนวนผู้ติดตาม (follower count)
  - จำนวนสินค้าทั้งหมด
  - คะแนนรีวิวเฉลี่ย (ถ้ามีระบบรีวิวอยู่แล้ว — ต้องเช็คก่อนว่ามีหรือไม่)
  - วันที่เข้าร่วม (`shops.created_at` หรือ `shops.approved_at`)
- **ปุ่ม Follow / Following** — ปุ่มหลัก เด่นชัด (ดูรายละเอียดหัวข้อ 5)
- **ปุ่ม Chat/ติดต่อร้าน** — ถ้ามีระบบแชทอยู่แล้วให้ลิงก์ไป ถ้ายังไม่มีให้ทำเป็น placeholder/ปุ่มที่ยังไม่ทำงาน (out of scope รอบนี้)

### 3.2 แท็บเนื้อหา
- **สินค้าทั้งหมด** (default tab) — grid สินค้าของร้าน พร้อม sort (ล่าสุด/ขายดี/ราคา) และ filter หมวดหมู่ภายในร้าน
- **หมวดหมู่** — ถ้าร้านมีสินค้าหลายหมวด แสดงเป็น chip ให้กรองได้
- **เกี่ยวกับร้าน** (About) — คำอธิบายร้าน (`shops.description`), นโยบายจัดส่ง/คืนสินค้าถ้ามี
- **รีวิว** — ถ้ามีระบบรีวิวสินค้าอยู่แล้วในระบบ ให้รวมมาโชว์ระดับร้าน (out of scope ถ้ายังไม่มีระบบรีวิวเลย ต้องเช็คก่อน)

### 3.3 Empty state
ถ้าร้านยังไม่มีสินค้าเลย (เช่น เพิ่ง approve ใหม่) ต้องมีข้อความที่เหมาะสม ไม่ใช่หน้าว่างเปล่า

---

## 4. Skeleton Loading

ตามมาตรฐานที่เพิ่งทำกับหน้า `account.html` — หน้านี้ก็ควรมี skeleton loading ตั้งแต่แรกเช่นกัน (ฝังใน static HTML ไม่พึ่ง JS) เพราะโหลดข้อมูลจาก API เหมือนกัน

---

## 5. ระบบ Follow — ออกแบบทางเทคนิค

### 5.1 หลักการ "ติดตามจริง"
ต้องเป็นระบบที่:
- Persist จริงใน DB (ไม่ใช่ localStorage หรือ fake counter)
- นับจำนวนผู้ติดตามจริงจากข้อมูลจริง ไม่ใช่เลขปลอม
- ต้อง login ก่อนถึงจะกดติดตามได้ (ถ้ายังไม่ login ให้ redirect ไป signin พร้อม `?redirect=/shop/{slug}` ตาม pattern ที่ใช้อยู่ทั่วเว็บ)
- Toggle ได้ (follow ↔ unfollow) แบบ real-time ไม่ต้อง reload หน้า

### 5.2 Database — ตารางใหม่

```sql
CREATE TABLE IF NOT EXISTS shop_follows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id    UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, shop_id)  -- กันติดตามซ้ำ
);
CREATE INDEX IF NOT EXISTS idx_shop_follows_shop ON shop_follows(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_follows_user ON shop_follows(user_id);
```

**เรื่องนับจำนวนผู้ติดตาม** — มี 2 แนวทาง ต้องตัดสินใจร่วมกับ Claude Code หลังสำรวจ scale ของระบบ:
- **แบบง่าย**: `COUNT(*) FROM shop_follows WHERE shop_id=X` ทุกครั้งที่ต้องโชว์ตัวเลข — ง่าย ถูกต้องเสมอ แต่ช้าลงถ้าร้านมีผู้ติดตามเยอะมากในอนาคต
- **แบบ cached column**: เพิ่ม `shops.follower_count` แล้ว increment/decrement ตอน follow/unfollow ในทรานแซกชันเดียวกัน — เร็วกว่า แต่เสี่ยงข้อมูลเพี้ยนถ้ามี edge case ไหนพลาด

แนะนำ**เริ่มจากแบบ COUNT(*) ก่อน** เพราะระบบยังเล็ก (ไม่มีลูกค้าจริงตามที่แจ้งไว้) ง่ายกว่าและถูกต้อง 100% เสมอ — ค่อยเปลี่ยนเป็น cached column ทีหลังถ้าพบว่าช้าจริง

### 5.3 API Endpoints

| Method | Endpoint | คำอธิบาย |
|---|---|---|
| POST | `/api/shops/:id/follow` | ติดตามร้าน (ต้อง login) — insert `shop_follows`, กัน insert ซ้ำด้วย UNIQUE constraint |
| DELETE | `/api/shops/:id/follow` | เลิกติดตาม — ลบ row ออก |
| GET | `/api/shops/:id/follow-status` | เช็คว่า user ปัจจุบัน follow ร้านนี้อยู่ไหม (ใช้ตอนโหลดหน้าเพื่อโชว์ปุ่ม Follow/Following ให้ถูก) |
| GET | `/api/shops/:id` | (มีอยู่แล้วจาก Seller Onboarding) ควรขยายให้คืน `follower_count` ด้วย |
| GET | `/api/shops/:id/products` | สินค้าทั้งหมดของร้าน (เช็คว่ามี endpoint แบบนี้อยู่แล้วหรือยัง — อาจมีอยู่ใน `/api/products?shop_id=X` แล้วก็ได้) |

### 5.4 Edge Cases
1. **เจ้าของร้านเข้าดูร้านตัวเอง** — ไม่ควรเห็นปุ่ม Follow (จะติดตามร้านตัวเองทำไม) ให้โชว์ปุ่ม "แก้ไขร้าน" แทนถ้าเป็นเจ้าของ
2. **กด Follow ตอนยังไม่ login** — redirect ไป signin พร้อม redirect กลับมาหน้าเดิม
3. **กด Follow รัวๆ เร็วๆ (double-click)** — ต้อง debounce ฝั่ง frontend + UNIQUE constraint ฝั่ง DB กันซ้ำอยู่แล้วเป็น safety net
4. **ร้านถูก suspend หลังมีคน follow ไปแล้ว** — `shop_follows` ควรคงอยู่ (ไม่ auto-delete) เผื่อร้านกลับมา active ใหม่

---

## 6. สิ่งที่ต้องให้ Claude Code สำรวจก่อน (สำคัญมาก)

ก่อน implement จริง ต้องเช็คให้ชัดว่า:
1. **มี route/หน้าโปรไฟล์ร้านอยู่แล้วบางส่วนไหม** — เช่นอาจมี `/shop/:slug` หรือคล้ายๆ อยู่แล้วจาก Phase 4 (multi-vendor shop architecture) ที่ทำไปก่อนหน้า
2. **API endpoint สินค้าตามร้านมีอยู่แล้วหรือยัง** — เช็ค `routes/products.js` หรือเทียบเท่า
3. **มีระบบรีวิวสินค้าอยู่แล้วไหม** — ถ้าไม่มีเลย ต้องตัด tab "รีวิว" ออกจาก scope รอบนี้
4. **`shops` table มี column `logo_url` แยกจาก `cover_url` ไหม** — ต้องเช็ค schema จริงจาก `db.js` เพราะ blueprint นี้เขียนจากความเข้าใจ ไม่ใช่จากโค้ดจริง
5. **หน้าแสดงสินค้าที่มีอยู่แล้ว (เช่น product listing patterns) ใช้ pattern ไหน** — จะได้ reuse component/style เดิมแทนเขียนใหม่

---

## 7. ลำดับ Implementation ที่แนะนำ

1. สำรวจโค้ดเดิมตามหัวข้อ 6 ก่อนทุกอย่าง
2. DB migration: `shop_follows` table
3. Backend API: follow/unfollow/follow-status endpoints
4. Backend API: ขยาย `GET /api/shops/:id` ให้คืน follower_count + product count
5. Frontend: หน้า shop profile page ใหม่ (พร้อม skeleton loading ตั้งแต่ต้น)
6. Frontend: ปุ่ม Follow/Following แบบ toggle real-time
7. เชื่อมลิงก์จากหน้าสินค้า/หน้าอื่นๆ ที่ควรลิงก์ไปหน้าโปรไฟล์ร้าน (เช่น คลิกชื่อร้านจากการ์ดสินค้า)
8. ทดสอบ edge cases ทั้งหมดในหัวข้อ 5.4

---

## 8. นอกขอบเขตรอบนี้ (Scope ถัดไป)

- ระบบแชทกับร้าน (Chat)
- ระบบรีวิวสินค้า/ร้าน (ถ้ายังไม่มีอยู่แล้ว)
- Notification เมื่อร้านที่ follow อยู่มีสินค้าใหม่/โปรโมชั่น
- Badge/verification system สำหรับร้าน

---

*เอกสารนี้เป็น design doc เบื้องต้น — ต้องให้ Claude Code สำรวจโค้ดจริงตามหัวข้อ 6 ก่อน แล้วปรับแผนให้ตรงกับสภาพจริงของระบบ ก่อนเริ่ม implement*
