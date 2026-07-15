# Node-RED API Contract

Company data is isolated in separate source state. Each authenticated session is bound to exactly one company. The server never uses a client-supplied company id as proof of access.

Frontend ใช้ REST polling เป็นฐานก่อน โดยเรียกค่าปัจจุบันทุก `VITE_REALTIME_POLL_INTERVAL_MS` ข้อมูลทุกรายการต้องเป็น JSON และ timestamp ต้องเป็น ISO 8601 เช่น `2026-07-12T08:30:00.000+07:00`

Base path ตัวอย่าง: `http://127.0.0.1:1880/stcr/api`

Frontend ส่ง `Authorization: Bearer <session token>` ทุก request ส่วน `companyId` ที่ส่งมาใช้ตรวจความสอดคล้องเท่านั้น ถ้าไม่ตรงกับบริษัทใน session ระบบตอบ `403` ทันที

## Endpoint

| Method | Path | หน้าที่ |
| --- | --- | --- |
| POST | `/auth/login` | ตรวจรหัสผ่านและออก session ที่ผูกกับบริษัท |
| POST | `/auth/logout` | ยกเลิก session ปัจจุบัน |
| POST | `/telemetry` | รับข้อมูล 4 เซนเซอร์จาก Node-RED ด้วย API Key |
| GET | `/ovens` | สถานะและค่าล่าสุดของทุกเตา |
| GET | `/ovens/:ovenId` | ข้อมูลเตาเดียว |
| GET | `/ovens/:ovenId/history` | ข้อมูลกราฟตามรอบ/ช่วงเวลา |
| GET | `/alarms` | Alarm ปัจจุบันและย้อนหลัง |
| GET | `/audit-events` | ประวัติการแก้ไขระบบ |
| PUT | `/ovens/:ovenId/limits` | บันทึก Upper/Lower |
| PATCH | `/ovens/:ovenId` | แก้ชื่อ โซน และไลน์ |
| POST | `/ovens` | เพิ่มเตา |
| POST | `/alarms/:alarmId/acknowledge` | รับทราบ Alarm |
| GET | `/ovens/:ovenId/export.csv` | ส่งออกข้อมูลดิบ CSV |

`GET /ovens/:ovenId/history` รับ query `preset`, `sensors`, `startAt`, `endAt`, `cycleNumber` โดย `sensors` เป็น comma-separated เช่น `chamberTemp,humidity` และต้องเรียงข้อมูลจากเวลาเก่าไปใหม่

## Telemetry ingestion

Node-RED sends one request per oven every minute with `X-API-Key`. The key is issued for one company and may be restricted to one oven. The API verifies the key hash, `companyId`, `ovenId`, the oven-company foreign key, all four sensor identities, units, sequence numbers and source timestamps before one MySQL transaction is committed.

```json
{
  "companyId": "gr",
  "ovenId": "oven-18",
  "batchId": "20260715T120000-oven-18",
  "deviceId": "gr-oven-18-gateway",
  "readings": [
    {
      "sensorKey": "chamberTemp",
      "sensorId": "gr-oven-18-chamberTemp",
      "sequence": 1001,
      "value": 56.2,
      "rawValue": 56.4,
      "unit": "C",
      "quality": "good",
      "qualityReasons": [],
      "sourceTimestamp": "2026-07-15T12:00:00.000Z"
    }
  ]
}
```

The example shortens `readings` for readability; a valid request must contain each of `chamberTemp`, `humidity`, `furnaceTemp` and `blowerTemp` exactly once.

## Oven payload

```json
{
  "id": "oven-18",
  "number": 18,
  "name": "เตา 18",
  "zone": "A",
  "line": "Line 2",
  "status": "open",
  "enabled": true,
  "cycleCount": 83,
  "startedAt": "2026-07-12T01:00:00.000+07:00",
  "lastUpdatedAt": "2026-07-12T08:30:00.000+07:00",
  "readings": {
    "chamberTemp": { "key": "chamberTemp", "value": 46.7, "unit": "C", "updatedAt": "2026-07-12T08:30:00.000+07:00" },
    "humidity": { "key": "humidity", "value": 49.9, "unit": "%", "updatedAt": "2026-07-12T08:30:00.000+07:00" },
    "furnaceTemp": { "key": "furnaceTemp", "value": 152, "unit": "C", "updatedAt": "2026-07-12T08:30:00.000+07:00" },
    "blowerTemp": { "key": "blowerTemp", "value": 64, "unit": "C", "updatedAt": "2026-07-12T08:30:00.000+07:00" }
  },
  "limits": {
    "chamberTemp": { "sensor": "chamberTemp", "lower": 30, "upper": 60 },
    "humidity": { "sensor": "humidity", "lower": 45, "upper": 70 },
    "furnaceTemp": { "sensor": "furnaceTemp", "lower": 140, "upper": 450 },
    "blowerTemp": { "sensor": "blowerTemp", "lower": 140, "upper": 450 }
  }
}
```

ค่าที่อนุญาต:

- `status`: `open`, `closed`, `offline`
- sensor key: `chamberTemp`, `humidity`, `furnaceTemp`, `blowerTemp`
- อุณหภูมิใช้ `C` และความชื้นใช้ `%`
- เตาปิดยังต้องส่งค่าล่าสุดและ `lastUpdatedAt`; frontend จะใช้ดูย้อนหลังและไม่ตีความ Alarm เป็นสถานะเตา

## History payload

```json
[
  {
    "timestamp": "2026-07-12T08:29:00.000+07:00",
    "chamberTemp": 46.5,
    "humidity": 50.1,
    "furnaceTemp": 151,
    "blowerTemp": 63.5
  }
]
```

หนึ่งคำขอของกราฟย้อนหลังต้องครอบคลุมหนึ่งรอบอบเท่านั้น รอบปัจจุบันให้เพิ่ม point ใหม่ตามเวลาจริง ห้ามเปลี่ยน `cycleCount` จนกว่าจะจบรอบจริง

## Report cycle metadata

`GET /stcr/api/ovens/:ovenId/cycles/:cycleNumber/report-meta` loads the saved form values for a report cycle. `PUT` on the same path stores the values in `oven_cycles` before the PDF is generated. Writing requires the `admin` or `operator` role. Both operations require an exact match on the session `company_id`, URL `oven_id`, and URL `cycle_number`.

Stored values include rubber type, smoking-period result, temperature-control result, reason, input/output net weight, and firewood weight. The web report configuration shows the firewood field only for GR.

## HTTP rules

- Success ใช้ `2xx`; error ใช้ `4xx/5xx`
- Node-RED ต้องตอบภายใน `VITE_API_TIMEOUT_MS`
- เปิด CORS เฉพาะ origin ที่ใช้งานจริง หรือใช้ reverse proxy ให้ frontend และ API อยู่ origin เดียวกัน
- ไม่ใส่ credential, token หรือรหัสผ่านลง payload/frontend environment เพราะตัวแปร `VITE_*` มองเห็นได้จาก browser
- ทุก endpoint ยกเว้น `/health`, `/auth/login`, `/telemetry` และ `OPTIONS` ต้องใช้ Bearer token
- `/telemetry` uses `X-API-Key`; a browser Bearer token cannot be used for ingestion.
- Session หมดอายุอัตโนมัติและถูกเก็บในหน่วยความจำ Node-RED การ restart จะบังคับให้ Login ใหม่
- History จำกัดช่วงคำขอไม่เกิน 14 วันและผลลัพธ์ไม่เกิน 10,000 จุด
- API จำกัดขนาด body, จำนวน request, ค่า Limit, ความยาวข้อความ และ sensor key
