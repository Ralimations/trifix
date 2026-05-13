[CmdletBinding()]
param(
  [switch]$CleanVerificationWork,
  [switch]$NoStart,
  [switch]$Start,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$workspaceRootLower = $workspaceRoot.ToLowerInvariant()
$pidFile = Join-Path $workspaceRoot ".trifix-dev.pid"
$stdoutLog = Join-Path $workspaceRoot "dev.ps1.stdout.log"
$stderrLog = Join-Path $workspaceRoot "dev.ps1.stderr.log"
$currentStderrLog = Join-Path $workspaceRoot "dev.current.stderr.log"
$verificationWork = Join-Path $workspaceRoot ".verification-work"
$logWatcherScript = Join-Path $PSScriptRoot "watch-dev-log.ps1"
$documentsRoot = [Environment]::GetFolderPath("MyDocuments")
$sandboxRoot = Join-Path $documentsRoot "TriFix AI Sandbox"
$script:TimestampNow = (Get-Date).ToString("o")
$script:StoppedPids = New-Object System.Collections.Generic.HashSet[int]
$script:SkippedPids = New-Object System.Collections.Generic.HashSet[int]
$script:SnapshotByPid = @{}
$script:DescendantsByParent = @{}
$script:TrackedRegistryEntries = @()
$script:CandidateMap = @{}

$shouldStart = $true
if ($NoStart) {
  $shouldStart = $false
} elseif ($Start) {
  $shouldStart = $true
}

$triFixScriptMarkers = @(
  (Join-Path $workspaceRoot "scripts\\dev.mjs").ToLowerInvariant(),
  (Join-Path $workspaceRoot "scripts\\start.mjs").ToLowerInvariant(),
  (Join-Path $workspaceRoot "scripts\\restart-dev.ps1").ToLowerInvariant(),
  $workspaceRootLower,
  "npm run dev",
  "npm run dev:vite",
  "vite --host 127.0.0.1 --port 5173",
  "watch-dev-log.ps1",
  "electron/main.cjs",
  "trifix-ai-tiny-office"
)

$lmStudioPatterns = @(
  "lm studio",
  "lm-studio",
  "lmstudio",
  "\lm studio\",
  "\lmstudio\",
  "\lms\"
)

$modelServerPatterns = @(
  "ollama",
  "api/v1/chat",
  "127.0.0.1:3010",
  "10.8.0.3:3011"
)

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message =="
}

function Write-Detail {
  param([string]$Message)
  Write-Verbose $Message
}

function Normalize-Text {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) {
    return ""
  }
  return $Value.ToLowerInvariant()
}

function Test-LmStudioText {
  param([AllowNull()][string]$Value)
  $text = Normalize-Text $Value
  if (-not $text) {
    return $false
  }
  foreach ($pattern in $lmStudioPatterns) {
    if ($text.Contains($pattern)) {
      return $true
    }
  }
  return $false
}

function Test-ModelServerText {
  param([AllowNull()][string]$Value)
  $text = Normalize-Text $Value
  if (-not $text) {
    return $false
  }
  foreach ($pattern in $modelServerPatterns) {
    if ($text.Contains($pattern)) {
      return $true
    }
  }
  return $false
}

function Test-PidAlive {
  param([int]$ProcessId)
  if ($ProcessId -le 0) {
    return $false
  }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function New-ProcessInfo {
  param(
    [int]$ProcessId,
    [int]$ParentProcessId,
    [string]$Name,
    [string]$CommandLine,
    [string]$ExecutablePath
  )

  [PSCustomObject]@{
    ProcessId = $ProcessId
    ParentProcessId = $ParentProcessId
    Name = $Name
    CommandLine = $CommandLine
    ExecutablePath = $ExecutablePath
  }
}

function Get-ProcessSnapshot {
  $snapshot = @{}
  $descendants = @{}

  try {
    $items = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Select-Object ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath

    foreach ($item in $items) {
      if (-not $item.ProcessId) {
        continue
      }
      $parentProcessId = 0
      if ($null -ne $item.ParentProcessId) {
        $parentProcessId = [int]$item.ParentProcessId
      }
      $entry = New-ProcessInfo -ProcessId ([int]$item.ProcessId) `
        -ParentProcessId $parentProcessId `
        -Name ([string]$item.Name) `
        -CommandLine ([string]$item.CommandLine) `
        -ExecutablePath ([string]$item.ExecutablePath)
      $snapshot[$entry.ProcessId] = $entry
    }
  } catch {
    Write-Detail "CIM process snapshot failed: $($_.Exception.Message)"
  }

  foreach ($proc in Get-Process -ErrorAction SilentlyContinue) {
    if (-not $snapshot.ContainsKey($proc.Id)) {
      $entry = New-ProcessInfo -ProcessId ([int]$proc.Id) `
        -ParentProcessId 0 `
        -Name ([string]$proc.ProcessName) `
        -CommandLine "" `
        -ExecutablePath ([string]$proc.Path)
      $snapshot[$entry.ProcessId] = $entry
    }
  }

  foreach ($entry in $snapshot.Values) {
    if (-not $descendants.ContainsKey($entry.ParentProcessId)) {
      $descendants[$entry.ParentProcessId] = New-Object System.Collections.Generic.List[int]
    }
    $descendants[$entry.ParentProcessId].Add($entry.ProcessId)
  }

  return @{
    Snapshot = $snapshot
    Descendants = $descendants
  }
}

function Get-DescendantPids {
  param([int]$RootPid)

  $result = New-Object System.Collections.Generic.HashSet[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($RootPid)

  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    $children = $script:DescendantsByParent[$current]
    if ($null -eq $children) {
      continue
    }
    foreach ($childPid in $children) {
      if ($result.Add([int]$childPid)) {
        $queue.Enqueue([int]$childPid)
      }
    }
  }

  return @($result)
}

function Get-TrackedPidFileValue {
  if (-not (Test-Path $pidFile)) {
    return $null
  }
  $raw = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($raw -match '^\d+$') {
    return [int]$raw
  }
  return $null
}

function Test-TriFixWorkspaceProcess {
  param($ProcessInfo)
  $commandLine = Normalize-Text $ProcessInfo.CommandLine
  $executablePath = Normalize-Text $ProcessInfo.ExecutablePath
  foreach ($marker in $triFixScriptMarkers) {
    if (($commandLine -and $commandLine.Contains($marker)) -or ($executablePath -and $executablePath.Contains($marker))) {
      return $true
    }
  }
  return $false
}

function Test-ExpectedTriFixBinaryName {
  param([AllowNull()][string]$Name)
  $normalized = Normalize-Text $Name
  return $normalized -in @(
    "node",
    "node.exe",
    "electron",
    "electron.exe",
    "cmd",
    "cmd.exe",
    "powershell",
    "powershell.exe",
    "pwsh",
    "pwsh.exe",
    "chrome",
    "chrome.exe",
    "chromium",
    "chromium.exe",
    "msedge",
    "msedge.exe",
    "conhost",
    "conhost.exe",
    "esbuild",
    "esbuild.exe"
  )
}

function Test-ManagedRecordMatchesLiveProcess {
  param(
    $ProcessInfo,
    [string]$ProjectRoot
  )

  if ($null -eq $ProcessInfo) {
    return $false
  }

  $projectRootLower = Normalize-Text $ProjectRoot
  $commandLine = Normalize-Text $ProcessInfo.CommandLine
  $executablePath = Normalize-Text $ProcessInfo.ExecutablePath
  $combined = "{0}`n{1}`n{2}" -f $ProcessInfo.Name, $ProcessInfo.CommandLine, $ProcessInfo.ExecutablePath

  if (Test-LmStudioText $combined -or Test-ModelServerText $combined) {
    return $false
  }

  if (($projectRootLower -and $commandLine.Contains($projectRootLower)) -or ($projectRootLower -and $executablePath.Contains($projectRootLower))) {
    return $true
  }
  if (($commandLine -and $commandLine.Contains($workspaceRootLower)) -or ($executablePath -and $executablePath.Contains($workspaceRootLower))) {
    return $true
  }
  if (Test-ExpectedTriFixBinaryName $ProcessInfo.Name) {
    foreach ($childProcessId in Get-DescendantPids -RootPid ([int]$ProcessInfo.ProcessId)) {
      $childInfo = $script:SnapshotByPid[[int]$childProcessId]
      if ($null -eq $childInfo) {
        continue
      }
      $childCommandLine = Normalize-Text $childInfo.CommandLine
      $childExecutablePath = Normalize-Text $childInfo.ExecutablePath
      if (($projectRootLower -and $childCommandLine.Contains($projectRootLower)) -or ($projectRootLower -and $childExecutablePath.Contains($projectRootLower))) {
        return $true
      }
      if (($childCommandLine -and $childCommandLine.Contains($workspaceRootLower)) -or ($childExecutablePath -and $childExecutablePath.Contains($workspaceRootLower))) {
        return $true
      }
    }
  }

  return $false
}

function Get-ManagedRegistryPaths {
  $roots = @($workspaceRoot)
  if ((Test-Path $sandboxRoot) -and $sandboxRoot -ne $workspaceRoot) {
    $roots += $sandboxRoot
  }

  $paths = New-Object System.Collections.Generic.HashSet[string]
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) {
      continue
    }
    try {
      $trifixDirs = Get-ChildItem -Path $root -Directory -Filter ".trifix" -Recurse -ErrorAction SilentlyContinue
      foreach ($dir in $trifixDirs) {
        $candidate = Join-Path $dir.FullName "processes\\processes.json"
        if (Test-Path $candidate) {
          [void]$paths.Add($candidate)
        }
      }
    } catch {
      Write-Detail "Could not scan $root for .trifix process registries: $($_.Exception.Message)"
    }
  }

  return @($paths)
}

function Get-ManagedRegistryEntries {
  $entries = @()
  foreach ($registryPath in Get-ManagedRegistryPaths) {
    try {
      $rootDir = Split-Path -Parent (Split-Path -Parent $registryPath)
      $records = Get-Content $registryPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      foreach ($record in @($records)) {
        if ($null -eq $record) {
          continue
        }
        $recordPid = 0
        try {
          $recordPid = [int]$record.pid
        } catch {
          $recordPid = 0
        }
        $entries += [PSCustomObject]@{
          RegistryPath = $registryPath
          ProjectRoot = $rootDir
          Record = $record
          ProcessId = $recordPid
        }
      }
    } catch {
      Write-Detail ("Could not read managed process registry {0}: {1}" -f $registryPath, $_.Exception.Message)
    }
  }
  return $entries
}

function Get-ProcessCategory {
  param(
    $ProcessInfo,
    [string]$Source
  )

  $name = Normalize-Text $ProcessInfo.Name
  $commandLine = Normalize-Text $ProcessInfo.CommandLine

  if ($commandLine.Contains("watch-dev-log.ps1")) {
    return "log-watcher"
  }
  if ($name -eq "electron.exe" -or $name -eq "electron" -or $commandLine.Contains("electron/main.cjs") -or $commandLine.Contains("vite_dev_server_url")) {
    return "trifix-electron"
  }
  if ($commandLine.Contains("dev:vite") -or ($commandLine.Contains("vite") -and $commandLine.Contains("5173"))) {
    return "trifix-vite"
  }
  if ($Source -eq "managed-record" -or $commandLine.Contains(".trifix\\processes")) {
    return "managed-project-server"
  }
  if ($name -eq "cmd.exe" -or $name -eq "cmd" -or $name -eq "npm.cmd" -or $name -eq "npm") {
    return "wrapper"
  }
  if ($name -eq "node.exe" -or $name -eq "node") {
    return "node-child"
  }
  if (($name -like "chrome*" -or $name -like "chromium*" -or $name -eq "msedge.exe" -or $name -eq "msedge") -and ($commandLine.Contains("playwright") -or $Source -eq "descendant")) {
    return "playwright-browser"
  }
  return "other"
}

function Get-ProcessPriority {
  param([string]$Category)
  switch ($Category) {
    "trifix-electron" { return 10 }
    "trifix-vite" { return 20 }
    "managed-project-server" { return 30 }
    "wrapper" { return 40 }
    "node-child" { return 50 }
    "playwright-browser" { return 60 }
    "log-watcher" { return 70 }
    default { return 80 }
  }
}

function Register-CandidateProcess {
  param(
    [int]$ProcessId,
    [string]$Source,
    [string]$Reason,
    [string]$RegistryPath = "",
    [string]$ProjectRoot = ""
  )

  if ($ProcessId -le 0 -or $ProcessId -eq $PID) {
    return
  }

  $processInfo = $script:SnapshotByPid[$ProcessId]
  if ($null -eq $processInfo) {
    return
  }

  $combinedText = "{0}`n{1}`n{2}" -f $processInfo.Name, $processInfo.CommandLine, $processInfo.ExecutablePath
  if (Test-LmStudioText $combinedText) {
    [void]$script:SkippedPids.Add($ProcessId)
    Write-Host "Skipped LM Studio PID $ProcessId"
    return
  }
  if (Test-ModelServerText $combinedText) {
    [void]$script:SkippedPids.Add($ProcessId)
    Write-Host "Skipped model server PID $ProcessId"
    return
  }

  if ($script:CandidateMap.ContainsKey($ProcessId)) {
    $existing = $script:CandidateMap[$ProcessId]
    if ($Reason -and -not $existing.Reasons.Contains($Reason)) {
      $existing.Reasons.Add($Reason)
    }
    if ($Source -and -not $existing.Sources.Contains($Source)) {
      $existing.Sources.Add($Source)
    }
    if ($RegistryPath -and -not $existing.RegistryPaths.Contains($RegistryPath)) {
      $existing.RegistryPaths.Add($RegistryPath)
    }
    if ($ProjectRoot -and -not $existing.ProjectRoots.Contains($ProjectRoot)) {
      $existing.ProjectRoots.Add($ProjectRoot)
    }
    return
  }

  $category = Get-ProcessCategory -ProcessInfo $processInfo -Source $Source
  $candidate = [PSCustomObject]@{
    ProcessId = $ProcessId
    ParentProcessId = [int]$processInfo.ParentProcessId
    Name = [string]$processInfo.Name
    CommandLine = [string]$processInfo.CommandLine
    ExecutablePath = [string]$processInfo.ExecutablePath
    Category = $category
    Priority = Get-ProcessPriority -Category $category
    Sources = (New-Object System.Collections.Generic.List[string])
    Reasons = (New-Object System.Collections.Generic.List[string])
    RegistryPaths = (New-Object System.Collections.Generic.List[string])
    ProjectRoots = (New-Object System.Collections.Generic.List[string])
  }
  if ($Source) { $candidate.Sources.Add($Source) }
  if ($Reason) { $candidate.Reasons.Add($Reason) }
  if ($RegistryPath) { $candidate.RegistryPaths.Add($RegistryPath) }
  if ($ProjectRoot) { $candidate.ProjectRoots.Add($ProjectRoot) }
  $script:CandidateMap[$ProcessId] = $candidate
}

function Add-DescendantCandidates {
  param(
    [int]$RootPid,
    [string]$Reason,
    [string]$RegistryPath = "",
    [string]$ProjectRoot = ""
  )

  foreach ($childPid in Get-DescendantPids -RootPid $RootPid) {
    Register-CandidateProcess -ProcessId ([int]$childPid) -Source "descendant" -Reason $Reason -RegistryPath $RegistryPath -ProjectRoot $ProjectRoot
  }
}

function Invoke-ProcessStop {
  param(
    [Parameter(Mandatory = $true)]
    $Candidate,
    [switch]$Force
  )

  $targetPid = [int]$Candidate.ProcessId
  if (-not (Test-PidAlive $targetPid)) {
    return "not-running"
  }

  $mode = if ($Force) { "force killed" } else { "stopped" }
  $actionLabel = if ($Force) { "Force killing" } else { "Stopping" }
  Write-Host "$actionLabel $($Candidate.Category) PID $targetPid"
  if ($VerbosePreference -ne "SilentlyContinue") {
    Write-Detail "PID $targetPid command line: $($Candidate.CommandLine)"
  }

  if ($DryRun) {
    if ($Force) {
      return "would-force-kill"
    }
    return "would-stop"
  }

  try {
    $process = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
    if ($null -eq $process) {
      return "not-running"
    }

    if (-not $Force) {
      if ($Candidate.Category -eq "trifix-electron" -and $process.MainWindowHandle -ne 0) {
        [void]$process.CloseMainWindow()
      } else {
        Stop-Process -Id $targetPid -ErrorAction SilentlyContinue
      }
    } else {
      Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
    }
  } catch {
    if ($Force) {
      return "force-failed"
    }
    return "stop-failed"
  }

  if (-not $Force) {
    return $mode
  }

  return $mode
}

function Clear-StalePidFile {
  if (-not (Test-Path $pidFile)) {
    return
  }

  $trackedPid = Get-TrackedPidFileValue
  $shouldRemove = $true
  if ($null -ne $trackedPid -and (Test-PidAlive $trackedPid)) {
    $shouldRemove = $false
  }

  if (-not $shouldRemove) {
    return
  }

  if ($DryRun) {
    Write-Host "Would clear stale .trifix-dev.pid"
    return
  }

  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host "Cleared stale .trifix-dev.pid"
}

function Clear-VerificationWork {
  if (-not $CleanVerificationWork -or -not (Test-Path $verificationWork)) {
    return
  }

  if ($DryRun) {
    Write-Host "Would remove verification work: $verificationWork"
    return
  }

  Remove-Item -LiteralPath $verificationWork -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Removed verification work: $verificationWork"
}

function Reconcile-ManagedProcessRecords {
  param([int[]]$TargetedPids)

  $targetedLookup = New-Object System.Collections.Generic.HashSet[int]
  foreach ($targetPid in $TargetedPids) {
    if ($targetPid -gt 0) {
      [void]$targetedLookup.Add([int]$targetPid)
    }
  }

  $entriesByRegistry = @{}
  foreach ($entry in $script:TrackedRegistryEntries) {
    if (-not $entriesByRegistry.ContainsKey($entry.RegistryPath)) {
      $entriesByRegistry[$entry.RegistryPath] = New-Object System.Collections.Generic.List[object]
    }
    $entriesByRegistry[$entry.RegistryPath].Add($entry)
  }

  foreach ($registryPath in $entriesByRegistry.Keys) {
    try {
      $records = Get-Content $registryPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      $updated = @()
      $changed = $false
      foreach ($record in @($records)) {
        if ($null -eq $record) {
          continue
        }

        $recordPid = 0
        try {
          $recordPid = [int]$record.pid
        } catch {
          $recordPid = 0
        }

        $status = [string]$record.status
        $isRunningStatus = $status -in @("running", "starting")
        $shouldMarkStopped = $isRunningStatus -and (($recordPid -gt 0 -and $targetedLookup.Contains($recordPid)) -or ($recordPid -gt 0 -and -not (Test-PidAlive $recordPid)))

        if ($shouldMarkStopped) {
          $record.status = "stopped"
          $record.finishedAt = $script:TimestampNow
          if ($null -eq $record.PSObject.Properties["exitCode"]) {
            Add-Member -InputObject $record -NotePropertyName "exitCode" -NotePropertyValue $null
          } else {
            $record.exitCode = $record.exitCode
          }
          $changed = $true
        }

        $updated += $record
      }

      if ($changed) {
        if ($DryRun) {
          Write-Host "Would reconcile managed process registry: $registryPath"
        } else {
          $updated | ConvertTo-Json -Depth 8 | Set-Content -Path $registryPath -Encoding UTF8
          Write-Host "Reconciled managed process registry: $registryPath"
        }
      }
    } catch {
      Write-Host "Could not reconcile managed process registry: $registryPath"
      Write-Detail $_.Exception.Message
    }
  }
}

function Start-TriFixDev {
  if (-not $shouldStart) {
    Write-Host "TriFix restarted: no (cleanup only)"
    return
  }

  if ($DryRun) {
    Write-Host "Would start npm run dev"
    Write-Host "TriFix restarted: dry run only"
    return
  }

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

  Write-Host "Starting npm run dev..."
  Write-Host "TriFix restarted: yes"
  Write-Host "PID: $($process.Id)"
  Write-Host "Stdout: $stdoutLog"
  Write-Host "Stderr: $stderrLog"
  Write-Host "Current main-process stderr mirror: $currentStderrLog"
}

Write-Step "Collecting TriFix-owned processes"
$snapshotResult = Get-ProcessSnapshot
$script:SnapshotByPid = $snapshotResult.Snapshot
$script:DescendantsByParent = $snapshotResult.Descendants
$script:TrackedRegistryEntries = Get-ManagedRegistryEntries

$trackedPid = Get-TrackedPidFileValue
if ($null -ne $trackedPid) {
  if (Test-PidAlive $trackedPid) {
    Write-Host "Found TriFix dev PID $trackedPid from .trifix-dev.pid"
    Register-CandidateProcess -ProcessId $trackedPid -Source "pid-file" -Reason ".trifix-dev.pid"
    Add-DescendantCandidates -RootPid $trackedPid -Reason ".trifix-dev.pid descendant"
  } else {
    Write-Host "Found stale .trifix-dev.pid -> PID $trackedPid is no longer running"
  }
}

foreach ($entry in $script:TrackedRegistryEntries) {
  if ($entry.ProcessId -le 0) {
    continue
  }
  if ([string]$entry.Record.status -notin @("running", "starting")) {
    continue
  }
  if (Test-PidAlive $entry.ProcessId) {
    $liveProcess = $script:SnapshotByPid[[int]$entry.ProcessId]
    if (-not (Test-ManagedRecordMatchesLiveProcess -ProcessInfo $liveProcess -ProjectRoot $entry.ProjectRoot)) {
      Write-Host "Skipped reused managed-record PID $($entry.ProcessId) because it no longer matches TriFix ownership"
      continue
    }
    Write-Host "Found managed project process PID $($entry.ProcessId) from $($entry.RegistryPath)"
    Register-CandidateProcess -ProcessId $entry.ProcessId -Source "managed-record" -Reason $entry.RegistryPath -RegistryPath $entry.RegistryPath -ProjectRoot $entry.ProjectRoot
    Add-DescendantCandidates -RootPid $entry.ProcessId -Reason "managed descendant" -RegistryPath $entry.RegistryPath -ProjectRoot $entry.ProjectRoot
  } else {
    Write-Host "Found stale managed project process record PID $($entry.ProcessId) from $($entry.RegistryPath)"
  }
}

foreach ($processInfo in $script:SnapshotByPid.Values) {
  if ($processInfo.ProcessId -eq $PID) {
    continue
  }
  if (Test-LmStudioText ("{0}`n{1}`n{2}" -f $processInfo.Name, $processInfo.CommandLine, $processInfo.ExecutablePath)) {
    if ($script:SkippedPids.Add([int]$processInfo.ProcessId)) {
      Write-Host "Skipped LM Studio PID $($processInfo.ProcessId)"
    }
    continue
  }
  if (Test-TriFixWorkspaceProcess $processInfo) {
    Register-CandidateProcess -ProcessId ([int]$processInfo.ProcessId) -Source "workspace-command" -Reason "workspace command line"
  }
}

$candidates = @($script:CandidateMap.Values | Sort-Object Priority, ProcessId)
if ($candidates.Count -eq 0) {
  Write-Host "No TriFix-owned processes found."
} else {
  foreach ($candidate in $candidates) {
    Write-Host ("Found {0} PID {1}" -f $candidate.Category, $candidate.ProcessId)
    if ($VerbosePreference -ne "SilentlyContinue" -and $candidate.CommandLine) {
      Write-Detail "PID $($candidate.ProcessId): $($candidate.CommandLine)"
    }
  }
}

Write-Step "Stopping TriFix-owned processes"
$gracefulStatuses = @()
foreach ($candidate in $candidates) {
  $status = Invoke-ProcessStop -Candidate $candidate
  $gracefulStatuses += [PSCustomObject]@{
    Candidate = $candidate
    Status = $status
  }
}

if (-not $DryRun -and $candidates.Count -gt 0) {
  Start-Sleep -Seconds 3
}

$forceStatuses = @()
foreach ($entry in $gracefulStatuses) {
  $candidate = $entry.Candidate
  if (-not (Test-PidAlive $candidate.ProcessId)) {
    [void]$script:StoppedPids.Add([int]$candidate.ProcessId)
    continue
  }
  $status = Invoke-ProcessStop -Candidate $candidate -Force
  $forceStatuses += [PSCustomObject]@{
    Candidate = $candidate
    Status = $status
  }
  if (-not $DryRun -and -not (Test-PidAlive $candidate.ProcessId)) {
    [void]$script:StoppedPids.Add([int]$candidate.ProcessId)
  }
}

Write-Step "Reconciling runtime state"
Reconcile-ManagedProcessRecords -TargetedPids @($script:CandidateMap.Keys)
Clear-StalePidFile
Clear-VerificationWork
Write-Host "TriFix active run lock is in-memory only; no on-disk run-lock file was found to clear."

Write-Step "Restart"
Start-TriFixDev
