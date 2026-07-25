param([switch]$KeepMySql)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$statePath = Join-Path $root ".runtime\express-public-services.json"

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.Name -eq "cloudflared.exe" -and $_.CommandLine -like "*127.0.0.1:3001*") -or
  ($_.Name -eq "node.exe" -and $_.CommandLine -like "*backend*src*server.mjs*")
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

if (-not $KeepMySql) {
  $mysql = Get-Process mysqld -ErrorAction SilentlyContinue
  if ($mysql) {
    & "C:\xampp\mysql\bin\mysqladmin.exe" -u root shutdown | Out-Null
  }
}

Remove-Item $statePath -Force -ErrorAction SilentlyContinue
Write-Host "ปิด Cloudflare Tunnel และ Express แล้ว" -ForegroundColor Green
if ($KeepMySql) {
  Write-Host "คง MySQL ให้ทำงานต่อ" -ForegroundColor DarkGray
} else {
  Write-Host "ปิด MySQL แล้ว" -ForegroundColor Green
}
