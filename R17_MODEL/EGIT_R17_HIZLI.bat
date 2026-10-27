@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "R17VENV=%LOCALAPPDATA%\TKP\R17Python"
if not defined LOCALAPPDATA set "R17VENV=%USERPROFILE%\AppData\Local\TKP\R17Python"
set "PY=%R17VENV%\Scripts\python.exe"
set "BACKUP=%~dp0..\YEDEKLER\TKP_CORE_YEDEK_2026-09-13_165941_R17_BACKFILLED.tkbz"
set "TOOL=%~dp0..\DOGRULAMA\tools\tkp_r17_autogluon.py"
if not exist "%PY%" call "%~dp0KUR_AUTOGLOUON.bat" || exit /b 1
"%PY%" "%TOOL%" "%BACKUP%" --dataset "%~dp0r17_training.csv" --model-dir "%~dp0autogluon_model_fast" --report "%~dp0r17_training_report_fast.json" --time-limit 1800 --presets medium_quality
if errorlevel 1 goto :fail
echo [TKP R17] Hizli egitim tamamlandi.
exit /b 0
:fail
echo [TKP R17 HATA] Hizli egitim tamamlanamadi.
pause
exit /b 1
