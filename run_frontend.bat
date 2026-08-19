@echo off
chcp 65001 >nul
title Editorial AI - Frontend
cd /d "%~dp0"

echo ============================================
echo   Editorial AI - Запуск фронтенда (сайта)
echo ============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не найден. Установите Node.js с https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [1/2] Устанавливаю зависимости, это может занять пару минут...
    call npm install
    if %errorlevel% neq 0 (
        echo [ОШИБКА] Не удалось установить зависимости.
        pause
        exit /b 1
    )
) else (
    echo [1/2] Зависимости уже установлены, пропускаю установку.
)

echo [2/2] Запускаю сайт...
echo.
echo Сайт откроется в браузере по адресу, который покажет Vite ниже.
echo Не закрывайте это окно, пока пользуетесь сайтом.
echo.
call npm run dev

pause
