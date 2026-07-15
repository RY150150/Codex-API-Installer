param([switch]$SkipInstall)

$ErrorActionPreference = "Stop"
$uiDir = Join-Path $PSScriptRoot "codex-api-installer-ui"
if (-not (Test-Path (Join-Path $uiDir "package.json"))) {
    throw "GUI project not found: $uiDir"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js 20 or newer is required to build the installer. End users do not need Node.js."
}

Push-Location $uiDir
try {
    if (-not $SkipInstall) { npm install }
    npm run dist:all
    Write-Host "Built original Codex installer: $uiDir\release\Codex-API-Installer-1.0.0.exe"
    Write-Host "Built model source manager: $uiDir\release\Codex-Model-Source-Manager-1.0.0.exe"
} finally {
    Pop-Location
}
