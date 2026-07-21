# STCR MQTT และ Node-RED Workflow

## เส้นทางข้อมูลจริง

```text
เครื่อง TTN
  ├─ Topic test: oven, cycle, oven_state, time_stamp
  └─ Topic sensor: startoven, oven, cycle, oventemp, blower,
                   roomtemp, humanity, page, time_stamp
          ↓ QoS 1
MQTT Broker
          ↓ Subscribe
Node-RED Adapter
          ├─ เก็บ Payload ต้นฉบับ
          ├─ ตรวจบริษัทและ mapping เตา 1–9
          ├─ แปลง roomtemp → chamberTemp
          ├─ แปลง humanity → humidity
          ├─ แปลง oventemp → furnaceTemp
          └─ แปลง blower → blowerTemp
          ↓ API Key
STCR API → MariaDB → Dashboard / History / Report
```

ระบบไม่สร้างค่าทดแทน เมื่อค่าใดเป็น `null` จะเก็บ Payload ต้นฉบับและไม่สร้าง snapshot ที่ดูเหมือนข้อมูลครบ

`oven_state` เป็นสถานะหลัก: `1=open`, `0=closed` ส่วน `page` ยังไม่ใช้ในเว็บไซต์ สถานะจะกลายเป็น `offline` เมื่อไม่ได้รับข้อความเกิน `STCR_OFFLINE_THRESHOLD_SECONDS`

Publisher ปัจจุบันส่งเวลาไทยแต่ลงท้าย `Z` จึงชดเชยด้วย `STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES=420` จนกว่าฝั่งเครื่องจะแก้ timestamp ให้ถูกต้อง
