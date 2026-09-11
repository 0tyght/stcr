$ErrorActionPreference = "Stop"

$nodeRedHome = Join-Path $env:USERPROFILE ".node-red"
$dataDirectory = "C:\STCR\data"

Write-Host "Preparing STCR Local Data..."
New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null

if (-not (Test-Path $nodeRedHome)) {
    throw "Node-RED user directory was not found: $nodeRedHome"
}

Push-Location $nodeRedHome
try {
    npm.cmd install --save node-red-node-sqlite
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Ready."
Write-Host "1. Restart Node-RED once."
Write-Host "2. Import output\node-red\ttn-production-complete-v7.json"
Write-Host "3. Disable V6, enable V7, then Deploy."
Write-Host "SQLite file: C:\STCR\data\stcr-buffer.db"
