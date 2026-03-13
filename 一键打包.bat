@echo off
chcp 65001 >nul
title 医院排班系统 - 一键打包脚本

echo ========================================
echo   医院排班系统 - Windows 版一键打包
echo ========================================
echo.

REM 检查是否在正确的目录
if not exist "package.json" (
    echo [错误] 请在项目根目录下运行此脚本！
    echo.
    echo 当前目录: %CD%
    echo.
    pause
    exit /b 1
)

echo [步骤 1/7] 检查必要工具...
echo.

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未安装 Node.js！
    echo 请先安装 Node.js: https://nodejs.org/
    pause
    exit /b 1
)
echo [√] Node.js 已安装

REM 检查 Git
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未安装 Git！
    echo 请先安装 Git: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo [√] Git 已安装

REM 检查 pnpm
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] pnpm 未安装，正在安装...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo [错误] pnpm 安装失败！
        pause
        exit /b 1
    )
    echo [√] pnpm 安装成功
) else (
    echo [√] pnpm 已安装
)

echo.
echo [步骤 2/7] 设置镜像源...
echo.

REM 设置 npm 镜像
call npm config set registry https://registry.npmmirror.com

REM 设置 pnpm 镜像
call pnpm config set registry https://registry.npmmirror.com

echo [√] 镜像源设置完成

echo.
echo [步骤 3/7] 安装依赖...
echo.

call pnpm install
if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败！
    pause
    exit /b 1
)

echo [√] 依赖安装完成

echo.
echo [步骤 4/7] 修改配置文件...
echo.

REM 创建或修改 .env.production
echo PROJECT_DOMAIN=http://localhost:3000 > .env.production

echo [√] 配置文件修改完成

echo.
echo [步骤 5/7] 编译 H5 版本...
echo.

call pnpm build:web
if %errorlevel% neq 0 (
    echo [错误] H5 编译失败！
    pause
    exit /b 1
)

echo [√] H5 编译完成

echo.
echo [步骤 6/7] 设置 Electron 镜像...
echo.

set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

echo [√] Electron 镜像设置完成

echo.
echo [步骤 7/7] 打包 Windows 版本...
echo.
echo 提示：首次打包需要下载 Electron 运行时（约 100MB），可能需要 5-10 分钟...
echo.

node node_modules\.pnpm\electron-builder@*\node_modules\electron-builder\out\cli\cli.js --win --config .electron-builder-win.json --dir
if %errorlevel% neq 0 (
    echo [错误] Windows 版打包失败！
    pause
    exit /b 1
)

echo.
echo ========================================
echo   打包完成！
echo ========================================
echo.

REM 检查打包结果
if exist "dist\electron\win-unpacked\医院排班系统.exe" (
    echo [√] 应用打包成功！
    echo.
    echo 应用位置：
    echo   %CD%\dist\electron\win-unpacked\
    echo.
    echo 主程序：
    echo   医院排班系统.exe
    echo.
    echo 如何运行：
    echo   1. 打开一个新的命令行窗口
    echo   2. 运行: cd %CD% ^&^& pnpm dev:server
    echo   3. 在文件管理器中双击运行: dist\electron\win-unpacked\医院排班系统.exe
    echo.
) else (
    echo [错误] 打包失败，未找到应用文件！
    echo.
    echo 请检查上面的错误信息。
)

echo.
echo 按任意键退出...
pause >nul
