# STCR Production Deployment

โค้ด Production ต้องผ่านคำสั่งต่อไปนี้ก่อน Deploy:

```bash
npm ci
npm run production:check
```

## Ubuntu

1. Build frontend แล้วคัดลอก `dist/` ไป `/var/www/stcr`.
2. คัดลอกโปรเจกต์ Backend ไป `/opt/stcr` และให้ผู้ใช้ `stcr` อ่านได้.
3. สร้าง `/opt/stcr/output` และให้ผู้ใช้ `stcr` เขียนได้.
4. คัดลอก `deploy/ubuntu/stcr.env.example` ไป `/etc/stcr/stcr.env`, เปลี่ยนค่าตัวอย่างทั้งหมด และกำหนดสิทธิ์ `0600`.
5. ติดตั้ง `deploy/ubuntu/stcr-express.service` เป็น `/etc/systemd/system/stcr-express.service`.
6. แก้ Domain และ Certificate ใน `deploy/ubuntu/nginx-stcr.conf`, ทดสอบด้วย `nginx -t` แล้วเปิดใช้งาน.
7. เปิด Service และตรวจทั้ง Liveness กับ Readiness.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stcr-express.service
curl http://127.0.0.1:3001/healthz
curl http://127.0.0.1:3001/readyz
sudo journalctl -u stcr-express.service -f
```

`healthz` บอกว่า Process ยังทำงาน ส่วน `readyz` จะคืน HTTP 200 เมื่อฐานข้อมูลพร้อม และ MQTT เชื่อมต่อสำเร็จในกรณีที่เปิด MQTT.

## ข้อกำหนดก่อนใช้เป็นข้อมูลจริงของโรงงาน

- MariaDB ต้องใช้บัญชีเฉพาะของระบบ ไม่ใช้ `root`.
- API ต้องเปิดผ่าน HTTPS และ Nginx เท่านั้น โดย Express bind ที่ `127.0.0.1`.
- MQTT ควรใช้ TLS, บัญชีเฉพาะระบบ และ ACL จำกัด Topic.
- ทดสอบ Mapping เตา GR/TTN, รอบการอบ, เวลาอุปกรณ์ และ Alarm กับข้อมูลจากเครื่องจริง.
- ตั้ง Backup รายวัน พร้อมทดสอบ Restore แยกฐานข้อมูล.
- เก็บ `.env`, MQTT credentials, API pepper และ TLS keys นอก Git.
