@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "R17VENV=%LOCALAPPDATA%\TKP\R17Python"
if not defined LOCALAPPDATA set "R17VENV=%USERPROFILE%\AppData\Local\TKP\R17Python"
set "PY=%R17VENV%\Scripts\python.exe"
set "BACKUP=%~dp0..\YEDEKLER\TKP_CORE_YEDEK_2026-09-13_165941_R17_BACKFILLED.tkbz"
set "TOOL=%~dp0..\DOGRULAMA\tools\tkp_r17_autogluon.py"
if not exist "%PY%" (
  echo [TKP R17] Once KUR_AUTOGLOUON.bat calistiriliyor...
  call "%~dp0KUR_AUTOGLOUON.bat" || exit /b 1
)
if not exist "%BACKUP%" (
  echo [TKP R17 HATA] Egitim yedegi bulunamadi: %BACKUP%
  pause
  exit /b 1
)
echo [TKP R17] R17 BEST QUALITY + ROI temporal egitimi basliyor...
"%PY%" "%TOOL%" "%BACKUP%" --dataset "%~dp0r17_training.csv" --model-dir "%~dp0autogluon_model" --report "%~dp0r17_training_report.json" --time-limit 7200 --presets best_quality
if errorlevel 1 goto :fail
echo.
echo [TKP R17] Egitim tamamlandi. Promotion + ROI gate sonucu r17_training_report.json icindedir.
exit /b 0
:fail
echo [TKP R17 HATA] Egitim tamamlanamadi. R16.94 Champion aktif kalir.
pause
exit /b 1
