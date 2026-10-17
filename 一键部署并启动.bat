@echo off
chcp 65001 >nul
title KadiGo Store Inspection - Deploy & Start

echo.
echo ================================================
echo   KadiGo Store Inspection System
echo   One-Click Deploy and Start (Auto-Restart Enabled)
echo ================================================
echo.

cd /d "%~dp0"

:: [1] Kill process on port 3000
echo [1/5] Freeing port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo       Port released

:: [2] Check bundled Node.js
echo.
echo [2/5] Checking Node.js...
if not exist "%~dp0\node.exe" (
    echo       [ERROR] node.exe not found in project root
    pause
    exit /b 1
)
echo       Bundled Node.js OK

:: [3] Check dependencies
echo.
echo [3/5] Checking dependencies...
if not exist "%~dp0\node_modules" (
    echo       [ERROR] node_modules not found, please run npm install first
    pause
    exit /b 1
)
if not exist "%~dp0\node_modules\typescript\bin\tsc" (
    echo       [ERROR] TypeScript not found in node_modules
    pause
    exit /b 1
)
if not exist "%~dp0\node_modules\vite\bin\vite.js" (
    echo       [ERROR] Vite not found in node_modules
    pause
    exit /b 1
)
echo       Dependencies OK

:: [4] Build
echo.
echo [4/5] Building project...
echo       [4.1] TSC - Compiling TypeScript backend...
"%~dp0\node.exe" "%~dp0\node_modules\typescript\bin\tsc"
if errorlevel 1 (
    echo       [ERROR] TSC build failed, see errors above
    pause
    exit /b 1
)
echo       TSC build complete

echo       [4.2] Vite - Building frontend...
"%~dp0\node.exe" "%~dp0\node_modules\vite\bin\vite.js" build
if errorlevel 1 (
    echo       [ERROR] Vite build failed, see errors above
    pause
    exit /b 1
)
echo       Vite build complete
echo       Build complete

:: [5] Start with auto-restart
echo.
echo [5/5] Starting server (auto-restart enabled)...
echo ================================================
echo   Deploy success! Starting server...
echo   Local:   http://localhost:3000
echo ================================================
echo.
echo   [INFO] Server will auto-restart if crashed
echo   [INFO] Press Ctrl+C to stop
echo ================================================
echo.

timeout /t 2 /nobreak >nul
start "" http://localhost:3000

set NODE_ENV=production
set CARDIGAO_BASE_DIR=%~dp0
set RESTART_COUNT=0

:run_server
echo.
echo [%date% %time%] Starting Node.js server (restart #%RESTART_COUNT%)...
echo ------------------------------------------------
"%~dp0\node.exe" "%~dp0\dist\server\server.js"
set EXIT_CODE=%ERRORLEVEL%
echo ------------------------------------------------
echo [%date% %time%] Server exited with code %EXIT_CODE%
echo.

if %EXIT_CODE% equ 0 (
    echo [INFO] Server exited normally. Press any key to exit...
    pause >nul
    exit /b 0
)

set /a RESTART_COUNT+=1
echo [WARN] Server crashed! Restarting in 3 seconds (attempt #%RESTART_COUNT%)...
timeout /t 3 /nobreak >nul
goto :run_server
