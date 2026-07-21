-- MQTT ของโรงงานสามารถส่ง blower = null ได้
-- จึงต้องอนุญาตให้ sensor_readings.blower_temp เป็น NULL

USE stcr;

ALTER TABLE sensor_readings
  MODIFY COLUMN blower_temp DECIMAL(8,2) NULL;
