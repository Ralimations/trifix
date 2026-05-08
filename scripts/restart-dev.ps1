[CmdletBinding()]
param(
  [switch]$CleanVerificationWork
)

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $workspaceRoot ".trifix-dev.pid"
$stdoutLog = Join-Path $workspaceRoot "dev.ps1.stdout.log"
$stderrLog = Join-Path $workspaceRoot "dev.ps1.stderr.log"
$currentStderrLog = Join-Path $workspaceRoot "dev.current.stderr.log"
$currentStdoutLog = Join-Path $workspaceRoot "dev.current.stdout.log"
$verificationWork = Join-Path $workspaceRoot ".verification-work"
$logWatcherScript = Join-Path $PSScriptRoot "watch-dev-log.ps1"

function Stop-ProcessTree {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    return
  }

  & taskkill /PID $ProcessId /T /F | Out-Null
}

function Stop-TrackedDevProcess {
  if (-not (Test-Path $pidFile)) {
    return
  }

  $trackedPid = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($trackedPid -match '^\d+$') {
    Stop-ProcessTree -ProcessId ([int]$trackedPid)
  }

  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Stop-VitePortListener {
  $listenerIds = netstat -ano |
    Select-String '127\.0\.0\.1:5173\s+.*LISTENING' |
    ForEach-Object { ($_ -split '\s+')[-1] } |
    Select-Object -Unique

  foreach ($listenerId in $listenerIds) {
    if ($listenerId -match '^\d+$') {
      Stop-Process -Id ([int]$listenerId) -Force -ErrorAction SilentlyContinue
    }
  }
}

function Stop-WorkspaceProcesses {
  $escapedRoot = [Regex]::Escape($workspaceRoot)
  $candidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -in @("node.exe", "electron.exe", "cmd.exe", "powershell.exe") -and
      $_.CommandLine -match $escapedRoot
    }

  foreach ($candidate in $candidates) {
    if ($candidate.ProcessId -and $candidate.ProcessId -ne $PID) {
      Stop-ProcessTree -ProcessId ([int]$candidate.ProcessId)
    }
  }
}

function Remove-StaleLogs {
  Remove-Item $stdoutLog, $stderrLog, $currentStdoutLog, $currentStderrLog -Force -ErrorAction SilentlyContinue
}

function Clear-VerificationWork {
  if (-not $CleanVerificationWork -or -not (Test-Path $verificationWork)) {
    return
  }

  Remove-Item -LiteralPath $verificationWork -Recurse -Force -ErrorAction SilentlyContinue
}

function Invoke-Build {
  Push-Location $workspaceRoot
  try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
      throw "npm run build failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

Stop-TrackedDevProcess
Stop-WorkspaceProcesses
Stop-VitePortListener
Remove-StaleLogs
Clear-VerificationWork
Invoke-Build

$process = Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList "run", "dev" `
  -WorkingDirectory $workspaceRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Set-Content -Path $pidFile -Value $process.Id

if (Test-Path $logWatcherScript) {
  $watchCommand = "powershell -NoExit -ExecutionPolicy Bypass -File `"$logWatcherScript`" -WorkspaceRoot `"$workspaceRoot`""
  Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList "/k", $watchCommand `
    -WorkingDirectory $workspaceRoot `
    -WindowStyle Normal | Out-Null
}

Write-Host "TriFix dev restarted from a fresh build."
Write-Host "PID: $($process.Id)"
Write-Host "Stdout: $stdoutLog"
Write-Host "Stderr: $stderrLog"
Write-Host "Log watcher: $logWatcherScript"
if ($CleanVerificationWork) {
  Write-Host "Verification work cleanup requested for: $verificationWork"
}
