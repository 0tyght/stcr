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
  $requiredKeys = @(
    'STCR_DB_HOST',
    'STCR_DB_PORT',
    'STCR_DB_USER',
    'STCR_DB_PASSWORD',
    'STCR_DB_NAME',
    'STCR_ALLOWED_ORIGINS',
    'STCR_SESSION_TTL_MINUTES',
    'STCR_TRUST_PROXY',
    'STCR_NODE_RED_CREDENTIAL_SECRET',
    'STCR_API_KEY_PEPPER',
    'STCR_TTN_INGEST_API_KEY',
    'STCR_FACTORY_MQTT_URL',
    'STCR_FACTORY_MQTT_USERNAME',
    'STCR_FACTORY_MQTT_PASSWORD',
    'STCR_FACTORY_MQTT_COMPANY_ID',
    'STCR_FACTORY_MQTT_OVEN_MAP_JSON'
  )

  foreach ($key in $requiredKeys) {
    $value = [Environment]::GetEnvironmentVariable($key, 'User')
    if (-not $value) {
      throw "Missing Windows user environment variable: $key"
    }
    Set-Item -Path "Env:$key" -Value $value
  }

  if ($env:STCR_API_KEY_PEPPER.Length -lt 32) {
    throw 'STCR_API_KEY_PEPPER must contain at least 32 characters'
  }

  $env:STCR_DEPLOYMENT_MODE = 'test'
  $env:STCR_FACTORY_MQTT_ENABLED = 'true'
  $env:STCR_FACTORY_MQTT_FORWARD_ENABLED = 'true'
  $env:STCR_FACTORY_MQTT_TOPICS = 'test,sensor'
  $env:STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES = '420'

  $httpIngestEnabled = [Environment]::GetEnvironmentVariable('STCR_HTTP_INGEST_ENABLED', 'User')
  if (-not $httpIngestEnabled) { $httpIngestEnabled = 'false' }
  Set-Item -Path 'Env:STCR_HTTP_INGEST_ENABLED' -Value $httpIngestEnabled

  $ingestUrl = [Environment]::GetEnvironmentVariable('STCR_INGEST_URL', 'User')
  if (-not $ingestUrl) { $ingestUrl = 'http://127.0.0.1:1880/stcr/api/telemetry' }
  Set-Item -Path 'Env:STCR_INGEST_URL' -Value $ingestUrl

  if ($httpIngestEnabled -eq 'true') {
    foreach ($key in @('STCR_GR_INGEST_API_KEY')) {
      $value = [Environment]::GetEnvironmentVariable($key, 'User')
      if (-not $value) {
        throw "Missing Windows user environment variable while HTTP ingest is enabled: $key"
      }
      Set-Item -Path "Env:$key" -Value $value
    }
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
  pollIntervalMs = 5000
  requestTimeoutMs = 15000
  updatedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json
[IO.File]::WriteAllText(
  $runtimeConfigPath,
  $runtimeConfig + [Environment]::NewLine,
  (New-Object Text.UTF8Encoding($false))
)

if (-not $SkipGitPush) {
  $branch = (git -C $root rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -ne 'main') { throw "Automatic push requires branch main; current branch is $branch" }

  git -C $root add -- public/runtime-config.json
  git -C $root diff --cached --quiet -- public/runtime-config.json
  if ($LASTEXITCODE -ne 0) {
    git -C $root commit -m 'อัปเดตลิงก์ Node-RED ชั่วคราว'
    if ($LASTEXITCODE -ne 0) { throw 'Git commit failed' }
  }
  git -C $root push origin main
  if ($LASTEXITCODE -ne 0) { throw 'Git push failed' }

  if (-not $SkipDeployWait) {
    $sha = (git -C $root rev-parse HEAD).Trim()
    Write-Host 'Waiting for GitHub Pages deployment...' -ForegroundColor DarkGray
    $deployDeadline = (Get-Date).AddMinutes(3)
    $deployment = $null
    do {
      Start-Sleep -Seconds 5
      try {
        $runs = Invoke-RestMethod -TimeoutSec 20 -Headers @{ 'User-Agent' = 'STCR-Public-Test' } `
          -Uri 'https://api.github.com/repos/0tyght/stcr/actions/runs?per_page=10'
        $deployment = $runs.workflow_runs | Where-Object { $_.head_sha -eq $sha } | Select-Object -First 1
      } catch {
        $deployment = $null
      }
    } while ((-not $deployment -or $deployment.status -ne 'completed') -and (Get-Date) -lt $deployDeadline)

    if ($deployment.conclusion -eq 'success') {
      Write-Host 'GitHub Pages deployment completed.' -ForegroundColor Green
    } else {
      Write-Warning 'GitHub Pages is still deploying. The server is online; check Actions before testing the web.'
    }
  }
}

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
