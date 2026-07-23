param(
  [switch]$SkipGitPush,
  [switch]$SkipDeployWait,
  [switch]$Background
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $root '.runtime'
$cloudflared = Join-Path $runtimeDir 'cloudflared.exe'
$runtimeConfigPath = Join-Path $root 'public\runtime-config.json'
$nodeRedSettings = Join-Path $root 'node-red\settings.production.cjs'
$nodeRedUserDir = Join-Path $env:USERPROFILE '.node-red'
$mysqlAdmin = 'C:\xampp\mysql\bin\mysqladmin.exe'
$mysqlStart = 'C:\xampp\mysql_start.bat'
$mysqlStartedByScript = $false
$tunnelProcess = $null
$nodeRedProcess = $null

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Port([int]$Port, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((-not (Test-Port $Port)) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  return Test-Port $Port
}

function Get-StcrProcesses([string]$Name, [string]$CommandPattern) {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $Name -and $_.CommandLine -like $CommandPattern })
}

function Stop-StcrProcesses {
  Get-StcrProcesses 'cloudflared.exe' '*127.0.0.1:1880*' |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-StcrProcesses 'node.exe' '*node-red*settings.production.cjs*' |
    ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
}

function Import-RequiredEnvironment {
  $defaults = [ordered]@{
    STCR_DB_HOST = '127.0.0.1'
    STCR_DB_PORT = '3306'
    STCR_DB_USER = 'stcr_app'
    STCR_DB_NAME = 'stcr'
    STCR_ALLOWED_ORIGINS = 'https://0tyght.github.io,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173'
    STCR_SESSION_TTL_MINUTES = '480'
    STCR_TRUST_PROXY = 'true'
    STCR_DEPLOYMENT_MODE = 'test'
    STCR_FACTORY_MQTT_ENABLED = 'true'
    STCR_FACTORY_MQTT_TOPICS = 'test,sensor'
    STCR_FACTORY_MQTT_COMPANY_ID = 'ttn'
    STCR_FACTORY_MQTT_CLIENT_ID = 'stcr-multi-company-server'
    STCR_FACTORY_MQTT_OVEN_MAP_JSON = '{"1":"oven-1","2":"oven-2","3":"oven-3","4":"oven-4","5":"oven-5","6":"oven-6","7":"oven-7","8":"oven-8","9":"oven-9"}'
    STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON = '{"test":{"companyId":"ttn","messageType":"status"},"sensor":{"companyId":"ttn","messageType":"sensor"},"status_gr":{"companyId":"gr","messageType":"status"},"sensor_gr":{"companyId":"gr","messageType":"sensor"}}'
    STCR_FACTORY_MQTT_OVEN_MAPS_JSON = '{"ttn":{"1":"oven-1","2":"oven-2","3":"oven-3","4":"oven-4","5":"oven-5","6":"oven-6","7":"oven-7","8":"oven-8","9":"oven-9"},"gr":{"11":"oven-11","12":"oven-12","13":"oven-13","14":"oven-14","15":"oven-15","16":"oven-16","17":"oven-17","18":"oven-18","19":"oven-19","20":"oven-20","21":"oven-21","22":"oven-22","23":"oven-23","24":"oven-24","25":"oven-25","26":"oven-26"}}'
    # The factory currently sends Bangkok wall-clock time with a trailing Z.
    # Remove this correction after the publisher sends a real UTC/offset timestamp.
    STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES = '420'
    STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED = 'false'
    STCR_FACTORY_MQTT_STORE_RAW_MESSAGES = 'false'
    STCR_OFFLINE_THRESHOLD_SECONDS = '180'
    STCR_HTTP_INGEST_ENABLED = 'false'
  }

  $forceTestDefaults = @(
    'STCR_TRUST_PROXY',
    'STCR_DEPLOYMENT_MODE',
    'STCR_HTTP_INGEST_ENABLED',
    'STCR_FACTORY_MQTT_CLIENT_ID',
    'STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON',
    'STCR_FACTORY_MQTT_OVEN_MAPS_JSON'
  )

  foreach ($key in $defaults.Keys) {
    $value = if ($forceTestDefaults -contains $key) {
      [string]$defaults[$key]
    } else {
      [Environment]::GetEnvironmentVariable($key, 'User')
    }

    if ([string]::IsNullOrWhiteSpace($value)) {
      $value = [string]$defaults[$key]
    }

    Set-Item -Path "Env:$key" -Value $value
  }

  $required = @(
    'STCR_DB_PASSWORD',
    'STCR_NODE_RED_CREDENTIAL_SECRET',
    'STCR_API_KEY_PEPPER',
    'STCR_FACTORY_MQTT_URL',
    'STCR_FACTORY_MQTT_USERNAME',
    'STCR_FACTORY_MQTT_PASSWORD'
  )

  $missing = @()

  foreach ($key in $required) {
    $value = [Environment]::GetEnvironmentVariable(
      $key,
      'User'
    )

    if ([string]::IsNullOrWhiteSpace($value)) {
      $missing += $key
      continue
    }

    Set-Item -Path "Env:$key" -Value $value
  }

  $optional = @(
    'STCR_TTN_INGEST_API_KEY'
  )

  foreach ($key in $optional) {
    $value = [Environment]::GetEnvironmentVariable(
      $key,
      'User'
    )

    if (-not [string]::IsNullOrWhiteSpace($value)) {
      Set-Item -Path "Env:$key" -Value $value
    }
  }

  if ($missing.Count -gt 0) {
    throw (
      'Missing Windows User environment variables: ' +
      ($missing -join ', ') +
      '. Run scripts\setup-dev-env.ps1 before public:start.'
    )
  }

  if ($env:STCR_API_KEY_PEPPER.Length -lt 32) {
    throw 'STCR_API_KEY_PEPPER must contain at least 32 characters'
  }

  if ($env:STCR_NODE_RED_CREDENTIAL_SECRET.Length -lt 32) {
    throw 'STCR_NODE_RED_CREDENTIAL_SECRET must contain at least 32 characters'
  }
}

function Test-LocalHealth {
  try {
    $health = Invoke-RestMethod -TimeoutSec 5 'http://127.0.0.1:1880/stcr/api/health'
    return [bool]$health.ok
  } catch {
    return $false
  }
}

function Publish-RuntimeConfig([string]$ExpectedApiBaseUrl) {
  if ($SkipGitPush) {
    Write-Host 'Skipping GitHub Pages runtime-config update.' -ForegroundColor DarkGray
    return
  }

  $branch = (& git -C $root branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
    throw "Automatic runtime-config publishing requires the main branch (current: $branch)"
  }

  $stagedOtherFiles = @(
    & git -C $root diff --cached --name-only |
      Where-Object { $_ -and $_ -ne 'public/runtime-config.json' }
  )
  if ($stagedOtherFiles.Count -gt 0) {
    throw 'Cannot publish runtime-config while unrelated files are staged. Commit or unstage them first.'
  }

  & git -C $root add -- 'public/runtime-config.json'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to stage public/runtime-config.json' }

  & git -C $root diff --cached --quiet -- 'public/runtime-config.json'
  if ($LASTEXITCODE -eq 1) {
    Write-Host 'Publishing the new API URL to GitHub Pages...' -ForegroundColor Cyan
    & git -C $root commit -m 'Update temporary API endpoint' -- 'public/runtime-config.json'
    if ($LASTEXITCODE -ne 0) { throw 'Failed to commit the new runtime-config' }
    & git -C $root push origin main
    if ($LASTEXITCODE -ne 0) { throw 'Failed to push the new runtime-config to GitHub' }
  } elseif ($LASTEXITCODE -ne 0) {
    throw 'Failed to compare the runtime-config with Git'
  } else {
    Write-Host 'GitHub already has this API URL.' -ForegroundColor DarkGray
  }

  if ($SkipDeployWait) { return }

  Write-Host 'Waiting for GitHub Pages to use the new API URL...' -ForegroundColor DarkGray
  $deadline = (Get-Date).AddMinutes(3)
  $deployed = $false
  do {
    try {
      $cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $publicConfig = Invoke-RestMethod -TimeoutSec 15 `
        "https://0tyght.github.io/stcr/runtime-config.json?t=$cacheBust"
      $deployed = $publicConfig.apiBaseUrl -eq $ExpectedApiBaseUrl
    } catch {
      $deployed = $false
    }
    if (-not $deployed) { Start-Sleep -Seconds 5 }
  } while ((-not $deployed) -and (Get-Date) -lt $deadline)

  if (-not $deployed) {
    throw 'GitHub Pages did not publish the new API URL within 3 minutes'
  }

  Write-Host 'GitHub Pages is using the new API URL.' -ForegroundColor Green
}

trap {
  Write-Warning "Startup failed: $($_.Exception.Message)"
  Stop-StcrProcesses
  if ($mysqlStartedByScript -and (Test-Port 3306)) {
    & $mysqlAdmin -u root shutdown | Out-Null
  }
  exit 1
}

if (-not (Test-Path $nodeRedSettings)) { throw "Node-RED settings not found: $nodeRedSettings" }
if (-not (Test-Path $mysqlStart)) { throw "XAMPP MySQL starter not found: $mysqlStart" }
if (-not (Test-Path $mysqlAdmin)) { throw "mysqladmin.exe not found: $mysqlAdmin" }

Write-Host 'Starting STCR public test server...' -ForegroundColor Cyan

if (-not (Test-Port 3306)) {
  Write-Host 'Starting MariaDB...' -ForegroundColor DarkGray
  Start-Process -FilePath $mysqlStart -WindowStyle Hidden | Out-Null
  if (-not (Wait-Port 3306 30)) { throw 'MariaDB failed to start on port 3306' }
  $mysqlStartedByScript = $true
}

Import-RequiredEnvironment

$backupScript = Join-Path $PSScriptRoot 'backup-database.ps1'
$backupDir = Join-Path $root 'backups'
$latestBackup = Get-ChildItem $backupDir -Filter 'stcr-*.sql' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $latestBackup -or $latestBackup.LastWriteTime.Date -lt (Get-Date).Date) {
  Write-Host 'Creating the daily database backup...' -ForegroundColor DarkGray
  & $backupScript
}

$existingNodeRed = Get-StcrProcesses 'node.exe' '*node-red*settings.production.cjs*'
if ($existingNodeRed.Count -gt 0 -and (Test-LocalHealth)) {
  $nodeRedProcess = Get-Process -Id $existingNodeRed[0].ProcessId
  Write-Host 'Node-RED is already online.' -ForegroundColor DarkGray
} else {
  if (Test-Port 1880) {
    throw 'Port 1880 is already used by another process. Stop it before running this command.'
  }

  Write-Host 'Starting Node-RED API...' -ForegroundColor DarkGray
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $nodeOut = Join-Path $runtimeDir "node-red-$stamp.out.log"
  $nodeErr = Join-Path $runtimeDir "node-red-$stamp.err.log"
  $nodeRedCommand = Join-Path $env:APPDATA 'npm\node-red.cmd'
  $nodeRedProcess = Start-Process -FilePath $nodeRedCommand `
    -ArgumentList @('--settings', $nodeRedSettings, '--userDir', $nodeRedUserDir) `
    -WorkingDirectory $root -RedirectStandardOutput $nodeOut -RedirectStandardError $nodeErr `
    -WindowStyle Hidden -PassThru

  $deadline = (Get-Date).AddSeconds(40)
  while ((-not (Test-LocalHealth)) -and (Get-Date) -lt $deadline -and (-not $nodeRedProcess.HasExited)) {
    Start-Sleep -Milliseconds 500
  }
  if (-not (Test-LocalHealth)) {
    Get-Content $nodeOut,$nodeErr -Tail 50 -ErrorAction SilentlyContinue
    throw 'Node-RED API failed to start'
  }
}

if (-not (Test-Path $cloudflared)) {
  Write-Host 'Downloading cloudflared from the official Cloudflare release...' -ForegroundColor DarkGray
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 `
    'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
    -OutFile $cloudflared
}

Get-StcrProcesses 'cloudflared.exe' '*127.0.0.1:1880*' |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$url = $null
$latestTunnelLog = $null
for ($attempt = 1; $attempt -le 4 -and -not $url; $attempt++) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $tunnelOut = Join-Path $runtimeDir "tunnel-$stamp-attempt$attempt.out.log"
  $tunnelErr = Join-Path $runtimeDir "tunnel-$stamp-attempt$attempt.err.log"
  $latestTunnelLog = $tunnelErr
  Write-Host "Starting Cloudflare Quick Tunnel (attempt $attempt/4)..." -ForegroundColor Cyan

  $tunnelProcess = Start-Process -FilePath $cloudflared `
    -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:1880', '--no-autoupdate') `
    -WorkingDirectory $root -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr `
    -WindowStyle Hidden -PassThru

  $deadline = (Get-Date).AddSeconds(50)
  while (-not $url -and (Get-Date) -lt $deadline -and (-not $tunnelProcess.HasExited)) {
    Start-Sleep -Seconds 1
    $logText = ((Get-Content $tunnelOut,$tunnelErr -ErrorAction SilentlyContinue) -join "`n")
    $match = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) { $url = $match.Value }
  }

  if ($url) {
    $tunnelHost = ([Uri]$url).Host
    $healthDeadline = (Get-Date).AddSeconds(60)
    $healthy = $false
    do {
      try {
        $tunnelIp = Resolve-DnsName $tunnelHost -Server '1.1.1.1' -DnsOnly -Type A -ErrorAction Stop |
          Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress -First 1
        if (-not $tunnelIp) { throw 'Cloudflare DNS is not ready' }
        $healthJson = & curl.exe --silent --show-error --fail --max-time 15 `
          --resolve "${tunnelHost}:443:$tunnelIp" "$url/stcr/api/health" 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($healthJson -join ' ') }
        $healthy = [bool](($healthJson -join "`n") | ConvertFrom-Json).ok
      } catch {
        Start-Sleep -Seconds 3
      }
    } while ((-not $healthy) -and (Get-Date) -lt $healthDeadline -and (-not $tunnelProcess.HasExited))

    if (-not $healthy) { $url = $null }
  }

  if (-not $url) {
    if ($tunnelProcess -and (-not $tunnelProcess.HasExited)) {
      Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($attempt -lt 4) { Start-Sleep -Seconds (5 * $attempt) }
  }
}

if (-not $url) {
  throw "Cloudflare Quick Tunnel failed. Latest log: $latestTunnelLog"
}

$runtimeConfig = [ordered]@{
  dataSource = 'node-red'
  apiBaseUrl = "$url/stcr/api"
  pollIntervalMs = 1000
  requestTimeoutMs = 15000
  updatedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json
[IO.File]::WriteAllText(
  $runtimeConfigPath,
  $runtimeConfig + [Environment]::NewLine,
  (New-Object Text.UTF8Encoding($false))
)

Publish-RuntimeConfig "$url/stcr/api"

Write-Host ''
Write-Host 'STCR public test server is ready' -ForegroundColor Green
Write-Host 'Web: https://0tyght.github.io/stcr/'
Write-Host "API: $url/stcr/api"
Write-Host 'Accounts: gr_dev_admin / ttn_dev_admin (use the existing test passwords)'

if ($Background) {
  Write-Host 'Mode: background. Run npm run public:stop to stop all STCR services.' -ForegroundColor DarkGray
  return
}

Write-Host ''
Write-Host 'Server monitor is running. Press Q to stop Tunnel, Node-RED and MySQL.' -ForegroundColor Cyan
try {
  while ($true) {
    $dbState = if (Test-Port 3306) { 'ONLINE' } else { 'OFFLINE' }
    $apiState = if (Test-LocalHealth) { 'ONLINE' } else { 'OFFLINE' }
    $tunnelState = if ($tunnelProcess -and (-not $tunnelProcess.HasExited)) { 'ONLINE' } else { 'OFFLINE' }
    Write-Host ("[{0}] DB: {1} | Node-RED: {2} | Tunnel: {3}" -f (Get-Date -Format 'HH:mm:ss'), $dbState, $apiState, $tunnelState)

    for ($step = 0; $step -lt 10; $step++) {
      try {
        if ([Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq [ConsoleKey]::Q) {
          throw [System.OperationCanceledException]::new('Stop requested')
        }
      } catch [System.OperationCanceledException] {
        throw
      } catch {
        # Ctrl+C remains available in terminals that do not expose KeyAvailable.
      }
      Start-Sleep -Milliseconds 500
    }
  }
} catch [System.OperationCanceledException] {
  Write-Host 'Stop requested.' -ForegroundColor Yellow
} finally {
  Write-Host 'Stopping STCR public test server...' -ForegroundColor Yellow
  Stop-StcrProcesses
  if ($mysqlStartedByScript -and (Test-Port 3306)) {
    & $mysqlAdmin -u root shutdown | Out-Null
  }
  Write-Host 'STCR services are stopped.' -ForegroundColor Green
}
