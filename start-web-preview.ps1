param()

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$webDir = Join-Path $root "web"
$backendDir = Join-Path $root "server"
$backendPort = 8088
$frontendPort = 3000
$url = "http://localhost:$frontendPort"

if (-not (Test-Path $webDir -PathType Container)) {
    Write-Host "[ERROR] web directory not found: $webDir"
    exit 1
}

if (-not (Test-Path $backendDir -PathType Container)) {
    Write-Host "[ERROR] server directory not found: $backendDir"
    exit 1
}

function Stop-PortProcess([int]$Port) {
    $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        try {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop
        } catch {
        }
    }
}

function Wait-PortReady([int]$Port, [int]$Retry = 60) {
    for ($i = 0; $i -lt $Retry; $i++) {
        $ok = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if ($ok) {
            return $true
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

Write-Host "[INFO] Restarting services (release occupied ports first)..."
Stop-PortProcess -Port $backendPort
Stop-PortProcess -Port $frontendPort

Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "cd /d `"$backendDir`" && npm run start" -WindowStyle Minimized
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "cd /d `"$webDir`" && corepack pnpm dev" -WindowStyle Minimized

Write-Host "[INFO] Waiting for services ready (max 60 seconds)..."
$backendReady = Wait-PortReady -Port $backendPort -Retry 60
$frontendReady = Wait-PortReady -Port $frontendPort -Retry 60

if (-not $backendReady -or -not $frontendReady) {
    Write-Host "[WARN] Ports not fully ready within timeout, still trying to open page."
}

Start-Process $url
Write-Host "[INFO] Started. Press Enter to close this window (backend/frontend keep running)."
Read-Host
