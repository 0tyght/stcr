# STCR Express IoT Workflow

```text
เครื่องโรงงาน
→ MQTT Broker
→ mqtt.js ใน Express
→ ตรวจและแปลง Payload
→ ป้องกันข้อมูลซ้ำ/ย้อนหลัง
→ อัปเดต Realtime memory
→ รวมข้อมูลรายนาที
→ MariaDB
→ Express API
→ React
```

Express Subscribe Topic ตาม `STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON` และใช้ mapping เตาตาม `STCR_FACTORY_MQTT_OVEN_MAPS_JSON`

ข้อมูลเซนเซอร์ที่ผ่านการตรวจจะอัปเดต Realtime ทันที ส่วนข้อมูลกราฟจะรวมเป็นหนึ่งจุดต่อนาทีต่อเตา โดยเก็บค่าเฉลี่ย ต่ำสุด สูงสุด ล่าสุด และจำนวนตัวอย่าง
