[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $workspaceRoot ".trifix-dev.pid"
$stdoutLog = Join-Path $workspaceRoot "dev.ps1.stdout.log"
$stderrLog = Join-Path $workspaceRoot "dev.ps1.stderr.log"

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

Stop-TrackedDevProcess
Stop-VitePortListener

Remove-Item $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue

$process = Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList "run", "dev" `
  -WorkingDirectory $workspaceRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Set-Content -Path $pidFile -Value $process.Id

Write-Host "TriFix dev restarted."
Write-Host "PID: $($process.Id)"
Write-Host "Stdout: $stdoutLog"
Write-Host "Stderr: $stderrLog"
