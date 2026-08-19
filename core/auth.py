"""
core/auth.py

JWT авторизация через httpOnly cookies.

Схема работы:
  POST /auth/login  → sign_in() → выдаёт JWT → пишет в httpOnly cookie "access_token"
  GET  /api/*       → FastAPI Depends(get_current_user) → читает cookie → валидирует JWT → User

Конфигурация .env:
    JWT_SECRET_KEY  — 32+ байт случайного hex (secrets.token_hex(32))
    JWT_ALGORITHM   — HS256 (по умолчанию)
    JWT_EXPIRE_DAYS — срок жизни токена в днях (по умолчанию 30)

Токен НЕ передаётся в JS-коде — только в httpOnly Set-Cookie заголовке.
"""

import os
import logging
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from fastapi import Cookie, HTTPException, status
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "")
JWT_ALGORITHM: str  = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_DAYS: int = int(os.getenv("JWT_EXPIRE_DAYS", "30"))

# Предупреждение при запуске без секрета (dev-режим)
if not JWT_SECRET_KEY:
    import secrets
    JWT_SECRET_KEY = secrets.token_hex(32)   # ephemeral — не выжить перезапуску
    logger.warning(
        "[auth] JWT_SECRET_KEY не задан в .env — используется временный ключ. "
        "Все сессии сбросятся при перезапуске. Добавьте JWT_SECRET_KEY в .env!"
    )

COOKIE_NAME = "access_token"
COOKIE_MAX_AGE = JWT_EXPIRE_DAYS * 24 * 3600  # секунды


# ── Token generation ─────────────────────────────────────────────────────────

def create_access_token(user_id: str, phone: str) -> str:
    """Создаёт подписанный JWT с полезной нагрузкой {sub, phone, exp}."""
    expire = datetime.utcnow() + timedelta(days=JWT_EXPIRE_DAYS)
    payload = {
        "sub": user_id,
        "phone": phone,
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


# ── Token verification ────────────────────────────────────────────────────────

def _decode_token(token: str) -> dict:
    """Декодирует и валидирует JWT. Бросает HTTPException 401 при ошибке."""
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Невалидный или просроченный токен: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── FastAPI dependency ────────────────────────────────────────────────────────

async def get_current_user(access_token: Optional[str] = Cookie(default=None)):
    """
    FastAPI dependency: читает httpOnly cookie, декодирует JWT,
    возвращает User из БД.

    Использование в endpoint:
        @app.get("/api/projects")
        async def list_projects(current_user = Depends(get_current_user)):
            ...
    """
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Необходима авторизация (cookie отсутствует)",
        )

    payload = _decode_token(access_token)
    user_id: Optional[str] = payload.get("sub")

    if not user_id:
        raise HTTPException(status_code=401, detail="Невалидный токен: отсутствует sub")

    from database.session import async_session
    from database.models import User
    from sqlalchemy import select

    async with async_session() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Пользователь не найден или деактивирован")

    return user


async def get_current_admin(current_user=None):
    """
    Dependency для admin-only endpoints.
    Вызывать как: Depends(get_current_admin)
    """
    # NOTE: FastAPI не поддерживает вложенные Depends напрямую в аргументах,
    # поэтому get_current_admin вызывает get_current_user через Cookie вручную.
    # В route лучше использовать:
    #   user = Depends(get_current_user); if not user.is_admin: raise 403
    from fastapi import Cookie as FCookie

    async def _inner(access_token: Optional[str] = FCookie(default=None)):
        user = await get_current_user(access_token)
        if not user.is_admin:
            raise HTTPException(status_code=403, detail="Требуются права администратора")
        return user
    return _inner
