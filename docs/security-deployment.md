# STCR Security Deployment Checklist

สถานะ Production ยังคงต้องผ่านรายการใน `production-readiness.md` ก่อนใช้เป็นแหล่งข้อมูลหลักของโรงงาน

## ก่อนเปิดใช้งานจริง

1. วางเว็บไซต์และ Express หลัง HTTPS บน Origin เดียวกัน และให้ Nginx Proxy `/stcr/api/` ไป `127.0.0.1:3001`
2. กำหนด `STCR_ALLOWED_ORIGINS` แบบเจาะจง ห้ามใช้ `*`
3. สร้างผู้ใช้ด้วย `node backend/tools/create-user.mjs` และเก็บเฉพาะ Argon2id hash ใน MariaDB
4. ใช้บัญชี MariaDB แบบ Least privilege ห้ามใช้ root เป็นบัญชีของแอป
5. Bind MariaDB ไว้ที่ localhost/private network และปิดพอร์ต 3306 จากอินเทอร์เน็ต
6. เปิด MQTT TLS ใช้ credential แยกรายอุปกรณ์ และกำหนด ACL ตามบริษัท/เตา
7. ตั้ง `STCR_API_KEY_PEPPER` อย่างน้อย 32 ตัวอักษร และออก API key แยก GR/TTN
8. เก็บ `.env`, MQTT password, DB password, API key และ TLS private key นอก Git
9. เปิด Logging, Rate limit, Backup, Restore drill และ Monitoring ของ DB/MQTT/Telemetry age
10. รัน `npm run production:preflight` ใน Environment จริงก่อน Deploy ทุกครั้ง

## Ubuntu

```bash
sudo install -d -o stcr -g stcr -m 0750 /opt/stcr/output
sudo install -d -o root -g stcr -m 0750 /etc/stcr
sudo install -m 0640 deploy/ubuntu/stcr.env.example /etc/stcr/stcr.env
sudo install -m 0644 deploy/ubuntu/stcr-express.service /etc/systemd/system/stcr-express.service
sudo install -m 0750 deploy/ubuntu/backup-stcr.sh /usr/local/sbin/backup-stcr
sudo install -m 0644 deploy/ubuntu/stcr-backup.service /etc/systemd/system/stcr-backup.service
sudo install -m 0644 deploy/ubuntu/stcr-backup.timer /etc/systemd/system/stcr-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now stcr-express.service stcr-backup.timer
sudo systemctl status stcr-express.service stcr-backup.timer
```

ไฟล์จริง `/etc/stcr/stcr.env` ต้องตั้งค่าแทน Placeholder และใช้สิทธิ์อ่านเฉพาะ root/กลุ่ม service
