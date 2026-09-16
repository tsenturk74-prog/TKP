@echo off
setlocal
cd /d "%~dp0.."
set "PY=%LOCALAPPDATA%\TKP\R17Python\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
set "BACKUP=YEDEKLER\TKP_CORE_YEDEK_2026-09-13_165941_R17_BACKFILLED.tkbz"
"%PY%" R18_MODEL\tkp_r18_backtest.py "%BACKUP%" --champion-json R18_MODEL\champion_reference_520.json --budget 1500 --simulations 10000 --model-out R18_MODEL\r18_model.joblib --report R18_MODEL\r18_training_report.json --ablation
if errorlevel 1 (
  echo R18.2 egitim/backtest basarisiz.
  pause
  exit /b 1
)
echo R18.2 tamamlandi. Promotion raporu: R18_MODEL\r18_training_report.json
pause
