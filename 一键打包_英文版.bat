@echo off
setlocal enabledelayedexpansion
title Hospital Schedule - One-Click Build

echo ========================================
echo   Hospital Schedule - Windows Build
echo ========================================
echo.

REM Check if in correct directory
if not exist "package.json" (
    echo [Error] Please run this script in project root!
    echo.
    echo Current directory: %CD%
    echo.
    pause
    exit /b 1
)

echo [Step 1/7] Checking required tools...
echo.

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Node.js not installed!
    echo Please install Node.js: https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js is installed

REM Check Git
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Git not installed!
    echo Please install Git: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo [OK] Git is installed

REM Check pnpm
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] pnpm not installed, installing...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo [Error] Failed to install pnpm!
        pause
        exit /b 1
    )
    echo [OK] pnpm installed successfully
) else (
    echo [OK] pnpm is installed
)

echo.
echo [Step 2/7] Setting up mirrors...
echo.

REM Set npm mirror
call npm config set registry https://registry.npmmirror.com

REM Set pnpm mirror
call pnpm config set registry https://registry.npmmirror.com

echo [OK] Mirrors configured

echo.
echo [Step 3/7] Installing dependencies...
echo.

call pnpm install
if %errorlevel% neq 0 (
    echo [Error] Failed to install dependencies!
    pause
    exit /b 1
)

echo [OK] Dependencies installed

echo.
echo [Step 4/7] Modifying config file...
echo.

REM Create or modify .env.production
echo PROJECT_DOMAIN=http://localhost:3000 > .env.production

echo [OK] Config file modified

echo.
echo [Step 5/7] Building H5 version...
echo.

call pnpm build:web
if %errorlevel% neq 0 (
    echo [Error] Failed to build H5!
    pause
    exit /b 1
)

echo [OK] H5 build completed

echo.
echo [Step 6/7] Setting up Electron mirror...
echo.

set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

echo [OK] Electron mirror configured

echo.
echo [Step 7/7] Packaging Windows version...
echo.
echo Note: First build needs to download Electron runtime (about 100MB), this may take 5-10 minutes...
echo.

node node_modules\.pnpm\electron-builder@*\node_modules\electron-builder\out\cli\cli.js --win --config .electron-builder-win.json --dir
if %errorlevel% neq 0 (
    echo [Error] Failed to package Windows version!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Packaging Completed!
echo ========================================
echo.

REM Check packaging result
if exist "dist\electron\win-unpacked\医院排班系统.exe" (
    echo [OK] Application packaged successfully!
    echo.
    echo Application location:
    echo   %CD%\dist\electron\win-unpacked\
    echo.
    echo Main program:
    echo   医院排班系统.exe
    echo.
    echo How to run:
    echo   1. Open a new command window
    echo   2. Run: cd %CD% ^&^& pnpm dev:server
    echo   3. Double-click: dist\electron\win-unpacked\医院排班系统.exe
    echo.
) else (
    echo [Error] Packaging failed, application file not found!
    echo.
    echo Please check the error messages above.
)

echo.
echo Press any key to exit...
pause >nul
