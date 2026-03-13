# Hospital Schedule - One-Click Start Script (PowerShell)
# 保存为：一键启动_推荐.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Hospital Schedule - Start            " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if application exists
if (-not (Test-Path "dist\electron\win-unpacked\医院排班系统.exe")) {
    Write-Host "[Error] Application not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run '一键打包_推荐.ps1' to package first."
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[Step 1/2] Starting backend service..." -ForegroundColor Yellow
Write-Host ""

# Start backend in new window
$backendScript = "cd $PWD; pnpm dev:server"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendScript -WindowStyle Normal -Verb RunAs

Write-Host "[OK] Backend service started (in new window)" -ForegroundColor Green
Write-Host ""
Write-Host "[Step 2/2] Waiting for backend to be ready..." -ForegroundColor Yellow
Write-Host ""

# Wait 5 seconds for backend to start
Start-Sleep -Seconds 5

Write-Host "[OK] Backend service should be ready" -ForegroundColor Green
Write-Host ""
Write-Host "[Step 3/3] Starting desktop application..." -ForegroundColor Yellow
Write-Host ""

# Start desktop application
Start-Process "dist\electron\win-unpacked\医院排班系统.exe"

Write-Host "[OK] Desktop application started" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Started Successfully!                " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Backend service is running in a separate window."
Write-Host "Desktop application has been opened."
Write-Host ""
Write-Host "Tips:" -ForegroundColor Cyan
Write-Host "  - Closing the backend window will stop the backend service"
Write-Host "  - Closing the desktop app window will stop the frontend"
Write-Host ""

Read-Host "Press Enter to exit"
