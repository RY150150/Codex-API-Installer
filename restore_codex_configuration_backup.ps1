param(
    [Parameter(Mandatory = $true)]
    [string]$BackupName,

    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$codexHome = Join-Path $HOME ".codex"
$backupRoot = Join-Path $codexHome "backups"
$startupDirectory = [Environment]::GetFolderPath("Startup")
if (-not $startupDirectory) { $startupDirectory = Join-Path $env:USERPROFILE "AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup" }
New-Item -ItemType Directory -Force -Path $startupDirectory | Out-Null

if ($BackupName -notmatch '^configuration-\d{8}-\d{6}$') {
    throw "Invalid backup name."
}

$backupDir = Join-Path $backupRoot $BackupName
if (-not (Test-Path -LiteralPath $backupDir)) {
    throw "Backup was not found: $BackupName"
}

$configSource = Join-Path $backupDir "config.toml"
$authSource = Join-Path $backupDir "auth.json"
if ((-not (Test-Path -LiteralPath $configSource)) -and (-not (Test-Path -LiteralPath $authSource))) {
    throw "The selected backup contains no restorable configuration."
}

$currentBackup = Join-Path $backupRoot ("configuration-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-before-restore")
New-Item -ItemType Directory -Force -Path $currentBackup | Out-Null
foreach ($name in @("config.toml", "auth.json")) {
    $current = Join-Path $codexHome $name
    if (Test-Path -LiteralPath $current) {
        Copy-Item -LiteralPath $current -Destination (Join-Path $currentBackup $name) -Force
    }
}

Get-Process ChatGPT, Codex, codex -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process deepseek-responses-relay -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $startupDirectory "CodexAPIDeepSeekRelay.cmd") -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $configSource) { Copy-Item -LiteralPath $configSource -Destination (Join-Path $codexHome "config.toml") -Force }
if (Test-Path -LiteralPath $authSource) { Copy-Item -LiteralPath $authSource -Destination (Join-Path $codexHome "auth.json") -Force }
$relayBackup = Join-Path $backupDir "relay"
if (Test-Path -LiteralPath $relayBackup) {
    $relayDir = Join-Path $env:LOCALAPPDATA "CodexAPI\DeepSeekRelay"
    New-Item -ItemType Directory -Force -Path $relayDir | Out-Null
    Get-ChildItem -LiteralPath $relayBackup -File | Copy-Item -Destination $relayDir -Force
    $relayCmd = Join-Path $relayDir "start_deepseek_relay.cmd"
    if (Test-Path -LiteralPath $relayCmd) {
        Copy-Item -LiteralPath $relayCmd -Destination (Join-Path $startupDirectory "CodexAPIDeepSeekRelay.cmd") -Force
        Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "`"$relayCmd`"") -WindowStyle Hidden
        Write-Host "Restored and started the Chat Completions relay."
    }
}
Write-Host "Restored configuration backup: $BackupName"
Write-Host "Saved current configuration before restore: $currentBackup"

if (-not $NoLaunch) {
    $app = Get-StartApps | Where-Object { $_.AppID -match "OpenAI\.Codex" } | Select-Object -First 1
    if ($app) { & explorer.exe "shell:AppsFolder\$($app.AppID)" }
}
