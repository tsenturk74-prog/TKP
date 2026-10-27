@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0TKP_BOOTSTRAP.ps1" -Repair
if errorlevel 1 (
  echo.
  echo TKP onarimi tamamlanamadi. Yukaridaki hata metnini kontrol edin.
  pause
  exit /b 1
)
echo.
echo TKP onarimi ve calisma testi tamamlandi.
pause
exit /b 0
