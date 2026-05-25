@echo off
title 寝室共享板服务器
cd /d "%~dp0"
echo.
echo ═══════════════════════════════════
echo   寝室共享板 - 服务器启动中...
echo ═══════════════════════════════════
echo.
node server.js
pause
