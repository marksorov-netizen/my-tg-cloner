"""
server.py — FastAPI backend для MyBotAi11

Endpoints:
  GET  /health                    — статус сервера
  GET  /status                    — статус Telegram авторизации

  POST /auth/request_code         — запросить SMS-код
  POST /auth/login                — войти по коду
  POST /auth/logout               — выйти

  POST /batch/fetch               — получить посты из канала
  POST /batch/send                — отправить пост в канал

  POST /api/ai/rewrite            — AI рерайт текста (Gemini)
  POST /api/ai/generate-prompt    — сгенерировать system prompt

  POST /api/projects              — создать проект
  GET  /api/projects              — список проектов
  GET  /api/projects/{id}         — детали проекта
  PUT  /api/projects/{id}         — обновить проект
  DELETE /api/projects/{id}       — удалить проект
  POST /api/projects/{id}/start   — запустить автомониторинг
  POST /api/projects/{id}/stop    — остановить автомониторинг
  GET  /api/projects/{id}/logs    — последние публикации проекта
"""

import logging
import os
import sys
import subprocess
import uuid
from contextlib import asynccontextmanager
from typing import Optional, Literal, List

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Response, Cookie, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from telethon.errors import (
    UsernameNotOccupiedError,
    UsernameInvalidError,
    ChannelPrivateError,
    ChatAdminRequiredError,
    FloodWaitError,
)
from telegram_service.client import tg_manager, user_clients
from database.session import init_db, get_db, get_system_user_id
from database.models import Project, Donor, ProjectDonor, Post, User, ArticleItem, OrderBotConfig, Order
from core.ai_rewriter import call_gemini_with_retry, AIRewriteError
from core.auth import get_current_user, create_access_token, COOKIE_NAME, COOKIE_MAX_AGE

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("server")

# ---------- Конфигурация CORS ----------
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]
logger.info(f"CORS allowed origins: {ALLOWED_ORIGINS}")

def get_default_ai_key() -> str:
    return (
        os.getenv("ZAPRO_API_KEY", "").strip() or
        os.getenv("OPENAI_API_KEY", "").strip() or
        os.getenv("GEMINI_API_KEY", "").strip()
    )

GEMINI_API_KEY = get_default_ai_key()
if not GEMINI_API_KEY:
    logger.warning("AI_API_KEY не установлен в .env. /api/ai/rewrite вернёт 503.")

# Автомониторинг: источник правды — Project.is_active в БД (переживает рестарты),
# листенеры перерегистрируются через _restart_listeners().


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("Database initialized.")
    restored = await tg_manager.restore()
    if restored:
        logger.info("Telegram: authorized and ready.")
    else:
        logger.info("Telegram: waiting for credentials from the website.")

    # Авто-старт бота заказов если токен настроен
    try:
        start_order_bot_subprocess()
    except Exception as ob_err:
        logger.warning(f"Could not auto-start order bot: {ob_err}")

    yield

    if ORDER_BOT_PROCESS and ORDER_BOT_PROCESS.poll() is None:
        try:
            ORDER_BOT_PROCESS.terminate()
        except Exception:
            pass

    await tg_manager.disconnect_all()
    await user_clients.disconnect_all()
    logger.info("Shutdown complete.")


app = FastAPI(title="MyBotAi11 API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,                                         # обязательно для cookies
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# ============================================================
# Rate limiting (in-memory, скользящее окно по IP)
# ============================================================
# Без этого /auth/request_code превращается в SMS-бомбинг через наш сервер,
# а Telegram отвечает FloodWait-ами на api_id. Для 200 пользователей хватит
# одного процесса; при масштабировании на несколько воркеров → Redis.
import time as _time
import collections as _collections

_RATE_BUCKETS: dict[str, _collections.deque] = {}
_RATE_LIMITS = {
    # endpoint -> (max_requests, window_seconds)
    "/auth/request_code": (3, 3600),   # 3 SMS в час с одного IP
    "/auth/login": (10, 3600),         # 10 попыток входа в час
    "/batch/fetch": (30, 300),         # 30 чтений канала за 5 минут
    "/batch/send": (20, 300),          # 20 публикаций за 5 минут
}


def _client_ip(request) -> str:
    """IP клиента с учётом обратного прокси (nginx и т.п.)."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_rate_limit(request, bucket_key: Optional[str] = None) -> Optional[int]:
    """
    Возвращает retry_after в секундах, если лимит превышен, иначе None.
    bucket_key по умолчанию — путь эндпоинта.
    """
    key = bucket_key or request.url.path
    limit_cfg = _RATE_LIMITS.get(key.rstrip("/"))
    if not limit_cfg:
        return None
    max_req, window = limit_cfg

    bucket_key_full = f"{key}:{_client_ip(request)}"
    now = _time.monotonic()
    bucket = _RATE_BUCKETS.setdefault(bucket_key_full, _collections.deque())

    while bucket and now - bucket[0] > window:
        bucket.popleft()

    if len(bucket) >= max_req:
        retry_after = int(window - (now - bucket[0])) + 1
        return max(retry_after, 1)

    bucket.append(now)

    # Не даём словарю расти бесконечно между IPP
    if len(_RATE_BUCKETS) > 10_000:
        stale = [k for k, v in _RATE_BUCKETS.items() if not v]
        for k in stale:
            _RATE_BUCKETS.pop(k, None)
    return None


# ============================================================
# Pydantic схемы запросов/ответов
# ============================================================

class AuthCodeRequest(BaseModel):
    api_id: str
    api_hash: str
    phone: str


class LoginRequest(BaseModel):
    phone: str
    code: str
    password: Optional[str] = None


class FetchRequest(BaseModel):
    channel: str
    limit: int = 10


class SendRequest(BaseModel):
    destination: str
    text: str
    source_channel: Optional[str] = None
    msg_id: Optional[int] = None
    download_media: Optional[bool] = True
    article_code: Optional[str] = None
    bot_username: Optional[str] = None


class RewriteRequest(BaseModel):
    text: str
    prompt: str
    system_prompt: Optional[str] = None
    mode: Literal["news", "product"] = "news"
    project_id: Optional[str] = None  # Если указан, используем AiKeyManager


class ProjectCreateRequest(BaseModel):
    name: str
    donor_channel_id: str          # @username или числовой ID канала-донора
    target_channel_id: str         # куда публиковать
    rewrite_prompt: Optional[str] = None
    rewrite_enabled: bool = True
    remove_links: bool = True
    use_original_on_error: bool = False
    duplicate_threshold: float = 0.85
    check_interval: int = 60       # секунды
    pricing_enabled: bool = False
    pricing_wholesale_pct: float = 10.0
    pricing_drop_pct: float = 30.0
    pricing_retail_pct: float = 50.0
    pricing_currency: str = "₽"
    # AI провайдер
    ai_provider: str = "platform"  # "platform" | "own_gemini" | "own_openrouter"
    ai_api_key: Optional[str] = None  # Приходит в plaintext, шифруется на сервере


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    donor_channel_id: Optional[str] = None
    target_channel_id: Optional[str] = None
    rewrite_prompt: Optional[str] = None
    rewrite_enabled: Optional[bool] = None
    remove_links: Optional[bool] = None
    use_original_on_error: Optional[bool] = None
    duplicate_threshold: Optional[float] = None
    check_interval: Optional[int] = None
    pricing_enabled: Optional[bool] = None
    pricing_wholesale_pct: Optional[float] = None
    pricing_drop_pct: Optional[float] = None
    pricing_retail_pct: Optional[float] = None
    pricing_currency: Optional[str] = None
    # AI провайдер
    ai_provider: Optional[str] = None  # "platform" | "own_gemini" | "own_openrouter"
    ai_api_key: Optional[str] = None   # plaintext, шифруется на сервере


def _project_to_dict(project: Project, donor_channel_id: str = "") -> dict:
    """Сериализует Project ORM в JSON-совместимый словарь."""
    return {
        "id": project.id,
        "name": project.name,
        "donor_channel_id": donor_channel_id,
        "target_channel_id": project.target_channel_id,
        "rewrite_enabled": project.rewrite_enabled,
        "rewrite_prompt": project.rewrite_prompt,
        "remove_links": project.remove_links,
        "use_original_on_error": getattr(project, "use_original_on_error", False),
        "duplicate_threshold": project.duplicate_threshold,
        "check_interval": project.check_interval,
        "ai_provider": getattr(project, "ai_provider", "platform"),
        "has_own_ai_key": bool(getattr(project, "ai_api_key_encrypted", None)),  # не возвращаем сам ключ
        "pricing_enabled": project.pricing_enabled,
        "pricing_wholesale_pct": project.pricing_wholesale_pct,
        "pricing_drop_pct": project.pricing_drop_pct,
        "pricing_retail_pct": project.pricing_retail_pct,
        "pricing_currency": project.pricing_currency,
        "is_active": project.is_active,
        "created_at": project.created_at.isoformat() if project.created_at else None,
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }


# ============================================================
# Служебные endpoints
# ============================================================

# ============================================================
# Служебные endpoints
# ============================================================

@app.get("/status")
async def status(access_token: Optional[str] = Cookie(default=None)):
    # Статус строится по JWT-cookie: каждый пользователь видит СВОЙ Telegram-аккаунт.
    # Без cookie возвращаем 200 + unauthorized (так ждёт фронтенд).
    try:
        current_user = await get_current_user(access_token)
    except HTTPException:
        current_user = None
    if current_user and await user_clients.is_authorized(current_user):
        return {
            "status": "authenticated",
            "user": current_user.username or current_user.full_name or current_user.phone_number,
            "user_details": {
                "id": current_user.id,
                "phone_number": current_user.phone_number,
                "telegram_user_id": current_user.telegram_user_id,
                "username": current_user.username,
                "full_name": current_user.full_name,
                "subscription_tier": current_user.subscription_tier,
                "is_admin": current_user.is_admin,
                "total_posts_processed": current_user.total_posts_processed,
            }
        }
    return {"status": "unauthorized"}


@app.get("/api/me")
async def get_current_user_profile(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "phone_number": current_user.phone_number,
        "telegram_user_id": current_user.telegram_user_id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "is_admin": current_user.is_admin,
        "subscription_tier": current_user.subscription_tier,
        "total_posts_processed": current_user.total_posts_processed,
        "total_time_saved_minutes": current_user.total_time_saved_minutes,
        "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
        "last_login_at": current_user.last_login_at.isoformat() if current_user.last_login_at else None,
    }


@app.get("/health")
async def health():
    from database.session import async_session
    active_count = 0
    try:
        async with async_session() as s:
            from sqlalchemy import func as sa_func
            r = await s.execute(sa_func.count().select_from(Project).where(Project.is_active == True))
            active_count = r.scalar() or 0
    except Exception:
        pass
    return {
        "status": "ok",
        "telegram_authorized": await tg_manager.is_authorized(),
        "user_clients_connected": len(user_clients._clients),
        "gemini_configured": bool(GEMINI_API_KEY),
        "active_monitors": active_count,
    }


# ============================================================
# Авторизация Telegram
# ============================================================

@app.post("/auth/request_code")
async def request_code(req: AuthCodeRequest, request: Request):
    retry = check_rate_limit(request)
    if retry:
        raise HTTPException(
            status_code=429,
            detail=f"Слишком много запросов кода. Попробуйте через {retry} секунд.",
            headers={"Retry-After": str(retry)},
        )
    try:
        return await tg_manager.request_code(req.api_id, req.api_hash, req.phone)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"request_code failed: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка Telegram: {e}")


@app.post("/auth/login")
async def login(req: LoginRequest, response: Response, request: Request):
    retry = check_rate_limit(request)
    if retry:
        raise HTTPException(
            status_code=429,
            detail=f"Слишком много попыток входа. Попробуйте через {retry} секунд.",
            headers={"Retry-After": str(retry)},
        )
    try:
        result = await tg_manager.sign_in(req.phone, req.code, req.password)
        me_info = result.get("me") or {}

        # Регистрация / обновление профиля в БД
        from database.session import get_or_create_user
        db_user = await get_or_create_user(
            phone_number=me_info.get("phone_number") or req.phone,
            telegram_user_id=me_info.get("telegram_user_id"),
            username=me_info.get("username"),
            full_name=me_info.get("full_name"),
            tg_session_string=me_info.get("session_string"),
            tg_api_id=me_info.get("api_id"),
            tg_api_hash=me_info.get("api_hash"),
        )

        # Выдаём JWT в httpOnly cookie — JS не имеет к нему доступа
        # COOKIE_SECURE=true в проде за HTTPS, иначе браузер не примет cookie по http
        token = create_access_token(db_user.id, db_user.phone_number)
        response.set_cookie(
            key=COOKIE_NAME,
            value=token,
            httponly=True,
            samesite="lax",
            max_age=COOKIE_MAX_AGE,
            secure=os.getenv("COOKIE_SECURE", "false").lower() in ("1", "true", "yes"),
        )

        # Кладём сессию в кэш per-user клиентов — без обращения к global tg_manager
        await user_clients.register_session(
            db_user.id,
            me_info.get("session_string"),
            me_info.get("api_id"),
            me_info.get("api_hash"),
        )

        await _restart_listeners()

        return {
            "status": "authenticated",
            "user": db_user.username or db_user.full_name or db_user.phone_number,
            "user_id": db_user.id,
            "subscription_tier": db_user.subscription_tier,
            "is_admin": db_user.is_admin,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"login failed: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка входа: {e}")


@app.post("/auth/logout")
async def logout(response: Response, access_token: Optional[str] = Cookie(default=None)):
    # Стираем cookie + отключаем Telegram-клиента ТОЛЬКО этого пользователя.
    # Глобальная системная сессия (для бота заказов) не трогается.
    response.delete_cookie(key=COOKIE_NAME, samesite="lax")
    try:
        current_user = await get_current_user(access_token)
        await user_clients.disconnect_user(current_user.id)
    except HTTPException:
        pass
    await _restart_listeners()
    return {"status": "logged_out"}


def clean_channel_identifier(channel_str: str) -> str:
    """Очищает любой ввод канала в чистый идентификатор, который понимает Telethon."""
    if not channel_str:
        return ""
    s = channel_str.strip()
    if s.startswith("@http://") or s.startswith("@https://") or s.startswith("@t.me/"):
        s = s[1:]
    if "t.me/" in s:
        parts = s.split("t.me/")[-1].strip("/")
        if not (parts.startswith("c/") or parts.startswith("+") or parts.startswith("joinchat/")):
            username = parts.split("/")[0].split("?")[0]
            return f"@{username}"
        return s
    if not s.startswith("@") and not s.startswith("-") and not s.isdigit():
        return f"@{s}"
    return s


# ============================================================
# ДЕДУПЛИКАЦИЯ: Память опубликованных постов
# ============================================================

PUBLISHED_POST_KEYS = set()    # Набор видов: "{clean_src}:{msg_id}"
PUBLISHED_TEXT_HASHES = set()  # Хэши текстов
PUBLISHED_IMAGE_HASHES: List[dict] = []  # [{"time": datetime, "hash": ImageHash, "key": str}]

def get_simple_hash(text: str) -> str:
    """Генерирует MD5 хеш очищенного текста для обнаружения повторных постов."""
    import hashlib, re
    if not text:
        return ""
    clean = re.sub(r'\s+', '', text.lower())
    return hashlib.md5(clean[:300].encode('utf-8')).hexdigest()


def is_visual_duplicate(image_path: str, max_age_hours: int = 24, max_distance: int = 8) -> bool:
    """
    Проверяет, выкладывалось ли визуально идентичное фото за последние 24 часа.
    Использует dhash/phash через ImageHash.
    """
    if not os.path.exists(image_path):
        return False
    # Проверяем только графические файлы
    ext = os.path.splitext(image_path)[1].lower()
    if ext not in ['.jpg', '.jpeg', '.png', '.webp']:
        return False
    try:
        import imagehash
        from PIL import Image
        from datetime import datetime, timedelta

        with Image.open(image_path) as img:
            new_hash = imagehash.phash(img)

        now = datetime.utcnow()
        cutoff = now - timedelta(hours=max_age_hours)

        global PUBLISHED_IMAGE_HASHES
        PUBLISHED_IMAGE_HASHES = [item for item in PUBLISHED_IMAGE_HASHES if item["time"] > cutoff]

        for item in PUBLISHED_IMAGE_HASHES:
            distance = new_hash - item["hash"]
            if distance <= max_distance:
                logger.info(f"[Visual Deduplication] Duplicate photo detected! Distance {distance} <= {max_distance} (key: {item.get('key')})")
                return True
        return False
    except Exception as e:
        logger.warning(f"[Visual Deduplication] Could not process image {image_path}: {e}")
        return False


def register_image_hash(image_path: str, key: str = ""):
    """Регистрирует хэш фото в глобальной памяти за последние 24 часа."""
    if not os.path.exists(image_path):
        return
    ext = os.path.splitext(image_path)[1].lower()
    if ext not in ['.jpg', '.jpeg', '.png', '.webp']:
        return
    try:
        import imagehash
        from PIL import Image
        from datetime import datetime

        with Image.open(image_path) as img:
            h = imagehash.phash(img)
        PUBLISHED_IMAGE_HASHES.append({"time": datetime.utcnow(), "hash": h, "key": key})
        logger.info(f"[Visual Deduplication] Registered photo hash for key: {key}")
    except Exception as e:
        logger.warning(f"[Visual Deduplication] Failed to register image hash for {image_path}: {e}")



# ============================================================
# Batch операции с каналами
# ============================================================

@app.post("/batch/fetch")
async def batch_fetch(req: FetchRequest, current_user: User = Depends(get_current_user), request: Request = None):
    retry = check_rate_limit(request)
    if retry:
        raise HTTPException(status_code=429, detail=f"Слишком много запросов. Подождите {retry}с.", headers={"Retry-After": str(retry)})
    try:
        client = await user_clients.get_client(current_user)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        clean_target = clean_channel_identifier(req.channel)
        entity = await client.get_entity(clean_target)

        # Сканируем сообщения канала (с запасом для склейки фото + текст)
        scan_limit = max(req.limit * 12, 100)
        raw_msgs = []
        async for msg in client.iter_messages(entity, limit=scan_limit):
            raw_msgs.append(msg)

        # Сортируем по ID по возрастанию (хронологический порядок: старые -> новые)
        raw_msgs.sort(key=lambda m: m.id)

        # Предварительная группировка альбомов по grouped_id:
        # grouped_id -> { "msgs": [...], "caption": "...", "first_id": 123 }
        groups_by_id = {}
        for m in raw_msgs:
            gid = getattr(m, "grouped_id", None)
            if gid:
                if gid not in groups_by_id:
                    groups_by_id[gid] = {"msgs": [], "caption": "", "first_id": m.id}
                groups_by_id[gid]["msgs"].append(m)
                if m.text and len(m.text.strip()) > len(groups_by_id[gid]["caption"]):
                    groups_by_id[gid]["caption"] = m.text.strip()

        result = []
        skip_ids = set()

        i = 0
        while i < len(raw_msgs) and len(result) < req.limit:
            msg = raw_msgs[i]
            if msg.id in skip_ids:
                i += 1
                continue

            gid = getattr(msg, "grouped_id", None)

            # --- СЛУЧАЙ 1: Сообщение является частью альбома (grouped_id) ---
            if gid and gid in groups_by_id:
                g_data = groups_by_id[gid]
                # Добавляем все фото этого альбома в skip_ids, чтобы не дублировать
                for am in g_data["msgs"]:
                    skip_ids.add(am.id)

                caption = g_data["caption"]
                first_msg_id = g_data["first_id"]

                # Если внутри альбома не было текста — проверяем следующий пост
                if not caption:
                    last_idx = max(raw_msgs.index(am) for am in g_data["msgs"])
                    if last_idx + 1 < len(raw_msgs):
                        next_m = raw_msgs[last_idx + 1]
                        if next_m.text and not (next_m.photo or next_m.video or next_m.document or next_m.media):
                            caption = next_m.text.strip()
                            skip_ids.add(next_m.id)

                # Добавляем только если текст реальный и имеет смысл (не просто короткое слово)
                if caption and len(caption) >= 10:
                    result.append({
                        "id": first_msg_id,
                        "text": caption,
                        "date": msg.date.isoformat() if msg.date else "",
                        "media_type": "photo",
                        "grouped_id": gid,
                        "url": f"https://t.me/{clean_target.lstrip('@')}/{first_msg_id}",
                    })
                i += 1
                continue

            # --- СЛУЧАЙ 2: Одиночное сообщение (без grouped_id) ---
            has_media = bool(msg.photo or msg.video or msg.document or msg.media)
            text = (msg.text or "").strip()

            # Одиночное медиа без текста — ищем следующий пост с текстом
            if has_media and not text:
                skip_ids.add(msg.id)
                if i + 1 < len(raw_msgs):
                    next_m = raw_msgs[i + 1]
                    if next_m.text and not (next_m.photo or next_m.video or next_m.document or next_m.media):
                        matched_text = next_m.text.strip()
                        skip_ids.add(next_m.id)
                        if len(matched_text) >= 10:
                            result.append({
                                "id": msg.id,
                                "text": matched_text,
                                "date": msg.date.isoformat() if msg.date else "",
                                "media_type": "photo",
                                "grouped_id": None,
                                "url": f"https://t.me/{clean_target.lstrip('@')}/{msg.id}",
                            })
                i += 1
                continue

            # Одиночное сообщение с текстом
            if text and len(text) >= 10:
                skip_ids.add(msg.id)
                media_msg_id = msg.id
                if not has_media and i > 0:
                    prev_m = raw_msgs[i - 1]
                    if (prev_m.photo or prev_m.media) and not (prev_m.text or "").strip():
                        media_msg_id = prev_m.id
                        has_media = True

                result.append({
                    "id": media_msg_id,
                    "text": text,
                    "date": msg.date.isoformat() if msg.date else "",
                    "media_type": "photo" if has_media else "none",
                    "grouped_id": None,
                    "url": f"https://t.me/{clean_target.lstrip('@')}/{msg.id}",
                })
                i += 1
                continue

            skip_ids.add(msg.id)
            i += 1

        # Возвращаем от самых свежих к старым
        result.reverse()
        return result[:req.limit]
    except FloodWaitError as e:
        raise HTTPException(status_code=429, detail=f"Telegram ограничил запросы. Подождите {e.seconds} секунд.", headers={"Retry-After": str(e.seconds)})
    except Exception as e:
        logger.error(f"batch_fetch failed: {e}")
        raise HTTPException(status_code=400, detail=f"Не удалось прочитать канал: {e}")


@app.post("/batch/send")
async def batch_send(req: SendRequest, current_user: User = Depends(get_current_user), request: Request = None):
    retry = check_rate_limit(request)
    if retry:
        raise HTTPException(status_code=429, detail=f"Слишком много запросов. Подождите {retry}с.", headers={"Retry-After": str(retry)})
    try:
        client = await user_clients.get_client(current_user)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        clean_dest = clean_channel_identifier(req.destination)
        clean_src = clean_channel_identifier(req.source_channel) if req.source_channel else ""
        
        # 1. Защита от дубликатов: Проверка по ID поста и хешу текста
        msg_key = f"{clean_src}:{req.msg_id}" if clean_src and req.msg_id else None
        text_hash = get_simple_hash(req.text)

        if msg_key and msg_key in PUBLISHED_POST_KEYS:
            logger.info(f"[Deduplication] Skip duplicate post key: {msg_key}")
            return {"status": "skipped", "reason": "duplicate", "detail": "Пост с таким ID уже публиковался ранее"}

        if text_hash and text_hash in PUBLISHED_TEXT_HASHES:
            logger.info(f"[Deduplication] Skip duplicate text hash")
            return {"status": "skipped", "reason": "duplicate", "detail": "Идентичный пост уже публиковался ранее"}

        # Подготовка кнопки Telegram (если передан бот и артикул)
        from telethon import Button
        buttons = None
        if req.bot_username and req.article_code:
            clean_bot = req.bot_username.lstrip('@')
            buttons = [Button.url(f"🛒 Заказать ({req.article_code})", f"https://t.me/{clean_bot}?start={req.article_code}")]

        # 2. Если переданы source_channel и msg_id, скачиваем медиа (поддержка альбомов/галерей!)
        if clean_src and req.msg_id and req.download_media:
            try:
                src_msg = await client.get_messages(clean_src, ids=req.msg_id)

                # Получаем сообщения вокрег req.msg_id (от msg_id-10 до msg_id+10) в один клик
                neighbor_ids = list(range(max(1, req.msg_id - 10), req.msg_id + 10))
                around_msgs_raw = await client.get_messages(clean_src, ids=neighbor_ids)
                around_msgs = [m for m in around_msgs_raw if m is not None]

                # 💡 Если картинки отправлены отдельным постом (до или после текста) — ищем их у соседей!
                if src_msg and not src_msg.media:
                    for m_item in sorted(around_msgs, key=lambda m: abs(m.id - req.msg_id)):
                        if m_item and m_item.media:
                            src_msg = m_item
                            logger.info(f"[Media Stitcher] Bound neighbor media msg {m_item.id} to text msg {req.msg_id}")
                            break

                if src_msg and src_msg.media:
                    temp_dir = os.path.join(os.getcwd(), "temp_media")
                    os.makedirs(temp_dir, exist_ok=True)

                    # Проверяем, является ли пост частью медиа-альбома (группы фото/видео)
                    grouped_msgs = [src_msg]
                    grouped_id = getattr(src_msg, "grouped_id", None)
                    if grouped_id:
                        album_items = [
                            m for m in around_msgs
                            if getattr(m, "grouped_id", None) == grouped_id and m.media
                        ]
                        if album_items:
                            grouped_msgs = sorted(album_items, key=lambda m: m.id)

                    # Скачиваем ВСЕ медиа-файлы альбома
                    media_files = []
                    for m in grouped_msgs:
                        try:
                            f_path = await client.download_media(m, file=temp_dir)
                            if f_path and os.path.exists(f_path):
                                media_files.append(f_path)
                        except Exception as dl_err:
                            logger.warning(f"Download failed for item in msg {m.id}: {dl_err}")

                    if media_files:
                        try:
                            # 🔍 ПРОВЕРКА НА ВИЗУАЛЬНЫЙ ДУБЛИКАТ ПО ФОТО (24 ЧАСА)
                            is_photo_dup = False
                            for f_path in media_files:
                                if is_visual_duplicate(f_path, max_age_hours=24, max_distance=8):
                                    is_photo_dup = True
                                    break

                            if is_photo_dup:
                                logger.info(f"[Visual Deduplication] Skipping duplicate product photo for msg {req.msg_id}")
                                for f_path in media_files:
                                    if os.path.exists(f_path):
                                        try: os.remove(f_path)
                                        except Exception: pass
                                return {
                                    "status": "skipped",
                                    "reason": "visual_duplicate",
                                    "detail": "Товар с аналогичным фото уже выкладывался за последние 24 часа"
                                }

                            # Публикация в канал (единым постом с описанием и ссылкой на заказ)
                            sent_res = None
                            if len(media_files) == 1:
                                try:
                                    sent_res = await client.send_file(
                                        clean_dest,
                                        media_files[0],
                                        caption=req.text,
                                        buttons=buttons
                                    )
                                except Exception:
                                    sent_res = await client.send_file(
                                        clean_dest,
                                        media_files[0],
                                        caption=req.text
                                    )
                            else:
                                sent_res = await client.send_file(
                                    clean_dest,
                                    media_files,
                                    caption=req.text
                                )

                            sent_msg_ids = []
                            sent_msg_id = None
                            if sent_res:
                                if isinstance(sent_res, list) and len(sent_res) > 0:
                                    sent_msg_ids = [getattr(m, 'id', None) for m in sent_res if getattr(m, 'id', None)]
                                    sent_msg_id = sent_msg_ids[0]
                                elif hasattr(sent_res, 'id'):
                                    sent_msg_id = getattr(sent_res, 'id', None)
                                    sent_msg_ids = [sent_msg_id] if sent_msg_id else []

                            # Привязываем ID отправленного сообщения в НАШЕМ канале к артикулу
                            if req.article_code and sent_msg_id:
                                try:
                                    from database.session import async_session
                                    async with async_session() as s_art:
                                        art_res = await s_art.execute(select(ArticleItem).where(ArticleItem.article_code == req.article_code))
                                        art_obj = art_res.scalar_one_or_none()
                                        if art_obj:
                                            art_obj.target_channel = clean_dest
                                            art_obj.target_msg_id = sent_msg_id
                                            if sent_msg_ids:
                                                art_obj.media_urls = [str(x) for x in sent_msg_ids]
                                            clean_ch_name = clean_dest.lstrip('@')
                                            art_obj.telegram_post_url = f"https://t.me/{clean_ch_name}/{sent_msg_id}"
                                            await s_art.commit()
                                            logger.info(f"[Article Link] Linked {req.article_code} to our channel: {art_obj.telegram_post_url} (album msgs: {sent_msg_ids})")
                                except Exception as upd_err:
                                    logger.warning(f"[Article Link] Could not update target_msg_id for article {req.article_code}: {upd_err}")

                            logger.info(f"Published media ({len(media_files)} files) for msg {req.msg_id} to {clean_dest}")

                            # Регистрируем в памяти дубликатов (текст + ID + хэш картинок)
                            if msg_key: PUBLISHED_POST_KEYS.add(msg_key)
                            if text_hash: PUBLISHED_TEXT_HASHES.add(text_hash)
                            for f_path in media_files:
                                register_image_hash(f_path, key=msg_key or req.article_code or "")

                            return {"status": "sent", "has_media": True, "media_count": len(media_files), "sent_msg_id": sent_msg_id}
                        finally:
                            for f_path in media_files:
                                try:
                                    if os.path.exists(f_path):
                                        os.remove(f_path)
                                except Exception:
                                    pass
            except (UsernameNotOccupiedError, UsernameInvalidError, ChannelPrivateError, ChatAdminRequiredError):
                raise
            except Exception as media_err:
                logger.warning(f"Media album download/send failed for msg {req.msg_id}: {media_err}, falling back to text message")

        # Обычная отправка текста если медиа нет или отключено
        sent_txt_res = None
        try:
            sent_txt_res = await client.send_message(clean_dest, req.text, buttons=buttons)
        except Exception:
            sent_txt_res = await client.send_message(clean_dest, req.text)

        sent_msg_id = getattr(sent_txt_res, 'id', None) if sent_txt_res else None
        if req.article_code and sent_msg_id:
            try:
                from database.session import async_session
                async with async_session() as s_art:
                    art_res = await s_art.execute(select(ArticleItem).where(ArticleItem.article_code == req.article_code))
                    art_obj = art_res.scalar_one_or_none()
                    if art_obj:
                        art_obj.target_channel = clean_dest
                        art_obj.target_msg_id = sent_msg_id
                        clean_ch_name = clean_dest.lstrip('@')
                        art_obj.telegram_post_url = f"https://t.me/{clean_ch_name}/{sent_msg_id}"
                        await s_art.commit()
            except Exception:
                pass

        # Регистрируем в памяти дубликатов
        if msg_key: PUBLISHED_POST_KEYS.add(msg_key)
        if text_hash: PUBLISHED_TEXT_HASHES.add(text_hash)

        return {"status": "sent", "has_media": False, "sent_msg_id": sent_msg_id}
    except FloodWaitError as e:
        raise HTTPException(status_code=429, detail=f"Telegram ограничил отправку. Подождите {e.seconds} секунд.", headers={"Retry-After": str(e.seconds)})
    except (UsernameNotOccupiedError, UsernameInvalidError) as e:
        raise HTTPException(
            status_code=400,
            detail=f"Канал '{req.destination}' не существует в Telegram. Введите юзернейм вашего существующего канала (например @my_real_channel)."
        )
    except (ChannelPrivateError, ChatAdminRequiredError) as e:
        raise HTTPException(
            status_code=400,
            detail=f"Канал '{req.destination}' приватный или ваш аккаунт не является администратором в нём."
        )
    except Exception as e:
        logger.error(f"batch_send failed: {e}")
        raise HTTPException(status_code=400, detail=f"Не удалось отправить в канал '{req.destination}': {e}")


# ============================================================
# AI endpoints
# ============================================================

@app.post("/api/ai/rewrite")
async def ai_rewrite(
    req: RewriteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Текст не может быть пустым")

    # Определяем ключ через AiKeyManager если есть project_id
    resolved_key: Optional[str] = None
    if req.project_id:
        try:
            project_res = await db.execute(
                select(Project).where(and_(Project.id == req.project_id, Project.user_id == current_user.id))
            )
            project_obj = project_res.scalar_one_or_none()
            if project_obj:
                from core.ai_key_manager import AiKeyManager
                resolved_key, _ = await AiKeyManager.resolve_key(project_obj, current_user, db)
        except ValueError as e:
            err = str(e)
            if err.startswith("QUOTA_EXCEEDED"):
                parts = err.split("|")
                used, limit, tier = parts[1], parts[2], parts[3]
                raise HTTPException(
                    status_code=429,
                    detail=f"Дневной лимит исчерпан ({used}/{limit} рерайтов на тарифе {tier}). Упгрейдите тариф или подождите до завтра.",
                )
            raise HTTPException(status_code=403, detail=err.split("|", 1)[-1])
        except RuntimeError as e:
            err = str(e)
            if "NO_PLATFORM_KEY" in err:
                # Фолбэк на дефолтный ключ из .env
                default_key = get_default_ai_key()
                if not default_key:
                    raise HTTPException(status_code=503, detail="AI-ключи не настроены. Добавьте ZAPRO_API_KEY или GEMINI_API_KEY в .env.")
                resolved_key = default_key
            else:
                raise HTTPException(status_code=503, detail=err.split("|", 1)[-1])

    # Фолбэк: если ключ не резолвился — берём дефолтный AI-ключ из .env
    if not resolved_key:
        default_key = get_default_ai_key()
        if not default_key:
            raise HTTPException(status_code=503, detail="AI API не настроен. Добавьте ZAPRO_API_KEY или GEMINI_API_KEY в .env.")
        resolved_key = default_key

    try:
        rewritten, tokens_used = await call_gemini_with_retry(
            text=req.text,
            prompt=req.prompt,
            system_prompt=req.system_prompt,
            mode=req.mode,
            api_key=resolved_key,
        )
        return {"rewritten_text": rewritten, "tokens_used": tokens_used}

    except AIRewriteError as e:
        logger.error(f"Gemini API rate limit/error after retries: {e}")
        raise HTTPException(status_code=503, detail="Gemini API перегружен. Пост отложен.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Gemini error: {error_msg}")
        if "API_KEY_INVALID" in error_msg or "invalid" in error_msg.lower():
            raise HTTPException(status_code=401, detail="Неверный API ключ")
        if "quota" in error_msg.lower() or "rate" in error_msg.lower() or "429" in error_msg:
            raise HTTPException(status_code=503, detail="Gemini API перегружен. Пост отложен.")
        if "SAFETY" in error_msg:
            raise HTTPException(status_code=422, detail="Gemini отклонил по политике безопасности")
        raise HTTPException(status_code=503, detail=f"Ошибка AI рерайта: {error_msg}")



@app.post("/api/ai/generate-prompt")
async def generate_prompt(data: dict):
    intent = (data.get("user_intent") or "").strip()
    if not intent:
        raise HTTPException(status_code=400, detail="Опишите желаемый стиль")
    generated = (
        f"Ты — профессиональный SMM-редактор Telegram-канала.\n"
        f"Твоя задача — переписывать входящие новости в стиле: {intent}.\n\n"
        f"Правила:\n"
        f"1. Сохраняй все факты, цифры и имена из оригинала.\n"
        f"2. Пиши структурировано, добавляй уместные эмодзи.\n"
        f"3. Удаляй внешние ссылки и упоминания чужих каналов.\n"
        f"4. Верни только готовый текст поста, без вступлений и кавычек."
    )
    return {"generated_system_prompt": generated}


@app.post("/api/ai/test-key")
async def test_own_ai_key(
    data: dict,
    current_user: User = Depends(get_current_user),
):
    """
    Проверяет работоспособность личного AI-ключа пользователя.
    Доступно только на тарифах Pro и Business.
    """
    allowed_tiers = {"pro", "business"}
    if current_user.subscription_tier not in allowed_tiers:
        raise HTTPException(status_code=403, detail="Личный AI ключ доступен только на тарифах Pro и Business")

    api_key = (data.get("api_key") or "").strip()
    provider = (data.get("provider") or "gemini").strip()

    if not api_key:
        raise HTTPException(status_code=400, detail="Укажите API ключ")

    try:
        rewritten, _ = await call_gemini_with_retry(
            text="Напиши одно слово: Привет",
            prompt="Ответь одним словом",
            system_prompt=None,
            mode="news",
            api_key=api_key,
        )
        return {"status": "ok", "message": "✅ Ключ работает!", "provider": provider}
    except AIRewriteError:
        raise HTTPException(status_code=429, detail="Ключ валиден, но API перегружен — попробуйте позже")
    except Exception as e:
        err = str(e)
        if "API_KEY_INVALID" in err or "invalid" in err.lower() or "400" in err:
            raise HTTPException(status_code=401, detail="❌ Ключ недействителен или неверный формат")
        raise HTTPException(status_code=503, detail=f"Ошибка проверки: {err}")


@app.get("/api/user/ai-limits")
async def get_user_ai_limits(current_user: User = Depends(get_current_user)):
    """Текущие лимиты рерайтов пользователя по тарифу."""
    from core.ai_key_manager import AiKeyManager
    return AiKeyManager.get_tier_info(
        current_user.subscription_tier,
        current_user.ai_rewrites_today or 0,
    )


# ============================================================
# Admin: управление ключами платформы
# ============================================================

class PlatformAiKeyRequest(BaseModel):
    provider: str                   # "gemini" | "openrouter"
    label: Optional[str] = None    # Название для UI
    api_key: str                    # plaintext — шифруем на сервере
    daily_limit: Optional[int] = None
    priority: int = 0


@app.post("/api/admin/ai-keys", status_code=201)
async def admin_add_ai_key(
    req: PlatformAiKeyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[ADMIN] Добавить ключ AI-провайдера в пул платформы."""
    _require_admin(current_user)

    from database.models import PlatformAiKey
    from core.crypto import encrypt

    encrypted = encrypt(req.api_key)
    prefix = req.api_key[:8] if len(req.api_key) >= 8 else req.api_key

    key = PlatformAiKey(
        provider=req.provider,
        label=req.label or f"{req.provider} #{prefix}",
        key_encrypted=encrypted,
        key_prefix=prefix,
        is_active=True,
        priority=req.priority,
        daily_limit=req.daily_limit,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)

    logger.info(f"Admin {current_user.id} added platform AI key: {prefix}... [{req.provider}]")
    return {
        "id": key.id,
        "provider": key.provider,
        "label": key.label,
        "prefix": key.key_prefix,
        "daily_limit": key.daily_limit,
        "priority": key.priority,
        "is_active": key.is_active,
        "created_at": key.created_at.isoformat(),
    }


@app.get("/api/admin/ai-keys")
async def admin_list_ai_keys(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[ADMIN] Список всех ключей платформы с метриками (без секретов)."""
    _require_admin(current_user)

    from database.models import PlatformAiKey
    result = await db.execute(
        select(PlatformAiKey).order_by(PlatformAiKey.priority.desc(), PlatformAiKey.created_at)
    )
    keys = result.scalars().all()
    return [
        {
            "id": k.id,
            "provider": k.provider,
            "label": k.label,
            "prefix": k.key_prefix,
            "is_active": k.is_active,
            "priority": k.priority,
            "daily_limit": k.daily_limit,
            "requests_today": k.requests_today,
            "last_error_at": k.last_error_at.isoformat() if k.last_error_at else None,
            "created_at": k.created_at.isoformat() if k.created_at else None,
        }
        for k in keys
    ]


@app.patch("/api/admin/ai-keys/{key_id}")
async def admin_update_ai_key(
    key_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[ADMIN] Активировать/деактивировать или изменить приоритет ключа."""
    _require_admin(current_user)

    from database.models import PlatformAiKey
    result = await db.execute(select(PlatformAiKey).where(PlatformAiKey.id == key_id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="Ключ не найден")

    allowed = {"is_active", "priority", "daily_limit", "label"}
    for field, value in data.items():
        if field in allowed:
            setattr(key, field, value)

    await db.commit()
    return {"status": "updated", "key_id": key_id}


@app.delete("/api/admin/ai-keys/{key_id}", status_code=204)
async def admin_delete_ai_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[ADMIN] Удалить ключ из пула платформы."""
    _require_admin(current_user)

    from database.models import PlatformAiKey
    result = await db.execute(select(PlatformAiKey).where(PlatformAiKey.id == key_id))
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="Ключ не найден")
    await db.delete(key)
    await db.commit()
    logger.info(f"Admin {current_user.id} deleted platform AI key {key_id}")


# ============================================================
# CRUD для проектов
# ============================================================

@app.post("/api/projects", status_code=201)
async def create_project(
    req: ProjectCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Создаёт проект + донора + связь ProjectDonor."""
    user_id = current_user.id

    # 1. Найти или создать донора
    donor_channel = req.donor_channel_id.strip()
    result = await db.execute(select(Donor).where(Donor.telegram_id == donor_channel))
    donor = result.scalar_one_or_none()

    if not donor:
        donor = Donor(telegram_id=donor_channel, username=donor_channel)
        db.add(donor)
        await db.flush()  # получить ID

    # Шифруем личный AI ключ если указан
    ai_api_key_encrypted = None
    if req.ai_api_key and req.ai_provider != "platform":
        allowed_tiers = {"pro", "business"}
        if current_user.subscription_tier not in allowed_tiers:
            raise HTTPException(status_code=403, detail="Личный AI ключ доступен только на тарифах Pro и Business")
        from core.crypto import encrypt
        ai_api_key_encrypted = encrypt(req.ai_api_key)

    # 2. Создать проект
    project = Project(
        id=str(uuid.uuid4()),
        user_id=user_id,
        name=req.name,
        target_channel_id=req.target_channel_id.strip(),
        rewrite_enabled=req.rewrite_enabled,
        rewrite_prompt=req.rewrite_prompt,
        remove_links=req.remove_links,
        use_original_on_error=req.use_original_on_error,
        duplicate_threshold=req.duplicate_threshold,
        check_interval=req.check_interval,
        ai_provider=req.ai_provider,
        ai_api_key_encrypted=ai_api_key_encrypted,
        pricing_enabled=req.pricing_enabled,
        pricing_wholesale_pct=req.pricing_wholesale_pct,
        pricing_drop_pct=req.pricing_drop_pct,
        pricing_retail_pct=req.pricing_retail_pct,
        pricing_currency=req.pricing_currency,
        is_active=False,
    )
    db.add(project)
    await db.flush()

    # 3. Связать проект с донором
    link = ProjectDonor(project_id=project.id, donor_id=donor.id)
    db.add(link)
    await db.commit()

    logger.info(f"Project created: {project.id} | donor: {donor_channel} | ai: {req.ai_provider}")
    return _project_to_dict(project, donor_channel)


@app.get("/api/projects")
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Возвращает проекты текущего пользователя (защита от IDOR)."""
    result = await db.execute(
        select(Project)
        .where(Project.user_id == current_user.id)
        .options(selectinload(Project.donors))
        .order_by(Project.created_at.desc())
    )
    projects = result.scalars().all()

    output = []
    for p in projects:
        donor_id = p.donors[0].telegram_id if p.donors else ""
        output.append(_project_to_dict(p, donor_id))
    return output


@app.get("/api/projects/{project_id}")
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Project)
        .where(and_(Project.id == project_id, Project.user_id == current_user.id))
        .options(selectinload(Project.donors))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")
    donor_id = project.donors[0].telegram_id if project.donors else ""
    return _project_to_dict(project, donor_id)


@app.put("/api/projects/{project_id}")
async def update_project(
    project_id: str,
    req: ProjectUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Project)
        .where(and_(Project.id == project_id, Project.user_id == current_user.id))
        .options(selectinload(Project.donors))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    # Обновляем только переданные поля
    update_fields = req.model_dump(exclude_none=True)

    # Обработка смены донора
    donor_channel_id = update_fields.pop("donor_channel_id", None)
    if donor_channel_id:
        donor_channel = donor_channel_id.strip()
        res = await db.execute(select(Donor).where(Donor.telegram_id == donor_channel))
        donor = res.scalar_one_or_none()
        if not donor:
            donor = Donor(telegram_id=donor_channel, username=donor_channel)
            db.add(donor)
            await db.flush()

        # Удаляем старые связи и создаём новую
        await db.execute(
            ProjectDonor.__table__.delete().where(ProjectDonor.project_id == project_id)
        )
        db.add(ProjectDonor(project_id=project_id, donor_id=donor.id))

    # Обработка личного AI ключа — шифруем перед сохранением
    raw_ai_key = update_fields.pop("ai_api_key", None)
    if raw_ai_key:
        new_provider = update_fields.get("ai_provider") or project.ai_provider
        if new_provider != "platform":
            allowed_tiers = {"pro", "business"}
            if current_user.subscription_tier not in allowed_tiers:
                raise HTTPException(status_code=403, detail="Личный AI ключ доступен только на тарифах Pro и Business")
            from core.crypto import encrypt
            project.ai_api_key_encrypted = encrypt(raw_ai_key)
    elif update_fields.get("ai_provider") == "platform":
        # Если переключились обратно на платформу — стираем личный ключ
        project.ai_api_key_encrypted = None

    for field, value in update_fields.items():
        if hasattr(project, field):
            setattr(project, field, value)

    from datetime import datetime
    project.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(project)

    # Если проект активен — перезапускаем listener с новыми донорами
    if project.is_active:
        await _restart_listeners()

    donor_id = project.donors[0].telegram_id if project.donors else (donor_channel_id or "")
    logger.info(f"Project updated: {project_id}")
    return _project_to_dict(project, donor_id)


@app.delete("/api/projects/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == current_user.id))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    # Останавливаем мониторинг если активен
    await _restart_listeners()

    await db.delete(project)
    await db.commit()
    logger.info(f"Project deleted: {project_id}")


@app.post("/api/projects/{project_id}/start")
async def start_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Включает автомониторинг проекта."""
    if not await user_clients.is_authorized(current_user):
        raise HTTPException(
            status_code=401,
            detail="Сначала авторизуйтесь в Telegram",
        )

    result = await db.execute(
        select(Project)
        .where(and_(Project.id == project_id, Project.user_id == current_user.id))
        .options(selectinload(Project.donors))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    project.is_active = True
    from datetime import datetime
    project.updated_at = datetime.utcnow()
    await db.commit()

    await _restart_listeners()

    logger.info(f"Project {project_id} monitoring started")
    return {"status": "started", "project_id": project_id}


@app.post("/api/projects/{project_id}/stop")
async def stop_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Останавливает автомониторинг проекта."""
    result = await db.execute(
        select(Project).where(and_(Project.id == project_id, Project.user_id == current_user.id))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")

    project.is_active = False
    from datetime import datetime
    project.updated_at = datetime.utcnow()
    await db.commit()

    await _restart_listeners()

    logger.info(f"Project {project_id} monitoring stopped")
    return {"status": "stopped", "project_id": project_id}


@app.get("/api/projects/{project_id}/logs")
async def get_project_logs(
    project_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Последние публикации проекта (только своего — защита от IDOR)."""
    # Сначала проверяем, что проект принадлежит текущему пользователю
    proj_check = await db.execute(
        select(Project.id).where(and_(Project.id == project_id, Project.user_id == current_user.id))
    )
    if not proj_check.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Проект не найден")

    result = await db.execute(
        select(Post)
        .where(Post.project_id == project_id)
        .order_by(Post.created_at.desc())
        .limit(limit)
    )
    posts = result.scalars().all()
    return [
        {
            "id": p.id,
            "status": p.status,
            "original_text": (p.original_text or "")[:200],
            "processed_text": (p.processed_text or "")[:300],
            "media_type": p.media_type,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in posts
    ]


# ============================================================
# API Keys — генерация, просмотр, ротация
# ============================================================

import hashlib
import secrets as _secrets
from database.models import ApiKey


class ApiKeyCreateRequest(BaseModel):
    name: str
    expires_days: Optional[int] = None  # None = бессрочный


@app.post("/api/keys", status_code=201)
async def create_api_key(
    req: ApiKeyCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Генерирует новый API-ключ для текущего пользователя.
    Возвращает ключ ОДИН РАЗ — потом только хэш хранится.
    """
    raw_key = f"mbai_{_secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:8]

    from datetime import timedelta
    expires_at = None
    if req.expires_days:
        expires_at = datetime.utcnow() + timedelta(days=req.expires_days)

    api_key = ApiKey(
        user_id=current_user.id,
        name=req.name,
        key_hash=key_hash,
        key_prefix=key_prefix,
        is_active=True,
        expires_at=expires_at,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    logger.info(f"API key created: {key_prefix}... for user {current_user.id}")
    return {
        "id": api_key.id,
        "name": api_key.name,
        "key": raw_key,          # ← показываем ТОЛЬКО один раз
        "prefix": key_prefix,
        "expires_at": api_key.expires_at.isoformat() if api_key.expires_at else None,
        "warning": "Сохраните ключ — повторно он показан не будет!",
    }


@app.get("/api/keys")
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Список API-ключей текущего пользователя (без секретов)."""
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.user_id == current_user.id)
        .order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()
    return [
        {
            "id": k.id,
            "name": k.name,
            "prefix": k.key_prefix,
            "is_active": k.is_active,
            "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
            "expires_at": k.expires_at.isoformat() if k.expires_at else None,
            "created_at": k.created_at.isoformat() if k.created_at else None,
        }
        for k in keys
    ]


@app.delete("/api/keys/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Отзывает (деактивирует) API-ключ. Только свой."""
    result = await db.execute(
        select(ApiKey).where(and_(ApiKey.id == key_id, ApiKey.user_id == current_user.id))
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="Ключ не найден")
    key.is_active = False
    await db.commit()
    logger.info(f"API key revoked: {key.key_prefix}... by user {current_user.id}")


# ============================================================
# Admin endpoints — только для is_admin=True
# ============================================================

def _require_admin(current_user: User):
    """Проверяет is_admin флаг, бросает 403 если нет."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Требуются права администратора")


@app.get("/api/admin/users")
async def admin_list_users(
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[ADMIN] Список всех пользователей платформы."""
    _require_admin(current_user)
    from database.models import User as UserModel
    result = await db.execute(
        select(UserModel).order_by(UserModel.created_at.desc()).limit(limit).offset(offset)
    )
    users = result.scalars().all()
    return [
        {
            "id": u.id,
            "phone_number": u.phone_number,
            "username": u.username,
            "full_name": u.full_name,
            "is_admin": u.is_admin,
            "is_active": u.is_active,
            "subscription_tier": u.subscription_tier,
            "total_posts_processed": u.total_posts_processed,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        }
        for u in users
    ]


@app.patch("/api/admin/users/{user_id}")
async def admin_update_user(
    user_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[ADMIN] Изменить подписку, статус или права пользователя."""
    _require_admin(current_user)
    from database.models import User as UserModel

    result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    allowed_fields = {"subscription_tier", "is_active", "is_admin", "subscription_expires_at"}
    for field, value in data.items():
        if field in allowed_fields and hasattr(target, field):
            setattr(target, field, value)

    await db.commit()
    await db.refresh(target)
    logger.info(f"Admin {current_user.id} updated user {user_id}: {data}")
    return {"status": "updated", "user_id": user_id}


@app.get("/api/admin/stats")
async def admin_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[ADMIN] Общая статистика платформы."""
    _require_admin(current_user)
    from sqlalchemy import func
    from database.models import User as UserModel

    total_users = (await db.execute(select(func.count()).select_from(UserModel))).scalar()
    total_projects = (await db.execute(select(func.count()).select_from(Project))).scalar()
    total_posts = (await db.execute(select(func.count()).select_from(Post))).scalar()
    active_monitors = (
        await db.execute(select(func.count()).select_from(Project).where(Project.is_active == True))
    ).scalar()

    return {
        "total_users": total_users,
        "total_projects": total_projects,
        "total_posts_processed": total_posts,
        "active_monitors_now": active_monitors,
    }


# ============================================================
# Артикулы и Бот Заказов — API Endpoints
# ============================================================

def extract_sizes_and_product_type(text: str, category_hint: str = "") -> tuple[dict, str]:
    """
    Автоматически извлекает размеры из текста поста донора
    и определяет тип товара: "shoes" (обувь) или "clothing" (одежда).
    """
    import re
    if not text:
        text = ""

    full_txt = (text + " " + (category_hint or "")).lower()

    shoe_keywords = ["обувь", "кроссовки", "кеды", "ботинки", "туфли", "слайды", "сникеры", "лоферы", "сапоги", "shoes", "sneakers", "nike", "adidas", "jordan", "puma", "reebok", "new balance"]
    clothing_keywords = ["одежда", "футболка", "худи", "свитшот", "штаны", "брюки", "куртка", "пальто", "джинсы", "шорты", "кофта", "платье", "костюм", "clothing", "t-shirt", "hoodie"]

    is_shoe = any(w in full_txt for w in shoe_keywords)
    is_clothing = any(w in full_txt for w in clothing_keywords)

    if is_shoe:
        product_type = "shoes"
    elif is_clothing:
        product_type = "clothing"
    else:
        product_type = "shoes" if re.search(r'\b(36|37|38|39|40|41|42|43|44|45|46)\b', text) else "clothing"

    parsed_sizes = {}
    if product_type == "shoes":
        found = re.findall(r'\b(3[5-9]|4[0-7])\b', text)
        if found:
            seen = set()
            for s in found:
                if s not in seen:
                    seen.add(s)
                    parsed_sizes[s] = 1
        else:
            parsed_sizes = {"40": 1, "41": 1, "42": 1, "43": 1, "44": 1, "45": 1}
    else:
        letter_found = re.findall(r'\b(XXS|XS|S|M|L|XL|XXL|3XL|4XL|46|48|50|52|54|56)\b', text, re.IGNORECASE)
        if letter_found:
            seen = set()
            for s in letter_found:
                sz = s.upper()
                if sz not in seen:
                    seen.add(sz)
                    parsed_sizes[sz] = 1
        else:
            parsed_sizes = {"S": 1, "M": 1, "L": 1, "XL": 1}

    return parsed_sizes, product_type


class ArticleCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    original_text: Optional[str] = None
    price: Optional[str] = None
    wholesale_price: Optional[str] = None
    drop_price: Optional[str] = None
    currency: Optional[str] = "₽"
    source_channel: Optional[str] = None
    target_channel: Optional[str] = None
    media_urls: List[str] = []
    category: Optional[str] = "Товар"
    product_type: Optional[str] = None    # "shoes" | "clothing"
    article_prefix: Optional[str] = "ART"
    telegram_post_url: Optional[str] = None
    source_msg_id: Optional[int] = None   # ID сообщения в канале-доноре

class ArticleStockUpdateRequest(BaseModel):
    stock: dict  # {"41": 3, "42": 5} или {"one_size": 10}

class OrderBotConfigRequest(BaseModel):
    bot_token: str
    bot_username: Optional[str] = None       # @username бота (если знаешь заранее)
    manager_chat_id: Optional[str] = None
    manager_username: Optional[str] = None
    welcome_message: Optional[str] = None
    article_prefix: Optional[str] = "ART"

class OrderStatusUpdateRequest(BaseModel):
    status: str  # new | confirmed | shipped | done | cancelled


async def _generate_article_code(db: AsyncSession, prefix: str = "ART") -> str:
    """Генерирует уникальный артикул вида ART-0001, ART-0002, ..."""
    result = await db.execute(
        select(ArticleItem).where(ArticleItem.article_code.like(f"{prefix}-%")).order_by(ArticleItem.created_at.desc())
    )
    existing = result.scalars().all()
    next_num = len(existing) + 1
    return f"{prefix}-{str(next_num).zfill(4)}"


@app.post("/api/articles")
async def create_article(req: ArticleCreateRequest, db: AsyncSession = Depends(get_db)):
    """Создать товар с уникальным артикулом при копировании поста."""
    article_code = await _generate_article_code(db, req.article_prefix or "ART")
    
    # Извлекаем имеющиеся в посте размеры и определяем тип товара (обувь / одежда)
    raw_text = (req.description or "") + " " + (req.original_text or "")
    auto_sizes, auto_type = extract_sizes_and_product_type(raw_text, req.category or "")

    final_product_type = req.product_type or auto_type
    final_stock = auto_sizes if auto_sizes else {"one_size": 1}

    article = ArticleItem(
        article_code=article_code,
        title=req.title or article_code,
        description=req.description,
        original_text=req.original_text,
        price=req.price,
        wholesale_price=req.wholesale_price,
        drop_price=req.drop_price,
        currency=req.currency or "₽",
        source_channel=req.source_channel,
        target_channel=req.target_channel,
        media_urls=req.media_urls,
        category=req.category or "Товар",
        product_type=final_product_type,
        stock=final_stock,
        telegram_post_url=req.telegram_post_url,
        source_msg_id=req.source_msg_id
    )
    db.add(article)
    await db.commit()
    await db.refresh(article)
    logger.info(f"Created article {article_code} | Type: {final_product_type} | Sizes: {list(final_stock.keys())}")
    # Получаем username бота из конфига (если настроен)
    bot_username_val = "YourOrderBot"
    try:
        from sqlalchemy import text as sa_text
        cfg_result = await db.execute(select(OrderBotConfig).limit(1))
        cfg = cfg_result.scalar_one_or_none()
        if cfg and cfg.bot_username:
            bot_username_val = cfg.bot_username.replace('@', '')
    except Exception:
        pass
    return {
        "status": "ok",
        "article_code": article_code,
        "article_id": article.id,
        "bot_deeplink": f"https://t.me/{bot_username_val}?start={article_code}"
    }


@app.get("/api/articles")
async def list_articles(db: AsyncSession = Depends(get_db)):
    """Получить список всех товаров-артикулов с ссылками на донора и целевой канал."""
    result = await db.execute(
        select(ArticleItem).order_by(ArticleItem.created_at.desc()).limit(200)
    )
    items = result.scalars().all()
    return {
        "status": "ok",
        "count": len(items),
        "articles": [
            {
                "id": a.id,
                "article_code": a.article_code,
                "title": a.title,
                "description": a.description,
                "price": a.price,
                "wholesale_price": a.wholesale_price,
                "drop_price": a.drop_price,
                "currency": a.currency,
                "source_channel": a.source_channel,
                "source_msg_id": a.source_msg_id,
                "target_channel": a.target_channel,
                "target_msg_id": a.target_msg_id,
                "donor_post_url": (
                    f"https://t.me/{a.source_channel.lstrip('@')}/{a.source_msg_id}"
                    if a.source_channel and a.source_msg_id
                    else (f"https://t.me/{a.source_channel.lstrip('@')}" if a.source_channel else None)
                ),
                "telegram_post_url": (
                    a.telegram_post_url
                    or (f"https://t.me/{a.target_channel.lstrip('@')}/{a.target_msg_id}" if a.target_channel and a.target_msg_id else None)
                ),
                "stock": a.stock or {},
                "category": a.category,
                "product_type": getattr(a, "product_type", "shoes") or "shoes",
                "is_active": a.is_active,
                "orders_count": a.orders_count,
                "media_urls": a.media_urls or [],
                "created_at": a.created_at.isoformat() if a.created_at else None
            }
            for a in items
        ]
    }


@app.put("/api/articles/{article_id}/stock")
async def update_article_stock(article_id: str, req: ArticleStockUpdateRequest, db: AsyncSession = Depends(get_db)):
    """Обновить остатки товара по размерам."""
    result = await db.execute(select(ArticleItem).where(ArticleItem.id == article_id))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    article.stock = req.stock
    await db.commit()
    return {"status": "ok", "article_code": article.article_code, "stock": article.stock}


@app.get("/api/get_album_msg_ids")
async def get_album_msg_ids(
    channel: Optional[str] = None,
    msg_id: Optional[int] = None,
    article_code: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Возвращает список ID всех сообщений альбома (всех фото) из Telegram-канала без скачивания медиа.
    Отрабатывает за 0.05 сек.
    """
    try:
        art_obj = None
        if article_code:
            res_art = await db.execute(select(ArticleItem).where(ArticleItem.article_code == article_code))
            art_obj = res_art.scalar_one_or_none()
            if art_obj:
                channel = channel or art_obj.target_channel or art_obj.source_channel
                msg_id = msg_id or art_obj.target_msg_id or art_obj.source_msg_id
                # Если в media_urls уже сохранён список ID отправленных сообщений альбома
                if art_obj.media_urls and isinstance(art_obj.media_urls, list) and len(art_obj.media_urls) > 0:
                    try:
                        cached_ids = [int(x) for x in art_obj.media_urls if str(x).isdigit()]
                        if cached_ids:
                            return {"msg_ids": cached_ids, "channel": channel}
                    except Exception:
                        pass

        if not channel or not msg_id:
            return {"msg_ids": [msg_id] if msg_id else []}

        clean_ch = channel.lstrip('@').strip()
        ch_entity = int(clean_ch) if clean_ch.lstrip('-').isdigit() else clean_ch

        if not tg_manager.client:
            return {"msg_ids": [msg_id]}

        # Получаем сообщения вокруг msg_id (±10) чтобы найти все фото одного альбома
        neighbor_ids = list(range(max(1, msg_id - 10), msg_id + 11))
        around_msgs_raw = await tg_manager.client.get_messages(ch_entity, ids=neighbor_ids)
        around_msgs = [m for m in around_msgs_raw if m is not None]

        src_msg = next((m for m in around_msgs if m.id == msg_id), None)
        if not src_msg:
            return {"msg_ids": [msg_id]}

        grouped_id = getattr(src_msg, "grouped_id", None)
        if grouped_id:
            album = [m for m in around_msgs if getattr(m, "grouped_id", None) == grouped_id]
            if album:
                album_ids = sorted([m.id for m in album])
                return {"msg_ids": album_ids, "channel": channel}

        return {"msg_ids": [msg_id], "channel": channel}
    except Exception as e:
        logger.error(f"[get_album_msg_ids] error: {e}")
        return {"msg_ids": [msg_id] if msg_id else []}


@app.get("/api/fetch_article_media")
async def fetch_article_media(
    channel: Optional[str] = None,
    msg_id: Optional[int] = None,
    article_code: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Скачивает фотографии товара из нашего канала или канала-донора.
    Если msg_id не известен, автоматически ищет пост по артикулу в канале.
    Возвращает список путей к временным файлам.
    """
    try:
        temp_dir = os.path.join(os.getcwd(), "temp_media", "bot_preview")
        os.makedirs(temp_dir, exist_ok=True)

        art_obj = None
        if article_code:
            res_art = await db.execute(select(ArticleItem).where(ArticleItem.article_code == article_code))
            art_obj = res_art.scalar_one_or_none()
            if art_obj:
                channel = channel or art_obj.target_channel or art_obj.source_channel
                msg_id = msg_id or art_obj.target_msg_id or art_obj.source_msg_id

        if not channel:
            return {"files": [], "detail": "channel not specified"}

        clean_ch = channel.lstrip('@').strip()
        ch_entity = int(clean_ch) if clean_ch.lstrip('-').isdigit() else clean_ch

        # Если msg_id не указан — ищем пост с этим артикулом в Telegram канале
        if (not msg_id or msg_id == 0) and article_code and tg_manager.client:
            try:
                search_res = await tg_manager.client.get_messages(ch_entity, search=article_code, limit=5)
                for sm in search_res:
                    if sm:
                        msg_id = sm.id
                        if art_obj:
                            art_obj.target_msg_id = sm.id
                            await db.commit()
                            logger.info(f"[fetch_article_media] Found and linked {article_code} to msg {sm.id} in {clean_ch}")
                        break
            except Exception as search_err:
                logger.warning(f"[fetch_article_media] Search for {article_code} in {clean_ch} failed: {search_err}")

        if not msg_id:
            return {"files": [], "detail": "msg_id not found"}

        # Получаем сообщения вокруг msg_id (±5) чтобы найти полный альбом
        neighbor_ids = list(range(max(1, msg_id - 5), msg_id + 6))
        around_msgs_raw = await tg_manager.client.get_messages(ch_entity, ids=neighbor_ids)
        around_msgs = [m for m in around_msgs_raw if m is not None]

        # Находим целевое сообщение
        src_msg = next((m for m in around_msgs if m.id == msg_id), None)

        # Если целевое без медиа — ищем соседнее с медиа
        if src_msg and not src_msg.media:
            for m in sorted(around_msgs, key=lambda x: abs(x.id - msg_id)):
                if m and m.media:
                    src_msg = m
                    break

        if not src_msg or not src_msg.media:
            return {"files": [], "detail": "no media found"}

        # Собираем альбом
        grouped_msgs = [src_msg]
        grouped_id = getattr(src_msg, "grouped_id", None)
        if grouped_id:
            album = [
                m for m in around_msgs
                if getattr(m, "grouped_id", None) == grouped_id and m.media
            ]
            if album:
                grouped_msgs = sorted(album, key=lambda m: m.id)

        # Скачиваем 1 главное фото для быстрого ответа бота
        file_paths = []
        for m in grouped_msgs[:1]:
            try:
                fp = await tg_manager.client.download_media(m, file=temp_dir)
                if fp and os.path.exists(fp):
                    file_paths.append(fp)
            except Exception as dl_err:
                logger.warning(f"[fetch_article_media] download failed: {dl_err}")

        return {"files": file_paths, "count": len(file_paths)}

    except Exception as e:
        logger.error(f"[fetch_article_media] error: {e}")
        return {"files": [], "detail": str(e)}


@app.get("/api/articles/{article_id}/image")
async def get_article_image(article_id: str, db: AsyncSession = Depends(get_db)):
    """
    Возвращает превью/фотографию товара по ID артикула.
    Кэширует фото на диске в temp_media/article_thumbs/{article_id}.jpg.
    """
    result = await db.execute(select(ArticleItem).where(ArticleItem.id == article_id))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    thumb_dir = os.path.join(os.getcwd(), "temp_media", "article_thumbs")
    os.makedirs(thumb_dir, exist_ok=True)
    cached_path = os.path.join(thumb_dir, f"{article.id}.jpg")

    if os.path.exists(cached_path) and os.path.getsize(cached_path) > 0:
        return FileResponse(cached_path, media_type="image/jpeg")

    # Если кэша нет, пробуем скачать фото из канала донора
    if article.source_channel and article.source_msg_id and await tg_manager.is_authorized():
        try:
            clean_ch = clean_channel_identifier(article.source_channel)
            neighbor_ids = list(range(max(1, article.source_msg_id - 5), article.source_msg_id + 6))
            around_msgs = await tg_manager.client.get_messages(clean_ch, ids=neighbor_ids)
            valid_msgs = [m for m in around_msgs if m is not None]

            src_msg = next((m for m in valid_msgs if m.id == article.source_msg_id), None)
            if src_msg and not src_msg.media:
                for m in sorted(valid_msgs, key=lambda x: abs(x.id - article.source_msg_id)):
                    if m and m.media:
                        src_msg = m
                        break

            if src_msg and src_msg.media:
                dl_path = await tg_manager.client.download_media(src_msg, file=cached_path)
                if dl_path and os.path.exists(dl_path):
                    return FileResponse(dl_path, media_type="image/jpeg")
        except Exception as e:
            logger.warning(f"Failed to download image for article {article.article_code}: {e}")

    raise HTTPException(status_code=404, detail="No image available for this article")


@app.get("/api/articles/code/{article_code}/image")
async def get_article_image_by_code(article_code: str, db: AsyncSession = Depends(get_db)):
    """Возвращает фотографию товара по артикулу (например ART-0001)."""
    norm_code = article_code.strip().upper().translate(str.maketrans("АВЕКМНОРСТУХ", "ABEKMHOPCTYX"))
    result = await db.execute(select(ArticleItem).where(ArticleItem.article_code == norm_code))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return await get_article_image(article.id, db)


@app.put("/api/articles/{article_id}/toggle")
async def toggle_article(article_id: str, db: AsyncSession = Depends(get_db)):
    """Активировать / деактивировать товар."""
    result = await db.execute(select(ArticleItem).where(ArticleItem.id == article_id))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    article.is_active = not article.is_active
    await db.commit()
    return {"status": "ok", "is_active": article.is_active}


@app.delete("/api/articles/{article_id}")
async def delete_article(article_id: str, db: AsyncSession = Depends(get_db)):
    """Удалить товар."""
    result = await db.execute(select(ArticleItem).where(ArticleItem.id == article_id))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    await db.delete(article)
    await db.commit()
    return {"status": "deleted"}


# ── Order Bot Config ──────────────────────────────────────────

@app.post("/api/orderbot/setup")
async def setup_order_bot(req: OrderBotConfigRequest, db: AsyncSession = Depends(get_db)):
    """Сохранить/обновить конфигурацию бота заказов.
    Автоматически запрашивает @username бота через Telegram Bot API.
    """
    import httpx as _httpx

    # Авто-определяем @username бота через Telegram Bot API
    resolved_username = req.bot_username or ""
    try:
        async with _httpx.AsyncClient(timeout=10) as hclient:
            tg_resp = await hclient.get(f"https://api.telegram.org/bot{req.bot_token}/getMe")
            if tg_resp.status_code == 200:
                tg_data = tg_resp.json()
                if tg_data.get("ok"):
                    resolved_username = tg_data["result"].get("username", resolved_username)
                    logger.info(f"[OrderBot] Resolved bot username: @{resolved_username}")
            else:
                logger.warning(f"[OrderBot] getMe failed: {tg_resp.text}")
    except Exception as e:
        logger.warning(f"[OrderBot] Could not resolve bot username: {e}")

    result = await db.execute(select(OrderBotConfig).limit(1))
    existing = result.scalar_one_or_none()
    if existing:
        existing.bot_token = req.bot_token
        existing.bot_username = resolved_username
        existing.manager_chat_id = req.manager_chat_id
        existing.manager_username = req.manager_username
        if req.welcome_message:
            existing.welcome_message = req.welcome_message
        existing.article_prefix = req.article_prefix or "ART"
        existing.is_active = True
        await db.commit()
    else:
        cfg = OrderBotConfig(
            bot_token=req.bot_token,
            bot_username=resolved_username,
            manager_chat_id=req.manager_chat_id,
            manager_username=req.manager_username,
            welcome_message=req.welcome_message or "Привет! Введите артикул товара для заказа (например: ART-0001)",
            article_prefix=req.article_prefix or "ART",
            is_active=True
        )
        db.add(cfg)
        await db.commit()
        await db.refresh(cfg)

    # Автоматически перезапускаем процесс бота заказов
    start_order_bot_subprocess()

    return {"status": "saved", "bot_username": resolved_username, "is_active": True}


@app.get("/api/orderbot/config")
async def get_order_bot_config(db: AsyncSession = Depends(get_db)):
    """Получить текущую конфигурацию бота заказов."""
    result = await db.execute(select(OrderBotConfig).limit(1))
    cfg = result.scalar_one_or_none()
    if not cfg:
        return {"status": "not_configured", "config": None}
    return {
        "status": "ok",
        "config": {
            "id": cfg.id,
            "bot_username": cfg.bot_username,
            "manager_chat_id": cfg.manager_chat_id,
            "manager_username": cfg.manager_username,
            "welcome_message": cfg.welcome_message,
            "article_prefix": cfg.article_prefix,
            "is_active": cfg.is_active
        }
    }


ORDER_BOT_PROCESS = None

def start_order_bot_subprocess():
    """Запускает или перезапускает фоновый процесс order_bot_handler.py."""
    global ORDER_BOT_PROCESS
    if ORDER_BOT_PROCESS is not None and ORDER_BOT_PROCESS.poll() is None:
        try:
            ORDER_BOT_PROCESS.terminate()
            ORDER_BOT_PROCESS.wait(timeout=2)
        except Exception:
            pass
    try:
        import sqlite3
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "editorial.db")
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            c.execute("SELECT bot_token, is_active FROM order_bot_configs LIMIT 1")
            row = c.fetchone()
            conn.close()
            if not row or not row[0] or not row[1]:
                logger.info("[OrderBot] No active bot token in DB yet.")
                return

        bot_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "order_bot_handler.py")
        ORDER_BOT_PROCESS = subprocess.Popen([sys.executable, bot_script])
        logger.info(f"[OrderBot] Started order bot background process (PID {ORDER_BOT_PROCESS.pid})")
    except Exception as e:
        logger.error(f"[OrderBot] Failed to spawn order bot: {e}")


@app.post("/api/orderbot/start")
async def start_order_bot(db: AsyncSession = Depends(get_db)):
    """Запустить Telegram-бота для приёма заказов."""
    result = await db.execute(select(OrderBotConfig).limit(1))
    cfg = result.scalar_one_or_none()
    if not cfg or not cfg.bot_token:
        raise HTTPException(status_code=400, detail="Order bot not configured. Call /api/orderbot/setup first.")
    cfg.is_active = True
    await db.commit()

    start_order_bot_subprocess()

    return {"status": "started", "message": "Order bot activated and running."}


@app.post("/api/orderbot/stop")
async def stop_order_bot(db: AsyncSession = Depends(get_db)):
    """Остановить бота заказов."""
    global ORDER_BOT_PROCESS
    result = await db.execute(select(OrderBotConfig).limit(1))
    cfg = result.scalar_one_or_none()
    if not cfg:
        raise HTTPException(status_code=400, detail="Bot not configured")
    cfg.is_active = False
    await db.commit()

    if ORDER_BOT_PROCESS and ORDER_BOT_PROCESS.poll() is None:
        try:
            ORDER_BOT_PROCESS.terminate()
            ORDER_BOT_PROCESS = None
            logger.info("[OrderBot] Stopped order bot process.")
        except Exception as e:
            logger.warning(f"[OrderBot] Could not stop bot process: {e}")

    return {"status": "stopped"}


# ── Orders ────────────────────────────────────────────────────

@app.get("/api/orders")
async def list_orders(db: AsyncSession = Depends(get_db)):
    """Получить все заказы."""
    result = await db.execute(
        select(Order).order_by(Order.created_at.desc()).limit(200)
    )
    orders = result.scalars().all()
    return {
        "status": "ok",
        "count": len(orders),
        "orders": [
            {
                "id": o.id,
                "article_code": o.article_code,
                "customer_name": o.customer_name,
                "customer_phone": o.customer_phone,
                "customer_username": o.customer_username,
                "selected_size": o.selected_size,
                "foot_size_cm": o.foot_size_cm,
                "height_weight": o.height_weight,
                "supplier_message": o.supplier_message,
                "quantity": o.quantity,
                "price_at_order": o.price_at_order,
                "comment": o.comment,
                "status": o.status,
                "created_at": o.created_at.isoformat() if o.created_at else None
            }
            for o in orders
        ]
    }


@app.put("/api/orders/{order_id}/status")
async def update_order_status(order_id: str, req: OrderStatusUpdateRequest, db: AsyncSession = Depends(get_db)):
    """Обновить статус заказа."""
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    valid_statuses = ["new", "confirmed", "shipped", "done", "cancelled"]
    if req.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Use: {valid_statuses}")
    order.status = req.status
    await db.commit()
    return {"status": "ok", "order_id": order_id, "new_status": req.status}


# ── Unified Activity History ──────────────────────────────────

@app.get("/api/activity/history")
async def get_activity_history(db: AsyncSession = Depends(get_db)):
    """
    Возвращает объединённую историю действий пользователя из базы данных:
    - Опубликованные товары и артикулы
    - Поступившие заказы
    - Обработанные посты
    """
    history_items = []

    # 1. Товарные артикулы
    res_articles = await db.execute(
        select(ArticleItem).order_by(ArticleItem.created_at.desc()).limit(100)
    )
    articles = res_articles.scalars().all()
    for a in articles:
        dt = a.created_at or datetime.utcnow()
        ch_info = f" в {a.target_channel}" if a.target_channel else ""
        price_info = f" • {a.price}" if a.price else ""
        history_items.append({
            "id": f"art-{a.id}",
            "action": f"📦 Опубликован товар {a.article_code}",
            "details": f"{a.title}{price_info}{ch_info}",
            "type": "success",
            "time": dt.strftime("%H:%M:%S"),
            "date": dt.strftime("%d.%m.%Y"),
            "timestamp": dt.timestamp()
        })

    # 2. Заказы покупателей
    res_orders = await db.execute(
        select(Order).order_by(Order.created_at.desc()).limit(50)
    )
    orders = res_orders.scalars().all()
    for o in orders:
        dt = o.created_at or datetime.utcnow()
        size_str = f", разм: {o.selected_size}" if o.selected_size else ""
        color_str = f", цвет: {o.selected_color}" if getattr(o, 'selected_color', None) else ""
        history_items.append({
            "id": f"ord-{o.id}",
            "action": f"🛍️ Заказ товара {o.article_code}",
            "details": f"Покупатель: {o.customer_name or 'Клиент'} ({o.customer_phone or 'тел. не указан'}{size_str}{color_str})",
            "type": "success",
            "time": dt.strftime("%H:%M:%S"),
            "date": dt.strftime("%d.%m.%Y"),
            "timestamp": dt.timestamp()
        })

    # 3. Опубликованные посты
    res_posts = await db.execute(
        select(Post).order_by(Post.created_at.desc()).limit(50)
    )
    posts = res_posts.scalars().all()
    for p in posts:
        dt = p.created_at or datetime.utcnow()
        status_type = "success" if p.status == "published" else ("error" if p.status == "failed" else "warning")
        action_name = "📝 Опубликован пост" if p.status == "published" else ("⚠️ Пропущен пост" if p.status == "duplicate" else "🤖 Обработан пост")
        details_text = p.summary or (p.processed_text[:90] + "..." if p.processed_text else "Пост обработан")
        history_items.append({
            "id": f"post-{p.id}",
            "action": action_name,
            "details": details_text,
            "type": status_type,
            "time": dt.strftime("%H:%M:%S"),
            "date": dt.strftime("%d.%m.%Y"),
            "timestamp": dt.timestamp()
        })

    # Сортируем по времени (свежие сверху)
    history_items.sort(key=lambda x: x.get("timestamp", 0), reverse=True)

    return {
        "status": "ok",
        "count": len(history_items),
        "history": history_items[:150]
    }


# ============================================================
# Telegram Mini App Sync API Endpoints
# ============================================================

class MiniAppPublishRequest(BaseModel):
    title: Optional[str] = "Новый товар/пост"
    text: str
    price: Optional[str] = None
    original_price: Optional[str] = None
    media_urls: List[str] = []
    source_channel: Optional[str] = None
    target_channel: Optional[str] = None
    category: Optional[str] = "Store"

@app.post("/api/miniapp/publish")
async def publish_to_miniapp(req: MiniAppPublishRequest, db: AsyncSession = Depends(get_db)):
    """Публикует переписанный пост/товар напрямую в БД Telegram Mini App."""
    from database.models import MiniAppPost
    new_item = MiniAppPost(
        title=req.title or (req.text[:40] + "..."),
        text=req.text,
        price=req.price,
        original_price=req.original_price,
        media_urls=req.media_urls,
        source_channel=req.source_channel,
        target_channel=req.target_channel,
        category=req.category or "Store"
    )
    db.add(new_item)
    await db.commit()
    await db.refresh(new_item)
    return {"status": "ok", "miniapp_post_id": new_item.id, "item": {
        "id": new_item.id,
        "title": new_item.title,
        "price": new_item.price,
        "text": new_item.text,
        "media_urls": new_item.media_urls,
        "published_at": new_item.published_at.isoformat() if new_item.published_at else None
    }}

@app.get("/api/miniapp/feed")
async def get_miniapp_feed(db: AsyncSession = Depends(get_db)):
    """Возвращает список товаров/постов для ленты Telegram Mini App."""
    from database.models import MiniAppPost
    result = await db.execute(select(MiniAppPost).order_by(MiniAppPost.published_at.desc()).limit(50))
    posts = result.scalars().all()
    return {
        "status": "ok",
        "count": len(posts),
        "feed": [
            {
                "id": p.id,
                "title": p.title,
                "text": p.text,
                "price": p.price,
                "original_price": p.original_price,
                "media_urls": p.media_urls or [],
                "source_channel": p.source_channel,
                "target_channel": p.target_channel,
                "category": p.category,
                "views_count": p.views_count,
                "published_at": p.published_at.isoformat() if p.published_at else None
            }
            for p in posts
        ]
    }

@app.delete("/api/miniapp/feed/{post_id}")
async def delete_miniapp_post(post_id: str, db: AsyncSession = Depends(get_db)):
    """Удаляет пост из Mini App."""
    from database.models import MiniAppPost
    result = await db.execute(select(MiniAppPost).where(MiniAppPost.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    await db.delete(post)
    await db.commit()
    return {"status": "deleted", "id": post_id}


# ============================================================
# Внутренняя функция: перезапуск listener
# ============================================================

async def _restart_listeners():
    """
    Читает все активные проекты из БД, группирует их по владельцам (user_id)
    и регистрирует event handlers на КЛИЕНТЕ КАЖДОГО пользователя.
    Пользователи больше не делят один Telegram-аккаунт.
    Безопасно вызывать многократно — каждый раз очищает старые handlers.
    """
    from database.session import async_session
    from telegram_service.listener import register_listeners
    from core.brain import brain  # noqa: F401 (импорт нужен для регистрации pipeline)

    async with async_session() as session:
        result = await session.execute(
            select(Project)
            .where(Project.is_active == True)
            .options(selectinload(Project.donors))
        )
        active_projects = result.scalars().all()

    if not active_projects:
        logger.info("No active projects — listener not started.")
        return

    # Группируем каналы-доноры по владельцу проекта
    by_user: dict = {}
    for project in active_projects:
        channels = by_user.setdefault(project.user_id, [])
        for donor in project.donors:
            if donor.telegram_id not in channels:
                channels.append(donor.telegram_id)

    from database.models import User as UserModel

    for user_id, donor_channels in by_user.items():
        try:
            async with async_session() as s:
                u_res = await s.execute(select(UserModel).where(UserModel.id == user_id))
                user = u_res.scalar_one_or_none()
            if not user:
                logger.warning(f"[Listeners] Project owner {user_id} not found in DB — skip")
                continue
            try:
                client = await user_clients.get_client(user)
            except ValueError as e:
                logger.warning(f"[Listeners] No Telegram session for user {user_id}: {e}")
                continue

            # Очищаем старые handlers ТОЛЬКО этого клиента и ставим новые
            try:
                for handler, _ in list(client.list_event_handlers()):
                    client.remove_event_handler(handler)
            except Exception as e:
                logger.warning(f"[Listeners] Could not clear handlers for user {user_id}: {e}")
            register_listeners(client, chat_ids=donor_channels)
            logger.info(
                f"[Listeners] Registered {len(donor_channels)} donor(s) for user {user_id}"
            )
        except Exception as e:
            logger.error(f"[Listeners] Failed to register for user {user_id}: {e}")


# ============================================================
# Точка входа
# ============================================================

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
