# 🤖 MyBot AI — AI Клонер постов и Магазин Telegram

Автоматизированная система клонирования, AI-рерайта и публикации постов из каналов-доноров в целевые Telegram-каналы с умным ценообразованием (Опт / Дроп / Розница) и встроенным ботом для приёма заказов.

---

## 🌟 Основные возможности

- 🚀 **Парсер & Клонер каналов**: Сбор постов с каналов-доноров с сохранением медиа-альбомов (все фото и видео).
- 🧠 **AI-Рерайт**: Умная обработка текстов с сохранением стилистики, удалением чужих ссылок и водяных знаков через Gemini / Zapro AI.
- 💰 **3-Уровневое Ценообразование**: Авто-расчёт наценок (Опт / Дроп / Розница) от максимальной цены донора.
- 📦 **Склад & Артикулы**: Автоматическая генерация артикулов (`ART-0001`), отслеживание остатков и размеров (обувь, одежда).
- 🛍️ **Telegram Order Bot**: Приём заказов в Telegram с мгновенным показом альбома товара, выбором размеров/цвета и отправкой уведомлений менеджеру.
- ⏹️ **Мгновенная остановка задач**: Полный контроль над процессом переноса в один клик.

---

## 🚀 Быстрый запуск на сервере (VPS / Ubuntu / Debian)

### Вариант 1: Запуск через Docker (Рекомендуется)

1. **Клонируйте репозиторий**:
   ```bash
   git clone <URL_РЕПОЗИТОРИЯ>
   cd MyBotAi11-main
   ```

2. **Создайте `.env` из примера**:
   ```bash
   cp .env.example .env
   nano .env  # Укажите свои API_ID, API_HASH, GEMINI_API_KEY / ZAPRO_API_KEY
   ```

3. **Запустите через Docker Compose**:
   ```bash
   docker compose up -d --build
   ```

4. Откройте панель управления в браузере: `http://IP_СЕРВЕРА:5173`

---

### Вариант 2: Прямой запуск на сервере (Linux / VPS)

1. **Установите Python 3.10+ и Node.js 20+**:
   ```bash
   sudo apt update
   sudo apt install -y python3 python3-pip python3-venv nodejs npm git
   ```

2. **Клонируйте репозиторий и настройте окружение**:
   ```bash
   git clone <URL_РЕПОЗИТОРИЯ>
   cd MyBotAi11-main
   cp .env.example .env
   ```

3. **Установите зависимости**:
   ```bash
   # Python
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt

   # Node.js
   npm install
   npm run build
   ```

4. **Запуск всех сервисов**:
   ```bash
   chmod +x start_all.sh
   ./start_all.sh
   ```

---

## 💻 Локальный запуск на Windows

1. Запустите виртуальное окружение и бэкенд:
   ```cmd
   .venv\Scripts\activate
   pip install -r requirements.txt
   python server.py
   ```
2. В отдельном окне запустите фронтенд:
   ```cmd
   npm install
   npm run dev
   ```
3. Или используйте готовый скрипт: `run_all.bat`

---

## 🔐 Безопасность

* Файлы сессий Telegram (`*.session`, `user_session.json`), база данных SQLite (`*.db`), медиафайлы (`temp_media/`) и файл `.env` находятся в `.gitignore` и **никогда не попадают в Git**.
* При развёртывании на новом сервере авторизация в Telegram происходит безопасно через веб-интерфейс (ввод номера и кода).

---

## 🛠️ Стек технологий

* **Frontend**: React 18, TypeScript, TailwindCSS, Lucide Icons, Vite
* **Backend**: FastAPI, Telethon, pyTelegramBotAPI, SQLAlchemy (Async), Uvicorn
* **AI Engine**: Google Gemini API, Zapro AI (Gemini 3.5 Flash)

