@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer is required. Install it from https://www.python.org/downloads/
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 (
    echo Could not create the Python environment.
    pause
    exit /b 1
  )
)
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
  echo Importer setup failed. Check your internet connection and try again.
  pause
  exit /b 1
)
echo.
echo REA Shorts Studio local importer is starting at http://127.0.0.1:8765
echo Keep this window open while importing videos. Press Ctrl+C to stop.
python -m uvicorn main:app --host 127.0.0.1 --port 8765
pause
