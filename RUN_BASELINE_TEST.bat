@echo off
cd /d "%~dp0"
py -3 BASELINE_TEST_R19_12.py 2>nul
if errorlevel 1 python BASELINE_TEST_R19_12.py
pause
