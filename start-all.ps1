param(
  [string]$LbRoot = "",
  [switch]$Check,
  [switch]$SkipLb,
  [switch]$SkipBackend,
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $LbRoot) {
  $LbRoot = if ($env:LB_ROOT) { $env:LB_ROOT } else { Join-Path $ProjectRoot "LB" }
}

$BackendRoot = Join-Path $ProjectRoot "backend"
$FrontendRoot = Join-Path $ProjectRoot "frontend"
$LbStartFile = Join-Path $LbRoot "start.py"
$LbPython = Join-Path $LbRoot ".venv_qbank\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $LbPython)) {
  $LbPython = "python"
}

$Processes = New-Object System.Collections.Generic.List[System.Diagnostics.Process]

function Write-LauncherLine {
  param(
    [string]$Prefix,
    [string]$Message,
    [ConsoleColor]$Color = [ConsoleColor]::Gray
  )

  if ([string]::IsNullOrWhiteSpace($Message)) { return }
  Write-Host ("[{0}] {1}" -f $Prefix, $Message) -ForegroundColor $Color
}

function Assert-PathExists {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label was not found at: $Path"
  }
}

function Start-ManagedProcess {
  param(
    [string]$Name,
    [string]$FileName,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{},
    [ConsoleColor]$Color = [ConsoleColor]::Gray
  )

  Assert-PathExists -Path $WorkingDirectory -Label "$Name working directory"

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FileName
  foreach ($arg in $Arguments) {
    [void]$psi.ArgumentList.Add($arg)
  }
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  foreach ($key in $Environment.Keys) {
    $psi.Environment[$key] = [string]$Environment[$key]
  }

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  $process.EnableRaisingEvents = $true

  $outputHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $eventArgs)
    if ($eventArgs.Data) {
      Write-LauncherLine -Prefix $Name -Message $eventArgs.Data -Color $Color
    }
  }

  $errorHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $eventArgs)
    if ($eventArgs.Data) {
      Write-LauncherLine -Prefix $Name -Message $eventArgs.Data -Color ([ConsoleColor]::DarkYellow)
    }
  }

  $process.add_OutputDataReceived($outputHandler)
  $process.add_ErrorDataReceived($errorHandler)

  Write-LauncherLine -Prefix "START" -Message "$Name -> $FileName $($Arguments -join ' ')" -Color ([ConsoleColor]::Cyan)
  [void]$process.Start()
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()
  [void]$Processes.Add($process)
}

function Stop-ManagedProcesses {
  Write-LauncherLine -Prefix "STOP" -Message "Stopping QBank + LB processes..." -Color ([ConsoleColor]::Yellow)

  foreach ($process in $Processes) {
    if ($process -and -not $process.HasExited) {
      try {
        $process.CloseMainWindow() | Out-Null
        Start-Sleep -Milliseconds 300
        if (-not $process.HasExited) {
          $process.Kill($true)
        }
      } catch {
        Write-LauncherLine -Prefix "STOP" -Message $_.Exception.Message -Color ([ConsoleColor]::DarkYellow)
      }
    }
  }
}

try {
  Assert-PathExists -Path $BackendRoot -Label "QBank backend"
  Assert-PathExists -Path $FrontendRoot -Label "QBank frontend"
  if (-not $SkipLb) {
    Assert-PathExists -Path $LbStartFile -Label "LB start.py"
  }

  if ($Check) {
    Write-LauncherLine -Prefix "CHECK" -Message "QBank root: $ProjectRoot" -Color ([ConsoleColor]::Green)
    Write-LauncherLine -Prefix "CHECK" -Message "Backend root: $BackendRoot" -Color ([ConsoleColor]::Green)
    Write-LauncherLine -Prefix "CHECK" -Message "Frontend root: $FrontendRoot" -Color ([ConsoleColor]::Green)
    if (-not $SkipLb) {
      Write-LauncherLine -Prefix "CHECK" -Message "LB root: $LbRoot" -Color ([ConsoleColor]::Green)
      Write-LauncherLine -Prefix "CHECK" -Message "LB python: $LbPython" -Color ([ConsoleColor]::Green)
    }
    Write-LauncherLine -Prefix "CHECK" -Message "Launcher validation completed. No processes started." -Color ([ConsoleColor]::Green)
    return
  }

  if (-not $SkipLb) {
    Start-ManagedProcess `
      -Name "LB" `
      -FileName $LbPython `
      -Arguments @($LbStartFile) `
      -WorkingDirectory $LbRoot `
      -Color ([ConsoleColor]::Magenta)
  }

  if (-not $SkipBackend) {
    Start-ManagedProcess `
      -Name "QBANK-API" `
      -FileName "npm.cmd" `
      -Arguments @("run", "dev") `
      -WorkingDirectory $BackendRoot `
      -Environment @{
        "EXTRACTION_STANDARD_API_BASE" = "http://127.0.0.1:8070"
        "EXTRACTION_LANGUAGE_API_BASE" = "http://127.0.0.1:8090"
        "EXTRACTION_QUESTION_CRAFTER_API_BASE" = "http://127.0.0.1:8100"
      } `
      -Color ([ConsoleColor]::Green)
  }

  if (-not $SkipFrontend) {
    Start-ManagedProcess `
      -Name "QBANK-WEB" `
      -FileName "npm.cmd" `
      -Arguments @("run", "dev", "--", "--host", "0.0.0.0") `
      -WorkingDirectory $FrontendRoot `
      -Environment @{
        "VITE_API_URL" = "http://localhost:5000/api"
        "VITE_QBANK_API_URL" = "http://localhost:5000/api"
      } `
      -Color ([ConsoleColor]::Blue)
  }

  Write-Host ""
  Write-LauncherLine -Prefix "READY" -Message "QBank API: http://localhost:5000/api" -Color ([ConsoleColor]::Green)
  Write-LauncherLine -Prefix "READY" -Message "QBank UI:  http://localhost:5173" -Color ([ConsoleColor]::Green)
  Write-LauncherLine -Prefix "READY" -Message "LB standard/language/question-crafter: 8070 / 8090 / 8100" -Color ([ConsoleColor]::Green)
  Write-LauncherLine -Prefix "READY" -Message "Press Ctrl+C in this terminal to stop everything started by this launcher." -Color ([ConsoleColor]::Yellow)
  Write-Host ""

  while ($true) {
    Start-Sleep -Seconds 1
    foreach ($process in $Processes) {
      if ($process.HasExited -and $process.ExitCode -ne 0) {
        Write-LauncherLine -Prefix "WARN" -Message "A process exited: PID $($process.Id), exit code $($process.ExitCode)." -Color ([ConsoleColor]::DarkYellow)
      }
    }
  }
} finally {
  if ($Processes.Count -gt 0) {
    Stop-ManagedProcesses
  }
}
