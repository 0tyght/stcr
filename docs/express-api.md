# STCR Express API

Backend ทำงานด้วย Express บน Node.js และให้บริการ API ที่ `/stcr/api` โดยค่าเริ่มต้นฟังที่ `127.0.0.1:3001`

## คำสั่ง

```bash
npm run dev
npm run start
npm run backend:check
npm run backend:preflight
```

## เส้นทางตรวจสุขภาพ

- `GET /healthz` ตรวจ process, MQTT และ runtime memory โดยไม่บังคับเชื่อมฐานข้อมูล
- `GET /stcr/api/health` ตรวจ API และโหลดสถานะจริงจาก MariaDB

## โครงสร้าง

- `backend/src/http` รับ HTTP และส่งผลลัพธ์กลับแบบเดิม
- `backend/src/mqtt` เชื่อม MQTT ด้วย `mqtt.js`
- `backend/src/runtime` จัดการ state และ compatibility runtime
- `backend/src/legacy-functions` เก็บ business logic เดิมระหว่างการย้าย เพื่อรักษา API และฐานข้อมูลเดิม
- `backend/tools` เครื่องมือสร้างผู้ใช้ รหัสผ่าน และ API key

ข้อมูลลับต้องอยู่ใน `.env` หรือ environment ของระบบเท่านั้น ห้ามใส่ใน Frontend หรือ Commit ลง Git
