# STCR Node-RED

Flow ชุดนี้รับข้อมูลจริงจาก MQTT ของโรงงาน ตรวจสอบรูปแบบ แปลงชื่อฟิลด์ บันทึก Payload ต้นฉบับ และส่งค่าที่ครบเข้า STCR API

## Flow

1. `01 ฐานข้อมูลและ API` — Authentication, Dashboard, History, Report, Alarm และ MariaDB
2. `02 รับข้อมูล MQTT โรงงาน` — Subscribe Topic `test`/`sensor`, ตรวจค่า และส่งเข้า API

ไม่มี Flow สร้างข้อมูลทดแทน หากไม่ได้รับ Heartbeat ภายในเวลาที่กำหนด เว็บไซต์จะแสดง `offline`

## Environment ที่ต้องมี

- `STCR_FACTORY_MQTT_ENABLED=true`
- `STCR_FACTORY_MQTT_FORWARD_ENABLED=true`
- `STCR_FACTORY_MQTT_URL`
- `STCR_FACTORY_MQTT_USERNAME`
- `STCR_FACTORY_MQTT_PASSWORD`
- `STCR_FACTORY_MQTT_COMPANY_ID=ttn`
- `STCR_FACTORY_MQTT_TOPICS=test,sensor`
- `STCR_FACTORY_MQTT_OVEN_MAP_JSON`
- `STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES=420`
- `STCR_TTN_INGEST_API_KEY`
- `STCR_OFFLINE_THRESHOLD_SECONDS=180`
- `STCR_REPORT_READY_HOLD_SECONDS=1800`
- ค่าฐานข้อมูลและ secret ตาม [../deploy/ubuntu/stcr.env.example](../deploy/ubuntu/stcr.env.example)

TTN ใช้ mapping เตา 1–9 แบบตรงตัว ข้อมูลหมายเลขอื่นจะถูกปฏิเสธ ในการตรวจล่าสุด Broker ส่งข้อความจากเตา 1–6 และยังไม่พบข้อความจากเตา 7–9

## สร้างและตรวจ Flow

```bash
npm run node-red:build
npm run node-red:validate
```

รหัส MQTT, API key และรหัสฐานข้อมูลต้องอยู่ใน environment เท่านั้น ห้ามเขียนลง `flows.json` หรือไฟล์ที่ Commit
