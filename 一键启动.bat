@echo off
chcp 65001 >nul
title 医院排班系统 - 一键启动

echo ========================================
echo   医院排班系统 - 一键启动
echo ========================================
echo.

REM 检查应用是否存在
if not exist "dist\electron\win-unpacked\医院排班系统.exe" (
    echo [错误] 未找到应用！
    echo.
    echo 请先运行"一键打包.bat"进行打包。
    echo.
    pause
    exit /b 1
)

echo [步骤 1/2] 启动后端服务...
echo.

start "医院排班系统-后端" cmd /k "cd /d %CD% && pnpm dev:server"

echo [√] 后端服务已启动（在新窗口中）
echo.
echo [步骤 2/2] 等待后端就绪...
echo.

REM 等待 5 秒让后端启动
timeout /t 5 /nobreak >nul

echo [√] 后端服务应该已就绪
echo.
echo [步骤 3/3] 启动桌面应用...
echo.

start "" "dist\electron\win-unpacked\医院排班系统.exe"

echo [√] 桌面应用已启动
echo.
echo ========================================
echo   启动完成！
echo ========================================
echo.
echo 后端服务运行在独立的窗口中。
echo 桌面应用已打开。
echo.
echo 提示：
echo   - 关闭后端窗口会停止后端服务
echo   - 关闭桌面应用窗口会停止前端应用
echo.
echo 按任意键退出...
pause >nul
