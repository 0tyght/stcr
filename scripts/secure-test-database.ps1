$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  throw 'Open PowerShell as Administrator, then run: npm run db:secure'
}

$matchingRules = @()
Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -ErrorAction SilentlyContinue |
  ForEach-Object {
    $rule = $_
    $ports = $rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
    if ($ports.LocalPort -eq '3306') { $matchingRules += $rule }
  }

foreach ($rule in $matchingRules) {
  Disable-NetFirewallRule -Name $rule.Name
  Write-Host "Disabled inbound MariaDB rule: $($rule.DisplayName)" -ForegroundColor Green
}

if (-not $matchingRules.Count) {
  Write-Host 'No enabled inbound Allow rule for MariaDB port 3306 was found.' -ForegroundColor Green
}

Write-Host 'MariaDB remains available locally at 127.0.0.1:3306.' -ForegroundColor DarkGray

