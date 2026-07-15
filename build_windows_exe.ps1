$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SwitchSource = Join-Path $ScriptDir "codex_api_switch.py"
$RelaySource = Join-Path $ScriptDir "deepseek_responses_proxy.py"

if (-not (Test-Path $SwitchSource)) {
    throw "Cannot find codex_api_switch.py next to this build script."
}
if (-not (Test-Path $RelaySource)) {
    throw "Cannot find deepseek_responses_proxy.py next to this build script."
}

Set-Location $ScriptDir

Write-Host "Checking Python..."
if (Get-Command py -ErrorAction SilentlyContinue) {
    $Python = @("py", "-3")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $Python = @("python")
} else {
    throw "Python 3 was not found."
}

function Invoke-Python {
    param([string[]]$Arguments)

    $exe = $Python[0]
    $prefix = @()
    if ($Python.Count -gt 1) {
        $prefix = $Python[1..($Python.Count - 1)]
    }
    & $exe @($prefix + $Arguments)
}

Invoke-Python @("--version")

Write-Host "Installing/upgrading PyInstaller..."
Invoke-Python @("-m", "pip", "install", "--upgrade", "pyinstaller")

Write-Host "Building codex-api-switch.exe..."
Invoke-Python @(
    "-m", "PyInstaller",
    "--onefile",
    "--console",
    "--clean",
    "--name", "codex-api-switch",
    ".\codex_api_switch.py"
)

Write-Host "Building deepseek-responses-relay.exe..."
Invoke-Python @(
    "-m", "PyInstaller",
    "--onefile",
    "--console",
    "--clean",
    "--name", "deepseek-responses-relay",
    ".\deepseek_responses_proxy.py"
)

$Exe = Join-Path $ScriptDir "dist\codex-api-switch.exe"
if (-not (Test-Path $Exe)) {
    throw "Build finished but exe was not found: $Exe"
}
$RelayExe = Join-Path $ScriptDir "dist\deepseek-responses-relay.exe"
if (-not (Test-Path $RelayExe)) {
    throw "Build finished but exe was not found: $RelayExe"
}

Write-Host ""
Write-Host "Done:"
Write-Host $Exe
Write-Host $RelayExe
Write-Host ""
Write-Host "Try:"
Write-Host ".\dist\codex-api-switch.exe --where"
Write-Host ".\dist\deepseek-responses-relay.exe --help"
