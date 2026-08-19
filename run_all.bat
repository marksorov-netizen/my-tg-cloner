@echo off
cd /d "%~dp0"

echo ========================================
echo   GhostPost - 1-Click Local Launcher
echo ========================================
echo.
echo [INFO] Starting Backend, Frontend and Order Bot...
echo.

start "GhostPost - Backend API (Port 8000)" cmd /k "title GhostPost Backend & call run_backend.bat"
start "GhostPost - Admin UI & Landing (Port 5173)" cmd /k "title GhostPost Frontend & call run_frontend.bat"
start "GhostPost - Order Bot" cmd /k "title GhostPost Order Bot & call run_order_bot.bat"

echo.
echo [OK] All 3 components launched in separate windows!
echo      Landing and Admin UI: http://localhost:5173
echo      Backend API:          http://localhost:8000
echo.
pause
