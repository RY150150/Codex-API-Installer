param(
    [string]$RelayHost = "127.0.0.1",

    [int]$RelayPort = 8787,

    [string]$DeepSeekBase = "https://api.deepseek.com/v1",

    [string]$DeepSeekModel = "deepseek-chat",

    [string]$ApiKey,

    [switch]$ApiKeyStdin,

    [string]$InstallDir = "$env:LOCALAPPDATA\CodexAPI\DeepSeekRelay",

    [string]$RelayExe,

    [switch]$NoStartup,

    [switch]$SkipStart,

    [switch]$SkipTest
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message"
}

function Get-StartupDirectory {
    $startup = [Environment]::GetFolderPath("Startup")
    if (-not $startup) {
        $roaming = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE "AppData\Roaming" }
        $startup = Join-Path $roaming "Microsoft\Windows\Start Menu\Programs\Startup"
    }
    New-Item -ItemType Directory -Force -Path $startup | Out-Null
    return $startup
}

function Get-ApiKeyValue {
    if ($ApiKeyStdin) {
        return ([Console]::In.ReadToEnd()).Trim()
    }
    if ($ApiKey) {
        return $ApiKey.Trim()
    }
    if ($env:DEEPSEEK_API_KEY) {
        return $env:DEEPSEEK_API_KEY.Trim()
    }
    if ($env:OPENAI_API_KEY) {
        return $env:OPENAI_API_KEY.Trim()
    }
    throw "Missing API key. Pass -ApiKey, -ApiKeyStdin, or set DEEPSEEK_API_KEY/OPENAI_API_KEY."
}

function Resolve-PythonCommand {
    $candidates = @(
        @{ File = "python"; Args = @() },
        @{ File = "python3"; Args = @() },
        @{ File = "py"; Args = @("-3") }
    )

    foreach ($candidate in $candidates) {
        $cmd = Get-Command $candidate.File -ErrorAction SilentlyContinue
        if (-not $cmd) {
            continue
        }
        try {
            $version = & $candidate.File @($candidate.Args + @("-c", "import sys; print(sys.version_info[0])")) 2>$null
            if (($version | Select-Object -First 1) -eq "3") {
                $file = $candidate.File
                if ($cmd.Source) {
                    $file = $cmd.Source
                }
                return @{ File = $file; Args = $candidate.Args }
            }
        } catch {
        }
    }
    throw "Python 3 was not found. Install Python 3, or install Codex with a bundled relay exe."
}

function Find-FirstExistingPath {
    param([string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
        }
    }
    return $null
}

function Resolve-RelayExe {
    param(
        [string]$ExplicitPath,
        [string]$ScriptDir
    )

    if ($ExplicitPath) {
        return (Resolve-Path -LiteralPath $ExplicitPath -ErrorAction Stop).Path
    }

    return Find-FirstExistingPath @(
        (Join-Path $ScriptDir "deepseek-responses-relay.exe"),
        (Join-Path $ScriptDir "dist-x64\deepseek-responses-relay.exe"),
        (Join-Path $ScriptDir "dist\deepseek-responses-relay.exe"),
        (Join-Path $ScriptDir "dist-arm64\deepseek-responses-relay.exe")
    )
}

function Stop-ExistingRelay {
    param(
        [string]$ProxyPath,
        [string]$ExePath,
        [int]$Port
    )

    $escapedPath = $ProxyPath.Replace("\", "\\")
    $escapedExePath = ""
    if ($ExePath) {
        $escapedExePath = $ExePath.Replace("\", "\\")
    }
    $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            (
                $_.Name -eq "deepseek-responses-relay.exe" -or
                ($_.Name -eq "cmd.exe" -and $_.CommandLine -match [regex]::Escape("start_deepseek_relay.cmd")) -or
                $_.CommandLine -match [regex]::Escape("deepseek_responses_proxy.py") -or
                $_.CommandLine -match [regex]::Escape("deepseek-responses-relay.exe") -or
                $_.CommandLine -match [regex]::Escape($escapedPath) -or
                ($escapedExePath -and $_.CommandLine -match [regex]::Escape($escapedExePath))
            ) -and
            (
                $_.CommandLine -match "--port\s+$Port" -or
                $_.Name -eq "deepseek-responses-relay.exe" -or
                ($_.Name -eq "cmd.exe" -and $_.CommandLine -match [regex]::Escape("start_deepseek_relay.cmd"))
            )
        }

    foreach ($process in $processes) {
        Write-Host "Stopping existing Chat Completions relay pid=$($process.ProcessId)"
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }

    $deadline = (Get-Date).AddSeconds(10)
    do {
        $remaining = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq "deepseek-responses-relay.exe" -or
                ($_.Name -eq "cmd.exe" -and $_.CommandLine -match [regex]::Escape("start_deepseek_relay.cmd"))
            }
        if (-not $remaining) {
            return
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
}

function Copy-WithRetry {
    param(
        [string]$Source,
        [string]$Destination
    )

    for ($attempt = 1; $attempt -le 12; $attempt++) {
        try {
            Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
            return
        } catch {
            if ($attempt -eq 12) {
                throw
            }
            Start-Sleep -Milliseconds 500
        }
    }
}

function Write-PrivateText {
    param([string]$Path, [string]$Text)

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        icacls $Path /inheritance:r /grant:r "${identity}:(R,W)" | Out-Null
    } catch {
        Write-Warning "Could not tighten permissions on $Path"
    }
}

function Quote-CmdArg {
    param([string]$Value)

    return '"' + ($Value -replace '"', '""') + '"'
}

function Test-Relay {
    param([string]$BaseUrl)

    $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" -TimeoutSec 10
    if (-not $health.ok) {
        throw "Relay health check returned an unexpected response."
    }

    $body = @{
        model = $DeepSeekModel
        input = @(
            @{
                role = "user"
                content = "Reply with exactly: OK"
            }
        )
        stream = $false
    } | ConvertTo-Json -Depth 10

    $response = Invoke-RestMethod -Method Post -Uri "$BaseUrl/responses" -ContentType "application/json" -Body $body -TimeoutSec 120
    $text = ""
    foreach ($item in @($response.output)) {
        foreach ($part in @($item.content)) {
            if ($part.text) {
                $text += [string]$part.text
            }
        }
    }
    if (-not $text.Trim()) {
        throw "Relay test reached the upstream API, but no text was returned."
    }
    Write-Host "Upstream API relay test response: $($text.Trim())"
}

function Wait-RelayReady {
    param([string]$BaseUrl)

    $deadline = (Get-Date).AddSeconds(20)
    do {
        try {
            $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" -TimeoutSec 3
            if ($health.ok) {
                return
            }
        } catch {
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    throw "Chat Completions relay did not become ready at $BaseUrl within 20 seconds."
}

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $PSCommandPath
}
if (-not $scriptDir) {
    $scriptDir = Get-Location
}
$sourceProxy = Join-Path $scriptDir "deepseek_responses_proxy.py"
$resolvedRelayExe = Resolve-RelayExe -ExplicitPath $RelayExe -ScriptDir $scriptDir
if (-not $resolvedRelayExe -and -not (Test-Path -LiteralPath $sourceProxy)) {
    throw "Missing Chat Completions relay runtime. Put deepseek-responses-relay.exe or deepseek_responses_proxy.py next to install_deepseek_relay.ps1."
}

Write-Step "Installing Chat Completions compatibility relay"
$key = Get-ApiKeyValue
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$proxyPath = Join-Path $InstallDir "deepseek_responses_proxy.py"
$installedRelayExe = Join-Path $InstallDir "deepseek-responses-relay.exe"
$keyPath = Join-Path $InstallDir "deepseek_api_key.txt"
$cmdPath = Join-Path $InstallDir "start_deepseek_relay.cmd"
$logPath = Join-Path $InstallDir "deepseek_relay.log"
$startupPath = Join-Path (Get-StartupDirectory) "CodexAPIDeepSeekRelay.cmd"

Stop-ExistingRelay -ProxyPath $proxyPath -ExePath $installedRelayExe -Port $RelayPort

if ($resolvedRelayExe) {
    Copy-WithRetry -Source $resolvedRelayExe -Destination $installedRelayExe
    Write-Host "Relay runtime: bundled exe"
} else {
    $python = Resolve-PythonCommand
    Copy-Item -LiteralPath $sourceProxy -Destination $proxyPath -Force
    Write-Host "Relay runtime: Python 3"
}
Write-PrivateText -Path $keyPath -Text $key

if ($resolvedRelayExe) {
    $runtimeCommand = Quote-CmdArg $installedRelayExe
} else {
    $pythonFile = $python.File
    $pythonArgs = @($python.Args)
    $pythonPrefix = @($pythonFile) + $pythonArgs
    $runtimeCommand = ($pythonPrefix | ForEach-Object { Quote-CmdArg $_ }) -join " "
    $runtimeCommand = "$runtimeCommand $(Quote-CmdArg $proxyPath)"
}

$cmdContents = @"
@echo off
setlocal
cd /d "$InstallDir"
$runtimeCommand --host "$RelayHost" --port $RelayPort --deepseek-base "$DeepSeekBase" --deepseek-model "$DeepSeekModel" --api-key-file "$keyPath" >> "$logPath" 2>&1
"@
Set-Content -LiteralPath $cmdPath -Value $cmdContents -Encoding ASCII

if (-not $NoStartup) {
    Copy-Item -LiteralPath $cmdPath -Destination $startupPath -Force
    Write-Host "Startup entry: $startupPath"
}

if (-not $SkipStart) {
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "`"$cmdPath`"") -WindowStyle Hidden
}

$relayBaseUrl = "http://$RelayHost`:$RelayPort"
if (-not $SkipStart) {
    Wait-RelayReady -BaseUrl $relayBaseUrl
}
if (-not $SkipTest) {
    Write-Step "Testing upstream API through relay"
    Test-Relay -BaseUrl $relayBaseUrl
}

Write-Step "Result"
Write-Host "Relay base URL for Codex: $relayBaseUrl"
Write-Host "Upstream API: $($DeepSeekBase.TrimEnd('/'))/chat/completions"
Write-Host "Upstream model: $DeepSeekModel"
Write-Host "API key: ***MASKED***"
