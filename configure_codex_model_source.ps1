param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$Model,

    [string]$Provider = "custom",

    [Parameter(Mandatory = $true)]
    [ValidateSet("responses", "chat")]
    [string]$Protocol,

    [switch]$ApiKeyStdin,

    [string]$ApiKey,

    [int]$RelayPort = 8787,

    [switch]$ClearWebProfile,

    [switch]$NoLaunch,

    [switch]$SkipTest
)

$ErrorActionPreference = "Stop"

function Get-HelperPath {
    param([string]$Name)
    $path = Join-Path $PSScriptRoot $Name
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing helper file: $Name"
    }
    return $path
}

function Get-Key {
    if ($ApiKeyStdin) { return ([Console]::In.ReadToEnd()).Trim() }
    if ($ApiKey) { return $ApiKey.Trim() }
    throw "Missing API key."
}

function Invoke-WithKey {
    param([string]$Script, [string[]]$Arguments, [string]$Key)
    $Key | & powershell -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Script failed with exit code $LASTEXITCODE"
    }
}

function Stop-OldRelay {
    Get-Process deepseek-responses-relay -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    $startup = [Environment]::GetFolderPath("Startup")
    if (-not $startup) { $startup = Join-Path $env:USERPROFILE "AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup" }
    Remove-Item (Join-Path $startup "CodexAPIDeepSeekRelay.cmd") `
        -Force -ErrorAction SilentlyContinue
}

function Start-CurrentCodex {
    $app = Get-StartApps | Where-Object { $_.AppID -match "OpenAI\.Codex" } | Select-Object -First 1
    if ($app) {
        & explorer.exe "shell:AppsFolder\$($app.AppID)"
        Write-Host "Started original Codex app."
    }
}

function Backup-CurrentConfiguration {
    $codexHome = Join-Path $HOME ".codex"
    $configPath = Join-Path $codexHome "config.toml"
    $authPath = Join-Path $codexHome "auth.json"
    if ((-not (Test-Path -LiteralPath $configPath)) -and (-not (Test-Path -LiteralPath $authPath))) {
        Write-Host "No existing Codex configuration to back up."
        return
    }

    $backupDir = Join-Path (Join-Path $codexHome "backups") ("configuration-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    if (Test-Path -LiteralPath $configPath) { Copy-Item -LiteralPath $configPath -Destination (Join-Path $backupDir "config.toml") -Force }
    if (Test-Path -LiteralPath $authPath) { Copy-Item -LiteralPath $authPath -Destination (Join-Path $backupDir "auth.json") -Force }
    $relayDir = Join-Path $env:LOCALAPPDATA "CodexAPI\DeepSeekRelay"
    if (Test-Path -LiteralPath $relayDir) {
        $relayBackup = Join-Path $backupDir "relay"
        New-Item -ItemType Directory -Force -Path $relayBackup | Out-Null
        Get-ChildItem -LiteralPath $relayDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -in @("start_deepseek_relay.cmd", "deepseek_api_key.txt") } |
            Copy-Item -Destination $relayBackup -Force
    }
    Write-Host "Saved current configuration backup: $backupDir"
}

$key = Get-Key
Backup-CurrentConfiguration
$prepareScript = Get-HelperPath "prepare_codex_external_api.ps1"
$relayScript = Get-HelperPath "install_deepseek_relay.ps1"
$base = $BaseUrl.TrimEnd("/")
$effectiveBase = $base
$wireApi = "responses"

if ($Protocol -eq "chat") {
    Write-Host "Chat Completions compatibility mode: local relay enabled."
    $relayArgs = @(
        "-RelayHost", "127.0.0.1",
        "-RelayPort", "$RelayPort",
        "-DeepSeekBase", $base,
        "-DeepSeekModel", $Model,
        "-ApiKeyStdin"
    )
    if ($SkipTest) { $relayArgs += "-SkipTest" }
    Invoke-WithKey -Script $relayScript -Arguments $relayArgs -Key $key
    $effectiveBase = "http://127.0.0.1:$RelayPort"
} else {
    Write-Host "Responses API mode: Codex will connect directly to the configured Base URL."
    Stop-OldRelay
}

$prepareArgs = @(
    "-BaseUrl", $effectiveBase,
    "-ApiKeyStdin",
    "-Model", $Model,
    "-Provider", $Provider,
    "-WireApi", $wireApi
)
if ($ClearWebProfile) { $prepareArgs += "-ClearWebProfile" }
Invoke-WithKey -Script $prepareScript -Arguments $prepareArgs -Key $key

Write-Host "Provider: $Provider"
Write-Host "Model: $Model"
Write-Host "Configured Base URL: $base"
Write-Host "Codex Base URL: $effectiveBase"
Write-Host "Protocol: $Protocol"
Write-Host "API key: ***MASKED***"

if (-not $NoLaunch) { Start-CurrentCodex }
