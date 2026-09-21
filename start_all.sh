#!/bin/sh

echo "========================================="
echo "   🚀 GhostPost All-In-One Launcher"
echo "========================================="

export PYTHONUNBUFFERED=1

# Start FastAPI backend in background (server.py automatically manages order_bot)
echo "[1/2] Starting FastAPI Backend (Port 8000)..."
python -u server.py &

# Wait 3 seconds for backend DB init
sleep 3

# Start Frontend in production mode (serves pre-built dist/ instantly with 0% CPU)
echo "[2/2] Starting Admin UI & Landing Page (Port 5173)..."
npm run preview -- --host 0.0.0.0 --port 5173

