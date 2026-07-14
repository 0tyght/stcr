param(
  [switch]$KeepMySql
)

$ErrorActionPreference = 'Stop'

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -like '*127.0.0.1:1880*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*node-red*settings.production.cjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }

if (-not $KeepMySql) {
  $mysql = Get-Process mysqld -ErrorAction SilentlyContinue
  if ($mysql) {
    & 'C:\xampp\mysql\bin\mysqladmin.exe' -u root shutdown | Out-Null
  }
}

Write-Host 'Cloudflare Tunnel and Node-RED are stopped.' -ForegroundColor Green
if ($KeepMySql) {
  Write-Host 'MySQL was left running.' -ForegroundColor DarkGray
} else {
  Write-Host 'MySQL is stopped.' -ForegroundColor Green
}
