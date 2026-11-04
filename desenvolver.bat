@echo off
rem Modo de desenvolvimento: API com recarga automatica e Vite com hot reload (duas janelas).
chcp 65001 >nul
title Investment Lab (desenvolvimento)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\desenvolver.ps1" %*
if errorlevel 1 pause
