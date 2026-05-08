[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot
)

$ErrorActionPreference = "Stop"

$stderrLog = Join-Path $WorkspaceRoot "dev.ps1.stderr.log"
$currentStderrLog = Join-Path $WorkspaceRoot "dev.current.stderr.log"

Write-Host "TriFix log watcher"
Write-Host "Primary: $stderrLog"
Write-Host "Secondary: $currentStderrLog"
Write-Host ""
Write-Host "Streaming dev.ps1.stderr.log. Press Ctrl+C to close this window."
Write-Host ""

if (-not (Test-Path $stderrLog)) {
  New-Item -ItemType File -Path $stderrLog -Force | Out-Null
}

Get-Content -Path $stderrLog -Tail 40 -Wait
