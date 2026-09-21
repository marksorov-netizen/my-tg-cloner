@echo off
chcp 65001 >nul
title Быстрый тест примерки на модель
cd /d "%~dp0"
echo ========================================================
echo   БЫСТРЫЙ ТЕСТ ПРИМЕРКИ ОДЕЖДЫ НА МОДЕЛЬ (0 руб)
echo ========================================================
echo.
if "%~1"=="" (
    echo Запуск примерки на тестовом товаре...
    call .venv\Scripts\python.exe run_vton_cli.py
) else (
    echo Примерка файла: %~1
    call .venv\Scripts\python.exe run_vton_cli.py "%~1"
)
echo.
pause
