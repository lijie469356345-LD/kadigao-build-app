@echo off
chcp 65001 >nul
echo ================================================
echo           卡迪高巡店管理系统 - 安装依赖
echo ================================================
echo.

cd /d "%~dp0"

echo 检查 Node.js 环境...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误：未检测到 Node.js 环境
    echo 请先安装 Node.js（推荐版本：18.x 或 20.x）
    echo 下载地址：https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js 版本：
node --version
echo.

echo 检查 npm 版本...
npm --version
echo.

echo 开始安装依赖...
echo 这可能需要几分钟时间，请耐心等待...
echo.

npm install

if %errorlevel% equ 0 (
    echo.
    echo 依赖安装成功！
    echo.
    echo 接下来请运行：启动项目.bat
) else (
    echo.
    echo 依赖安装失败，请检查网络连接或 Node.js 版本
    pause
    exit /b 1
)

pause