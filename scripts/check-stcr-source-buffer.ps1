param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("gr", "ttn")]
    [string]$Company,

    [string]$NodeRedUserDir = (Join-Path $env:USERPROFILE ".node-red")
)

$ErrorActionPreference = "Stop"
$companyId = $Company.ToLowerInvariant()
$databaseName = if ($companyId -eq "gr") { "stcr-buffer-gr.db" } else { "stcr-buffer.db" }
$databasePath = Join-Path "C:\STCR\data" $databaseName
$flowPath = Join-Path $NodeRedUserDir "flows.json"
$expectedAckTopic = "stcr/ack/$companyId"

$checks = [ordered]@{
    Company = $companyId
    FlowFileExists = Test-Path -LiteralPath $flowPath
    BufferDatabaseExists = Test-Path -LiteralPath $databasePath
    HasSqliteNodes = $false
    HasMqttPublisher = $false
    HasDatabaseAckSubscriber = $false
    HasDurableMessageId = $false
}

if ($checks.FlowFileExists) {
    $flowText = Get-Content -Raw -LiteralPath $flowPath
    $nodes = $flowText | ConvertFrom-Json
    $checks.HasSqliteNodes = @($nodes | Where-Object { $_.type -eq "sqlite" }).Count -gt 0
    $checks.HasMqttPublisher = @($nodes | Where-Object { $_.type -eq "mqtt out" }).Count -gt 0
    $checks.HasDatabaseAckSubscriber = @(
        $nodes | Where-Object {
            $_.type -eq "mqtt in" -and
            $_.topic -eq $expectedAckTopic -and
            [string]$_.qos -eq "1"
        }
    ).Count -gt 0
    $checks.HasDurableMessageId = $flowText.Contains("_stcr_message_id")
}

if ($checks.BufferDatabaseExists) {
    $database = Get-Item -LiteralPath $databasePath
    $checks.BufferDatabaseBytes = $database.Length
    $checks.BufferDatabaseModifiedAt = $database.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
}

[pscustomobject]$checks | Format-List

$required = @(
    "FlowFileExists",
    "BufferDatabaseExists",
    "HasSqliteNodes",
    "HasMqttPublisher",
    "HasDatabaseAckSubscriber",
    "HasDurableMessageId"
)
$failed = @($required | Where-Object { -not $checks[$_] })
if ($failed.Count -gt 0) {
    Write-Error "Source buffer is not production-ready: $($failed -join ', ')"
    exit 1
}

Write-Output "SOURCE_BUFFER=READY"
