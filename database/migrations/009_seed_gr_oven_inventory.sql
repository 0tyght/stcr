USE stcr;
SET time_zone = '+00:00';

-- Add the GR inventory to existing installations without overwriting local settings.
INSERT INTO ovens (
  id, company_id, oven_number, name, zone_name, line_name,
  status, enabled,
  chamber_lower, chamber_upper,
  furnace_lower, furnace_upper,
  blower_lower, blower_upper,
  humidity_lower, humidity_upper
) VALUES
  ('oven-11', 'gr', 11, 'เตา 11', 'A', 'Line 1', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-12', 'gr', 12, 'เตา 12', 'A', 'Line 1', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-13', 'gr', 13, 'เตา 13', 'A', 'Line 1', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-14', 'gr', 14, 'เตา 14', 'A', 'Line 1', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-15', 'gr', 15, 'เตา 15', 'A', 'Line 1', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-16', 'gr', 16, 'เตา 16', 'A', 'Line 1', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-17', 'gr', 17, 'เตา 17', 'A', 'Line 1', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-18', 'gr', 18, 'เตา 18', 'A', 'Line 1', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-19', 'gr', 19, 'เตา 19', 'B', 'Line 2', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-20', 'gr', 20, 'เตา 20', 'B', 'Line 2', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-21', 'gr', 21, 'เตา 21', 'B', 'Line 2', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-22', 'gr', 22, 'เตา 22', 'B', 'Line 2', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-23', 'gr', 23, 'เตา 23', 'B', 'Line 2', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-24', 'gr', 24, 'เตา 24', 'B', 'Line 2', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-25', 'gr', 25, 'เตา 25', 'B', 'Line 2', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-26', 'gr', 26, 'เตา 26', 'B', 'Line 2', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00)
ON DUPLICATE KEY UPDATE id = VALUES(id);
