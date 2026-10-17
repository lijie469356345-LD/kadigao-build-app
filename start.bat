@echo off
cd /d "%~dp0"
chcp 65001 >nul
title Cardigao Inspection System

echo ================================================
echo   Cardigao Inspection System
echo   Quick Start Script (Build + Run)
echo ================================================
echo.

echo [1/5] Checking environment...

if not exist "%~dp0\node.exe" (
    echo   ERROR: node.exe not found
    pause
    exit /b 1
)
echo       Node.js OK

if not exist "%~dp0\node_modules\typescript\bin\tsc" (
    echo   ERROR: TypeScript not found, please run 安装依赖.bat first
    pause
    exit /b 1
)
echo       TypeScript OK

if not exist "%~dp0\node_modules\vite\bin\vite.js" (
    echo   ERROR: Vite not found, please run 安装依赖.bat first
    pause
    exit /b 1
)
echo       Vite OK

echo.
echo [2/5] Building project (tsc + vite)...
echo       [2.1] Compiling TypeScript...
"%~dp0\node.exe" "%~dp0\node_modules\typescript\bin\tsc"
if errorlevel 1 (
    echo       [ERROR] TSC build failed, see errors above
    pause
    exit /b 1
)
echo       TSC build complete

echo       [2.2] Building frontend (vite)...
"%~dp0\node.exe" "%~dp0\node_modules\vite\bin\vite.js" build
if errorlevel 1 (
    echo       [ERROR] Vite build failed, see errors above
    pause
    exit /b 1
)
echo       Vite build complete

echo.
echo [3/5] Freeing port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo       Port released

echo.
echo [4/5] Setting environment...
set NODE_ENV=production
set CARDIGAO_BASE_DIR=%~dp0
echo       Environment set

echo.
echo [5/5] Starting server...
echo ================================================
echo   Local: http://localhost:3000
echo ================================================
echo   INFO: Auto-restart on crash
echo   INFO: Press Ctrl+C to stop
echo ================================================
echo.

timeout /t 1 /nobreak >nul
start "" http://localhost:3000

set RESTART_COUNT=0

:run
echo.
echo [%date% %time%] Starting server (restart: %RESTART_COUNT%)...
"%~dp0\node.exe" "%~dp0\dist\server\server.js"
set EXIT_CODE=%ERRORLEVEL%
echo [%date% %time%] Server exited with code: %EXIT_CODE%
echo.

if %EXIT_CODE% equ 0 (
    echo INFO: Server exited normally
    pause >nul
    exit /b 0
)

set /a RESTART_COUNT+=1
if %RESTART_COUNT% geq 10 (
    echo ERROR: Max restart attempts reached
    pause >nul
    exit /b 1
)

echo WARN: Restarting in 3 seconds (%RESTART_COUNT%/10)...
timeout /t 3 /nobreak >nul
goto run
