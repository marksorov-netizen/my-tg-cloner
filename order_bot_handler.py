"""
order_bot_handler.py — Telegram-бот для приёма заказов товаров с артикулами.

Логика:
  1. Пользователь жмёт кнопку "🛒 Заказать: @бот?start=ART-0001" в канале
  2. Бот получает /start ART-0001, ищет товар в БД
  3. Показывает карточку товара (фото, название, цены, размеры в наличии)
  4. Пользователь выбирает размер → вводит имя → вводит телефон
  5. Заказ сохраняется в БД + менеджер получает уведомление

Запуск:
  python order_bot_handler.py
"""

import asyncio
import logging
import sys
import os
import tempfile
import socket
import requests as http_requests
from typing import Optional, List

import telebot
from telebot import types
from dotenv import load_dotenv

_lock_socket = None

def ensure_single_instance(port: int = 49152):
    """
    Гарантирует, что запущен только 1 экземпляр order_bot_handler.
    Предотвращает ошибку Telegram 409 Conflict при повторном запуске.
    """
    global _lock_socket
    try:
        _lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _lock_socket.bind(('127.0.0.1', port))
        _lock_socket.listen(1)
        return True
    except socket.error:
        logger.warning(f"[OrderBot] Другой экземпляр order_bot_handler уже работает (порт {port}). Завершаем дублирующий процесс.")
        sys.exit(0)

# ── БД через SQLAlchemy ───────────────────────────────────────
from sqlalchemy import select, create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database.models import Base, ArticleItem, Order, OrderBotConfig

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("order_bot")

# ── БД: PostgreSQL (prod) или SQLite (dev) — по DATABASE_URL из .env ──────
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()

if DATABASE_URL and not DATABASE_URL.startswith("sqlite"):
    # Сервер использует asyncpg; sync-боту нужен psycopg2
    _sync_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
    engine = create_engine(_sync_url, pool_pre_ping=True, pool_size=5, max_overflow=10)
    logger.info(f"Order Bot: PostgreSQL ({_sync_url.split('@')[-1]})")
else:
    DB_PATH = os.path.join(os.path.dirname(__file__), "editorial.db")
    engine = create_engine(
        f"sqlite:///{DB_PATH}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    logger.info("Order Bot: SQLite (dev mode)")

    # WAL + busy_timeout: бот и сервер пишут в одну базу, без этого ловим "database is locked"
    from sqlalchemy import event as sa_event

    @sa_event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


def get_session() -> Session:
    return Session(engine)


def get_bot_config() -> Optional[OrderBotConfig]:
    with get_session() as s:
        return s.execute(select(OrderBotConfig).limit(1)).scalar_one_or_none()


def normalize_article_code(raw: str) -> str:
    """Нормализует артикул: переводит в верхний регистр и заменяет похожие русские буквы."""
    if not raw:
        return ""
    s = raw.strip().upper()
    trans = str.maketrans("АВЕКМНОРСТУХ", "ABEKMHOPCTYX")
    return s.translate(trans)


def get_article(code: str) -> Optional[ArticleItem]:
    norm = normalize_article_code(code)
    with get_session() as s:
        return s.execute(
            select(ArticleItem).where(ArticleItem.article_code == norm)
        ).scalar_one_or_none()


# ── Конфиг ───────────────────────────────────────────────────
cfg = get_bot_config()
if not cfg or not cfg.bot_token:
    logger.error("❌ Токен бота не найден в базе данных!")
    logger.error("   Перейди в дашборд → 📦 Склад & Заказы → 🤖 Бот Заказов и введи токен.")
    sys.exit(1)

BOT_TOKEN = cfg.bot_token
MANAGER_CHAT_ID = cfg.manager_chat_id
ARTICLE_PREFIX = cfg.article_prefix or "ART"

logger.info(f"✅ Запуск Order Bot | токен: ...{BOT_TOKEN[-10:]} | менеджер: {MANAGER_CHAT_ID}")

bot = telebot.TeleBot(BOT_TOKEN, parse_mode="HTML", num_threads=10)

# ── Временное хранилище диалогов (в памяти) ──────────────────
# user_id -> { "step": "...", "article_code": "ART-0001", "size": "M", "name": "..." }
user_state: dict = {}

# ── Шаги диалога ─────────────────────────────────────────────
STEP_WANT_ORDER            = "want_order"
STEP_SELECT_SIZE           = "select_size"
STEP_ENTER_FOOT_SIZE       = "enter_foot_size"
STEP_ENTER_HEIGHT_WEIGHT   = "enter_height_weight"
STEP_ENTER_COLOR           = "enter_color"
STEP_ENTER_NAME            = "enter_name"
STEP_ENTER_PHONE           = "enter_phone"
STEP_DONE                  = "done"


def format_article_card(article: ArticleItem) -> str:
    """Формирует карточку товара с приветствием."""
    lines = []
    lines.append("👋 <b>Здравствуйте! Хотите оформить заказ на данный товар?</b>\n")
    lines.append(f"📦 <b>{article.title}</b>")
    lines.append(f"🏷️ Артикул: <code>{article.article_code}</code>")
    if article.price:
        lines.append(f"💰 Цена: <b>{article.price} {article.currency}</b>")
    if article.wholesale_price:
        lines.append(f"📦 Опт: {article.wholesale_price} {article.currency}")
    if article.drop_price:
        lines.append(f"🤝 Дроп: {article.drop_price} {article.currency}")
    if article.description:
        desc = article.description[:260].strip()
        if len(article.description) > 260:
            desc += "..."
        lines.append(f"\n📝 {desc}")
    return "\n".join(lines)


def get_start_order_keyboard(article: ArticleItem) -> types.InlineKeyboardMarkup:
    """Кнопка согласия на оформление заказа под карточкой товара."""
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("🛍️ Оформить заказ", callback_data=f"order_start:{article.article_code}"),
        types.InlineKeyboardButton("❌ Отмена", callback_data="cancel")
    )
    return kb


def get_size_keyboard(article: ArticleItem) -> types.InlineKeyboardMarkup:
    """
    Формирует кнопки имеющихся размеров, спарсенных напрямую из поста донора.
    """
    kb = types.InlineKeyboardMarkup(row_width=3)
    stock = article.stock or {}
    p_type = getattr(article, "product_type", "shoes") or "shoes"

    available_sizes = list(stock.keys()) if stock else (
        ["38", "39", "40", "41", "42", "43", "44", "45"] if p_type == "shoes" else ["S", "M", "L", "XL", "XXL"]
    )

    buttons = []
    for size in available_sizes:
        label = size if size != "one_size" else "✅ Один размер"
        buttons.append(
            types.InlineKeyboardButton(
                f"{label}",
                callback_data=f"size:{article.article_code}:{size}"
            )
        )
    kb.add(*buttons)

    # Доп кнопка индивидуального подбора
    if p_type == "clothing":
        kb.add(types.InlineKeyboardButton("⚖️ Подобрать по росту и весу", callback_data=f"custom:{article.article_code}:clothing"))
    else:
        kb.add(types.InlineKeyboardButton("📏 Подобрать по длине стопы", callback_data=f"custom:{article.article_code}:shoes"))

    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="cancel"))
    return kb


def get_color_keyboard(article_code: str) -> types.InlineKeyboardMarkup:
    """Кнопки быстрого выбора цвета."""
    kb = types.InlineKeyboardMarkup(row_width=2)
    kb.add(
        types.InlineKeyboardButton("✅ Как на фото", callback_data=f"color:{article_code}:Как на фото"),
        types.InlineKeyboardButton("⏩ Пропустить (Случайный)", callback_data=f"color:{article_code}:skip")
    )
    kb.add(types.InlineKeyboardButton("❌ Отмена", callback_data="cancel"))
    return kb


# ── /start ────────────────────────────────────────────────────
@bot.message_handler(commands=["start"])
def handle_start(message: types.Message):
    chat_id = message.chat.id
    args = message.text.split()

    if len(args) < 2:
        bot.send_message(
            chat_id,
            f"👋 <b>Добро пожаловать!</b>\n\n"
            f"Это бот для оформления заказов.\n"
            f"Перейдите в наш канал и нажмите ссылку <b>«🛒 Чтобы заказать — нажмите сюда»</b> под нужным товаром.\n\n"
            f"Или введите артикул товара: <code>{ARTICLE_PREFIX}-0001</code>"
        )
        return

    article_code = normalize_article_code(args[1])
    _show_article(chat_id, article_code, message.from_user)


def _show_article(chat_id: int, raw_article_code: str, user):
    """
    Пересылает ВСЕ фотографии и текст оригинального поста товара из нашего канала покупателю
    и предлагает оформить заказ.
    """
    article_code = normalize_article_code(raw_article_code)
    article = get_article(article_code)
    if not article:
        bot.send_message(
            chat_id,
            f"❌ Товар с артикулом <code>{article_code}</code> не найден."
        )
        return

    if not article.is_active:
        bot.send_message(
            chat_id,
            f"⚠️ Товар <code>{article_code}</code> временно недоступен.\n"
            f"Напишите менеджеру для уточнения."
        )
        return

    keyboard = get_start_order_keyboard(article)

    user_state[chat_id] = {
        "step": STEP_WANT_ORDER,
        "article_code": article_code,
        "product_type": getattr(article, "product_type", "shoes") or "shoes",
        "price": article.price
    }

    target_channel = getattr(article, 'target_channel', None)
    target_msg_id = getattr(article, 'target_msg_id', None)
    source_channel = getattr(article, 'source_channel', None)
    source_msg_id = getattr(article, 'source_msg_id', None)

    channel_to_use = target_channel or source_channel
    msg_id_to_use = target_msg_id or source_msg_id

    post_sent = False

    # 1. ПЕРВЫЙ И ГЛАВНЫЙ ПРИОРИТЕТ: Копируем/пересылаем ВСЕ картинки поста (весь альбом)
    if channel_to_use and msg_id_to_use:
        target_ch_formatted = channel_to_use if str(channel_to_use).startswith('@') or str(channel_to_use).startswith('-') else f"@{channel_to_use}"
        
        # Получаем ID всех фото в посте (альбоме) за 0.05 сек
        msg_ids = [msg_id_to_use]
        try:
            r = http_requests.get(
                "http://127.0.0.1:8000/api/get_album_msg_ids",
                params={"channel": channel_to_use, "msg_id": msg_id_to_use, "article_code": article_code},
                timeout=3.5
            )
            if r.status_code == 200:
                fetched_ids = r.json().get("msg_ids", [])
                if fetched_ids:
                    msg_ids = fetched_ids
        except Exception as err:
            logger.warning(f"[album_ids] error: {err}")

        # Отправляем ВСЕ картинки поста
        try:
            if len(msg_ids) > 1:
                bot.copy_messages(
                    chat_id,
                    from_chat_id=target_ch_formatted,
                    message_ids=msg_ids
                )
            else:
                bot.copy_message(
                    chat_id,
                    from_chat_id=target_ch_formatted,
                    message_id=msg_ids[0]
                )
            post_sent = True
        except Exception as copy_err:
            logger.warning(f"[post] copy_messages failed: {copy_err}, trying forward_messages...")
            try:
                if len(msg_ids) > 1:
                    bot.forward_messages(
                        chat_id,
                        from_chat_id=target_ch_formatted,
                        message_ids=msg_ids
                    )
                else:
                    bot.forward_message(
                        chat_id,
                        from_chat_id=target_ch_formatted,
                        message_id=msg_ids[0]
                    )
                post_sent = True
            except Exception as fwd_err:
                logger.warning(f"[post] forward_messages failed: {fwd_err}")

        if post_sent:
            bot.send_message(
                chat_id,
                f"👋 <b>Здравствуйте! Хотите оформить заказ на данный товар?</b>\n\n"
                f"🏷️ Артикул: <code>{article.article_code}</code>\n"
                f"💰 Цена: <b>{article.price or 'Уточняйте у менеджера'}</b>",
                parse_mode="HTML",
                reply_markup=keyboard
            )
            return

    # 2. Если target_msg_id не был привязан — резервный показ фото
    card_text = format_article_card(article)
    if not post_sent:
        try:
            resp = http_requests.get(
                "http://127.0.0.1:8000/api/fetch_article_media",
                params={
                    "channel": target_channel or source_channel or "",
                    "msg_id": target_msg_id or source_msg_id or 0,
                    "article_code": article_code
                },
                timeout=4.0
            )
            if resp.status_code == 200:
                data = resp.json()
                file_paths: List[str] = [fp for fp in data.get("files", []) if os.path.exists(fp)]
                if file_paths:
                    with open(file_paths[0], 'rb') as pf:
                        bot.send_photo(
                            chat_id,
                            pf,
                            caption=card_text,
                            parse_mode="HTML",
                            reply_markup=keyboard
                        )
                    post_sent = True

                    for fp in file_paths:
                        try:
                            if os.path.exists(fp): os.remove(fp)
                        except Exception: pass
        except Exception as e:
            logger.warning(f"[photos] fast fetch_article_media error for {article_code}: {e}")

    # 3. Резерв media_urls
    if not post_sent:
        media_urls = [u for u in (getattr(article, 'media_urls', None) or []) if u and not str(u).isdigit()]
        if media_urls:
            try:
                bot.send_photo(chat_id, media_urls[0], caption=card_text, parse_mode="HTML", reply_markup=keyboard)
                post_sent = True
            except Exception as e:
                logger.warning(f"[photos] media_urls failed: {e}")

    # 4. Резервный вывод текстовой карточки
    if not post_sent:
        bot.send_message(
            chat_id,
            card_text,
            parse_mode="HTML",
            reply_markup=keyboard
        )


# ── Callback: старт оформления заказа ─────────────────────────
@bot.callback_query_handler(func=lambda call: call.data.startswith("order_start:"))
def handle_order_start(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    article_code = call.data.split(":")[1]
    article = get_article(article_code)
    if not article:
        bot.answer_callback_query(call.id, "Товар не найден")
        return

    user_state[chat_id] = {
        "step": STEP_SELECT_SIZE,
        "article_code": article_code,
        "product_type": getattr(article, "product_type", "shoes") or "shoes",
        "price": article.price
    }

    bot.edit_message_reply_markup(chat_id, call.message.message_id, reply_markup=None)
    bot.answer_callback_query(call.id, "Начинаем оформление!")

    size_kb = get_size_keyboard(article)
    bot.send_message(
        chat_id,
        "📏 <b>Шаг 1 из 4: Выберите имеющийся в наличии размер:</b>",
        parse_mode="HTML",
        reply_markup=size_kb
    )


# ── Callback: выбор размера ───────────────────────────────────
@bot.callback_query_handler(func=lambda call: call.data.startswith("size:") or call.data.startswith("custom:"))
def handle_size_select(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    parts = call.data.split(":")
    mode = parts[0]
    article_code = parts[1]
    value = parts[2]

    article = get_article(article_code)
    p_type = getattr(article, "product_type", "shoes") if article else "shoes"

    state = user_state.get(chat_id, {})
    state["article_code"] = article_code
    state["product_type"] = p_type
    state["price"] = article.price if article else state.get("price")

    bot.edit_message_reply_markup(chat_id, call.message.message_id, reply_markup=None)

    if mode == "custom":
        # Нужен ввод стопы или роста/веса
        if value == "clothing":
            state["step"] = STEP_ENTER_HEIGHT_WEIGHT
            state["size"] = "Свой рост/вес"
            user_state[chat_id] = state
            bot.answer_callback_query(call.id, "Подбор по росту и весу")
            kb = types.InlineKeyboardMarkup()
            kb.add(types.InlineKeyboardButton("⏩ Пропустить", callback_data="skip_custom"))
            bot.send_message(
                chat_id,
                "⚖️ <b>Укажите ваш рост и вес</b> (например: <code>180 см / 75 кг</code>):\n"
                "<i>Это поможет менеджеру подобрать идеальный размер при отправке.</i>",
                parse_mode="HTML",
                reply_markup=kb
            )
        else:
            state["step"] = STEP_ENTER_FOOT_SIZE
            state["size"] = "Своя стопа"
            user_state[chat_id] = state
            bot.answer_callback_query(call.id, "Подбор по длине стопы")
            kb = types.InlineKeyboardMarkup()
            kb.add(types.InlineKeyboardButton("⏩ Пропустить", callback_data="skip_custom"))
            bot.send_message(
                chat_id,
                "📏 <b>Укажите длину вашей стопы в см</b> (например: <code>27 см</code> или <code>27.5 см</code>):\n"
                "<i>Это поможет менеджеру подобрать идеальный размер обуви.</i>",
                parse_mode="HTML",
                reply_markup=kb
            )
        return

    # Обычный выбор размера -> переходим к выбору цвета
    state["size"] = value
    state["step"] = STEP_ENTER_COLOR
    user_state[chat_id] = state

    bot.answer_callback_query(call.id, f"✅ Размер: {value}")
    color_kb = get_color_keyboard(article_code)
    bot.send_message(
        chat_id,
        f"✅ Выбран размер: <b>{value}</b>\n\n"
        f"🎨 <b>Шаг 2 из 4: Выберите или напишите цвет товара:</b>\n"
        f"<i>(Например: «Как на фото», «Черный», «Белый с серым»)</i>",
        parse_mode="HTML",
        reply_markup=color_kb
    )


# ── Callback: выбор цвета ─────────────────────────────────────
@bot.callback_query_handler(func=lambda call: call.data.startswith("color:"))
def handle_color_select(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    color_val = call.data.split(":")[2]
    state = user_state.get(chat_id, {})
    state["color"] = color_val
    state["step"] = STEP_ENTER_NAME
    bot.edit_message_reply_markup(chat_id, call.message.message_id, reply_markup=None)

    if color_val == "skip" or color_val.lower() in ("skip", "пропустить"):
        state["color"] = "Случайный цвет"
        state["step"] = STEP_ENTER_NAME
        user_state[chat_id] = state
        bot.answer_callback_query(call.id, "Цвет будет выбран случайно")

        bot.send_message(
            chat_id,
            "🎲 <b>Выбор цвета одежды будет выбран случайно.</b>\n"
            "<i>(Менеджер свяжется с вами при подтверждении заказа).</i>\n\n"
            "📝 <b>Шаг 3 из 4: Введите ваше имя и фамилию:</b>",
            parse_mode="HTML"
        )
    else:
        state["color"] = color_val
        state["step"] = STEP_ENTER_NAME
        user_state[chat_id] = state
        bot.answer_callback_query(call.id, f"Цвет: {color_val}")

        bot.send_message(
            chat_id,
            f"✅ Цвет: <b>{color_val}</b>\n\n"
            f"📝 <b>Шаг 3 из 4: Введите ваше имя и фамилию:</b>",
            parse_mode="HTML"
        )


@bot.callback_query_handler(func=lambda call: call.data == "skip_custom")
def handle_skip_custom(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    state = user_state.get(chat_id, {})
    state["step"] = STEP_ENTER_COLOR
    user_state[chat_id] = state

    bot.edit_message_reply_markup(chat_id, call.message.message_id, reply_markup=None)
    bot.answer_callback_query(call.id, "Пропущено")

    art_code = state.get("article_code", "")
    color_kb = get_color_keyboard(art_code)
    bot.send_message(
        chat_id,
        f"🎨 <b>Шаг 2 из 4: Выберите или напишите цвет товара:</b>\n"
        f"<i>(Например: «Как на фото», «Черный», «Белый»)</i>",
        parse_mode="HTML",
        reply_markup=color_kb
    )


@bot.callback_query_handler(func=lambda call: call.data == "cancel")
def handle_cancel(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    user_state.pop(chat_id, None)
    bot.edit_message_reply_markup(chat_id, call.message.message_id, reply_markup=None)
    bot.answer_callback_query(call.id, "Отменено")
    bot.send_message(chat_id, "❌ Оформление отменено. Вы всегда можете написать /start чтобы выбрать товар снова.")


# ── Обработчик текста — движок диалога ───────────────────────
@bot.message_handler(func=lambda m: True, content_types=["text"])
def handle_text(message: types.Message):
    chat_id = message.chat.id
    text = message.text.strip()
    state = user_state.get(chat_id)

    if not state:
        norm = normalize_article_code(text)
        found = get_article(norm)
        if found or norm.startswith(ARTICLE_PREFIX + "-") or "-" in norm:
            _show_article(chat_id, norm, message.from_user)
        else:
            bot.send_message(
                chat_id,
                f"ℹ️ Введите артикул товара, например: <code>{ARTICLE_PREFIX}-0001</code>\n"
                f"Или нажмите ссылку <b>«🛒 Заказать»</b> под постом в канале.",
                parse_mode="HTML"
            )
        return

    step = state.get("step")

    # ── Ввод стопы ───────────────────────────────────────────
    if step == STEP_ENTER_FOOT_SIZE:
        state["foot_size_cm"] = text
        state["step"] = STEP_ENTER_COLOR
        art_code = state.get("article_code", "")
        color_kb = get_color_keyboard(art_code)
        bot.send_message(
            chat_id,
            f"✅ Длина стопы: <b>{text}</b>\n\n"
            f"🎨 <b>Шаг 2 из 4: Выберите или напишите цвет товара:</b>",
            parse_mode="HTML",
            reply_markup=color_kb
        )

    # ── Ввод роста/веса ──────────────────────────────────────
    elif step == STEP_ENTER_HEIGHT_WEIGHT:
        state["height_weight"] = text
        state["step"] = STEP_ENTER_COLOR
        art_code = state.get("article_code", "")
        color_kb = get_color_keyboard(art_code)
        bot.send_message(
            chat_id,
            f"✅ Рост и вес: <b>{text}</b>\n\n"
            f"🎨 <b>Шаг 2 из 4: Выберите или напишите цвет товара:</b>",
            parse_mode="HTML",
            reply_markup=color_kb
        )

    # ── Ввод цвета текстом ───────────────────────────────────
    elif step == STEP_ENTER_COLOR:
        if text.lower() in ("пропустить", "пропуск", "skip", "случайно", "любой", "рандом", "-"):
            state["color"] = "Случайный цвет"
            state["step"] = STEP_ENTER_NAME
            bot.send_message(
                chat_id,
                "🎲 <b>Выбор цвета одежды будет выбран случайно.</b>\n"
                "<i>(Менеджер свяжется с вами при подтверждении заказа).</i>\n\n"
                "📝 <b>Шаг 3 из 4: Введите ваше имя и фамилию:</b>",
                parse_mode="HTML"
            )
        else:
            state["color"] = text
            state["step"] = STEP_ENTER_NAME
            bot.send_message(
                chat_id,
                f"✅ Цвет: <b>{text}</b>\n\n"
                f"📝 <b>Шаг 3 из 4: Введите ваше имя и фамилию:</b>",
                parse_mode="HTML"
            )

    # ── Ввод имени ───────────────────────────────────────────
    elif step == STEP_ENTER_NAME:
        if len(text) < 2:
            bot.send_message(chat_id, "⚠️ Пожалуйста, введите ваше имя полностью:")
            return
        state["name"] = text
        state["step"] = STEP_ENTER_PHONE
        bot.send_message(
            chat_id,
            f"Принято, <b>{text}</b>! 👍\n\n"
            f"📱 <b>Шаг 4 из 4: Введите ваш номер телефона для связи:</b>\n"
            f"<i>(Например: +7 999 123-45-67)</i>",
            parse_mode="HTML"
        )

    # ── Ввод телефона ────────────────────────────────────────
    elif step == STEP_ENTER_PHONE:
        digits = "".join(c for c in text if c.isdigit())
        if len(digits) < 7:
            bot.send_message(
                chat_id,
                "⚠️ Введите корректный номер телефона (например: +7 900 123-45-67):"
            )
            return

        state["phone"] = text
        state["step"] = STEP_DONE

        article_code = state.get("article_code", "")
        foot_size = state.get("foot_size_cm", None)
        height_weight = state.get("height_weight", None)
        color = state.get("color", "Как на фото")

        order_id, supplier_msg = _save_order(
            article_code=article_code,
            customer_name=state.get("name"),
            customer_phone=text,
            customer_telegram_id=str(message.from_user.id),
            customer_username=message.from_user.username,
            selected_size=state.get("size"),
            selected_color=color,
            foot_size_cm=foot_size,
            height_weight=height_weight,
            price_at_order=state.get("price")
        )

        confirm_text = (
            f"🎉 <b>Спасибо! Ваша заявка успешно принята!</b>\n\n"
            f"🏷️ Артикул: <code>{article_code}</code>\n"
            f"📏 Размер: <b>{state.get('size', 'Не указан')}</b>\n"
            f"🎨 Цвет: <b>{color}</b>\n"
        )
        if foot_size:
            confirm_text += f"👣 Длина стопы: <b>{foot_size}</b>\n"
        if height_weight:
            confirm_text += f"⚖️ Рост / вес: <b>{height_weight}</b>\n"

        confirm_text += (
            f"👤 Получатель: <b>{state.get('name')}</b>\n"
            f"📱 Телефон: <b>{text}</b>\n"
        )
        if state.get("price"):
            confirm_text += f"💰 Цена: <b>{state.get('price')}</b>\n"

        confirm_text += (
            f"\n✅ <b>Ожидайте обратной связи от нашего менеджера, мы свяжемся с вами в течение 10 минут!</b>\n"
            f"Номер вашей заявки: <b>#{order_id[-6:].upper()}</b>"
        )
        bot.send_message(chat_id, confirm_text, parse_mode="HTML")

        if MANAGER_CHAT_ID:
            _notify_manager(
                article_code=article_code,
                customer_name=state.get("name"),
                customer_phone=text,
                customer_username=message.from_user.username,
                size=state.get("size"),
                color=color,
                foot_size_cm=foot_size,
                height_weight=height_weight,
                price=state.get("price"),
                supplier_message=supplier_msg,
                order_id=order_id
            )

        user_state.pop(chat_id, None)
        logger.info(f"✅ New order saved: {article_code} (Size: {state.get('size')}, Color: {color})")


def generate_supplier_text(article: Optional[ArticleItem], size: str, color: str = None, foot_size: str = None, height_weight: str = None) -> str:
    """Формирует идеальный вежливый готовый текст для отправки менеджеру оптового поставщика."""
    title = article.title if (article and article.title) else "товар"
    lines = [
        "Здравствуйте! Подскажите, пожалуйста, по наличию:",
        f"• Модель: {title}",
    ]
    if size and size not in ["Не указан", "Свой рост/вес", "Своя стопа"]:
        lines.append(f"• Размер: {size}")
    if color and color != "Не указан":
        lines.append(f"• Цвет: {color}")
    if foot_size and foot_size != "Не указано":
        lines.append(f"• Длина стопы: {foot_size}")
    if height_weight and height_weight != "Не указано":
        lines.append(f"• Рост / вес: {height_weight}")

    lines.append("\nЕсть ли в наличии и можно ли оформить заказ?")
    return "\n".join(lines)


def _save_order(
    article_code: str,
    customer_name: str,
    customer_phone: str,
    customer_telegram_id: str,
    customer_username: str,
    selected_size: str,
    selected_color: str = "Как на фото",
    foot_size_cm: str = None,
    height_weight: str = None,
    price_at_order: str = None
) -> tuple[str, str]:
    """Сохраняет заказ в БД и генерирует текст для поставщика."""
    with Session(engine) as s:
        art = s.execute(
            select(ArticleItem).where(ArticleItem.article_code == article_code)
        ).scalar_one_or_none()

        supplier_msg = generate_supplier_text(art, selected_size, selected_color, foot_size_cm, height_weight)

        if not art:
            logger.warning(f"Article {article_code} not found when saving order!")
            return "UNKNOWN", supplier_msg

        order = Order(
            article_id=art.id,
            article_code=article_code,
            customer_name=customer_name,
            customer_phone=customer_phone,
            customer_telegram_id=customer_telegram_id,
            customer_username=customer_username,
            selected_size=selected_size,
            selected_color=selected_color,
            foot_size_cm=foot_size_cm,
            height_weight=height_weight,
            price_at_order=price_at_order,
            supplier_message=supplier_msg,
            status="new"
        )
        s.add(order)
        art.orders_count = (art.orders_count or 0) + 1
        s.commit()
        s.refresh(order)
        return order.id, supplier_msg


def _notify_manager(
    article_code: str,
    customer_name: str,
    customer_phone: str,
    customer_username: str,
    size: str,
    color: str = "Как на фото",
    foot_size_cm: str = None,
    height_weight: str = None,
    price: str = None,
    supplier_message: str = None,
    order_id: str = "000000"
):
    """Отправляет уведомление менеджеру о новом заказе."""
    try:
        msg_lines = [
            "🚨 <b>НОВЫЙ ЗАКАЗ ИЗ БОТА!</b>",
            "",
            f"🏷️ <b>Артикул:</b> <code>{article_code}</code>",
            f"👤 <b>Клиент:</b> {customer_name or 'Не указано'}",
            f"📱 <b>Телефон:</b> <code>{customer_phone}</code>",
        ]
        if customer_username:
            msg_lines.append(f"💬 <b>Telegram:</b> @{customer_username}")
        if size:
            msg_lines.append(f"📏 <b>Размер:</b> <b>{size}</b>")
        if color:
            msg_lines.append(f"🎨 <b>Цвет:</b> <b>{color}</b>")
        if foot_size_cm:
            msg_lines.append(f"👣 <b>Стопа:</b> {foot_size_cm}")
        if height_weight:
            msg_lines.append(f"⚖️ <b>Рост/вес:</b> {height_weight}")
        if price:
            msg_lines.append(f"💰 <b>Сумма:</b> {price}")

        msg_lines.append(f"\n📋 <b>Номер заказа:</b> #{order_id[-6:].upper()}")

        if supplier_message:
            msg_lines.append("\n━━━━━━━━━━━━━━━━━━━━")
            msg_lines.append("🤖 <b>Текст для поставщика (нажмите чтобы скопировать):</b>")
            msg_lines.append(f"<code>{supplier_message}</code>")

        bot.send_message(
            MANAGER_CHAT_ID,
            "\n".join(msg_lines),
            parse_mode="HTML"
        )
    except Exception as e:
        logger.error(f"Failed to notify manager: {e}")


# ── Запуск ────────────────────────────────────────────────────
if __name__ == "__main__":
    ensure_single_instance()
    logger.info("=" * 50)
    logger.info("🤖 Order Bot запущен!")
    logger.info(f"   Prefix: {ARTICLE_PREFIX}")
    logger.info(f"   Manager: {MANAGER_CHAT_ID or 'не задан'}")
    logger.info("=" * 50)
    try:
        bot.infinity_polling(logger_level=logging.WARNING, timeout=30, long_polling_timeout=20)
    except Exception as e:
        logger.error(f"[OrderBot] Polling terminated: {e}")

