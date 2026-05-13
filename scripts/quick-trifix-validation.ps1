param(
    [string]$ProjectRoot = "C:\Users\Skunk\Documents\TriFix AI Sandbox\sandbox\tasks\implement-a-basic-vite-react-dashboard-3",
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"

function Write-Step($Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Pass($Text) {
    Write-Host "PASS: $Text" -ForegroundColor Green
}

function Fail($Text) {
    Write-Host "FAIL: $Text" -ForegroundColor Red
}

function Warn($Text) {
    Write-Host "WARN: $Text" -ForegroundColor Yellow
}

function Ensure-Dir($Path) {
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Read-ProcessOutput($Path) {
    if (Test-Path $Path) {
        return Get-Content $Path -Raw -ErrorAction SilentlyContinue
    }
    return ""
}

function Find-LocalUrl($Text) {
    $patterns = @(
        'https?://localhost:\d+/?',
        'https?://127\.0\.0\.1:\d+/?',
        'https?://0\.0\.0\.0:\d+/?',
        'https?://\[::1\]:\d+/?'
    )

    foreach ($pattern in $patterns) {
        $match = [regex]::Match($Text, $pattern)
        if ($match.Success) {
            $url = $match.Value
            $url = $url -replace '0\.0\.0\.0', '127.0.0.1'
            $url = $url -replace '\[::1\]', '127.0.0.1'
            return $url
        }
    }

    return $null
}

$Results = [ordered]@{
    projectRoot = $ProjectRoot
    checkedAt = (Get-Date).ToString("o")
    checks = @()
}

function Add-Check($Name, $Status, $Details = "") {
    $script:Results.checks += [ordered]@{
        name = $Name
        status = $Status
        details = $Details
    }
}

Write-Step "TriFix Quick Validation"

if (-not (Test-Path $ProjectRoot)) {
    Fail "Project root not found: $ProjectRoot"
    exit 1
}

Pass "Project root found"
Add-Check "Project root exists" "passed" $ProjectRoot

Set-Location $ProjectRoot

$TrifixDir = Join-Path $ProjectRoot ".trifix"
$GuiQaDir = Join-Path $TrifixDir "gui-qa"
$TerminalDir = Join-Path $TrifixDir "terminal"
$ProcessDir = Join-Path $TrifixDir "processes"

Ensure-Dir $GuiQaDir
Ensure-Dir $TerminalDir
Ensure-Dir $ProcessDir

Write-Step "Check important project files"

$RequiredFiles = @(
    "package.json",
    "vite.config.js",
    "index.html",
    "src\main.jsx",
    "src\App.jsx"
)

foreach ($file in $RequiredFiles) {
    if (Test-Path (Join-Path $ProjectRoot $file)) {
        Pass "Found $file"
        Add-Check "Found $file" "passed"
    } else {
        Warn "Missing $file"
        Add-Check "Found $file" "warning" "Missing"
    }
}

Write-Step "Run npm --version"

try {
    $npmVersion = & npm --version
    Pass "npm works: $npmVersion"
    Add-Check "npm --version" "passed" $npmVersion
} catch {
    Fail "npm failed: $($_.Exception.Message)"
    Add-Check "npm --version" "failed" $_.Exception.Message
}

Write-Step "Run npm run build"

try {
    $buildOutput = & npm run build 2>&1
    $buildText = $buildOutput | Out-String

    if ($LASTEXITCODE -eq 0) {
        Pass "npm run build passed"
        Add-Check "npm run build" "passed" "Exit code 0"
    } else {
        Fail "npm run build failed"
        Add-Check "npm run build" "failed" $buildText
    }

    $buildLog = Join-Path $GuiQaDir "quick-build-log.txt"
    $buildText | Set-Content -Encoding UTF8 $buildLog
} catch {
    Fail "Build command errored: $($_.Exception.Message)"
    Add-Check "npm run build" "failed" $_.Exception.Message
}

Write-Step "Start npm run dev and detect URL"

$ProcessId = "quick-" + ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$StdoutLog = Join-Path $ProcessDir "$ProcessId.stdout.log"
$StderrLog = Join-Path $ProcessDir "$ProcessId.stderr.log"

$proc = $null
$detectedUrl = $null

try {
    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/d", "/s", "/c", "npm.cmd run dev" `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError $StderrLog `
        -PassThru `
        -WindowStyle Hidden

    Pass "Started dev server process PID $($proc.Id)"
    Add-Check "npm run dev start" "passed" "PID $($proc.Id)"

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 750

        $stdout = Read-ProcessOutput $StdoutLog
        $stderr = Read-ProcessOutput $StderrLog
        $combined = "$stdout`n$stderr"

        $detectedUrl = Find-LocalUrl $combined

        if ($detectedUrl) {
            Pass "Detected dev URL: $detectedUrl"
            Add-Check "Detect dev URL" "passed" $detectedUrl
            break
        }

        if ($proc.HasExited) {
            Warn "Dev server process exited before URL detection"
            Add-Check "Detect dev URL" "failed" "Process exited early"
            break
        }
    }

    if (-not $detectedUrl) {
        Warn "No dev URL detected within timeout"
        Add-Check "Detect dev URL" "failed" "No URL found in stdout/stderr"
    }
} catch {
    Fail "Could not start dev server: $($_.Exception.Message)"
    Add-Check "npm run dev start" "failed" $_.Exception.Message
}

Write-Step "HTTP check"

if ($detectedUrl) {
    try {
        $response = Invoke-WebRequest -Uri $detectedUrl -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
            Pass "HTTP check passed: $($response.StatusCode)"
            Add-Check "HTTP status" "passed" "$($response.StatusCode)"
        } else {
            Warn "HTTP check returned status: $($response.StatusCode)"
            Add-Check "HTTP status" "warning" "$($response.StatusCode)"
        }
    } catch {
        Fail "HTTP check failed: $($_.Exception.Message)"
        Add-Check "HTTP status" "failed" $_.Exception.Message
    }
}

Write-Step "Playwright capability check"

$PlaywrightAvailable = $false

try {
    $pwResolve = & node -e "try { require.resolve('@playwright/test'); console.log('available') } catch (e) { console.log('missing') }"
    if (($pwResolve | Out-String).Trim() -eq "available") {
        $PlaywrightAvailable = $true
        Pass "@playwright/test is available"
        Add-Check "Playwright package" "passed"
    } else {
        Warn "@playwright/test is missing"
        Add-Check "Playwright package" "warning" "package_missing"
    }
} catch {
    Warn "Could not check Playwright package: $($_.Exception.Message)"
    Add-Check "Playwright package" "warning" $_.Exception.Message
}

Write-Step "Playwright smoke test"

$LatestResult = Join-Path $GuiQaDir "latest-result.json"
$LatestScreenshot = Join-Path $GuiQaDir "latest-screenshot.png"

if ($PlaywrightAvailable -and $detectedUrl) {
    $SmokeScript = Join-Path $GuiQaDir "quick-smoke-test.cjs"

    @"
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const baseURL = process.argv[2];
const resultPath = process.argv[3];
const screenshotPath = process.argv[4];

(async () => {
  const consoleErrors = [];
  const pageErrors = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", msg => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  page.on("pageerror", err => {
    pageErrors.push(err.message || String(err));
  });

  let status = "failed";
  let httpStatus = null;
  let title = "";
  let bodyTextLength = 0;
  let finalUrl = "";

  try {
    const response = await page.goto(baseURL, { waitUntil: "networkidle", timeout: 30000 });
    httpStatus = response ? response.status() : null;
    title = await page.title();
    finalUrl = page.url();

    const body = await page.locator("body");
    const bodyExists = await body.count() > 0;
    const bodyText = bodyExists ? await body.innerText() : "";
    bodyTextLength = bodyText.length;

    await page.screenshot({ path: screenshotPath, fullPage: true });

    const pageLoaded = httpStatus >= 200 && httpStatus < 300;
    const passed = pageLoaded && bodyExists && bodyTextLength > 0 && pageErrors.length === 0;

    status = passed ? "passed" : "failed";

    const result = {
      status,
      baseURL,
      finalUrl,
      title,
      bodyTextLength,
      consoleErrors,
      pageErrors,
      screenshotPath,
      resultPath,
      checkedAt: new Date().toISOString(),
      mode: "headless",
      browser: "chromium",
      httpStatus,
      pageLoaded,
      bodyExists,
      genericChecks: {
        pageLoads: pageLoaded,
        bodyExists,
        bodyTextNotEmpty: bodyTextLength > 0,
        noUncaughtPageError: pageErrors.length === 0
      },
      message: status === "passed" ? "GUI smoke test passed." : "GUI smoke test failed."
    };

    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  } catch (error) {
    const result = {
      status: "error",
      baseURL,
      finalUrl,
      title,
      bodyTextLength,
      consoleErrors,
      pageErrors: [...pageErrors, error.message || String(error)],
      screenshotPath,
      resultPath,
      checkedAt: new Date().toISOString(),
      mode: "headless",
      browser: "chromium",
      httpStatus,
      pageLoaded: false,
      bodyExists: false,
      genericChecks: {
        pageLoads: false,
        bodyExists: false,
        bodyTextNotEmpty: false,
        noUncaughtPageError: pageErrors.length === 0
      },
      message: error.message || String(error)
    };

    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
"@ | Set-Content -Encoding UTF8 $SmokeScript

    try {
        & node $SmokeScript $detectedUrl $LatestResult $LatestScreenshot
        if (Test-Path $LatestResult) {
            $resultJson = Get-Content $LatestResult -Raw | ConvertFrom-Json
            if ($resultJson.status -eq "passed") {
                Pass "Playwright smoke test passed"
                Add-Check "Playwright smoke test" "passed" $LatestResult
            } else {
                Warn "Playwright smoke test status: $($resultJson.status)"
                Add-Check "Playwright smoke test" $resultJson.status $LatestResult
            }
        } else {
            Fail "Playwright result file was not created"
            Add-Check "Playwright smoke test" "failed" "No result file"
        }
    } catch {
        Fail "Playwright smoke test errored: $($_.Exception.Message)"
        Add-Check "Playwright smoke test" "failed" $_.Exception.Message
    }
} elseif (-not $PlaywrightAvailable) {
    Warn "Skipping Playwright smoke test because package is missing"
    Add-Check "Playwright smoke test" "skipped" "package_missing"
} elseif (-not $detectedUrl) {
    Warn "Skipping Playwright smoke test because no dev URL was detected"
    Add-Check "Playwright smoke test" "skipped" "missing_health_url"
}

Write-Step "Create quality-loop evidence folder"

try {
    $RoundDir = Join-Path $GuiQaDir "rounds\round-001"
    Ensure-Dir $RoundDir

    if (Test-Path $LatestResult) {
        Copy-Item $LatestResult (Join-Path $RoundDir "result.json") -Force
    }

    if (Test-Path $LatestScreenshot) {
        Copy-Item $LatestScreenshot (Join-Path $RoundDir "screenshot.png") -Force
    }

    $Evidence = [ordered]@{
        status = if (Test-Path $LatestResult) { "created" } else { "no_gui_result" }
        baseURL = $detectedUrl
        latestResult = $LatestResult
        latestScreenshot = $LatestScreenshot
        roundDir = $RoundDir
        createdAt = (Get-Date).ToString("o")
    }

    $Evidence | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 (Join-Path $RoundDir "evidence-summary.json")

    Pass "Evidence folder prepared: $RoundDir"
    Add-Check "Quality loop evidence folder" "passed" $RoundDir
} catch {
    Fail "Could not create evidence folder: $($_.Exception.Message)"
    Add-Check "Quality loop evidence folder" "failed" $_.Exception.Message
}

Write-Step "Stop dev server"

if ($proc -and -not $proc.HasExited) {
    try {
        Stop-Process -Id $proc.Id -Force
        Pass "Stopped dev server process"
        Add-Check "Stop dev server" "passed" "PID $($proc.Id)"
    } catch {
        Warn "Could not stop dev server process: $($_.Exception.Message)"
        Add-Check "Stop dev server" "warning" $_.Exception.Message
    }
}

Write-Step "Final summary"

$SummaryPath = Join-Path $GuiQaDir "quick-validation-summary.json"
$Results | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $SummaryPath

$Results.checks | ForEach-Object {
    $color = switch ($_.status) {
        "passed" { "Green" }
        "failed" { "Red" }
        "warning" { "Yellow" }
        "skipped" { "Yellow" }
        default { "White" }
    }

    Write-Host "$($_.status.ToUpper()) - $($_.name) $($_.details)" -ForegroundColor $color
}

Write-Host "`nSummary saved to:" -ForegroundColor Cyan
Write-Host $SummaryPath

Write-Host "`nUseful files:" -ForegroundColor Cyan
Write-Host $LatestResult
Write-Host $LatestScreenshot
Write-Host $StdoutLog
Write-Host $StderrLog