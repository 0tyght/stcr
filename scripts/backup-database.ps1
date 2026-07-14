param(
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $root '.runtime'
$backupDir = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $root 'backups' }
$dumpExe = 'C:\xampp\mysql\bin\mysqldump.exe'

if (-not (Test-Path $dumpExe)) { throw "mysqldump.exe not found: $dumpExe" }

$required = @('STCR_DB_HOST', 'STCR_DB_PORT', 'STCR_DB_USER', 'STCR_DB_PASSWORD', 'STCR_DB_NAME')
$values = @{}
foreach ($name in $required) {
  $value = [Environment]::GetEnvironmentVariable($name, 'Process')
  if (-not $value) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
  }
  if (-not $value) { throw "Missing Windows user environment variable: $name" }
  $values[$name] = $value
}

New-Item -ItemType Directory -Path $runtimeDir,$backupDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputPath = Join-Path $backupDir "stcr-$stamp.sql"
$clientConfig = Join-Path $runtimeDir "mysql-backup-$PID.cnf"

try {
  $config = @"
[client]
host=$($values.STCR_DB_HOST)
port=$($values.STCR_DB_PORT)
user=$($values.STCR_DB_USER)
password=$($values.STCR_DB_PASSWORD)
default-character-set=utf8mb4
"@
  [IO.File]::WriteAllText($clientConfig, $config, (New-Object Text.UTF8Encoding($false)))

  & $dumpExe `
    "--defaults-extra-file=$clientConfig" `
    --single-transaction `
    --quick `
    --triggers `
    --hex-blob `
    "--result-file=$outputPath" `
    $values.STCR_DB_NAME

  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outputPath)) {
    throw 'Database backup failed'
  }

  $file = Get-Item $outputPath
  if ($file.Length -lt 1024) { throw 'Database backup is unexpectedly small' }
  Write-Host "Database backup completed: $($file.FullName) ($([math]::Round($file.Length / 1MB, 2)) MB)" -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $clientConfig -Force -ErrorAction SilentlyContinue
}
