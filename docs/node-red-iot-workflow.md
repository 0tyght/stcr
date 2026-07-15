# Node-RED IoT Workflow

## Runtime path

```text
5-second device tick / real field sensor input
  -> independent chamber / humidity / furnace / blower telemetry topics
  -> company-specific field gateway
  -> physical range, unit and timestamp validation
  -> calibration
  -> 5-sample moving median (spike rejection)
  -> exponential moving average (display stability)
  -> batch correlation by batchId + sequence
  -> complete oven snapshot
  -> one HTTP POST per oven every 1 minute with a company API Key
  -> companyId + ovenId ownership validation
  -> MariaDB transaction
  -> 10-minute chart buckets
  -> REST API / dashboard / reports
```

Each telemetry event includes:

- `companyId`, `deviceId`, `ovenId`, `sensorId`, `sensorKey`
- MQTT-compatible topic such as `stcr/gr/oven-15/telemetry/chamberTemp`
- monotonically increasing `sequence`
- `sourceTimestamp`, `receivedTimestamp`, and `gatewayTimestamp`
- numeric value, unit, quality and quality reasons

The four sensor channels are independent Node-RED paths. GR and TTN have separate gateway, processing, and aggregation nodes even though they run in the same Node-RED instance. A complete company batch is emitted immediately. After 6.5 seconds, an incomplete batch is flushed with its raw telemetry while processed snapshots are written only for ovens that supplied all four required sensors. One missing sensor therefore cannot block every other oven, and timed-out batches are removed from memory. Duplicate sensor sequences are idempotent in MariaDB.

## Flow tabs

1. `01 จำลองข้อมูลอุปกรณ์หน้างาน` แทน PLC, Gateway และช่องข้อมูลเซนเซอร์ทั้ง 4 ชนิด
2. `02 ประมวลผลข้อมูล GR` ตรวจสอบ กรอง และรวมข้อมูลของ GR
3. `03 ประมวลผลข้อมูล TTN` ตรวจสอบ กรอง และรวมข้อมูลของ TTN
4. `04 ฐานข้อมูลและ API` บันทึกข้อมูลของทั้งสองบริษัทและให้บริการ API ร่วมกัน

The generated flow currently contains 66 nodes. Keeping company pipelines separate makes it possible to replace either simulator with a different MQTT, Modbus, OPC UA, or HTTP source without changing the other company.

## Quality rules

The gateway rejects malformed payloads and marks valid-but-suspicious payloads when units are wrong, values exceed physical sensor ranges, timestamps are stale, or timestamps are in the future.

Signal processing follows this order:

1. Apply the configured per-company, per-sensor gain and offset.
2. Reject isolated spikes using a moving median over the latest 5 samples.
3. Apply an exponential moving average with a sensor-specific coefficient.
4. Keep quality reasons and every intermediate value in the telemetry envelope.

The simulator still produces raw values every 5 seconds so filtering behaves like field equipment. In HTTP-ingestion mode, Node-RED publishes the latest complete snapshot for each oven once per minute. These one-minute samples are retained in `telemetry_events` and `sensor_readings`. Six-day realtime and historical charts query 10-minute arithmetic-mean buckets, so both modes have the same readable density without discarding the stored one-minute evidence. Alarm reconciliation marks database records as resolved when they are no longer active, including after a Node-RED restart.

## Production replacement

The local device simulator is the only part that should be replaced when real hardware arrives. MQTT, Modbus TCP, OPC UA or an HTTP gateway can publish the same telemetry envelope into the four gateway nodes. Aggregation, lifecycle rules, database persistence, alarms, API and frontend do not need to change.
