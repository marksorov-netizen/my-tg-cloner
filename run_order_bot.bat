@echo off
cd /d "%~dp0"

echo ========================================
echo   GhostPost - Order Bot Launcher
echo ========================================
echo.

if exist ".venv\Scripts\python.exe" (
    echo [INFO] Using .venv environment...
    ".venv\Scripts\python.exe" order_bot_handler.py
    goto END
)

if exist "venv\Scripts\python.exe" (
    echo [INFO] Using venv environment...
    "venv\Scripts\python.exe" order_bot_handler.py
    goto END
)

echo [INFO] Using system Python...
python order_bot_handler.py

:END
echo.
echo [INFO] Bot stopped.
pause
