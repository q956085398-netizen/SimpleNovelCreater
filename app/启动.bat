@echo off
chcp 65001 >nul
cd /d %~dp0
echo 正在启动 简单写小说 · 本地写作台 ...
node server.js
pause
