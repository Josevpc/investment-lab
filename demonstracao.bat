@echo off
rem Abre o Investment Lab em MODO DEMONSTRACAO: banco separado (data\demo) com dados ficticios.
rem Seus dados reais (data\investment.db) nao sao tocados. Opcoes: demonstracao.bat -Reset  (recria os dados de exemplo)
chcp 65001 >nul
title Investment Lab - Demonstracao
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demonstracao.ps1" %*
if errorlevel 1 (
  echo.
  echo A demonstracao encerrou com erro. Veja a mensagem acima.
  pause
)
