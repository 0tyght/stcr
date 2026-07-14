# Smoking Temperature Control Report

เว็บควบคุมและรายงานอุณหภูมิเตาอบ พัฒนาด้วย React, TypeScript และ Vite โดยแยก UI ออกจากแหล่งข้อมูลเพื่อให้สลับระหว่างข้อมูลจำลองกับ Node-RED ได้ด้วย environment config

## เริ่มใช้งาน

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

ค่าเริ่มต้นใช้ `VITE_DATA_SOURCE=mock` จึงเปิดระบบได้โดยไม่ต้องมี Node-RED

## เชื่อมต่อ Node-RED

แก้ `.env.local`:

```env
VITE_DATA_SOURCE=node-red
VITE_API_BASE_URL=http://127.0.0.1:1880/stcr/api
VITE_REALTIME_POLL_INTERVAL_MS=7000
VITE_API_TIMEOUT_MS=10000
```

จากนั้น restart dev server ทุกครั้งที่แก้ environment variable รายละเอียด endpoint และ payload อยู่ที่ [docs/node-red-api.md](docs/node-red-api.md)

มี Node-RED simulator พร้อม import อยู่ใน [node-red/README.md](node-red/README.md)

หลักการจำลอง thermal lag, เวลาเริ่มรายงาน และแหล่งอ้างอิงอยู่ใน [docs/simulation-model.md](docs/simulation-model.md) ส่วน schema ฐานข้อมูลอยู่ใน [database/README.md](database/README.md)

โครงสร้าง telemetry แบบ IoT และวิธีเปลี่ยน simulator เป็น MQTT/PLC จริงอยู่ใน [docs/node-red-iot-workflow.md](docs/node-red-iot-workflow.md)

การเพิ่มบริษัท โลโก้ บัญชีและธีมใหม่ ดูที่ [docs/adding-company.md](docs/adding-company.md)

## คำสั่งหลัก

```powershell
npm run typecheck
npm run build
npm run preview
npm run node-red:build
```

## โครงสร้างข้อมูล

- `src/config` อ่านและตรวจ runtime environment
- `src/services/api` สัญญา API, HTTP client และ Node-RED adapter
- `src/services/mockApi.ts` adapter ข้อมูลจำลองสำหรับพัฒนา UI
- `src/app/providers.tsx` state ส่วนกลาง, polling, retry และ connection error
- `src/types` domain types ที่ UI และ adapter ใช้ร่วมกัน
- `src/pages` หน้าจอระดับ route
- `src/components` UI และกราฟที่นำกลับมาใช้ซ้ำ
- `src/data` factory สำหรับข้อมูลจำลองเท่านั้น
- `src/utils` business rules ที่ไม่ขึ้นกับ React

## การ deploy

GitHub Actions จะ build และ deploy GitHub Pages เมื่อ push เข้า `main` สำหรับระบบโรงงานจริงควรเสิร์ฟ frontend และ Node-RED ผ่าน HTTPS host เดียวกัน หรือกำหนด CORS ที่ Node-RED ให้ยอมรับ origin ของ frontend

ห้าม commit `.env` หรือ `.env.local` ที่มี URL/credential ภายในโรงงาน
