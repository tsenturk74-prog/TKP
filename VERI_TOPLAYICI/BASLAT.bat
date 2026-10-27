@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0TKP_BOOTSTRAP.ps1"
if errorlevel 1 (
  echo.
  echo TKP baslatilamadi. Yukaridaki hata metnini kontrol edin.
  pause
  exit /b 1
)
exit /b 0
