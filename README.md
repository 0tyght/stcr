# STCR

เว็บควบคุมและรายงานอุณหภูมิเตาอบสำหรับ Grand Rubber และ TTN พัฒนาด้วย React, TypeScript, Express, MQTT.js และ MariaDB

ระบบใช้ข้อมูลจริงจาก Express API เท่านั้น ไม่มีแหล่งข้อมูลทดแทนในฝั่งเว็บ หากฐานข้อมูลหรืออุปกรณ์ไม่ส่งข้อมูล เว็บไซต์จะแสดงสถานะขาดการเชื่อมต่อตามจริง

## เริ่มต้นพัฒนา

```bash
npm install
npm run node-red:build
npm run node-red:validate
npm run dev
```

เว็บเรียก API ที่ `http://127.0.0.1:3001/stcr/api` เป็นค่าเริ่มต้น และสามารถกำหนด `VITE_API_BASE_URL` ได้จาก environment

## การรับข้อมูลจริง

ข้อมูล TTN เข้าทาง MQTT Topic `test` และ `sensor` แล้วผ่านขั้นตอน:

```text
เครื่องโรงงาน → MQTT Broker → Express/MQTT.js → STCR API → MariaDB → เว็บไซต์
```

ค่าความลับทั้งหมด เช่น MQTT password, API key และรหัสฐานข้อมูล ต้องเก็บใน environment เท่านั้น ห้ามบันทึกลง Git ดูตัวอย่างที่ [deploy/ubuntu/stcr.env.example](deploy/ubuntu/stcr.env.example)

## คำสั่งสำคัญ

- `npm run build` ตรวจ TypeScript และสร้างเว็บ
- `npm run node-red:build` สร้าง Flow จริง
- `npm run node-red:validate` ตรวจสัญญาข้อมูล MQTT และ API
- `npm run production:preflight` ตรวจค่าก่อนขึ้น Ubuntu
- `npm run public:start` เปิดเว็บทดสอบสาธารณะโดยรับข้อมูลจริง
- `npm run public:stop` ปิดบริการทดสอบ

รายละเอียด Backend อยู่ที่ [backend/README.md](backend/README.md) และขั้นตอนความปลอดภัยอยู่ที่ [docs/security-deployment.md](docs/security-deployment.md)

## Backend Express

ระบบหลังบ้านทำงานที่พอร์ต 3001 และรับ MQTT ด้วย mqtt.js โดยไม่ต้องเปิด Node-RED

```bash
npm install
npm run dev
```

ดูรายละเอียดที่ [docs/express-migration.md](docs/express-migration.md)
## Production Check

ก่อน Deploy ให้เปิด MariaDB และรัน:

```bash
npm run production:check
```

Production ใช้ API แบบ Same Origin ที่ `/stcr/api`, มี `/healthz` สำหรับ Liveness และ `/readyz` สำหรับตรวจฐานข้อมูล/MQTT ดูขั้นตอนที่ [docs/production-deployment.md](docs/production-deployment.md).
