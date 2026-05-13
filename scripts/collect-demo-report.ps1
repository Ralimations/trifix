param(
    [string]$ProjectRoot = "C:\Users\Skunk\Documents\TriFix AI Sandbox\sandbox\tasks\smartops-command-center",
    [string]$OutDir = "",
    [switch]$RunBuild,
    [int]$LogTail = 40,
    [switch]$NoCopy,
    [switch]$Fast,
    [switch]$OpenWhenDone
)

$ErrorActionPreference = "Continue"
$ScriptStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

function Write-Section($Title) {
    Write-Host "`n== $Title ==" -ForegroundColor Cyan
}

function Write-Checkpoint($Label) {
    Write-Host "Checkpoint: $Label" -ForegroundColor DarkCyan
}

function Add-Line($Text = "") {
    $script:ReportLines += [string]$Text
}

function Test-PathSafe($Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return [bool](Test-Path $Path)
}

function Read-TextSafe($Path) {
    if (-not (Test-PathSafe $Path)) { return $null }
    try {
        return Get-Content -LiteralPath $Path -Raw
    }
    catch {
        return $null
    }
}

function Read-JsonSafe($Path) {
    $raw = Read-TextSafe $Path
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    try {
        return $raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Get-FirstNonEmpty {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [object[]]$Values
    )

    foreach ($value in $Values) {
        if ($null -eq $value) { continue }
        if ($value -is [string]) {
            if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
            continue
        }
        return $value
    }

    return $null
}

function New-Dir($Path) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Copy-IfExists($Source, $DestDir) {
    if (-not (Test-PathSafe $Source)) { return $false }
    New-Dir $DestDir
    Copy-Item -LiteralPath $Source -Destination (Join-Path $DestDir (Split-Path $Source -Leaf)) -Force
    return $true
}

function Get-RelativeOrFullPath($BasePath, $Path) {
    try {
        return [System.IO.Path]::GetRelativePath($BasePath, $Path)
    }
    catch {
        return $Path
    }
}

function ConvertTo-PrettyJson($Value, $Depth = 20) {
    return $Value | ConvertTo-Json -Depth $Depth
}

function Get-RunLogTailInfo($Path, $TailCount) {
    $info = [ordered]@{
        exists = $(Test-PathSafe $Path)
        totalLines = $null
        tailLines = @()
        lastEventType = $null
        lastEventStatus = $null
        lastStage = $null
        lastParsedEvent = $null
    }

    if (-not $info.exists) {
        return $info
    }

    try {
        $tail = @(Get-Content -LiteralPath $Path -Tail $TailCount)
        $info.tailLines = $tail

        for ($i = $tail.Count - 1; $i -ge 0; $i--) {
            $line = $tail[$i]
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try {
                $event = $line | ConvertFrom-Json
                $info.lastParsedEvent = $event
                $info.lastEventType = Get-FirstNonEmpty $event.type $event.event $event.name
                $info.lastEventStatus = Get-FirstNonEmpty $event.status $event.state
                $info.lastStage = Get-FirstNonEmpty $event.stage $event.currentStage
                break
            }
            catch {
            }
        }
    }
    catch {
    }

    return $info
}

function Get-AutonomyScanInfo($AutonomyDir, $Warnings) {
    $result = [ordered]@{
        runbookFiles = @()
        latestStateFiles = @()
        nextActionFiles = @()
        artifactIndexFiles = @()
        toolActionIndexFiles = @()
        scannedFileCount = 0
        timedOut = $false
        skippedDemoReports = 0
        skippedNodeModules = 0
    }

    if (-not (Test-PathSafe $AutonomyDir)) {
        return $result
    }

    $scanWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $pendingDirs = New-Object System.Collections.Generic.Queue[string]
    $pendingDirs.Enqueue($AutonomyDir)

    try {
        while ($pendingDirs.Count -gt 0) {
            if ($scanWatch.Elapsed.TotalSeconds -gt 5) {
                $result.timedOut = $true
                $Warnings.Add("Autonomy scan exceeded 5 seconds. Remaining deep scan was skipped.")
                throw "AUTONOMY_SCAN_TIMEOUT"
            }

            $currentDir = $pendingDirs.Dequeue()

            $childDirs = @(Get-ChildItem -LiteralPath $currentDir -Directory -ErrorAction SilentlyContinue)
            foreach ($childDir in $childDirs) {
                $dirPath = $childDir.FullName

                if ($dirPath -match '[\\/]node_modules$') {
                    $result.skippedNodeModules++
                    continue
                }

                if ($dirPath -match '[\\/]demo-report-[^\\/]+$') {
                    $result.skippedDemoReports++
                    continue
                }

                $pendingDirs.Enqueue($dirPath)
            }

            $files = @(Get-ChildItem -LiteralPath $currentDir -File -ErrorAction SilentlyContinue)
            foreach ($file in $files) {
                if ($scanWatch.Elapsed.TotalSeconds -gt 5) {
                    $result.timedOut = $true
                    $Warnings.Add("Autonomy scan exceeded 5 seconds. Remaining deep scan was skipped.")
                    throw "AUTONOMY_SCAN_TIMEOUT"
                }

                if ($result.scannedFileCount -ge 500) {
                    $Warnings.Add("Autonomy scan reached the 500 file cap.")
                    throw "AUTONOMY_SCAN_CAP"
                }

                $fullName = $file.FullName
                $result.scannedFileCount++

                switch ($file.Name) {
                    "runbook.json" {
                        if ($result.runbookFiles.Count -lt 120) {
                            $result.runbookFiles += $fullName
                        }
                        break
                    }
                    "latest-state.json" {
                        if ($result.latestStateFiles.Count -lt 120) {
                            $result.latestStateFiles += $fullName
                        }
                        break
                    }
                    "next-action.json" {
                        if ($result.nextActionFiles.Count -lt 120) {
                            $result.nextActionFiles += $fullName
                        }
                        break
                    }
                    "artifacts-index.json" {
                        if ($result.artifactIndexFiles.Count -lt 120) {
                            $result.artifactIndexFiles += $fullName
                        }
                        break
                    }
                    "index.json" {
                        if ($fullName -match 'tool-actions' -and $result.toolActionIndexFiles.Count -lt 120) {
                            $result.toolActionIndexFiles += $fullName
                        }
                        break
                    }
                }
            }
        }
    }
    catch {
        if ($_.Exception.Message -notin @("AUTONOMY_SCAN_TIMEOUT", "AUTONOMY_SCAN_CAP")) {
            $Warnings.Add("Autonomy scan failed: $($_.Exception.Message)")
        }
    }

    return $result
}

function Invoke-BuildCapture($WorkingDirectory, $BuildDir) {
    New-Dir $BuildDir
    $stdoutPath = Join-Path $BuildDir "build-output.txt"
    $stderrPath = Join-Path $BuildDir "build-error.txt"
    $resultPath = Join-Path $BuildDir "build-result.json"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "npm.cmd"
    $psi.Arguments = "run build"
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi

    $started = $false
    try {
        $started = $process.Start()
    }
    catch {
        $result = [ordered]@{
            ran = $false
            success = $false
            exitCode = $null
            error = $_.Exception.Message
            outputPath = $stdoutPath
            errorPath = $stderrPath
            resultPath = $resultPath
        }
        Set-Content -LiteralPath $stdoutPath -Encoding UTF8 -Value ""
        Set-Content -LiteralPath $stderrPath -Encoding UTF8 -Value $_.Exception.ToString()
        ConvertTo-PrettyJson $result | Set-Content -LiteralPath $resultPath -Encoding UTF8
        return $result
    }

    if (-not $started) {
        $result = [ordered]@{
            ran = $false
            success = $false
            exitCode = $null
            error = "Failed to start npm run build."
            outputPath = $stdoutPath
            errorPath = $stderrPath
            resultPath = $resultPath
        }
        Set-Content -LiteralPath $stdoutPath -Encoding UTF8 -Value ""
        Set-Content -LiteralPath $stderrPath -Encoding UTF8 -Value "Failed to start npm run build."
        ConvertTo-PrettyJson $result | Set-Content -LiteralPath $resultPath -Encoding UTF8
        return $result
    }

    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    Set-Content -LiteralPath $stdoutPath -Encoding UTF8 -Value $stdout
    Set-Content -LiteralPath $stderrPath -Encoding UTF8 -Value $stderr

    $result = [ordered]@{
        ran = $true
        success = ($process.ExitCode -eq 0)
        exitCode = $process.ExitCode
        outputPath = $stdoutPath
        errorPath = $stderrPath
        resultPath = $resultPath
    }

    ConvertTo-PrettyJson $result | Set-Content -LiteralPath $resultPath -Encoding UTF8
    return $result
}

function Get-Recommendation($Summary) {
    $reasons = New-Object System.Collections.Generic.List[string]
    $nextSteps = New-Object System.Collections.Generic.List[string]
    $recommendation = "needs_manual_review"

    $core = $Summary.projectHealth.core
    $runState = $Summary.runState
    $finalReport = $Summary.finalReport
    $autonomy = $Summary.autonomy
    $guiQa = $Summary.guiQaHealth
    $design = $Summary.designHealth
    $build = $Summary.build

    $hasCoreGap = (-not $core.packageJsonExists) -or (-not $core.srcAppExists) -or (-not $core.srcMainExists)
    $hasQualityEvidence = $guiQa.latestResultExists -or $design.domAuditExists -or $design.designReviewExists
    $buildPass = ($build -and $build.ran -and $build.success)
    $buildFail = ($build -and $build.ran -and (-not $build.success))

    if ($hasCoreGap) {
        $recommendation = "missing_core_files"
        $reasons.Add("One or more required project files are missing.")
        $nextSteps.Add("Restore package.json, src/main.jsx, and src/App.jsx before running TriFix checks.")
        return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
    }

    if (-not $core.packageJsonValid) {
        $recommendation = "needs_package_fix"
        $reasons.Add("package.json exists but does not parse as valid JSON.")
        $nextSteps.Add("Repair package.json or restore from a package.json.invalid backup.")
        return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
    }

    if ($buildFail) {
        $recommendation = "needs_build_fix"
        $reasons.Add("npm run build failed.")
        $nextSteps.Add("Inspect build-output.txt and build-error.txt, then fix the build before demo validation.")
        return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
    }

    if ($runState.status -eq "running" -and [string]::IsNullOrWhiteSpace([string]$runState.runId)) {
        $recommendation = "stale_running_state"
        $reasons.Add("run-state.json says running but runId is empty.")
        $nextSteps.Add("Confirm whether this is an active manual run or a stale state before clearing it.")
        if (-not $build.ran) {
            $nextSteps.Add("Run this script again with -RunBuild after confirming the run state.")
        }
        return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
    }

    if ($design.designReviewRecommendation -eq "needs_patch") {
        $recommendation = "needs_manual_review"
        $reasons.Add("Design review recommends needs_patch.")
        $nextSteps.Add("Review the design issues and run a Design Polish Pass or patch manually.")
        return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
    }

    if ($finalReport.exists -and $finalReport.isEmpty -and (-not $autonomy.latestRunExists)) {
        $recommendation = "incomplete_no_runbook"
        $reasons.Add("final-report.md exists but is empty, and autonomy latest-run.json is missing.")
        $nextSteps.Add("Resume from the runbook if available, or restart the workflow from TriFix.")
        return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
    }

    if ($buildPass -and $hasQualityEvidence) {
        $recommendation = "ready_for_demo_evidence"
        $reasons.Add("Build passed and GUI QA/design evidence exists.")
        $nextSteps.Add("Review the generated report folder and use it for demo evidence.")
        return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
    }

    if ($buildPass -and (-not $hasQualityEvidence)) {
        $recommendation = "ready_to_test"
        $reasons.Add("Build passed but there is little or no GUI QA/design evidence.")
        $nextSteps.Add("Run Project in TriFix, then run GUI QA and UI Quality Check.")
        return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
    }

    if (-not $hasQualityEvidence) {
        $recommendation = "no_quality_evidence"
        $reasons.Add("GUI QA and design evidence files are missing or incomplete.")
        $nextSteps.Add("Run GUI QA and UI Quality Check from TriFix.")
        if (-not $build.ran) {
            $nextSteps.Add("Run this script again with -RunBuild for a deterministic build check.")
        }
        return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
    }

    $reasons.Add("Project needs manual inspection before a stronger recommendation.")
    $nextSteps.Add("Inspect run-state, run logs, and design evidence manually.")
    return [ordered]@{ recommendation = $recommendation; reasons = $reasons; nextSteps = $nextSteps }
}

function Get-AutonomySummaryInfo($AutonomyDir, $Warnings) {
    $result = [ordered]@{
        runbookFiles = @()
        latestStateFiles = @()
        nextActionFiles = @()
        artifactIndexFiles = @()
        toolActionIndexFiles = @()
        scannedFileCount = 0
        timedOut = $false
        skippedDemoReports = 0
        skippedNodeModules = 0
        runsDirExists = $false
        runFolderCount = 0
    }

    if (-not (Test-PathSafe $AutonomyDir)) {
        return $result
    }

    $runsDir = Join-Path $AutonomyDir "runs"
    $result.runsDirExists = Test-PathSafe $runsDir

    if ($result.runsDirExists) {
        try {
            $runDirs = @(Get-ChildItem -LiteralPath $runsDir -Directory -ErrorAction SilentlyContinue)
            $result.runFolderCount = $runDirs.Count
        }
        catch {
            $Warnings.Add("Autonomy summary scan failed: $($_.Exception.Message)")
        }
    }

    return $result
}

if (-not (Test-Path $ProjectRoot)) {
    Write-Host "Project root not found: $ProjectRoot" -ForegroundColor Red
    exit 1
}

Write-Checkpoint "START script"
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Write-Checkpoint "After resolving ProjectRoot"
$ProjectName = Split-Path $ProjectRoot -Leaf
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $ProjectRoot ".trifix\demo-report-$Timestamp"
}

New-Dir $OutDir

$ReportLines = @()
$Warnings = New-Object System.Collections.Generic.List[string]

$ProjectTrifixDir = Join-Path $ProjectRoot ".trifix"
$GuiQaDir = Join-Path $ProjectRoot ".trifix\gui-qa"
$DesignDir = Join-Path $ProjectRoot ".trifix\design"
$AutonomyDir = Join-Path $ProjectRoot ".trifix\autonomy"

$PackageJsonPath = Join-Path $ProjectRoot "package.json"
$PackageLockPath = Join-Path $ProjectRoot "package-lock.json"
$IndexHtmlPath = Join-Path $ProjectRoot "index.html"
$ViteConfigPath = Join-Path $ProjectRoot "vite.config.js"
$SrcMainPath = Join-Path $ProjectRoot "src\main.jsx"
$SrcAppPath = Join-Path $ProjectRoot "src\App.jsx"
$SrcStylesPath = Join-Path $ProjectRoot "src\styles.css"
$NodeModulesPath = Join-Path $ProjectRoot "node_modules"

$RunStatePath = Join-Path $ProjectTrifixDir "run-state.json"
$FinalReportPath = Join-Path $ProjectTrifixDir "final-report.md"
$RunLogPath = Join-Path $ProjectTrifixDir "run-log.jsonl"

$GuiLatest = Join-Path $GuiQaDir "latest-result.json"
$GuiScreenshot = Join-Path $GuiQaDir "latest-screenshot.png"

$UiContract = Join-Path $DesignDir "ui-quality-contract.json"
$UiQualityMd = Join-Path $DesignDir "UI_QUALITY.md"
$UiRegistry = Join-Path $DesignDir "ui-library-registry.json"
$UiLibrariesMd = Join-Path $DesignDir "UI_LIBRARIES.md"
$UiStack = Join-Path $DesignDir "ui-stack-recommendation.json"
$DependencyPlan = Join-Path $DesignDir "dependency-plan.json"
$DomAudit = Join-Path $DesignDir "ui-dom-audit.json"
$DesignReview = Join-Path $DesignDir "design-review.json"
$DesignPolish = Join-Path $DesignDir "design-polish-state.json"
$DesktopShot = Join-Path $DesignDir "screenshots\latest-desktop.png"
$MobileShot = Join-Path $DesignDir "screenshots\latest-mobile.png"

$LatestRun = Join-Path $AutonomyDir "latest-run.json"
$PendingApprovals = Join-Path $AutonomyDir "pending-tool-approvals.json"
Write-Checkpoint "After path setup"

Write-Section "Reading project state"

Write-Checkpoint "Reading package.json"
$packageRaw = Read-TextSafe $PackageJsonPath
$packageJson = Read-JsonSafe $PackageJsonPath
$packageJsonValid = $null -ne $packageJson
$packageBackups = @()
if (Test-Path $ProjectRoot) {
    $packageBackups = @(Get-ChildItem -LiteralPath $ProjectRoot -Filter "package.json.invalid-*.json" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
}

$packageScripts = @{}
$packageScriptNames = @()
if ($packageJsonValid -and $packageJson.scripts) {
    $packageScripts = @{}
    foreach ($prop in $packageJson.scripts.PSObject.Properties) {
        $packageScripts[$prop.Name] = [string]$prop.Value
        $packageScriptNames += $prop.Name
    }
}

$projectHealthCore = [ordered]@{
    projectRootExists = $true
    packageJsonExists = $(Test-PathSafe $PackageJsonPath)
    packageJsonValid = $packageJsonValid
    packageName = $(if ($packageJsonValid) { [string]$packageJson.name } else { $null })
    npmScripts = $packageScripts
    npmScriptNames = @($packageScriptNames)
    hasBuildScript = $packageScriptNames -contains "build"
    hasDevScript = $packageScriptNames -contains "dev"
    hasPreviewScript = $packageScriptNames -contains "preview"
    hasTestScript = $packageScriptNames -contains "test"
    indexHtmlExists = $(Test-PathSafe $IndexHtmlPath)
    viteConfigExists = $(Test-PathSafe $ViteConfigPath)
    srcMainExists = $(Test-PathSafe $SrcMainPath)
    srcAppExists = $(Test-PathSafe $SrcAppPath)
    srcStylesExists = $(Test-PathSafe $SrcStylesPath)
    nodeModulesExists = $(Test-PathSafe $NodeModulesPath)
    packageLockExists = $(Test-PathSafe $PackageLockPath)
    packageJsonBackupFiles = @($packageBackups)
}

if ($projectHealthCore.packageJsonExists -and (-not $projectHealthCore.packageJsonValid)) {
    $Warnings.Add("package.json exists but does not parse as valid JSON.")
}
Write-Checkpoint "After package.json read"

$runState = Read-JsonSafe $RunStatePath
Write-Checkpoint "Reading run-state"
$runStateInfo = [ordered]@{
    exists = $(Test-Path $RunStatePath)
    runId = $(if ($runState) { [string]$runState.runId } else { $null })
    mode = $(if ($runState) { [string]$runState.mode } else { $null })
    status = $(if ($runState) { [string]$runState.status } else { $null })
    stage = $(if ($runState) { [string]$runState.stage } else { $null })
    attempt = $(if ($runState) { $runState.attempt } else { $null })
    maxAttempts = $(if ($runState) { $runState.maxAttempts } else { $null })
    projectSlug = $(if ($runState) { [string]$runState.projectSlug } else { $null })
    workspacePath = $(if ($runState) { [string]$runState.workspacePath } else { $null })
    changedFilesCount = $(if ($runState -and $runState.changedFiles) { @($runState.changedFiles).Count } else { 0 })
    lastError = $(if ($runState) { [string]$runState.lastError } else { $null })
    lastValidationStatus = $(if ($runState) { [string]$runState.lastValidationStatus } else { $null })
    updatedAt = $(if ($runState) { [string]$runState.updatedAt } else { $null })
}

if ($runStateInfo.status -eq "running" -and [string]::IsNullOrWhiteSpace($runStateInfo.runId)) {
    $Warnings.Add("Run state says running but runId is empty. This may be stale/manual state.")
}

if ($runStateInfo.workspacePath -and ($runStateInfo.workspacePath -ne $ProjectRoot)) {
    $Warnings.Add("run-state workspacePath does not match selected project root.")
}
Write-Checkpoint "After run-state read"

$finalReportText = Read-TextSafe $FinalReportPath
$finalReportInfo = [ordered]@{
    exists = $(Test-Path $FinalReportPath)
    length = $(if ($null -ne $finalReportText) { $finalReportText.Length } else { 0 })
    isEmpty = [string]::IsNullOrWhiteSpace($finalReportText)
}

if ($finalReportInfo.exists -and $finalReportInfo.isEmpty) {
    $Warnings.Add("final-report.md exists but is empty.")
}

$runLogInfo = Get-RunLogTailInfo $RunLogPath $LogTail
Write-Checkpoint "After run-log tail"
$LogsDir = Join-Path $OutDir "logs"
New-Dir $LogsDir
if ($runLogInfo.exists) {
    $tailPath = Join-Path $LogsDir "run-log-tail.jsonl"
    Set-Content -LiteralPath $tailPath -Encoding UTF8 -Value ($runLogInfo.tailLines -join [Environment]::NewLine)
    $runLogInfo["tailPath"] = $tailPath
}

$latestRun = Read-JsonSafe $LatestRun
$pendingApprovals = Read-JsonSafe $PendingApprovals
Write-Checkpoint "Before autonomy scan"
if ($NoCopy -or $Fast) {
    $autonomyScan = Get-AutonomySummaryInfo -AutonomyDir $AutonomyDir -Warnings $Warnings
}
else {
    $autonomyScan = Get-AutonomyScanInfo -AutonomyDir $AutonomyDir -Warnings $Warnings
}
Write-Checkpoint "After autonomy scan"
$runbookFiles = @($autonomyScan.runbookFiles)
$latestStateFiles = @($autonomyScan.latestStateFiles)
$nextActionFiles = @($autonomyScan.nextActionFiles)
$artifactIndexFiles = @($autonomyScan.artifactIndexFiles)
$toolActionIndexFiles = @($autonomyScan.toolActionIndexFiles)

$pendingApprovalCount = 0
if ($pendingApprovals) {
    if ($pendingApprovals -is [System.Collections.IEnumerable] -and -not ($pendingApprovals -is [string])) {
        $pendingApprovalCount = @($pendingApprovals).Count
    }
}

$latestNextAction = $null
if ($nextActionFiles.Count -gt 0) {
    $latestNextAction = Read-JsonSafe ($nextActionFiles | Sort-Object | Select-Object -Last 1)
}

$autonomyInfo = [ordered]@{
    exists = $(Test-PathSafe $AutonomyDir)
    latestRunExists = $(Test-PathSafe $LatestRun)
    runCount = $runbookFiles.Count
    latestRunStatus = $(if ($latestRun) { [string]$latestRun.status } else { $null })
    latestRunMode = $(if ($latestRun) { [string]$latestRun.mode } else { $null })
    latestRunId = $(if ($latestRun) { [string]$latestRun.runId } else { $null })
    nextAction = $(if ($latestNextAction) { (ConvertTo-PrettyJson $latestNextAction) } else { $null })
    pendingApprovalCount = $pendingApprovalCount
    toolActionCount = $toolActionIndexFiles.Count
    scannedFileCount = $autonomyScan.scannedFileCount
    scanTimedOut = $autonomyScan.timedOut
    runsDirExists = $(Get-FirstNonEmpty $autonomyScan.runsDirExists $false)
    runFolderCount = $(Get-FirstNonEmpty $autonomyScan.runFolderCount 0)
    runbookFiles = @($runbookFiles)
    latestStateFiles = @($latestStateFiles)
    nextActionFiles = @($nextActionFiles)
    artifactIndexFiles = @($artifactIndexFiles)
    toolActionIndexFiles = @($toolActionIndexFiles)
}

if ($autonomyInfo.exists -and (-not $autonomyInfo.latestRunExists)) {
    $Warnings.Add("Autonomy folder exists but latest-run.json is missing.")
}

Write-Checkpoint "Before GUI QA reads"
$gui = Read-JsonSafe $GuiLatest
Write-Checkpoint "After GUI QA reads"
Write-Checkpoint "Before design reads"
$contract = Read-JsonSafe $UiContract
$stack = Read-JsonSafe $UiStack
$dep = Read-JsonSafe $DependencyPlan
$audit = Read-JsonSafe $DomAudit
$review = Read-JsonSafe $DesignReview
$polish = Read-JsonSafe $DesignPolish
Write-Checkpoint "After design reads"

$guiQaHealth = [ordered]@{
    latestResultExists = $(Test-PathSafe $GuiLatest)
    latestScreenshotExists = $(Test-PathSafe $GuiScreenshot)
    status = $(if ($gui) { [string]$gui.status } else { $null })
    httpStatus = $(if ($gui) { $gui.httpStatus } else { $null })
    consoleErrorCount = $(if ($gui -and $gui.consoleErrors) { @($gui.consoleErrors).Count } else { 0 })
    pageErrorCount = $(if ($gui -and $gui.pageErrors) { @($gui.pageErrors).Count } else { 0 })
}

$designHealth = [ordered]@{
    uiQualityMdExists = $(Test-PathSafe $UiQualityMd)
    uiQualityContractExists = $(Test-PathSafe $UiContract)
    uiLibrariesMdExists = $(Test-PathSafe $UiLibrariesMd)
    uiLibraryRegistryExists = $(Test-PathSafe $UiRegistry)
    dependencyPlanExists = $(Test-PathSafe $DependencyPlan)
    domAuditExists = $(Test-PathSafe $DomAudit)
    designReviewExists = $(Test-PathSafe $DesignReview)
    designPolishStateExists = $(Test-PathSafe $DesignPolish)
    desktopScreenshotExists = $(Test-PathSafe $DesktopShot)
    mobileScreenshotExists = $(Test-PathSafe $MobileShot)
    designReviewRecommendation = $(if ($review) { [string]$review.recommendation } else { $null })
}

$buildInfo = [ordered]@{
    ran = $false
    success = $null
    exitCode = $null
    outputPath = $null
    errorPath = $null
    resultPath = $null
}

if ($RunBuild) {
    Write-Section "Running npm run build"
    $buildInfo = Invoke-BuildCapture -WorkingDirectory $ProjectRoot -BuildDir (Join-Path $OutDir "build")
}

$Copied = @()
if (-not $NoCopy) {
    Write-Section "Copying key artifacts"
    $ArtifactMap = @(
        @{ Source = $GuiLatest; Dest = "gui-qa" },
        @{ Source = $GuiScreenshot; Dest = "gui-qa" },
        @{ Source = $UiContract; Dest = "design" },
        @{ Source = $UiQualityMd; Dest = "design" },
        @{ Source = $UiRegistry; Dest = "design" },
        @{ Source = $UiLibrariesMd; Dest = "design" },
        @{ Source = $UiStack; Dest = "design" },
        @{ Source = $DependencyPlan; Dest = "design" },
        @{ Source = $DomAudit; Dest = "design" },
        @{ Source = $DesignReview; Dest = "design" },
        @{ Source = $DesignPolish; Dest = "design" },
        @{ Source = $DesktopShot; Dest = "screenshots" },
        @{ Source = $MobileShot; Dest = "screenshots" },
        @{ Source = $LatestRun; Dest = "autonomy" },
        @{ Source = $PendingApprovals; Dest = "autonomy" },
        @{ Source = $RunStatePath; Dest = "runtime" },
        @{ Source = $FinalReportPath; Dest = "runtime" },
        @{ Source = $RunLogPath; Dest = "logs" }
    )

    foreach ($item in $ArtifactMap) {
        $destPath = Join-Path $OutDir $item.Dest
        if (Copy-IfExists $item.Source $destPath) {
            $Copied += $item.Source
            Write-Host "Copied: $($item.Source)"
        }
    }
}

$Summary = [ordered]@{
    projectName = $ProjectName
    projectRoot = $ProjectRoot
    generatedAt = (Get-Date).ToString("o")
    outDir = $OutDir
    projectHealth = [ordered]@{
        core = $projectHealthCore
    }
    runState = $runStateInfo
    finalReport = $finalReportInfo
    runLog = $runLogInfo
    autonomy = $autonomyInfo
    guiQaHealth = $guiQaHealth
    designHealth = $designHealth
    build = $buildInfo
    copiedArtifacts = $Copied
    warnings = @($Warnings)
}

Write-Checkpoint "Before recommendation"
$RecommendationInfo = Get-Recommendation $Summary
$Summary.recommendation = $RecommendationInfo.recommendation
$Summary.reasons = @($RecommendationInfo.reasons)
$Summary.nextSteps = @($RecommendationInfo.nextSteps)
$Summary.elapsedSeconds = [math]::Round($ScriptStopwatch.Elapsed.TotalSeconds, 2)
Write-Checkpoint "After recommendation"

Add-Line "# TriFix Project Health + Demo Report"
Add-Line
Add-Line "- Project: $ProjectName"
Add-Line "- Project root: $ProjectRoot"
Add-Line "- Generated at: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
Add-Line "- Recommendation: $($Summary.recommendation)"
Add-Line

Add-Line "## Core Health"
Add-Line
Add-Line "- package.json exists: $($projectHealthCore.packageJsonExists)"
Add-Line "- package.json valid: $($projectHealthCore.packageJsonValid)"
Add-Line "- package name: $(Get-FirstNonEmpty $projectHealthCore.packageName 'n/a')"
Add-Line "- build script: $($projectHealthCore.hasBuildScript)"
Add-Line "- dev script: $($projectHealthCore.hasDevScript)"
Add-Line "- preview script: $($projectHealthCore.hasPreviewScript)"
Add-Line "- test script: $($projectHealthCore.hasTestScript)"
Add-Line "- index.html exists: $($projectHealthCore.indexHtmlExists)"
Add-Line "- vite.config.js exists: $($projectHealthCore.viteConfigExists)"
Add-Line "- src/main.jsx exists: $($projectHealthCore.srcMainExists)"
Add-Line "- src/App.jsx exists: $($projectHealthCore.srcAppExists)"
Add-Line "- src/styles.css exists: $($projectHealthCore.srcStylesExists)"
Add-Line "- node_modules exists: $($projectHealthCore.nodeModulesExists)"
Add-Line "- package-lock.json exists: $($projectHealthCore.packageLockExists)"
if ($projectHealthCore.packageJsonBackupFiles.Count -gt 0) {
    Add-Line "- package.json backup files:"
    foreach ($backup in $projectHealthCore.packageJsonBackupFiles) {
        Add-Line "  - $backup"
    }
}
Add-Line

Add-Line "## Run State"
Add-Line
Add-Line "- exists: $($runStateInfo.exists)"
Add-Line "- runId: $(Get-FirstNonEmpty $runStateInfo.runId 'n/a')"
Add-Line "- mode: $(Get-FirstNonEmpty $runStateInfo.mode 'n/a')"
Add-Line "- status: $(Get-FirstNonEmpty $runStateInfo.status 'n/a')"
Add-Line "- stage: $(Get-FirstNonEmpty $runStateInfo.stage 'n/a')"
Add-Line "- attempt: $(Get-FirstNonEmpty $runStateInfo.attempt 'n/a')"
Add-Line "- maxAttempts: $(Get-FirstNonEmpty $runStateInfo.maxAttempts 'n/a')"
Add-Line "- projectSlug: $(Get-FirstNonEmpty $runStateInfo.projectSlug 'n/a')"
Add-Line "- workspacePath: $(Get-FirstNonEmpty $runStateInfo.workspacePath 'n/a')"
Add-Line "- changedFiles count: $($runStateInfo.changedFilesCount)"
Add-Line "- lastValidationStatus: $(Get-FirstNonEmpty $runStateInfo.lastValidationStatus 'n/a')"
Add-Line "- lastError: $(Get-FirstNonEmpty $runStateInfo.lastError 'n/a')"
Add-Line "- updatedAt: $(Get-FirstNonEmpty $runStateInfo.updatedAt 'n/a')"
Add-Line

Add-Line "## Final Report"
Add-Line
Add-Line "- exists: $($finalReportInfo.exists)"
Add-Line "- length: $($finalReportInfo.length)"
Add-Line "- empty: $($finalReportInfo.isEmpty)"
Add-Line

Add-Line "## Recent Run Log Events"
Add-Line
Add-Line "- run-log exists: $($runLogInfo.exists)"
Add-Line "- total lines: $(Get-FirstNonEmpty $runLogInfo.totalLines 'unknown')"
Add-Line "- last event type: $(Get-FirstNonEmpty $runLogInfo.lastEventType 'n/a')"
Add-Line "- last event status: $(Get-FirstNonEmpty $runLogInfo.lastEventStatus 'n/a')"
Add-Line "- last stage: $(Get-FirstNonEmpty $runLogInfo.lastStage 'n/a')"
Add-Line
foreach ($line in $runLogInfo.tailLines) {
    Add-Line "- $line"
}
Add-Line

Add-Line "## Autonomy"
Add-Line
Add-Line "- autonomy folder exists: $($autonomyInfo.exists)"
Add-Line "- latest-run exists: $($autonomyInfo.latestRunExists)"
Add-Line "- run count: $($autonomyInfo.runCount)"
Add-Line "- latest run status: $(Get-FirstNonEmpty $autonomyInfo.latestRunStatus 'n/a')"
Add-Line "- latest run mode: $(Get-FirstNonEmpty $autonomyInfo.latestRunMode 'n/a')"
Add-Line "- latest run id: $(Get-FirstNonEmpty $autonomyInfo.latestRunId 'n/a')"
Add-Line "- pending approval count: $($autonomyInfo.pendingApprovalCount)"
Add-Line "- tool action count: $($autonomyInfo.toolActionCount)"
Add-Line "- scanned file count: $($autonomyInfo.scannedFileCount)"
Add-Line "- scan timed out: $($autonomyInfo.scanTimedOut)"
if ($autonomyInfo.nextAction) {
    Add-Line "- next action:"
    Add-Line '```json'
    Add-Line $autonomyInfo.nextAction
    Add-Line '```'
}
Add-Line

Add-Line "## GUI QA"
Add-Line
Add-Line "- latest-result exists: $($guiQaHealth.latestResultExists)"
Add-Line "- latest-screenshot exists: $($guiQaHealth.latestScreenshotExists)"
Add-Line "- status: $(Get-FirstNonEmpty $guiQaHealth.status 'n/a')"
Add-Line "- httpStatus: $(Get-FirstNonEmpty $guiQaHealth.httpStatus 'n/a')"
Add-Line "- console error count: $($guiQaHealth.consoleErrorCount)"
Add-Line "- page error count: $($guiQaHealth.pageErrorCount)"
Add-Line

Add-Line "## Design Quality"
Add-Line
Add-Line "- UI_QUALITY.md exists: $($designHealth.uiQualityMdExists)"
Add-Line "- ui-quality-contract.json exists: $($designHealth.uiQualityContractExists)"
Add-Line "- UI_LIBRARIES.md exists: $($designHealth.uiLibrariesMdExists)"
Add-Line "- ui-library-registry.json exists: $($designHealth.uiLibraryRegistryExists)"
Add-Line "- dependency-plan.json exists: $($designHealth.dependencyPlanExists)"
Add-Line "- ui-dom-audit.json exists: $($designHealth.domAuditExists)"
Add-Line "- design-review.json exists: $($designHealth.designReviewExists)"
Add-Line "- design-polish-state.json exists: $($designHealth.designPolishStateExists)"
Add-Line "- desktop screenshot exists: $($designHealth.desktopScreenshotExists)"
Add-Line "- mobile screenshot exists: $($designHealth.mobileScreenshotExists)"
Add-Line "- design recommendation: $(Get-FirstNonEmpty $designHealth.designReviewRecommendation 'n/a')"
Add-Line

Add-Line "## Build"
Add-Line
Add-Line "- build executed: $($buildInfo.ran)"
Add-Line "- build success: $(Get-FirstNonEmpty $buildInfo.success 'n/a')"
Add-Line "- build exit code: $(Get-FirstNonEmpty $buildInfo.exitCode 'n/a')"
if ($buildInfo.outputPath) { Add-Line "- build output: $($buildInfo.outputPath)" }
if ($buildInfo.errorPath) { Add-Line "- build error: $($buildInfo.errorPath)" }
Add-Line

Add-Line "## Recommendation"
Add-Line
Add-Line "- recommendation: $($Summary.recommendation)"
Add-Line "- reasons:"
foreach ($reason in $Summary.reasons) {
    Add-Line "  - $reason"
}
Add-Line "- next steps:"
foreach ($step in $Summary.nextSteps) {
    Add-Line "  - $step"
}
Add-Line

Add-Line "## Warnings"
Add-Line
if ($Warnings.Count -eq 0) {
    Add-Line "- none"
}
else {
    foreach ($warning in $Warnings) {
        Add-Line "- $warning"
    }
}
Add-Line

Add-Line "## Copied Artifacts"
Add-Line
if ($Copied.Count -eq 0) {
    Add-Line "- none"
}
else {
    foreach ($file in $Copied) {
        Add-Line "- $file"
    }
}

$ReportPath = Join-Path $OutDir "DEMO_RESULT_REPORT.md"
$HealthReportPath = Join-Path $OutDir "project-health-report.md"
$JsonSummaryPath = Join-Path $OutDir "demo-result-summary.json"
$HealthJsonPath = Join-Path $OutDir "project-health-report.json"

Write-Checkpoint "Before writing markdown"
$ReportLines | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$ReportLines | Set-Content -LiteralPath $HealthReportPath -Encoding UTF8
Write-Checkpoint "After writing markdown"
Write-Checkpoint "Before writing JSON"
ConvertTo-PrettyJson $Summary | Set-Content -LiteralPath $JsonSummaryPath -Encoding UTF8
ConvertTo-PrettyJson $Summary | Set-Content -LiteralPath $HealthJsonPath -Encoding UTF8
Write-Checkpoint "After writing JSON"

Write-Section "Done"
Write-Host "Report folder: $OutDir" -ForegroundColor Green
Write-Host "Recommendation: $($Summary.recommendation)" -ForegroundColor Green
Write-Host "Elapsed seconds: $([math]::Round($ScriptStopwatch.Elapsed.TotalSeconds, 2))" -ForegroundColor Green
if ($RunBuild) {
    Write-Host "Build result: success=$($buildInfo.success) exitCode=$($buildInfo.exitCode)" -ForegroundColor Green
}
if ($Warnings.Count -gt 0) {
    Write-Host "`nWarnings:" -ForegroundColor Yellow
    foreach ($warning in $Warnings) {
        Write-Host "- $warning" -ForegroundColor Yellow
    }
}
Write-Host "`nNext steps:" -ForegroundColor Cyan
foreach ($step in $Summary.nextSteps) {
    Write-Host "- $step"
}
Write-Host "`nMarkdown report: $ReportPath" -ForegroundColor Green
Write-Host "JSON summary: $JsonSummaryPath" -ForegroundColor Green
Write-Checkpoint "END script"

if ($OpenWhenDone) {
    Start-Process -FilePath $OutDir -WindowStyle Hidden | Out-Null
}
