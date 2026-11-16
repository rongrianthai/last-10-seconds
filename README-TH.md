# LAST FLOOR V16.4 – TikTok Relay (Render)

ชุดนี้เป็น **backend** ที่เขียนให้เข้ากับไฟล์ `last_floor_v16_4_200_questions.html` ใน GitHub `rongrianthai/last-10-seconds` โดยตรง ไม่ต้องแก้ไฟล์ HTML เดิม

## โค้ดทำอะไร

- `GET /health`: ตรวจสอบว่าเซิร์ฟเวอร์ทำงาน
- `GET /api/status`: รายงานการเชื่อม TikTok (ต้องใช้รหัสลับ)
- `GET /api/comments?after=N`: คืนคอมเมนต์ที่ใหม่กว่า cursor N (ต้องใช้รหัสลับ)
- `POST /api/test-comment`: ส่งคอมเมนต์ทดสอบเมื่อเปิด `ENABLE_TEST_ENDPOINT=1` (ต้องใช้รหัสลับ)
- ใช้ `tiktok-live-connector` อ่านคอมเมนต์จาก TikTok LIVE แบบไม่เป็นทางการ และคัดเฉพาะ **เล่น**, **1**, **2** ให้ตรงกับตัวเกม V16.4
- ไม่เก็บข้อความถาวร ไม่เก็บรหัส TikTok ไม่บันทึกข้อความลง log

## ขั้นตอนอัปโหลด GitHub

1. แตก ZIP แล้วอัปโหลด `package.json`, `server.mjs`, `relay-core.mjs` ไปที่ **root** ของ Repository `rongrianthai/last-10-seconds` โดยไม่ลบไฟล์ HTML เกม
2. ใน Render เลือก Repository `rongrianthai/last-10-seconds` เพื่อสร้าง **Web Service**
3. ตั้งค่า:
   - Language: `Node`
   - Branch: `main`
   - Root Directory: เว้นว่าง
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free (สำหรับทดสอบ; ไม่เหมาะกับไลฟ์ที่ต้องเสถียร)
4. ใน Render > Environment กำหนดค่าดังนี้ **ไม่ใส่รหัสใน GitHub**:
   - `LIVE_ROOM_TOKEN` = ตั้งรหัสสุ่มลับอย่างน้อย 24 ตัวอักษร ใช้เฉพาะบอสคนเดียว
   - `ENABLE_TEST_ENDPOINT` = `1` (ช่วงทดสอบ; กลับเป็น `0` หลังเสร็จ)
   - `TIKTOK_USERNAME` = เว้นว่างในรอบทดสอบด้วยข้อความจำลอง; ภายหลังใส่ชื่อบัญชี LIVE จริงโดยไม่ใส่ `@`
   - `ALLOWED_ORIGINS` = `https://rongrianthai.github.io` (หรือโดเมนที่ใช้เปิดเกม)
5. เมื่อ Render ขึ้นสถานะ Live จะได้ URL เช่น `https://ชื่อ-service.onrender.com`

## ทดสอบผ่านเกม V16.4

1. เปิด URL หน้า `last_floor_v16_4_200_questions.html` แบบ **หน้าแผงควบคุม** ไม่ใช่ `?view=live`
2. มองหากรอบ **📡 TikTok LIVE — รับคอมเมนต์จริง**
3. ในช่องที่อยู่เซิร์ฟเวอร์ ใส่ `https://ชื่อ-service.onrender.com`
4. ในช่องรหัสลับ ใส่ค่าที่ตั้งเป็น `LIVE_ROOM_TOKEN` บน Render (ห้ามส่งรหัสนี้ให้ผู้อื่น)
5. กด **เชื่อมต่อ LIVE** — ถ้ายังไม่ใส่ `TIKTOK_USERNAME` จะขึ้นว่าเชื่อมเซิร์ฟเวอร์แล้ว แต่ยังไม่มี LIVE ถือว่าปกติ
6. เปิด **🧪 ทดสอบส่งคอมเมนต์ผ่านเซิร์ฟเวอร์** แล้วกด `🎮 ส่ง เล่น` ในช่วง Lobby
7. ให้ตรวจชื่อผู้ทดสอบว่าปรากฏในตัวละคร; กด **เริ่มการแข่งขัน** และลองกด `ส่ง 1` หรือ `ส่ง 2` ภายในช่วงเปิดโหวต
8. หลังทดสอบ ตั้ง `ENABLE_TEST_ENDPOINT=0`; ใส่ `TIKTOK_USERNAME` ที่กำลังไลฟ์ แล้ว Deploy ใหม่เพื่อทดลองข้อความจาก TikTok จริง

## ข้อควรระวัง

- ห้ามใส่ `LIVE_ROOM_TOKEN` ลงในไฟล์หรือ Repository ที่เป็น Public
- ชื่อบัญชี TikTok ต้องอยู่ระหว่าง LIVE จึงทดสอบคอมเมนต์จริงได้
- ไลบรารี TikTok LIVE นี้ไม่เป็นทางการ อาจเปลี่ยนแปลง/ถูกจำกัด/ใช้ไม่ได้
- Render Free จะพักเมื่อไม่มี HTTP ขาเข้าเป็นเวลา 15 นาที (โดยทั่วไป); หน้าเกมควรเปิดแผงควบคุมก่อนเริ่มไลฟ์
- หน้า `?view=live` ใช้ซิงก์ข้อมูลกับแผงควบคุมผ่านเบราว์เซอร์/ออริจินเดียวกัน ควรเปิดจากเครื่องเดียวกันก่อนทดสอบจริง
- โปรแกรมนี้ยังไม่มีระบบบันทึกสถานะถาวรหรือรับประกันความเสถียรในไลฟ์ใหญ่

## ทดสอบโลคัล (สำหรับผู้ใช้ Node.js)

```bash
npm install
LIVE_ROOM_TOKEN='local-only-secret-1234567890-ABCDEFG' ENABLE_TEST_ENDPOINT=1 npm start
npm test
```
