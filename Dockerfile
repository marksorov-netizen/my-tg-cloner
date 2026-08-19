# Multi-stage Dockerfile for GhostPost (All-in-One: Backend + Frontend + OrderBot)
FROM node:20-slim AS node-stage
FROM python:3.12-slim

WORKDIR /app

# Install Node.js & system build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node packages
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Make start script executable
RUN chmod +x /app/start_all.sh

# Expose ports: 5173 (Frontend/Landing), 8000 (Backend API)
EXPOSE 5173 8000

CMD ["/app/start_all.sh"]
