$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RestartScript = Join-Path $ScriptRoot "restart_ads_backends.ps1"
$TaskName = "ADS Daily Backend Restart"
$TaskDescription = "Restarts ADS Standard Parser, Language Parser, and Question Crafter backends every day at 3:00 AM."

if (-not (Test-Path -LiteralPath $RestartScript)) {
    throw "Restart script not found: $RestartScript"
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RestartScript`""

$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

$currentUser = (whoami)
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Highest

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description $TaskDescription `
        -Force | Out-Null
} catch {
    Write-Warning "Could not install with highest privileges. Falling back to a normal current-user task."
    $principal = New-ScheduledTaskPrincipal `
        -UserId $currentUser `
        -LogonType Interactive `
        -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description $TaskDescription `
        -Force | Out-Null
}

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Schedule: every day at 3:00 AM"
Write-Host "Restart script: $RestartScript"
