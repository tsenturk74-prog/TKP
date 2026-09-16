@echo off
setlocal
cd /d "%~dp0.."
set "PY=%LOCALAPPDATA%\TKP\R17Python\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" R18_MODEL\tkp_r18_service.py --host 127.0.0.1 --port 3764 --model R18_MODEL\r18_model.joblib --report R18_MODEL\r18_training_report.json --simulations 10000
