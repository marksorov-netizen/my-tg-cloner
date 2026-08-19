@echo off
cd /d "%~dp0"

echo ========================================
echo   GhostPost - Docker Launcher
echo ========================================
echo.
echo [INFO] Starting GhostPost in Docker...
echo.

docker compose up --build -d

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Could not start Docker containers!
    echo [NOTE] Make sure Docker Desktop application is opened and running.
    echo [TIP] Alternatively, run "run_all.bat" to start without Docker!
    echo.
    pause
    exit /b 1
)

echo.
echo [OK] GhostPost is running!
echo      Landing and Admin UI: http://localhost:5173
echo      Backend API:          http://localhost:8000
echo.
echo [INFO] To view logs:  docker compose logs -f
echo [INFO] To stop:       docker compose down
echo.
pause
