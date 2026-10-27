@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "R17VENV=%LOCALAPPDATA%\TKP\R17Python"
if not defined LOCALAPPDATA set "R17VENV=%USERPROFILE%\AppData\Local\TKP\R17Python"
set "PY=%R17VENV%\Scripts\python.exe"
set "SERVICE=%~dp0..\DOGRULAMA\tools\tkp_r17_service.py"
if not exist "%PY%" (
  echo [TKP R17 HATA] AutoGluon ortami yok. KUR_AUTOGLOUON.bat calistirin.
  pause
  exit /b 1
)
if not exist "%~dp0autogluon_model\predictor.pkl" if not exist "%~dp0autogluon_model\learner.pkl" (
  echo [TKP R17 HATA] Egitilmis model yok. EGIT_R17.bat calistirin.
  pause
  exit /b 1
)
"%PY%" "%SERVICE%" --host 127.0.0.1 --port 3763 --model-dir "%~dp0autogluon_model" --report "%~dp0r17_training_report.json"
