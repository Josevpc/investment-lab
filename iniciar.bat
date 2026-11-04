@echo off
rem Inicia o Investment Lab: prepara o que faltar, sobe o servidor e abre o navegador.
rem Para opcoes (-Port, -NoBrowser, -Rebuild), use: iniciar.bat -Port 9000
chcp 65001 >nul
title Investment Lab
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1" %*
if errorlevel 1 (
  echo.
  echo O Investment Lab encerrou com erro. Veja a mensagem acima.
  pause
)
