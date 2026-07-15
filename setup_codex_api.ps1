param(
    [string]$MsixPath,
    [string]$Provider = "custom",
    [string]$Model = "",
    [string]$BaseUrl = "",
    [ValidateSet("responses", "chat")][string]$WireApi = "responses",
    [switch]$ApiKeyStdin,
    [switch]$UseDeepSeekRelay,
    [string]$DeepSeekBase = "",
    [switch]$SkipApiConfiguration,
    [switch]$ClearWebProfile,
    [switch]$SkipInstall,
    [switch]$KeepOriginalCodex
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-CheckedScript {
    param([string]$Name, [string[]]$Arguments = @(), [string]$StdinText = "")
    $script = Join-Path $root $Name
    if (-not (Test-Path $script)) { throw "Missing helper script: $script" }
    if ($StdinText) {
        $StdinText | & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script @Arguments
    } else {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script @Arguments
    }
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

$apiKey = if ($ApiKeyStdin) { [Console]::In.ReadToEnd().Trim() } else { "" }

if (-not $SkipInstall) {
    if (-not $MsixPath) { throw "MsixPath is required unless SkipInstall is used." }
    Invoke-CheckedScript "install_codex_msix.ps1" @($MsixPath)
}

if (-not $SkipApiConfiguration) {
    if (-not $apiKey) { throw "API Key is required." }
    if ($UseDeepSeekRelay) {
        Invoke-CheckedScript "install_deepseek_relay.ps1" @("-ApiKeyStdin", "-DeepSeekModel", $Model, "-DeepSeekBase", $DeepSeekBase) $apiKey
        $args = @("-ApiKeyStdin", "-Provider", $Provider, "-Model", $Model, "-BaseUrl", "http://127.0.0.1:8787", "-WireApi", "responses")
        if ($ClearWebProfile) { $args += "-ClearWebProfile" }
        Invoke-CheckedScript "prepare_codex_external_api.ps1" $args $apiKey
    } else {
        $args = @("-ApiKeyStdin", "-Provider", $Provider, "-Model", $Model, "-BaseUrl", $BaseUrl, "-WireApi", $WireApi)
        if ($ClearWebProfile) { $args += "-ClearWebProfile" }
        Invoke-CheckedScript "prepare_codex_external_api.ps1" $args $apiKey
    }
}

Start-Process explorer.exe "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
