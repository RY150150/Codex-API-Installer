param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,

    [switch]$NoKill
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message"
}

function Test-AppInstaller {
    $pkg = Get-AppxPackage Microsoft.DesktopAppInstaller -ErrorAction SilentlyContinue
    if ($pkg) {
        Write-Host "App Installer found: $($pkg.PackageFullName)"
        return $true
    }

    Write-Warning "App Installer is not registered for this user. Double-clicking .msix may not work."
    Write-Host "This script will continue with Add-AppxPackage, which does not require the double-click handler."
    Write-Host "To restore double-click install, install or repair 'App Installer' from Microsoft Store."
    return $false
}

function Stop-CodexProcesses {
    $names = @("ChatGPT", "Codex", "codex", "codex-plus-plus")
    $processes = Get-Process -ErrorAction SilentlyContinue | Where-Object { $names -contains $_.ProcessName }
    if (-not $processes) {
        Write-Host "No running Codex processes found."
        return
    }

    Write-Host "Stopping running Codex processes so MSIX deployment can update files..."
    foreach ($process in $processes) {
        Write-Host "Stopping $($process.ProcessName) pid=$($process.Id)"
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Resolve-InstallPath {
    param([string]$InputPath)

    $resolved = Resolve-Path -LiteralPath $InputPath -ErrorAction Stop
    $item = Get-Item -LiteralPath $resolved.Path -ErrorAction Stop
    if (-not $item.Extension.Equals(".msix", [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $item.Extension.Equals(".msixbundle", [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $item.Extension.Equals(".appx", [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $item.Extension.Equals(".appxbundle", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Expected an .msix/.msixbundle/.appx/.appxbundle file, got: $($item.FullName)"
    }
    return $item.FullName
}

$packagePath = Resolve-InstallPath $Path

Write-Step "Checking package"
Write-Host "Package: $packagePath"
Write-Host "Size: $((Get-Item -LiteralPath $packagePath).Length) bytes"

Write-Step "Checking App Installer registration"
[void](Test-AppInstaller)

if (-not $NoKill) {
    Write-Step "Closing running Codex"
    Stop-CodexProcesses
} else {
    Write-Warning "Skipping process cleanup because -NoKill was passed."
}

Write-Step "Installing MSIX package"
try {
    Add-AppxPackage -Path $packagePath -ErrorAction Stop
    Write-Host "Install completed."
} catch {
    Write-Error $_
    Write-Host ""
    Write-Host "Common fixes:"
    Write-Host "- Close Codex completely, including background codex.exe app-server processes."
    Write-Host "- If you see 0x80073D02, the app is still running and locking files."
    Write-Host "- If double-click install does not work, repair/install Microsoft App Installer."
    Write-Host "- If the package is corrupt, re-download it and compare its SHA256 checksum."
    exit 1
}

Write-Step "Installed Codex packages"
$installed = Get-AppxPackage OpenAI.Codex -ErrorAction SilentlyContinue
if (-not $installed) {
    throw "Add-AppxPackage completed, but OpenAI.Codex is still not registered for this Windows user."
}
$installed | Select-Object Name, PackageFullName, Version, InstallLocation | Format-List
