@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "R17VENV=%LOCALAPPDATA%\TKP\R17Python"
if not defined LOCALAPPDATA set "R17VENV=%USERPROFILE%\AppData\Local\TKP\R17Python"

echo [TKP R17] Python 3.10-3.13 kontrol ediliyor...
set "PYEXE="
for %%V in (3.13 3.12 3.11 3.10) do (
  py -%%V -c "import sys; assert (3,10) <= sys.version_info[:2] <= (3,13)" >nul 2>nul && if not defined PYEXE set "PYEXE=py -%%V"
)
if not defined PYEXE (
  python -c "import sys; assert (3,10) <= sys.version_info[:2] <= (3,13)" >nul 2>nul && set "PYEXE=python"
)
if not defined PYEXE (
  echo [TKP R17 HATA] AutoGluon 1.6.1 icin Python 3.10-3.13 bulunamadi.
  echo Python'u kurduktan sonra bu dosyayi tekrar calistirin.
  pause
  exit /b 1
)

if not exist "%R17VENV%\Scripts\python.exe" (
  echo [TKP R17] Ayrik Python ortami kuruluyor...
  %PYEXE% -m venv "%R17VENV%" || goto :fail
)
"%R17VENV%\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel || goto :fail
"%R17VENV%\Scripts\python.exe" -m pip install "autogluon.tabular[all]==1.6.1" pandas || goto :fail
"%R17VENV%\Scripts\python.exe" -c "from autogluon.tabular import TabularPredictor; import lightgbm, catboost, xgboost, pandas; print('[TKP R17] AutoGluon FULL hazir')" || goto :fail
exit /b 0
:fail
echo [TKP R17 HATA] Kurulum tamamlanamadi.
pause
exit /b 1
