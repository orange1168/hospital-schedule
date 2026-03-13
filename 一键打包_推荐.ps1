# Hospital Schedule - One-Click Build Script (PowerShell)
# 保存为：一键打包_推荐.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Hospital Schedule - Windows Build    " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if in correct directory
if (-not (Test-Path "package.json")) {
    Write-Host "[Error] Please run this script in project root!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Current directory: $PWD"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[Step 1/7] Checking required tools..." -ForegroundColor Yellow
Write-Host ""

# Check Node.js
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodePath) {
    Write-Host "[Error] Node.js not installed!" -ForegroundColor Red
    Write-Host "Please install Node.js: https://nodejs.org/"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Node.js is installed" -ForegroundColor Green

# Check Git
$gitPath = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitPath) {
    Write-Host "[Error] Git not installed!" -ForegroundColor Red
    Write-Host "Please install Git: https://git-scm.com/download/win"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Git is installed" -ForegroundColor Green

# Check pnpm
$pnpmPath = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmPath) {
    Write-Host "[!] pnpm not installed, installing..." -ForegroundColor Yellow
    npm install -g pnpm
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[Error] Failed to install pnpm!" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "[OK] pnpm installed successfully" -ForegroundColor Green
} else {
    Write-Host "[OK] pnpm is installed" -ForegroundColor Green
}

Write-Host ""
Write-Host "[Step 2/7] Setting up mirrors..." -ForegroundColor Yellow
Write-Host ""

# Set npm mirror
npm config set registry https://registry.npmmirror.com

# Set pnpm mirror
pnpm config set registry https://registry.npmmirror.com

Write-Host "[OK] Mirrors configured" -ForegroundColor Green

Write-Host ""
Write-Host "[Step 3/7] Installing dependencies..." -ForegroundColor Yellow
Write-Host ""

pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[Error] Failed to install dependencies!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[OK] Dependencies installed" -ForegroundColor Green

Write-Host ""
Write-Host "[Step 4/7] Modifying config file..." -ForegroundColor Yellow
Write-Host ""

# Create or modify .env.production
"PROJECT_DOMAIN=http://localhost:3000" | Out-File -FilePath ".env.production" -Encoding UTF8

Write-Host "[OK] Config file modified" -ForegroundColor Green

Write-Host ""
Write-Host "[Step 5/7] Building H5 version..." -ForegroundColor Yellow
Write-Host ""

pnpm build:web
if ($LASTEXITCODE -ne 0) {
    Write-Host "[Error] Failed to build H5!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[OK] H5 build completed" -ForegroundColor Green

Write-Host ""
Write-Host "[Step 6/7] Setting up Electron mirror..." -ForegroundColor Yellow
Write-Host ""

$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"

Write-Host "[OK] Electron mirror configured" -ForegroundColor Green

Write-Host ""
Write-Host "[Step 7/7] Packaging Windows version..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Note: First build needs to download Electron runtime (about 100MB), this may take 5-10 minutes..." -ForegroundColor Cyan
Write-Host ""

node node_modules\.pnpm\electron-builder@*\node_modules\electron-builder\out\cli\cli.js --win --config .electron-builder-win.json --dir
if ($LASTEXITCODE -ne 0) {
    Write-Host "[Error] Failed to package Windows version!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Packaging Completed!                " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Check packaging result
if (Test-Path "dist\electron\win-unpacked\医院排班系统.exe") {
    Write-Host "[OK] Application packaged successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Application location:" -ForegroundColor Cyan
    Write-Host "  $PWD\dist\electron\win-unpacked\"
    Write-Host ""
    Write-Host "Main program:" -ForegroundColor Cyan
    Write-Host "  医院排班系统.exe"
    Write-Host ""
    Write-Host "How to run:" -ForegroundColor Cyan
    Write-Host "  1. Open a new PowerShell window"
    Write-Host "  2. Run: cd $PWD"
    Write-Host "  3. Run: pnpm dev:server"
    Write-Host "  4. Double-click: dist\electron\win-unpacked\医院排班系统.exe"
    Write-Host ""
} else {
    Write-Host "[Error] Packaging failed, application file not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please check the error messages above."
}

Write-Host ""
Read-Host "Press Enter to exit"
