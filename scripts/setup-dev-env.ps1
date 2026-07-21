# ตั้งค่า Windows User Environment Variables สำหรับ STCR dev บนเครื่องนี้
# รัน: powershell -ExecutionPolicy Bypass -File scripts\setup-dev-env.ps1

$ErrorActionPreference = 'Stop'

# ======= ตั้งค่าตรงนี้ =======
$cred = [ordered]@{
    # DB (XAMPP)
    STCR_DB_HOST                            = '127.0.0.1'
    STCR_DB_PORT                            = '3306'
    STCR_DB_USER                            = 'stcr_app'
    STCR_DB_PASSWORD                        = 'dev-password-change-me'   # <-- ใส่ password จริงที่ตั้งตอน CREATE USER
    STCR_DB_NAME                            = 'stcr'

    # Web / session
    STCR_ALLOWED_ORIGINS                    = 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173'
    STCR_SESSION_TTL_MINUTES                = '480'
    STCR_TRUST_PROXY                        = 'false'

    # Node-RED secret (ใส่อะไรก็ได้ >= 32 ตัว)
    STCR_NODE_RED_CREDENTIAL_SECRET         = 'dev-local-secret-at-least-32-chars!!'

    # API key pepper + TTN key ที่เพิ่งสร้าง
    STCR_API_KEY_PEPPER                     = 'zKutpxu10Cba_xgBwnAJmhnNzKmzNii8QtoJ87XerQk'
    STCR_TTN_INGEST_API_KEY                 = 'stcr_ttn_xrWStF6pu-FyxGpQKx4YFc2P_zKLnHzKCgBW4g8XyJw'

    # MQTT โรงงาน TTN (plain mqtt ไม่มี TLS)
    STCR_FACTORY_MQTT_URL                   = 'mqtt://43.225.142.208:1883'
    STCR_FACTORY_MQTT_USERNAME              = 'myuser'
    STCR_FACTORY_MQTT_PASSWORD              = 'tytcdev888'
    STCR_FACTORY_MQTT_COMPANY_ID            = 'ttn'
    STCR_FACTORY_MQTT_OVEN_MAP_JSON         = '{"1":"oven-1","2":"oven-2","3":"oven-3","4":"oven-4","5":"oven-5","6":"oven-6","7":"oven-7","8":"oven-8","9":"oven-9"}'
}

Write-Host 'Setting Windows User environment variables...' -ForegroundColor Cyan
foreach ($entry in $cred.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'User')
    Write-Host "  SET $($entry.Key)" -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Done. Open a NEW terminal window before running npm run public:start' -ForegroundColor Green
Write-Host ''
Write-Host 'IMPORTANT: Edit STCR_DB_PASSWORD in this script to match your XAMPP stcr_app password first!' -ForegroundColor Yellow
