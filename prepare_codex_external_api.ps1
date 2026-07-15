param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [string]$ApiKey,

    [switch]$ApiKeyStdin,

    [string]$Model = "gpt-5.5",

    [string]$Provider = "custom",

    [ValidateSet("responses", "chat")]
    [string]$WireApi = "responses",

    [string]$CodexHome = "$env:USERPROFILE\.codex",

    [string]$SwitchExe,

    [switch]$ClearWebProfile
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message"
}

function Stop-CodexProcesses {
    $names = @("ChatGPT", "Codex", "codex", "codex-plus-plus")
    $processes = Get-Process -ErrorAction SilentlyContinue | Where-Object { $names -contains $_.ProcessName }
    if (-not $processes) {
        Write-Host "No running Codex processes found."
        return
    }

    foreach ($process in $processes) {
        Write-Host "Stopping $($process.ProcessName) pid=$($process.Id)"
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Resolve-SwitchExe {
    param([string]$ExplicitPath)

    if ($ExplicitPath) {
        return (Resolve-Path -LiteralPath $ExplicitPath -ErrorAction Stop).Path
    }

    $scriptDir = Split-Path -Parent $MyInvocation.ScriptName
    $candidates = @(
        (Join-Path $scriptDir "codex-api-switch.exe"),
        (Join-Path $scriptDir "dist-x64\codex-api-switch.exe"),
        (Join-Path $scriptDir "dist\codex-api-switch.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "Cannot find codex-api-switch.exe. Pass -SwitchExe or place it next to this script."
}

function Resolve-CodexHome {
    param([string]$InputPath)

    $expanded = [Environment]::ExpandEnvironmentVariables($InputPath)
    if ([System.IO.Path]::IsPathRooted($expanded)) {
        return [System.IO.Path]::GetFullPath($expanded)
    }
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $expanded))
}

function Backup-And-ClearWebProfile {
    $webDir = Join-Path $env:APPDATA "Codex\web"
    if (-not (Test-Path -LiteralPath $webDir)) {
        Write-Host "No Codex web profile found: $webDir"
        return
    }

    $backupRoot = Join-Path $CodexHome "backups"
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDir = Join-Path $backupRoot "codex-web-profile-$stamp"
    try {
        Move-Item -LiteralPath $webDir -Destination $backupDir -Force -ErrorAction Stop
        Write-Host "Moved Codex web profile to: $backupDir"
        return
    } catch {
        Write-Warning "Could not move the WebView profile directory. Falling back to copy-and-clear."
        New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
        Copy-Item -LiteralPath (Join-Path $webDir "*") -Destination $backupDir -Recurse -Force -ErrorAction SilentlyContinue
        Get-ChildItem -LiteralPath $webDir -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Copied Codex web profile backup to: $backupDir"
        Write-Host "Cleared removable WebView profile contents."
    }
}

function Get-ApiKeyValue {
    if ($ApiKeyStdin) {
        return ([Console]::In.ReadToEnd()).Trim()
    }
    if ($ApiKey) {
        return $ApiKey.Trim()
    }
    if ($env:OPENAI_API_KEY) {
        return $env:OPENAI_API_KEY.Trim()
    }
    throw "Missing API key. Pass -ApiKey, -ApiKeyStdin, or set OPENAI_API_KEY."
}

Write-Step "Closing Codex"
Stop-CodexProcesses

Write-Step "Configuring external API"
$resolvedSwitchExe = Resolve-SwitchExe $SwitchExe
$resolvedCodexHome = Resolve-CodexHome $CodexHome
$key = Get-ApiKeyValue

$switchArgs = @(
    "--codex-home", $resolvedCodexHome,
    "--base-url", $BaseUrl,
    "--api-key-stdin",
    "--provider", $Provider,
    "--wire-api", $WireApi
)
if ($Model) {
    $switchArgs += @("--model", $Model)
}

$key | & $resolvedSwitchExe @switchArgs
if ($LASTEXITCODE -ne 0) {
    throw "codex-api-switch.exe failed with exit code $LASTEXITCODE"
}

Write-Step "Removing official ChatGPT web profile"
if ($ClearWebProfile) {
    Backup-And-ClearWebProfile
} else {
    Write-Host "Skipped. Pass -ClearWebProfile to move the Codex WebView profile out of APPDATA."
}

Write-Step "Result"
Write-Host "Codex home: $resolvedCodexHome"
Write-Host "Provider: $Provider"
Write-Host "Base URL: $($BaseUrl.TrimEnd('/'))"
Write-Host "Auth mode: OPENAI_API_KEY only"
Write-Host "Restart Codex after this script completes."
