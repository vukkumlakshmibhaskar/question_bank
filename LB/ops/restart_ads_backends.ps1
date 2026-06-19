param(
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptRoot
$LogDir = Join-Path $AppDir "logs"
$RestartLog = Join-Path $LogDir "daily_restart.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-RestartLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $RestartLog -Value $line
    Write-Host $line
}

function Test-HealthEndpoint {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
    } catch {
        return $false
    }
}

function Test-TcpPort {
    param([string]$HostName, [int]$Port)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(1000)) {
            $client.Close()
            return $false
        }
        $client.EndConnect($async)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

Write-RestartLog "ADS backend restart requested."
Write-RestartLog "App directory: $AppDir"
if (Test-TcpPort -HostName "127.0.0.1" -Port 6379) {
    Write-RestartLog "Redis is reachable on 127.0.0.1:6379."
} else {
    Write-RestartLog "WARNING: Redis is not reachable on 127.0.0.1:6379. Backends will use fallback where available; install/start Redis for safest workspace persistence."
}

$modulePatterns = @(
    "F52:app",
    "Lt:app",
    "question_crafter.textbook_question_api:app",
    "gateway:app",
    "start.py"
)

$escapedAppDir = [regex]::Escape($AppDir)
$pythonProcesses = Get-CimInstance Win32_Process -Filter "name = 'python.exe' or name = 'pythonw.exe'" |
    Where-Object {
        $cmd = $_.CommandLine
        if ([string]::IsNullOrWhiteSpace($cmd)) {
            return $false
        }

        $isThisApp = $cmd -match $escapedAppDir
        $isAdsBackend = $false
        foreach ($pattern in $modulePatterns) {
            if ($cmd -like "*$pattern*") {
                $isAdsBackend = $true
                break
            }
        }

        return ($isThisApp -and $isAdsBackend)
    }

foreach ($process in $pythonProcesses) {
    try {
        Write-RestartLog "Stopping process $($process.ProcessId): $($process.CommandLine)"
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
        Write-RestartLog "Could not stop process $($process.ProcessId): $($_.Exception.Message)"
    }
}

Start-Sleep -Seconds 3

if ($NoStart) {
    Write-RestartLog "NoStart was supplied. Existing ADS backend processes were stopped only."
    exit 0
}

$venvPython = Join-Path $AppDir "Venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPython) {
    $python = $venvPython
} else {
    $pythonCommand = Get-Command python -ErrorAction Stop
    $python = $pythonCommand.Source
}

$stdoutLog = Join-Path $LogDir "ads_start_stdout.log"
$stderrLog = Join-Path $LogDir "ads_start_stderr.log"

Write-RestartLog "Starting ADS backend cluster with $python"
$started = Start-Process `
    -FilePath $python `
    -ArgumentList @("start.py") `
    -WorkingDirectory $AppDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

Write-RestartLog "Started start.py process $($started.Id)."

$healthChecks = @(
    @{ Name = "Standard Gateway"; Url = "http://127.0.0.1:8070/gateway-health" },
    @{ Name = "Language Gateway"; Url = "http://127.0.0.1:8090/gateway-health" },
    @{ Name = "Question Crafter Gateway"; Url = "http://127.0.0.1:8100/gateway-health" }
)

foreach ($check in $healthChecks) {
    $healthy = $false
    for ($attempt = 1; $attempt -le 24; $attempt++) {
        if (Test-HealthEndpoint -Url $check.Url) {
            $healthy = $true
            break
        }
        Start-Sleep -Seconds 5
    }

    if ($healthy) {
        Write-RestartLog "$($check.Name) is healthy."
    } else {
        Write-RestartLog "$($check.Name) did not become healthy within the expected time: $($check.Url)"
    }
}

Write-RestartLog "ADS backend restart flow finished."
