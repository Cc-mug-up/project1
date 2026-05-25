@echo off
title 寝室智控中心 - 一键启动
cd /d "%~dp0"

echo.
echo ═══════════════════════════════════════════
echo   寝室智控中心 v2.0 - MongoDB 版
echo ═══════════════════════════════════════════
echo.

:: ── 检查 Node.js ───────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装：
    echo https://nodejs.org （下载 LTS 版本即可）
    pause
    exit /b 1
)
echo [✓] Node.js 已就绪

:: ── 检查 MongoDB ───────────────────────────
mongosh --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 MongoDB，请先安装：
    echo https://www.mongodb.com/try/download/community
    echo 安装后 MongoDB 会自动以后台服务运行
    pause
    exit /b 1
)
echo [✓] MongoDB 已就绪

:: ── 安装依赖 ───────────────────────────────
if not exist "node_modules" (
    echo [*] 正在安装依赖...
    call npm install
) else (
    echo [✓] 依赖已安装
)

:: ── 防火墙放行（请求管理员） ──────────────
echo [*] 配置防火墙规则...
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] 需要管理员权限来配置防火墙，正在请求提权...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b 0
)

netsh advfirewall firewall show rule name="DormShare" >nul 2>&1
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="DormShare" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
    echo [✓] 防火墙已放行 3000 端口
) else (
    echo [✓] 防火墙规则已存在
)

:: ── 启动服务器 ─────────────────────────────
echo.
echo ═══════════════════════════════════════════
echo   启动服务器...
echo ═══════════════════════════════════════════
echo.
node server.js
pause
