param(
  [string]$LbRoot = "",
  [switch]$Check,
  [switch]$SkipLb,
  [switch]$SkipFonts,
  [switch]$SkipBackend,
  [switch]$SkipFrontend,
  [switch]$Watch,
  [switch]$Stop
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $LbRoot) {
  $LbRoot = if ($env:LB_ROOT) { $env:LB_ROOT } else { Join-Path $ProjectRoot "LB" }
}

$BackendRoot = Join-Path $ProjectRoot "backend"
$FrontendRoot = Join-Path $ProjectRoot "frontend"
$RuntimeLogRoot = Join-Path $ProjectRoot ".qbank-runtime"
$BackendPort = 5000
$FrontendPort = 5173
$BackendHealthUrl = "http://127.0.0.1:$BackendPort/api-docs/"
$FrontendHealthUrl = "http://127.0.0.1:$FrontendPort/"
$LbHealthUrls = @(
  "http://127.0.0.1:8070/docs",
  "http://127.0.0.1:8090/docs",
  "http://127.0.0.1:8100/docs",
  "http://127.0.0.1:8024/health"
)
$LbStartFile = Join-Path $LbRoot "start.py"
$LbFontsFile = Join-Path $LbRoot "fonts.py"
$LbPython = Join-Path $LbRoot ".venv_qbank\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $LbPython)) {
  $LbPython = "python"
}
$LbRuntimePorts = @(8070) + (8071..8079) + @(8090) + (8081..8089) + @(8100) + (8101..8109) + @(8024)
$BackendProcessPatterns = @([regex]::Escape($BackendRoot), "nodemon\s+src/app\.js", "node\s+src/app\.js")
$FrontendProcessPatterns = @([regex]::Escape($FrontendRoot))
$LbProcessPatterns = @([regex]::Escape($LbRoot))

$Processes = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$ProcessNames = @{}
$ReportedExitedProcesses = @{}
$StartedLb = $false

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

function ConvertTo-ProcessArguments {
  param(
    [string[]]$Arguments
  )

  $parts = foreach ($arg in $Arguments) {
    if ($null -eq $arg) { continue }

    $text = [string]$arg
    if ($text.Length -eq 0) {
      '""'
    } elseif ($text -notmatch '[\s"]') {
      $text
    } else {
      '"' + ($text -replace '"', '\"') + '"'
    }
  }

  return ($parts -join " ")
}

function ConvertTo-PowerShellLiteral {
  param(
    [AllowNull()][string]$Value
  )

  if ($null -eq $Value) {
    return "''"
  }

  return "'" + ([string]$Value -replace "'", "''") + "'"
}

function Test-LocalTcpPortOpen {
  param(
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(200, $false)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-BusyLocalPorts {
  param(
    [int[]]$Ports
  )

  $busyPorts = @()
  foreach ($port in $Ports) {
    if (Test-LocalTcpPortOpen -Port $port) {
      $busyPorts += $port
    }
  }
  return $busyPorts
}

function Test-HttpEndpoint {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 4
  )

  try {
    [void](Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds)
    return $true
  } catch {
    if ($_.Exception.Response) {
      return $true
    }
    return $false
  }
}

function Wait-ForHttpEndpoint {
  param(
    [string]$Name,
    [string]$Url,
    [int]$TimeoutSeconds = 60
  )

  for ($index = 0; $index -lt $TimeoutSeconds; $index++) {
    if (Test-HttpEndpoint -Url $Url -TimeoutSeconds 3) {
      Write-LauncherLine -Prefix "READY" -Message "$Name is responding at $Url." -Color ([ConsoleColor]::Green)
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "$Name did not respond at $Url within $TimeoutSeconds seconds."
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
  $psi.Arguments = ConvertTo-ProcessArguments -Arguments $Arguments
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
  $ProcessNames[$process.Id] = $Name
}

function Start-BackgroundProcess {
  param(
    [string]$Name,
    [string]$FileName,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{},
    [ConsoleColor]$Color = [ConsoleColor]::Gray
  )

  Assert-PathExists -Path $WorkingDirectory -Label "$Name working directory"
  if (-not (Test-Path -LiteralPath $RuntimeLogRoot)) {
    [void](New-Item -ItemType Directory -Path $RuntimeLogRoot -Force)
  }

  $safeName = $Name -replace '[^A-Za-z0-9_-]', '_'
  $logPath = Join-Path $RuntimeLogRoot "$safeName.log"
  $commandParts = @(
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "[Console]::InputEncoding = [System.Text.Encoding]::UTF8"
  )

  foreach ($key in $Environment.Keys) {
    $commandParts += ('$env:' + $key + ' = ' + (ConvertTo-PowerShellLiteral -Value ([string]$Environment[$key])))
  }

  $argumentList = @()
  foreach ($arg in $Arguments) {
    $argumentList += (ConvertTo-PowerShellLiteral -Value ([string]$arg))
  }

  $commandParts += "Set-Location -LiteralPath $(ConvertTo-PowerShellLiteral -Value $WorkingDirectory)"
  $commandParts += "& $(ConvertTo-PowerShellLiteral -Value $FileName) $($argumentList -join ' ') *> $(ConvertTo-PowerShellLiteral -Value $logPath)"
  $command = $commandParts -join "; "

  Write-LauncherLine -Prefix "START" -Message "$Name -> $FileName $($Arguments -join ' ')" -Color ([ConsoleColor]::Cyan)
  $process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden `
    -PassThru
  Write-LauncherLine -Prefix $Name -Message "Started in background, PID $($process.Id), log: $logPath" -Color $Color
}

function Wait-ForLocalTcpPort {
  param(
    [string]$Name,
    [int]$Port,
    [int]$TimeoutSeconds = 60
  )

  for ($index = 0; $index -lt $TimeoutSeconds; $index++) {
    if (Test-LocalTcpPortOpen -Port $Port) {
      Write-LauncherLine -Prefix "READY" -Message "$Name is listening on port $Port." -Color ([ConsoleColor]::Green)
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "$Name did not start listening on port $Port within $TimeoutSeconds seconds."
}

function Invoke-SetupProcess {
  param(
    [string]$Name,
    [string]$FileName,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{},
    [ConsoleColor]$Color = [ConsoleColor]::Gray
  )

  Assert-PathExists -Path $WorkingDirectory -Label "$Name working directory"

  $previousLocation = Get-Location
  $previousEnvironment = @{}
  $setupEnvironment = @{
    "PYTHONUNBUFFERED" = "1"
    "PYTHONIOENCODING" = "utf-8"
    "PYTHONUTF8" = "1"
  }
  foreach ($key in $Environment.Keys) {
    $setupEnvironment[$key] = [string]$Environment[$key]
  }

  Write-LauncherLine -Prefix "SETUP" -Message "$Name -> $FileName $($Arguments -join ' ')" -Color ([ConsoleColor]::Cyan)
  try {
    foreach ($key in $setupEnvironment.Keys) {
      $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
      [Environment]::SetEnvironmentVariable($key, [string]$setupEnvironment[$key], "Process")
    }

    Set-Location -LiteralPath $WorkingDirectory
    & $FileName @Arguments
    $exitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }
    if ($exitCode -ne 0) {
      throw "$Name failed with exit code $exitCode."
    }
  } finally {
    Set-Location -LiteralPath $previousLocation
    foreach ($key in $previousEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], "Process")
    }
  }
}

function Stop-ManagedProcesses {
  Write-LauncherLine -Prefix "STOP" -Message "Stopping QBank + LB processes..." -Color ([ConsoleColor]::Yellow)

  foreach ($process in $Processes) {
    if ($process -and -not $process.HasExited) {
      try {
        $process.CloseMainWindow() | Out-Null
        Start-Sleep -Milliseconds 300
        if (-not $process.HasExited) {
          & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null
        }
      } catch {
        Write-LauncherLine -Prefix "STOP" -Message $_.Exception.Message -Color ([ConsoleColor]::DarkYellow)
      }
    }
  }
}

function Stop-ProcessesByLocalPorts {
  param(
    [int[]]$Ports,
    [string]$Label
  )

  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $Ports -contains $_.LocalPort })
  $owningProcesses = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -and $_ -gt 0 })
  if ($owningProcesses.Count -eq 0) {
    return
  }

  Write-LauncherLine -Prefix "STOP" -Message "Stopping remaining $Label listener(s): $($owningProcesses -join ', ')" -Color ([ConsoleColor]::Yellow)
  foreach ($processId in $owningProcesses) {
    try {
      $taskkillOutput = & taskkill.exe /PID $processId /T /F 2>&1
      foreach ($line in $taskkillOutput) {
        if ($line -match "^ERROR" -and $line -notmatch "not found|no running instance|could not be terminated") {
          Write-LauncherLine -Prefix "STOP" -Message $line -Color ([ConsoleColor]::DarkYellow)
        }
      }
    } catch {
      Write-LauncherLine -Prefix "STOP" -Message $_.Exception.Message -Color ([ConsoleColor]::DarkYellow)
    }
  }
}

function Stop-ProcessesByCommandLine {
  param(
    [string[]]$Patterns,
    [string]$Label
  )

  $matchedProcesses = New-Object System.Collections.Generic.List[object]
  $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)

  foreach ($process in $allProcesses) {
    if (-not $process.CommandLine) {
      continue
    }
    if ([int]$process.ProcessId -eq [int]$PID) {
      continue
    }

    foreach ($pattern in $Patterns) {
      if ($process.CommandLine -match $pattern) {
        [void]$matchedProcesses.Add($process)
        break
      }
    }
  }

  $processIds = @($matchedProcesses | Select-Object -ExpandProperty ProcessId -Unique)
  if ($processIds.Count -eq 0) {
    return
  }

  Write-LauncherLine -Prefix "STOP" -Message "Stopping stale $Label process(es): $($processIds -join ', ')" -Color ([ConsoleColor]::Yellow)
  foreach ($processId in $processIds) {
    try {
      $taskkillOutput = & taskkill.exe /PID $processId /T /F 2>&1
      foreach ($line in $taskkillOutput) {
        if ($line -match "^ERROR" -and $line -notmatch "not found|no running instance|could not be terminated") {
          Write-LauncherLine -Prefix "STOP" -Message $line -Color ([ConsoleColor]::DarkYellow)
        }
      }
    } catch {
      Write-LauncherLine -Prefix "STOP" -Message $_.Exception.Message -Color ([ConsoleColor]::DarkYellow)
    }
  }
}

try {
  if ($Stop) {
    Stop-ProcessesByCommandLine -Patterns $BackendProcessPatterns -Label "QBank API"
    Stop-ProcessesByCommandLine -Patterns $FrontendProcessPatterns -Label "QBank UI"
    Stop-ProcessesByCommandLine -Patterns $LbProcessPatterns -Label "LB"
    Stop-ProcessesByLocalPorts -Ports ($LbRuntimePorts + @($BackendPort, $FrontendPort)) -Label "QBank/LB"
    Write-LauncherLine -Prefix "STOP" -Message "Stop command completed." -Color ([ConsoleColor]::Green)
    return
  }

  Assert-PathExists -Path $BackendRoot -Label "QBank backend"
  Assert-PathExists -Path $FrontendRoot -Label "QBank frontend"
  if (-not $SkipLb) {
    Assert-PathExists -Path $LbStartFile -Label "LB start.py"
    if (-not $SkipFonts) {
      Assert-PathExists -Path $LbFontsFile -Label "LB fonts.py"
    }
  }

  if ($Check) {
    Write-LauncherLine -Prefix "CHECK" -Message "QBank root: $ProjectRoot" -Color ([ConsoleColor]::Green)
    Write-LauncherLine -Prefix "CHECK" -Message "Backend root: $BackendRoot" -Color ([ConsoleColor]::Green)
    Write-LauncherLine -Prefix "CHECK" -Message "Backend port: $BackendPort" -Color ([ConsoleColor]::Green)
    Write-LauncherLine -Prefix "CHECK" -Message "Frontend root: $FrontendRoot" -Color ([ConsoleColor]::Green)
    Write-LauncherLine -Prefix "CHECK" -Message "Frontend port: $FrontendPort" -Color ([ConsoleColor]::Green)
    Write-LauncherLine -Prefix "CHECK" -Message "Mode: $(if ($Watch) { 'watch/log mode' } else { 'background launcher mode' })" -Color ([ConsoleColor]::Green)
    if (-not $SkipLb) {
      Write-LauncherLine -Prefix "CHECK" -Message "LB root: $LbRoot" -Color ([ConsoleColor]::Green)
      Write-LauncherLine -Prefix "CHECK" -Message "LB python: $LbPython" -Color ([ConsoleColor]::Green)
      Write-LauncherLine -Prefix "CHECK" -Message "LB runtime ports: $($LbRuntimePorts -join ', ')" -Color ([ConsoleColor]::Green)
      if (-not $SkipFonts) {
        Write-LauncherLine -Prefix "CHECK" -Message "LB fonts setup: $LbFontsFile" -Color ([ConsoleColor]::Green)
      }
    }
    Write-LauncherLine -Prefix "CHECK" -Message "Launcher validation completed. No processes started." -Color ([ConsoleColor]::Green)
    return
  }

  if (-not $SkipLb) {
    $healthyLbUrls = @($LbHealthUrls | Where-Object { Test-HttpEndpoint -Url $_ -TimeoutSeconds 3 })
    if ($healthyLbUrls.Count -eq $LbHealthUrls.Count) {
      Write-LauncherLine `
        -Prefix "LB" `
        -Message "Existing LB services are responding. Skipping LB/start.py." `
        -Color ([ConsoleColor]::Yellow)
    } else {
      $busyLbPorts = @(Get-BusyLocalPorts -Ports $LbRuntimePorts)
      if ($busyLbPorts.Count -gt 0) {
        Write-LauncherLine `
          -Prefix "LB" `
          -Message "Partial/stale LB services detected on port(s): $($busyLbPorts -join ', '). Restarting LB cleanly." `
          -Color ([ConsoleColor]::Yellow)
        Stop-ProcessesByCommandLine -Patterns $LbProcessPatterns -Label "stale LB"
        Stop-ProcessesByLocalPorts -Ports $LbRuntimePorts -Label "stale LB"
        Start-Sleep -Seconds 2
      }

      if (-not $SkipFonts) {
        Invoke-SetupProcess `
          -Name "LB-FONTS" `
          -FileName $LbPython `
          -Arguments @($LbFontsFile) `
          -WorkingDirectory $LbRoot `
          -Color ([ConsoleColor]::DarkCyan)
      }

      if ($Watch) {
        Start-ManagedProcess `
          -Name "LB" `
          -FileName $LbPython `
          -Arguments @($LbStartFile) `
          -WorkingDirectory $LbRoot `
          -Color ([ConsoleColor]::Magenta)
        $StartedLb = $true
      } else {
        Start-BackgroundProcess `
          -Name "LB" `
          -FileName $LbPython `
          -Arguments @($LbStartFile) `
          -WorkingDirectory $LbRoot `
          -Environment @{
            "PYTHONUNBUFFERED" = "1"
            "PYTHONIOENCODING" = "utf-8"
            "PYTHONUTF8" = "1"
          } `
          -Color ([ConsoleColor]::Magenta)
        Wait-ForHttpEndpoint -Name "LB standard gateway" -Url "http://127.0.0.1:8070/docs" -TimeoutSeconds 120
        Wait-ForHttpEndpoint -Name "LB language gateway" -Url "http://127.0.0.1:8090/docs" -TimeoutSeconds 120
        Wait-ForHttpEndpoint -Name "LB question crafter gateway" -Url "http://127.0.0.1:8100/docs" -TimeoutSeconds 120
        Wait-ForHttpEndpoint -Name "LB translation API" -Url "http://127.0.0.1:8024/health" -TimeoutSeconds 120
      }
    }
  }

  if (-not $SkipBackend) {
    if (Test-HttpEndpoint -Url $BackendHealthUrl -TimeoutSeconds 3) {
      Write-LauncherLine -Prefix "QBANK-API" -Message "Backend is responding. Skipping backend start." -Color ([ConsoleColor]::Yellow)
    } else {
      if (Test-LocalTcpPortOpen -Port $BackendPort) {
        Write-LauncherLine -Prefix "QBANK-API" -Message "Port $BackendPort is open but backend health failed. Restarting that listener." -Color ([ConsoleColor]::Yellow)
        Stop-ProcessesByLocalPorts -Ports @($BackendPort) -Label "stale QBank API"
        Start-Sleep -Seconds 1
      }
      Stop-ProcessesByCommandLine -Patterns $BackendProcessPatterns -Label "stale QBank API"

      $backendEnvironment = @{
        "EXTRACTION_STANDARD_API_BASE" = "http://127.0.0.1:8070"
        "EXTRACTION_LANGUAGE_API_BASE" = "http://127.0.0.1:8090"
        "EXTRACTION_QUESTION_CRAFTER_API_BASE" = "http://127.0.0.1:8100"
        "TRANSLATION_API_BASE" = "http://127.0.0.1:8024"
      }
      if ($Watch) {
        Start-ManagedProcess `
          -Name "QBANK-API" `
          -FileName "cmd.exe" `
          -Arguments @("/d", "/s", "/c", "npm run dev") `
          -WorkingDirectory $BackendRoot `
          -Environment $backendEnvironment `
          -Color ([ConsoleColor]::Green)
      } else {
        Start-BackgroundProcess `
          -Name "QBANK-API" `
          -FileName "cmd.exe" `
          -Arguments @("/d", "/s", "/c", "npm start") `
          -WorkingDirectory $BackendRoot `
          -Environment $backendEnvironment `
          -Color ([ConsoleColor]::Green)
        Wait-ForHttpEndpoint -Name "QBank API" -Url $BackendHealthUrl -TimeoutSeconds 90
      }
    }
  }

  if (-not $SkipFrontend) {
    if (Test-HttpEndpoint -Url $FrontendHealthUrl -TimeoutSeconds 3) {
      Write-LauncherLine -Prefix "QBANK-WEB" -Message "Frontend is responding. Skipping frontend start." -Color ([ConsoleColor]::Yellow)
    } else {
      if (Test-LocalTcpPortOpen -Port $FrontendPort) {
        Write-LauncherLine -Prefix "QBANK-WEB" -Message "Port $FrontendPort is open but frontend health failed. Restarting that listener." -Color ([ConsoleColor]::Yellow)
        Stop-ProcessesByLocalPorts -Ports @($FrontendPort) -Label "stale QBank UI"
        Start-Sleep -Seconds 1
      }
      Stop-ProcessesByCommandLine -Patterns $FrontendProcessPatterns -Label "stale QBank UI"

      $frontendEnvironment = @{
        "VITE_API_URL" = "http://localhost:5000/api"
        "VITE_QBANK_API_URL" = "http://localhost:5000/api"
      }
      if ($Watch) {
        Start-ManagedProcess `
          -Name "QBANK-WEB" `
          -FileName "cmd.exe" `
          -Arguments @("/d", "/s", "/c", "npm run dev -- --host 0.0.0.0") `
          -WorkingDirectory $FrontendRoot `
          -Environment $frontendEnvironment `
          -Color ([ConsoleColor]::Blue)
      } else {
        Start-BackgroundProcess `
          -Name "QBANK-WEB" `
          -FileName "cmd.exe" `
          -Arguments @("/d", "/s", "/c", "npm run dev -- --host 0.0.0.0") `
          -WorkingDirectory $FrontendRoot `
          -Environment $frontendEnvironment `
          -Color ([ConsoleColor]::Blue)
        Wait-ForHttpEndpoint -Name "QBank UI" -Url $FrontendHealthUrl -TimeoutSeconds 90
      }
    }
  }

  Write-Host ""
  Write-LauncherLine -Prefix "READY" -Message "QBank API: http://localhost:5000/api" -Color ([ConsoleColor]::Green)
  Write-LauncherLine -Prefix "READY" -Message "QBank UI:  http://localhost:5173" -Color ([ConsoleColor]::Green)
  Write-LauncherLine -Prefix "READY" -Message "LB standard/language/question-crafter/translation: 8070 / 8090 / 8100 / 8024" -Color ([ConsoleColor]::Green)
  if ($Watch) {
    Write-LauncherLine -Prefix "READY" -Message "Press Ctrl+C in this terminal to stop everything started by this launcher." -Color ([ConsoleColor]::Yellow)
  } else {
    Write-LauncherLine -Prefix "READY" -Message "All requested services are running in the background. This launcher can close safely." -Color ([ConsoleColor]::Yellow)
  }
  Write-Host ""

  if (-not $Watch) {
    return
  }

  if ($Processes.Count -eq 0) {
    Write-LauncherLine -Prefix "READY" -Message "No new processes were started by this launcher." -Color ([ConsoleColor]::Yellow)
    return
  }

  while ($true) {
    Start-Sleep -Seconds 1
    foreach ($process in $Processes) {
      if ($process.HasExited -and $process.ExitCode -ne 0 -and -not $ReportedExitedProcesses.ContainsKey($process.Id)) {
        $processName = if ($ProcessNames.ContainsKey($process.Id)) { $ProcessNames[$process.Id] } else { "process" }
        Write-LauncherLine -Prefix "WARN" -Message "$processName exited: PID $($process.Id), exit code $($process.ExitCode)." -Color ([ConsoleColor]::DarkYellow)
        $ReportedExitedProcesses[$process.Id] = $true
      }
    }
  }
} finally {
  if ($Processes.Count -gt 0) {
    Stop-ManagedProcesses
  }
  if ($StartedLb) {
    Stop-ProcessesByLocalPorts -Ports $LbRuntimePorts -Label "LB"
  }
}
