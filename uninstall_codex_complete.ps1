param(
    [switch]$Confirm
)

$ErrorActionPreference = "Stop"
if (-not $Confirm) {
    throw "Refusing to uninstall without -Confirm."
}

function Remove-PathIfPresent {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Removed: $Path"
    }
}

$processNames = @("ChatGPT", "Codex", "codex", "deepseek-responses-relay")
Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $processNames -contains $_.ProcessName } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "start_deepseek_relay|deepseek_responses_proxy" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Get-AppxPackage OpenAI.Codex -ErrorAction SilentlyContinue |
    ForEach-Object {
        Write-Host "Removing app package: $($_.PackageFullName)"
        Remove-AppxPackage -Package $_.PackageFullName -ErrorAction Stop
    }

$startup = [Environment]::GetFolderPath("Startup")
if (-not $startup) { $startup = Join-Path $env:USERPROFILE "AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup" }
Remove-Item (Join-Path $startup "CodexAPIDeepSeekRelay.cmd") -Force -ErrorAction SilentlyContinue

foreach ($path in @(
    (Join-Path $env:USERPROFILE ".codex"),
    (Join-Path $env:USERPROFILE ".codex-session-delete"),
    (Join-Path $env:APPDATA "Codex"),
    (Join-Path $env:LOCALAPPDATA "Codex"),
    (Join-Path $env:LOCALAPPDATA "CodexAPI")
)) {
    Remove-PathIfPresent -Path $path
}

foreach ($root in @(
    [Environment]::GetFolderPath("Desktop"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
 ) | Where-Object { $_ }) {
    if (Test-Path -LiteralPath $root) {
        Get-ChildItem -LiteralPath $root -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.BaseName -match "Codex|ChatGPT" } |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
}

$remainingPackage = [bool](Get-AppxPackage OpenAI.Codex -ErrorAction SilentlyContinue)
$remainingData = @(
    (Join-Path $env:USERPROFILE ".codex"),
    (Join-Path $env:APPDATA "Codex"),
    (Join-Path $env:LOCALAPPDATA "Codex"),
    (Join-Path $env:LOCALAPPDATA "CodexAPI")
) | Where-Object { Test-Path -LiteralPath $_ }

if ($remainingPackage -or $remainingData.Count) {
    throw "Uninstall did not complete. Remaining package: $remainingPackage; remaining data paths: $($remainingData -join ', ')"
}

Write-Host "Codex API configuration data was removed for the current Windows user."
