param(
  [switch]$SkipGitPush,
  [switch]$SkipDeployWait,
  [switch]$Background
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $root ".runtime"
$runtimeConfigPath = Join-Path $root "public\runtime-config.json"
$statePath = Join-Path $runtimeDir "express-public-services.json"
$cloudflared = Join-Path $runtimeDir "cloudflared.exe"
$mysqlAdmin = "C:\xampp\mysql\bin\mysqladmin.exe"
$mysqlStart = "C:\xampp\mysql_start.bat"
$mysqlStartedByScript = $false
$apiProcess = $null
$tunnelProcess = $null
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    if (& $Condition) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Get-StcrProcess([string]$Pattern) {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -like $Pattern
  })
}

function Stop-StcrRuntime {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -eq "cloudflared.exe" -and $_.CommandLine -like "*127.0.0.1:3001*") -or
    ($_.Name -eq "node.exe" -and $_.CommandLine -like "*backend*src*server.mjs*")
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Import-RequiredEnvironment {
  $defaults = [ordered]@{
    STCR_API_HOST = "127.0.0.1"
    STCR_API_PORT = "3001"
    STCR_SERVE_FRONTEND = "false"
    STCR_DB_HOST = "127.0.0.1"
    STCR_DB_PORT = "3306"
    STCR_DB_USER = "stcr_app"
    STCR_DB_NAME = "stcr"
    STCR_ALLOWED_ORIGINS = "https://0tyght.github.io,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173"
    STCR_SESSION_TTL_MINUTES = "480"
    STCR_TRUST_PROXY = "true"
    STCR_DEPLOYMENT_MODE = "test"
    STCR_FACTORY_MQTT_ENABLED = "true"
    STCR_FACTORY_MQTT_TOPICS = "test,sensor"
    STCR_FACTORY_MQTT_COMPANY_ID = "ttn"
    STCR_FACTORY_MQTT_CLIENT_ID = "stcr-multi-company-express"
    STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES = "420"
    STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED = "false"
    STCR_FACTORY_MQTT_STORE_RAW_MESSAGES = "false"
    STCR_OFFLINE_THRESHOLD_SECONDS = "180"
    STCR_HTTP_INGEST_ENABLED = "false"
    STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON = '{"test":{"companyId":"ttn","messageType":"status"},"sensor":{"companyId":"ttn","messageType":"sensor"},"status_gr":{"companyId":"gr","messageType":"status"},"sensor_gr":{"companyId":"gr","messageType":"sensor"}}'
    STCR_FACTORY_MQTT_OVEN_MAPS_JSON = '{"ttn":{"1":"oven-1","2":"oven-2","3":"oven-3","4":"oven-4","5":"oven-5","6":"oven-6","7":"oven-7","8":"oven-8","9":"oven-9"},"gr":{"11":"oven-11","12":"oven-12","13":"oven-13","14":"oven-14","15":"oven-15","16":"oven-16","17":"oven-17","18":"oven-18","19":"oven-19","20":"oven-20","21":"oven-21","22":"oven-22","23":"oven-23","24":"oven-24","25":"oven-25","26":"oven-26"}}'
  }

  foreach ($key in $defaults.Keys) {
    $value = [Environment]::GetEnvironmentVariable($key, "User")
    if ([string]::IsNullOrWhiteSpace($value)) { $value = [string]$defaults[$key] }
    Set-Item -Path "Env:$key" -Value $value
  }

  $required = @(
    "STCR_DB_PASSWORD",
    "STCR_API_KEY_PEPPER",
    "STCR_FACTORY_MQTT_URL",
    "STCR_FACTORY_MQTT_USERNAME",
    "STCR_FACTORY_MQTT_PASSWORD"
  )
  $missing = @()
  foreach ($key in $required) {
    $value = [Environment]::GetEnvironmentVariable($key, "User")
    if ([string]::IsNullOrWhiteSpace($value)) {
      $missing += $key
    } else {
      Set-Item -Path "Env:$key" -Value $value
    }
  }
  if ($missing.Count -gt 0) {
    throw "Missing Windows User environment variables: $($missing -join ', ')"
  }
  if ($env:STCR_API_KEY_PEPPER.Length -lt 32) {
    throw "STCR_API_KEY_PEPPER must contain at least 32 characters"
  }
}

function Test-LocalHealth {
  try {
    $health = Invoke-RestMethod -TimeoutSec 5 "http://127.0.0.1:3001/stcr/api/health"
    return [bool]$health.ok
  } catch {
    return $false
  }
}

function Publish-RuntimeConfig([string]$ExpectedApiBaseUrl) {
  if ($SkipGitPush) {
    Write-Host "ข้ามการอัปเดต runtime-config บน GitHub" -ForegroundColor DarkGray
    return
  }

  $branch = (& git -C $root branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne "main") {
    throw "การเผยแพร่ runtime-config อัตโนมัติต้องอยู่บน main (ปัจจุบัน: $branch)"
  }

  $otherStaged = @(& git -C $root diff --cached --name-only | Where-Object {
    $_ -and $_ -ne "public/runtime-config.json"
  })
  if ($otherStaged.Count -gt 0) {
    throw "มีไฟล์อื่นถูก Stage อยู่ กรุณา Commit หรือ Unstage ก่อน"
  }

  & git -C $root add -- "public/runtime-config.json"
  if ($LASTEXITCODE -ne 0) { throw "Stage runtime-config ไม่สำเร็จ" }
  & git -C $root diff --cached --quiet -- "public/runtime-config.json"
  if ($LASTEXITCODE -eq 1) {
    & git -C $root commit -m "อัปเดตปลายทาง Express ชั่วคราว" -- "public/runtime-config.json"
    if ($LASTEXITCODE -ne 0) { throw "Commit runtime-config ไม่สำเร็จ" }
    & git -C $root push origin main
    if ($LASTEXITCODE -ne 0) { throw "Push runtime-config ไม่สำเร็จ" }
  } elseif ($LASTEXITCODE -ne 0) {
    throw "ตรวจ runtime-config ไม่สำเร็จ"
  }

  if ($SkipDeployWait) { return }
  Write-Host "กำลังรอ GitHub Pages เผยแพร่ URL ใหม่..." -ForegroundColor DarkGray
  $deadline = (Get-Date).AddMinutes(3)
  do {
    try {
      $cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $publicConfig = Invoke-RestMethod -TimeoutSec 15 "https://0tyght.github.io/stcr/runtime-config.json?t=$cacheBust"
      if ($publicConfig.apiBaseUrl -eq $ExpectedApiBaseUrl) {
        Write-Host "GitHub Pages ใช้ Express URL ใหม่แล้ว" -ForegroundColor Green
        return
      }
    } catch {}
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)
  throw "GitHub Pages ยังไม่เผยแพร่ URL ใหม่ภายใน 3 นาที"
}

trap {
  Write-Warning "Startup failed: $($_.Exception.Message)"
  Stop-StcrRuntime
  if ($mysqlStartedByScript -and (Test-Port 3306) -and (Test-Path $mysqlAdmin)) {
    & $mysqlAdmin -u root shutdown | Out-Null
  }
  exit 1
}

Set-Location $root
if (-not (Test-Path $mysqlStart)) { throw "ไม่พบ XAMPP MySQL starter: $mysqlStart" }
if (-not (Test-Path $mysqlAdmin)) { throw "ไม่พบ mysqladmin.exe: $mysqlAdmin" }

Write-Host "กำลังเปิด STCR Express public test..." -ForegroundColor Cyan
if (-not (Test-Port 3306)) {
  Start-Process -FilePath $mysqlStart -WindowStyle Hidden | Out-Null
  if (-not (Wait-Until { Test-Port 3306 } 30)) { throw "MariaDB เปิดไม่สำเร็จ" }
  $mysqlStartedByScript = $true
}

Import-RequiredEnvironment

$backupScript = Join-Path $PSScriptRoot "backup-database.ps1"
if (Test-Path $backupScript) {
  $backupDir = Join-Path $root "backups"
  $latest = Get-ChildItem $backupDir -Filter "stcr-*.sql" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest -or $latest.LastWriteTime.Date -lt (Get-Date).Date) {
    & $backupScript
    if ($LASTEXITCODE -ne 0) { throw "สำรองฐานข้อมูลไม่สำเร็จ" }
  }
}

$existingApi = Get-StcrProcess "*backend*src*server.mjs*"
if ($existingApi.Count -gt 0 -and (Test-LocalHealth)) {
  $apiProcess = Get-Process -Id $existingApi[0].ProcessId
  Write-Host "Express API เปิดอยู่แล้ว" -ForegroundColor DarkGray
} else {
  if (Test-Port 3001) { throw "Port 3001 ถูกใช้งานโดย Process อื่น" }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $apiOut = Join-Path $runtimeDir "express-$stamp.out.log"
  $apiErr = Join-Path $runtimeDir "express-$stamp.err.log"
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $apiProcess = Start-Process -FilePath $node `
    -ArgumentList @("backend/src/server.mjs") `
    -WorkingDirectory $root `
    -RedirectStandardOutput $apiOut `
    -RedirectStandardError $apiErr `
    -WindowStyle Hidden -PassThru

  $ready = Wait-Until { Test-LocalHealth } 45
  if (-not $ready) {
    Get-Content $apiOut,$apiErr -Tail 80 -ErrorAction SilentlyContinue
    throw "Express API เปิดไม่สำเร็จ"
  }
}

if (-not (Test-Path $cloudflared)) {
  Write-Host "กำลังดาวน์โหลด cloudflared..." -ForegroundColor DarkGray
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 `
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
    -OutFile $cloudflared
}

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq "cloudflared.exe" -and $_.CommandLine -like "*127.0.0.1:3001*"
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$url = $null
for ($attempt = 1; $attempt -le 4 -and -not $url; $attempt++) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $tunnelOut = Join-Path $runtimeDir "tunnel-$stamp-attempt$attempt.out.log"
  $tunnelErr = Join-Path $runtimeDir "tunnel-$stamp-attempt$attempt.err.log"
  $tunnelProcess = Start-Process -FilePath $cloudflared `
    -ArgumentList @("tunnel", "--url", "http://127.0.0.1:3001", "--no-autoupdate") `
    -WorkingDirectory $root `
    -RedirectStandardOutput $tunnelOut `
    -RedirectStandardError $tunnelErr `
    -WindowStyle Hidden -PassThru

  $deadline = (Get-Date).AddSeconds(55)
  do {
    Start-Sleep -Seconds 1
    $text = ((Get-Content $tunnelOut,$tunnelErr -ErrorAction SilentlyContinue) -join "`n")
    $match = [regex]::Match($text, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($match.Success) { $url = $match.Value }
  } while (-not $url -and (Get-Date) -lt $deadline -and -not $tunnelProcess.HasExited)

  if (-not $url -and -not $tunnelProcess.HasExited) {
    Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
if (-not $url) { throw "Cloudflare Quick Tunnel เปิดไม่สำเร็จ" }

$remoteReady = Wait-Until {
  try {
    $remoteHealth = Invoke-RestMethod -TimeoutSec 15 "$url/stcr/api/health"
    return [bool]$remoteHealth.ok
  } catch {
    return $false
  }
} 60
if (-not $remoteReady) { throw "Cloudflare Tunnel เปิดแล้วแต่เรียก Express API ไม่สำเร็จ" }

$runtimeConfig = [ordered]@{
  dataSource = "express"
  apiBaseUrl = "$url/stcr/api"
  pollIntervalMs = 1000
  requestTimeoutMs = 15000
  updatedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json
[IO.File]::WriteAllText(
  $runtimeConfigPath,
  $runtimeConfig + [Environment]::NewLine,
  (New-Object Text.UTF8Encoding($false))
)

Publish-RuntimeConfig "$url/stcr/api"

@{
  apiPid = $apiProcess.Id
  tunnelPid = $tunnelProcess.Id
  mysqlStartedByScript = $mysqlStartedByScript
  apiUrl = "$url/stcr/api"
  startedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath

Write-Host ""
Write-Host "STCR Express public test พร้อมใช้งาน" -ForegroundColor Green
Write-Host "Web: https://0tyght.github.io/stcr/"
Write-Host "API: $url/stcr/api"

if ($Background) {
  Write-Host "ทำงานเบื้องหลัง ใช้ npm run public:stop เพื่อปิด" -ForegroundColor DarkGray
  return
}

Write-Host "กด Q เพื่อปิด Express, Tunnel และ MySQL ที่สคริปต์เปิด" -ForegroundColor Cyan
try {
  while ($true) {
    Write-Host ("[{0}] DB: {1} | Express: {2} | Tunnel: {3}" -f `
      (Get-Date -Format "HH:mm:ss"), `
      $(if (Test-Port 3306) { "ONLINE" } else { "OFFLINE" }), `
      $(if (Test-LocalHealth) { "ONLINE" } else { "OFFLINE" }), `
      $(if ($tunnelProcess -and -not $tunnelProcess.HasExited) { "ONLINE" } else { "OFFLINE" }))
    for ($step = 0; $step -lt 10; $step++) {
      try {
        if ([Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq [ConsoleKey]::Q) {
          throw [System.OperationCanceledException]::new("Stop requested")
        }
      } catch [System.OperationCanceledException] { throw }
      catch {}
      Start-Sleep -Milliseconds 500
    }
  }
} catch [System.OperationCanceledException] {
  Write-Host "กำลังปิดระบบ..." -ForegroundColor Yellow
} finally {
  Stop-StcrRuntime
  if ($mysqlStartedByScript -and (Test-Port 3306)) {
    & $mysqlAdmin -u root shutdown | Out-Null
  }
  Remove-Item $statePath -Force -ErrorAction SilentlyContinue
  Write-Host "ปิด STCR Express public test แล้ว" -ForegroundColor Green
}
