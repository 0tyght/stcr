# STCR Express Backend

Backend หลักของ STCR ทำงานด้วย Express บน Node.js และรับ MQTT ผ่าน `mqtt.js`
โดยไม่ต้องเปิด Node-RED

เส้นทางหลัก:

- API: `http://127.0.0.1:3001/stcr/api`
- Health: `http://127.0.0.1:3001/healthz`

ช่วงย้ายระบบ โค้ด business logic เดิมถูกเก็บใน `src/legacy-functions` และเรียกผ่าน
Express compatibility runtime เพื่อรักษาสัญญา API และพฤติกรรมฐานข้อมูลเดิมทั้งหมด
Node-RED ไม่ได้เป็น runtime หรือ dependency ของระบบอีกต่อไป
