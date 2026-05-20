# Launch Edge with remote debugging port
# Usage: .\launch-edge.ps1 [-Port 9222]
param(
    [int]$Port = 9222
)

$EdgePaths = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
)

$EdgeExe = $null
foreach ($p in $EdgePaths) {
    if (Test-Path $p) { $EdgeExe = $p; break }
}

if (-not $EdgeExe) {
    Write-Error "Edge not found"
    exit 1
}

$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[OK] Debug port $Port already active" -ForegroundColor Green
    try {
        $resp = Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
        Write-Host "[OK] Browser: $($resp.Browser)" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Port in use but cannot confirm Edge" -ForegroundColor Yellow
    }
    exit 0
}

$UserDataDir = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"

Write-Host "Launching Edge (debug port: $Port)..." -ForegroundColor Cyan
Write-Host "  Path: $EdgeExe" -ForegroundColor DarkGray
Write-Host "  UserData: $UserDataDir" -ForegroundColor DarkGray

$edgeProcs = Get-Process msedge -ErrorAction SilentlyContinue
if ($edgeProcs) {
    Write-Host "Closing existing Edge processes..." -ForegroundColor Yellow
    $edgeProcs | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Start-Process $EdgeExe -ArgumentList @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=`"$UserDataDir`"",
    "--restore-last-session"
)

Write-Host "Waiting for debug port..." -ForegroundColor DarkGray
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Milliseconds 500
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($conn) {
        Start-Sleep -Seconds 1
        try {
            $resp = Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 3
            Write-Host ""
            Write-Host "[OK] Edge debug mode ready!" -ForegroundColor Green
            Write-Host "  Browser: $($resp.Browser)" -ForegroundColor Green
            Write-Host "  Port: $Port" -ForegroundColor Green
            Write-Host "  WebSocket: $($resp.webSocketDebuggerUrl)" -ForegroundColor Green
            Write-Host ""
            Write-Host "Start Browser Engine:" -ForegroundColor Cyan
            Write-Host "  node server.mjs --browser-port $Port" -ForegroundColor White
            exit 0
        } catch {}
    }
}

Write-Host "[WARN] Timeout waiting for Edge debug port" -ForegroundColor Yellow
exit 1
