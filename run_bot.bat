@echo off
echo ==========================================
echo    AI Content Platform - Auto Starter
echo ==========================================

:: Проверка наличия виртуального окружения
if not exist ".venv" (
    echo [!] Creating virtual environment...
    python -m venv .venv
)

:: Активация и установка зависимостей
echo [!] Activating environment and checking dependencies...
call .venv\Scripts\activate
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt >nul

:: Запуск сервера
echo [!] Starting Backend Server...
echo [!] API will be available at http://localhost:8000
python server.py

pause
