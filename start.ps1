$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot"

if (-not (Test-Path "node_modules")) {
    Write-Host "First run: installing dependencies..."
    npm install
}

$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Write-Host "Port 3000 is in use. Stopping old server (PID: $($conn.OwningProcess))"
    Stop-Process -Id $conn.OwningProcess -Force
}

Write-Host "Starting game server..."
Start-Process "http://localhost:3000"
npm start
