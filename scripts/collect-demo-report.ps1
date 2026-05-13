param(
    [string]$ProjectRoot = "C:\Users\Skunk\Documents\TriFix AI Sandbox\sandbox\tasks\smartops-command-center",
    [string]$OutDir = ""
)

$ErrorActionPreference = "Continue"

function Write-Section($Title) {
    Write-Host "`n== $Title ==" -ForegroundColor Cyan
}

function Read-JsonSafe($Path) {
    if (-not (Test-Path $Path)) { return $null }
    try {
        return Get-Content $Path -Raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Copy-IfExists($Source, $DestDir) {
    if (Test-Path $Source) {
        New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
        Copy-Item $Source -Destination (Join-Path $DestDir (Split-Path $Source -Leaf)) -Force
        return $true
    }
    return $false
}

function Add-Line($Text) {
    $script:ReportLines += $Text
}

if (-not (Test-Path $ProjectRoot)) {
    Write-Host "Project root not found: $ProjectRoot" -ForegroundColor Red
    exit 1
}

$ProjectName = Split-Path $ProjectRoot -Leaf
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $ProjectRoot ".trifix\demo-report-$Timestamp"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$ReportLines = @()
Add-Line "# TriFix Demo Project Result Report"
Add-Line ""
Add-Line "- Project: `$ProjectName`"
Add-Line "- Project root: `$ProjectRoot`"
Add-Line "- Generated at: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")"
Add-Line ""

$GuiQaDir = Join-Path $ProjectRoot ".trifix\gui-qa"
$DesignDir = Join-Path $ProjectRoot ".trifix\design"
$AutonomyDir = Join-Path $ProjectRoot ".trifix\autonomy"

$GuiLatest = Join-Path $GuiQaDir "latest-result.json"
$GuiScreenshot = Join-Path $GuiQaDir "latest-screenshot.png"

$UiContract = Join-Path $DesignDir "ui-quality-contract.json"
$UiStack = Join-Path $DesignDir "ui-stack-recommendation.json"
$DependencyPlan = Join-Path $DesignDir "dependency-plan.json"
$DomAudit = Join-Path $DesignDir "ui-dom-audit.json"
$DesignReview = Join-Path $DesignDir "design-review.json"
$DesignPolish = Join-Path $DesignDir "design-polish-state.json"
$DesktopShot = Join-Path $DesignDir "screenshots\latest-desktop.png"
$MobileShot = Join-Path $DesignDir "screenshots\latest-mobile.png"

$LatestRun = Join-Path $AutonomyDir "latest-run.json"
$PendingApprovals = Join-Path $AutonomyDir "pending-tool-approvals.json"

$gui = Read-JsonSafe $GuiLatest
$contract = Read-JsonSafe $UiContract
$stack = Read-JsonSafe $UiStack
$dep = Read-JsonSafe $DependencyPlan
$audit = Read-JsonSafe $DomAudit
$review = Read-JsonSafe $DesignReview
$polish = Read-JsonSafe $DesignPolish
$run = Read-JsonSafe $LatestRun
$approvals = Read-JsonSafe $PendingApprovals

Write-Section "Copying key artifacts"

$Copied = @()

$ArtifactMap = @(
    @{ Source = $GuiLatest; Dest = "gui-qa" },
    @{ Source = $GuiScreenshot; Dest = "gui-qa" },
    @{ Source = $UiContract; Dest = "design" },
    @{ Source = Join-Path $DesignDir "UI_QUALITY.md"; Dest = "design" },
    @{ Source = Join-Path $DesignDir "ui-library-registry.json"; Dest = "design" },
    @{ Source = Join-Path $DesignDir "UI_LIBRARIES.md"; Dest = "design" },
    @{ Source = $UiStack; Dest = "design" },
    @{ Source = $DependencyPlan; Dest = "design" },
    @{ Source = $DomAudit; Dest = "design" },
    @{ Source = $DesignReview; Dest = "design" },
    @{ Source = $DesignPolish; Dest = "design" },
    @{ Source = $DesktopShot; Dest = "screenshots" },
    @{ Source = $MobileShot; Dest = "screenshots" },
    @{ Source = $LatestRun; Dest = "autonomy" },
    @{ Source = $PendingApprovals; Dest = "autonomy" }
)

foreach ($item in $ArtifactMap) {
    $destPath = Join-Path $OutDir $item.Dest
    if (Copy-IfExists $item.Source $destPath) {
        $Copied += $item.Source
        Write-Host "Copied: $($item.Source)"
    }
}

Add-Line "## 1. Final Status"
Add-Line ""

if ($run) {
    Add-Line "- Latest run status: `$($run.status)`"
    Add-Line "- Latest run mode: `$($run.mode)`"
    Add-Line "- Latest run id: `$($run.runId)`"
    Add-Line "- Updated at: `$($run.updatedAt)`"
}
else {
    Add-Line "- Latest run: `Not found`"
}

if ($polish) {
    Add-Line "- Design polish status: `$($polish.status)`"
    Add-Line "- Design polish message: $($polish.message)"
}

Add-Line ""

Add-Line "## 2. GUI QA Result"
Add-Line ""

if ($gui) {
    Add-Line "- Status: `$($gui.status)`"
    Add-Line "- Base URL: `$($gui.baseURL)`"
    Add-Line "- Final URL: `$($gui.finalUrl)`"
    Add-Line "- HTTP status: `$($gui.httpStatus)`"
    Add-Line "- Page loaded: `$($gui.pageLoaded)`"
    Add-Line "- Body exists: `$($gui.bodyExists)`"
    Add-Line "- Body text length: `$($gui.bodyTextLength)`"
    Add-Line "- Console errors: `$(@($gui.consoleErrors).Count)`"
    Add-Line "- Page errors: `$(@($gui.pageErrors).Count)`"
    Add-Line "- Screenshot: `$($gui.screenshotPath)`"
}
else {
    Add-Line "- GUI QA latest result: `Not found`"
}

Add-Line ""

Add-Line "## 3. UI Quality Contract"
    Add-Line ""

    if ($contract) {
        Add-Line "- Project type: `$($contract.projectType)`"
    Add-Line "- Quality level: `$($contract.qualityLevel)`"
        Add-Line "- Visual goal: $($contract.visualGoal)"
        Add-Line "- Preset: `$($contract.preset)`"
} else {
    Add-Line "- UI Quality Contract: `Not found`"
    }

    Add-Line ""

    Add-Line "## 4. UI Stack Recommendation"
    Add-Line ""

    if ($stack -and $stack.recommendation) {
        $rs = $stack.recommendation.recommendedStack
        Add-Line "- Component system: `$($rs.componentSystem)`"
    Add-Line "- Styling: `$($rs.styling)`"
        Add-Line "- Icons: `$($rs.icons)`"
    Add-Line "- Charts: `$($rs.charts)`"
        Add-Line "- Tables: `$($rs.tables)`"
    Add-Line "- Animation: `$($rs.animation)`"
        Add-Line "- Forms: `$($rs.forms)`"
    Add-Line ""
    Add-Line "### Install Plan"
        foreach ($cmd in @($stack.recommendation.installPlan)) {
            Add-Line "- `$($cmd.command)`"
    }
} else {
    Add-Line "- UI Stack Recommendation: `Not found`"
        }

        Add-Line ""

        Add-Line "## 5. Dependency Plan"
        Add-Line ""

        if ($dep) {
            Add-Line "- Requires user approval: `$($dep.requiresUserApproval)`"
    Add-Line "- Required installs: `$(@($dep.requiredInstalls).Count)`"
            Add-Line "- Optional installs: `$(@($dep.optionalInstalls).Count)`"
    Add-Line "- Already installed: `$(@($dep.alreadyInstalled).Count)`"
            Add-Line "- Warnings: `$(@($dep.warnings).Count)`"
} else {
    Add-Line "- Dependency Plan: `Not found`"
        }

        Add-Line ""

        Add-Line "## 6. DOM Audit"
        Add-Line ""

        if ($audit) {
            Add-Line "- Final URL: `$($audit.finalUrl)`"
    Add-Line "- HTTP status: `$($audit.httpStatus)`"
            Add-Line "- Page loaded: `$($audit.pageLoaded)`"
    Add-Line "- Button count: `$($audit.buttonCount)`"
            Add-Line "- Input count: `$($audit.inputCount)`"
    Add-Line "- Table count: `$($audit.tableCount)`"
            Add-Line "- Heading count: `$($audit.headingCount)`"
    Add-Line "- Has nav: `$($audit.hasNav)`"
            Add-Line "- Has header: `$($audit.hasHeader)`"
    Add-Line "- Has sidebar: `$($audit.hasSidebar)`"
            Add-Line "- Has search/filter: `$($audit.hasSearchOrFilter)`"
    Add-Line "- Has theme toggle: `$($audit.hasThemeToggle)`"
            Add-Line "- Card-like count: `$($audit.cardLikeCount)`"
    Add-Line "- Status badge-like count: `$($audit.statusBadgeLikeCount)`"
            Add-Line "- Has table-like section: `$($audit.hasTableLikeSection)`"
    Add-Line "- Body text length: `$($audit.bodyTextLength)`"
            Add-Line "- Desktop screenshot: `$($audit.desktopScreenshotPath)`"
    Add-Line "- Mobile screenshot: `$($audit.mobileScreenshotPath)`"
        }
        else {
            Add-Line "- DOM Audit: `Not found`"
}

Add-Line ""

Add-Line "## 7. Design Review"
            Add-Line ""

            if ($review) {
                Add-Line "- Recommendation: `$($review.recommendation)`"
    Add-Line "- Review mode: `$($review.reviewMode)`"
                Add-Line "- Needs human visual review: `$($review.needsHumanVisualReview)`"
    Add-Line "- Notes: $($review.notes)"
    Add-Line ""
    Add-Line "### Issues"
                foreach ($issue in @($review.issues)) {
                    Add-Line "- $issue"
                }
            }
            else {
                Add-Line "- Design Review: `Not found`"
}

Add-Line ""

Add-Line "## 8. Agent Tool Actions / Pending Approvals"
                Add-Line ""

                if ($approvals) {
                    $approvalItems = @($approvals)
                    Add-Line "- Pending approval records found: `$($approvalItems.Count)`"
    foreach ($approval in $approvalItems) {
        Add-Line "- `$($approval.tool)` / `$($approval.status)` / $($approval.reason)"
    }
} else {
    Add-Line "- Pending approvals: `Not found or none`"
                }

                $ToolActionFiles = @()
                if ($AutonomyDir -and (Test-Path $AutonomyDir)) {
                    $ToolActionFiles = Get-ChildItem -Recurse $AutonomyDir -Filter "*.json" -ErrorAction SilentlyContinue |
                    Where-Object { $_.FullName -match "tool-actions" }
                }

                Add-Line "- Tool action files found: `$($ToolActionFiles.Count)`"

Add-Line ""

Add-Line "## 9. File Inventory"
                Add-Line ""

                Add-Line "### Copied Artifacts"
                foreach ($file in $Copied) {
                    Add-Line "- `$file`"
}

Add-Line ""

Add-Line "### Design Folder"
                    if (Test-Path $DesignDir) {
                        Get-ChildItem -Recurse $DesignDir | ForEach-Object {
                            Add-Line "- `$($_.FullName)`"
    }
} else {
    Add-Line "- Design folder not found."
}

Add-Line ""

Add-Line "### GUI QA Folder"
if (Test-Path $GuiQaDir) {
    Get-ChildItem -Recurse $GuiQaDir | ForEach-Object {
        Add-Line "- `$($_.FullName)`"
                        }
                    }
                    else {
                        Add-Line "- GUI QA folder not found."
                    }

                    Add-Line ""

                    Add-Line "### Autonomy Folder, first 120 items"
                    if (Test-Path $AutonomyDir) {
                        Get-ChildItem -Recurse $AutonomyDir | Select-Object -First 120 | ForEach-Object {
                            Add-Line "- `$($_.FullName)`"
    }
} else {
    Add-Line "- Autonomy folder not found."
}

Add-Line ""

Add-Line "## 10. Manual Notes To Fill In"
Add-Line ""
Add-Line "- Visual impression:"
Add-Line "- What looks wrong:"
Add-Line "- Buttons/interactions that failed:"
Add-Line "- Final TriFix message:"
Add-Line "- What to fix next:"

$ReportPath = Join-Path $OutDir "DEMO_RESULT_REPORT.md"
$JsonSummaryPath = Join-Path $OutDir "demo-result-summary.json"

$ReportLines | Set-Content -Encoding UTF8 $ReportPath

$Summary = [ordered]@{
    projectName = $ProjectName
    projectRoot = $ProjectRoot
    generatedAt = (Get-Date).ToString("o")
    outDir = $OutDir
    guiQa = $gui
    uiQualityContract = $contract
    uiStackRecommendation = $stack
    dependencyPlan = $dep
    domAudit = $audit
    designReview = $review
    designPolish = $polish
    latestRun = $run
    pendingApprovals = $approvals
    copiedArtifacts = $Copied
}

$Summary | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $JsonSummaryPath

Write-Section "Done"
Write-Host "Report folder:" -ForegroundColor Green
Write-Host $OutDir

Write-Host "`nMarkdown report:" -ForegroundColor Green
Write-Host $ReportPath

Write-Host "`nJSON summary:" -ForegroundColor Green
Write-Host $JsonSummaryPath

Write-Host "`nOpen report folder with:" -ForegroundColor Cyan
Write-Host "start `"$OutDir`""