#!/bin/sh

echo "========================================="
echo "   🚀 GhostPost All-In-One Launcher"
echo "========================================="

# Start FastAPI backend in background
echo "[1/3] Starting FastAPI Backend (Port 8000)..."
python server.py &

# Wait 3 seconds for backend DB init
sleep 3

# Start Telegram Order Bot in background
echo "[2/3] Starting Telegram Order Bot..."
python order_bot_handler.py &

# Start Frontend (Vite) in foreground
echo "[3/3] Starting Admin UI & Landing Page (Port 5173)..."
npm run dev -- --host 0.0.0.0 --port 5173
