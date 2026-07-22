# STCR development environment setup
# Compatible with Windows PowerShell 5.1 and PowerShell 7+
# This file intentionally uses ASCII-only comments/messages to avoid encoding problems.

[CmdletBinding()]
param(
    [string]$DbHost = "127.0.0.1",
    [int]$DbPort = 3306,
    [string]$DbUser = "stcr_app",
    [string]$DbName = "stcr",
    [string]$MqttUrl = "mqtt://43.225.142.208:1883",
    [ValidateSet("gr", "ttn")]
    [string]$MqttCompanyId = "ttn"
)

$ErrorActionPreference = "Stop"

function Set-StcrUserVariable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value
    )

    [Environment]::SetEnvironmentVariable($Name, $Value, "User")
    Set-Item -Path ("Env:" + $Name) -Value $Value
    Write-Host ("SET  " + $Name) -ForegroundColor DarkGray
}

function Get-StcrUserVariable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    return [Environment]::GetEnvironmentVariable($Name, "User")
}

function ConvertFrom-StcrSecureString {
    param(
        [Parameter(Mandatory = $true)]
        [Security.SecureString]$SecureValue
    )

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Read-StcrRequiredText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Prompt
    )

    $existing = Get-StcrUserVariable -Name $Name
    if (-not [string]::IsNullOrWhiteSpace($existing)) {
        Set-Item -Path ("Env:" + $Name) -Value $existing
        Write-Host ("KEEP " + $Name) -ForegroundColor DarkGray
        return $existing
    }

    $value = Read-Host $Prompt
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw ($Name + " is required.")
    }

    Set-StcrUserVariable -Name $Name -Value $value
    return $value
}

function Read-StcrRequiredSecret {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Prompt
    )

    $existing = Get-StcrUserVariable -Name $Name
    if (-not [string]::IsNullOrWhiteSpace($existing)) {
        Set-Item -Path ("Env:" + $Name) -Value $existing
        Write-Host ("KEEP " + $Name) -ForegroundColor DarkGray
        return $existing
    }

    $secureValue = Read-Host $Prompt -AsSecureString
    $plainValue = ConvertFrom-StcrSecureString -SecureValue $secureValue

    if ([string]::IsNullOrWhiteSpace($plainValue)) {
        throw ($Name + " is required.")
    }

    Set-StcrUserVariable -Name $Name -Value $plainValue
    return $plainValue
}

function New-StcrRandomSecret {
    param(
        [int]$ByteLength = 48
    )

    $bytes = New-Object byte[] $ByteLength
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()

    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return [Convert]::ToBase64String($bytes)
}

function Import-OrCreate-StcrSecret {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [int]$MinimumLength = 32
    )

    $value = Get-StcrUserVariable -Name $Name

    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = New-StcrRandomSecret
        Set-StcrUserVariable -Name $Name -Value $value
        Write-Host ("GENERATED " + $Name) -ForegroundColor Yellow
    }
    else {
        Set-Item -Path ("Env:" + $Name) -Value $value
        Write-Host ("KEEP " + $Name) -ForegroundColor DarkGray
    }

    if ($value.Length -lt $MinimumLength) {
        throw ($Name + " must contain at least " + $MinimumLength + " characters.")
    }

    return $value
}

$allowedOrigins = @(
    "https://0tyght.github.io",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173"
) -join ","

$ovenMap = [ordered]@{
    "1" = "oven-1"
    "2" = "oven-2"
    "3" = "oven-3"
    "4" = "oven-4"
    "5" = "oven-5"
    "6" = "oven-6"
    "7" = "oven-7"
    "8" = "oven-8"
    "9" = "oven-9"
} | ConvertTo-Json -Compress

$grOvenMap = [ordered]@{}
foreach ($ovenNumber in 11..26) {
    $grOvenMap[[string]$ovenNumber] = "oven-$ovenNumber"
}

$topicRoutes = [ordered]@{
    "test" = [ordered]@{ companyId = "ttn"; messageType = "status" }
    "sensor" = [ordered]@{ companyId = "ttn"; messageType = "sensor" }
    "status_gr" = [ordered]@{ companyId = "gr"; messageType = "status" }
    "sensor_gr" = [ordered]@{ companyId = "gr"; messageType = "sensor" }
} | ConvertTo-Json -Compress

$ovenMaps = [ordered]@{
    "ttn" = ($ovenMap | ConvertFrom-Json)
    "gr" = $grOvenMap
} | ConvertTo-Json -Compress

$settings = [ordered]@{
    STCR_DB_HOST = $DbHost
    STCR_DB_PORT = [string]$DbPort
    STCR_DB_USER = $DbUser
    STCR_DB_NAME = $DbName

    STCR_ALLOWED_ORIGINS = $allowedOrigins
    STCR_SESSION_TTL_MINUTES = "480"
    STCR_TRUST_PROXY = "false"
    STCR_DEPLOYMENT_MODE = "test"
    STCR_OFFLINE_THRESHOLD_SECONDS = "180"

    STCR_FACTORY_MQTT_ENABLED = "true"
    STCR_FACTORY_MQTT_URL = $MqttUrl
    STCR_FACTORY_MQTT_COMPANY_ID = $MqttCompanyId
    STCR_FACTORY_MQTT_TOPICS = "test,sensor"
    STCR_FACTORY_MQTT_CLIENT_ID = "stcr-multi-company-server"
    STCR_FACTORY_MQTT_OVEN_MAP_JSON = $ovenMap
    STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON = $topicRoutes
    STCR_FACTORY_MQTT_OVEN_MAPS_JSON = $ovenMaps

    # The current publisher sends Bangkok wall-clock time with a trailing Z.
    STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES = "420"

    # This broker currently uses mqtt:// in the test environment.
    STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED = "false"

    STCR_HTTP_INGEST_ENABLED = "false"
}

Write-Host ""
Write-Host "Configuring STCR user environment variables..." -ForegroundColor Cyan

foreach ($entry in $settings.GetEnumerator()) {
    Set-StcrUserVariable -Name $entry.Key -Value ([string]$entry.Value)
}

$null = Read-StcrRequiredSecret `
    -Name "STCR_DB_PASSWORD" `
    -Prompt "Enter the stcr_app MySQL password"

$null = Read-StcrRequiredText `
    -Name "STCR_FACTORY_MQTT_USERNAME" `
    -Prompt "Enter the MQTT username"

$null = Read-StcrRequiredSecret `
    -Name "STCR_FACTORY_MQTT_PASSWORD" `
    -Prompt "Enter the MQTT password"

$null = Import-OrCreate-StcrSecret `
    -Name "STCR_NODE_RED_CREDENTIAL_SECRET" `
    -MinimumLength 32

$null = Import-OrCreate-StcrSecret `
    -Name "STCR_API_KEY_PEPPER" `
    -MinimumLength 32

Write-Host ""
Write-Host "STCR environment is ready." -ForegroundColor Green
Write-Host ("MQTT topics  : " + $env:STCR_FACTORY_MQTT_TOPICS)
Write-Host "MQTT routes  : TTN=test,sensor | GR=status_gr,sensor_gr"
Write-Host ("MQTT URL     : " + $env:STCR_FACTORY_MQTT_URL)
Write-Host ("Allowed CORS : " + $env:STCR_ALLOWED_ORIGINS)
Write-Host ""
Write-Host "Restart the services so Node-RED loads the new variables:" -ForegroundColor Yellow
Write-Host "  npm run public:stop"
Write-Host "  npm run node-red:build"
Write-Host "  npm run node-red:validate"
Write-Host "  npm run public:start"
