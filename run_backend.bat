@echo off
title AI Content Platform - BACKEND
echo ==========================================
echo    BACKEND (Python API) - http://localhost:8000
echo ==========================================

cd /d "%~dp0"

if not exist ".venv" (
    echo [1/3] Creating virtual environment...
    python -m venv .venv
)

echo [2/3] Installing dependencies...
call .venv\Scripts\activate.bat
python -m pip install -r requirements.txt --quiet

echo [3/3] Starting API server...
echo.
python server.py

pause
