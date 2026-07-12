# STCR Node-RED Simulator

Flow นี้จำลองข้อมูลเตา 11-26 แบบมี state และเปิด REST API ตาม [Node-RED API Contract](../docs/node-red-api.md)

## วิธีใช้

1. เปิด Node-RED ที่ `http://127.0.0.1:1880`
2. เลือก Menu → Import → Clipboard
3. นำเข้าไฟล์ `flows.json`
4. กด Deploy
5. ตรวจที่ `http://127.0.0.1:1880/stcr/api/health`
6. คัดลอก `.env.example` เป็น `.env.local` แล้วตั้ง `VITE_DATA_SOURCE=node-red`
7. restart `npm run dev`

Flow ใช้เฉพาะ node มาตรฐานของ Node-RED ไม่ต้องติดตั้ง palette เพิ่ม

## พฤติกรรมข้อมูลจำลอง

- อัปเดตเตาที่เปิดทุก 5 วินาที
- เก็บ history 14 วันใน flow context และเพิ่ม point ทุก 1 นาที
- seed history ทุก 10 นาทีเพื่อให้เปิดกราฟแล้วเห็นข้อมูลทันที
- อุณหภูมิและความชื้นเปลี่ยนตาม progress ของรอบ 6 วัน
- เตาปิดคงค่าล่าสุดและเตา offline ใช้ timestamp เก่า
- เตา 18 จำลอง Blower ต่ำ และเตา 20 จำลองอุณหภูมิสูงเพื่อทดสอบ Alarm
- `cycleCount` เพิ่มเมื่อรอบเปิดครบ 6 วันเท่านั้น

ข้อมูลอยู่ใน memory context ของ Node-RED และจะเริ่มใหม่เมื่อ restart หากยังไม่ได้ตั้ง context storage แบบ file/database ขั้น production ควรส่ง history ลงฐานข้อมูลภายนอก

## แก้ Function node อย่างเป็นระบบ

ไฟล์ต้นฉบับอยู่ใน `functions/` หลังแก้ให้สร้าง flow ใหม่ด้วย:

```powershell
npm run node-red:build
npm run node-red:validate
```

อย่าแก้ `flows.json` โดยตรง เพราะไฟล์นี้ generate จาก `build-flow.mjs`
