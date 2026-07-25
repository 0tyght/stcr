# STCR Security Deployment Checklist

ระบบหลังบ้านใช้ Express + MQTT.js และ MariaDB โดยตรง ไม่ต้องเปิด Node-RED.

ก่อนเปิดใช้งานจริง:

1. ใช้ HTTPS และ Reverse Proxy แบบ Same Origin.
2. ให้ Express bind ที่ `127.0.0.1:3001`; ห้ามเปิดพอร์ตนี้สู่ Internet โดยตรง.
3. กำหนด `STCR_ALLOWED_ORIGINS` เป็น Domain จริงเท่านั้น.
4. ใช้ MariaDB account เฉพาะระบบและสิทธิ์เท่าที่จำเป็น ห้ามใช้ `root`.
5. ใช้ MQTT TLS, credentials เฉพาะระบบ และ ACL จำกัด Topic.
6. ตั้ง `STCR_API_KEY_PEPPER` อย่างน้อย 32 ตัวอักษรและเก็บนอก Git.
7. ปิด retained sensor payload เว้นแต่ตรวจสอบวงจรข้อมูลแล้ว.
8. ให้ `npm run production:check` ผ่านก่อน Deploy ทุกครั้ง.
9. ตรวจ `/healthz`, `/readyz`, systemd restart และ log หลัง Deploy.
10. ทำ Backup และ Restore drill ก่อนถือระบบเป็นแหล่งข้อมูลหลัก.

รายละเอียดคำสั่งอยู่ใน `docs/production-deployment.md`.


## React Router security

Frontend ใช้ `react-router` 8.3.0 โดยตรง และไม่ใช้ `react-router-dom` 7.x เพื่อรับแพตช์ GHSA-qwww-vcr4-c8h2 โดยไม่ปิดการตรวจ `npm audit`.
