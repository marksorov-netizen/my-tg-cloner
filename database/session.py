"""
database/session.py

Async SQLAlchemy engine + session factory.
Управление БД и авторизацией пользователей SaaS.
"""

import os
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select, or_
from dotenv import load_dotenv

load_dotenv()

# Ленивый импорт crypto — не падаем при отсутствии ENCRYPTION_KEY в тестах
def _try_encrypt(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    try:
        from core.crypto import encrypt
        return encrypt(value)
    except Exception:
        return value  # fallback: хранить plaintext если ключ не задан

def _try_decrypt(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    try:
        from core.crypto import safe_decrypt
        return safe_decrypt(value, fallback=value)
    except Exception:
        return value

# SQLite по умолчанию (dev), PostgreSQL для prod
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./editorial.db")

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_async_engine(DATABASE_URL, echo=False, connect_args=connect_args)

# SQLite под конкурентной нагрузкой: WAL вместо journal + таймаут на блокировки.
# Без этого одновременные записи дают "database is locked" и потери заказов.
if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy import event

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

async_session = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def init_db():
    """Создаёт все таблицы и автоматически добавляет отсутствующие колонки при обновлении."""
    from .models import Base
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for alter_sql in [
            "ALTER TABLE orders ADD COLUMN foot_size_cm TEXT;",
            "ALTER TABLE orders ADD COLUMN height_weight TEXT;",
            "ALTER TABLE orders ADD COLUMN supplier_message TEXT;",
            "ALTER TABLE article_items ADD COLUMN product_type TEXT;",
        ]:
            try:
                await conn.execute(text(alter_sql))
            except Exception:
                pass  # Колонка уже существует


async def _is_first_user(session: AsyncSession) -> bool:
    """Возвращает True если таблица users пустая — первый зарегистрированный получает is_admin=True."""
    from .models import User
    from sqlalchemy import func
    result = await session.execute(select(func.count()).select_from(User))
    count = result.scalar()
    return count == 0


async def get_or_create_user(
    phone_number: str,
    telegram_user_id: Optional[int] = None,
    username: Optional[str] = None,
    full_name: Optional[str] = None,
    tg_session_string: Optional[str] = None,
    tg_api_id: Optional[int] = None,
    tg_api_hash: Optional[str] = None,
) -> "User":
    """
    Находит или создаёт пользователя в БД по номеру телефона / telegram_user_id.
    Обновляет время последнего входа (last_login_at) и данные сессии.
    """
    from .models import User

    clean_phone = (phone_number or "").strip()

    async with async_session() as session:
        # Ищем по номеру телефона или по telegram_user_id
        conditions = [User.phone_number == clean_phone]
        if telegram_user_id:
            conditions.append(User.telegram_user_id == telegram_user_id)

        result = await session.execute(
            select(User).where(or_(*conditions))
        )
        user = result.scalar_one_or_none()

        now = datetime.utcnow()

        if not user:
            # Создаём нового пользователя
            user = User(
                id=str(uuid.uuid4()),
                phone_number=clean_phone,
                telegram_user_id=telegram_user_id,
                username=username,
                full_name=full_name,
                is_admin=await _is_first_user(session),  # первый = автоматически админ
                is_active=True,
                subscription_tier="free",
                created_at=now,
                last_login_at=now,
                tg_api_id=tg_api_id,
                tg_api_hash_encrypted=_try_encrypt(tg_api_hash),
                tg_session_string=_try_encrypt(tg_session_string),
            )
            session.add(user)
        else:
            # Обновляем существующего
            user.last_login_at = now
            if telegram_user_id:
                user.telegram_user_id = telegram_user_id
            if username:
                user.username = username
            if full_name:
                user.full_name = full_name
            if tg_session_string:
                user.tg_session_string = _try_encrypt(tg_session_string)
            if tg_api_id:
                user.tg_api_id = tg_api_id
            if tg_api_hash:
                user.tg_api_hash_encrypted = _try_encrypt(tg_api_hash)

        await session.commit()
        await session.refresh(user)
        return user


async def get_active_user(phone_number: Optional[str] = None) -> Optional["User"]:
    """
    Возвращает текущего активного пользователя.
    Если phone_number не передан, берёт последнего вошедшего пользователя.
    """
    from .models import User

    async with async_session() as session:
        if phone_number:
            res = await session.execute(
                select(User).where(User.phone_number == phone_number.strip())
            )
            return res.scalar_one_or_none()

        # Берём последнего вошедшего
        res = await session.execute(
            select(User).where(User.is_active == True).order_by(User.last_login_at.desc()).limit(1)
        )
        return res.scalar_one_or_none()


async def get_system_user_id() -> str:
    """Хелпер для получения ID активного пользователя (совместимость)."""
    user = await get_active_user()
    if user:
        return user.id
    # Если пользователей ещё нет, создаём дефолтного
    user = await get_or_create_user(phone_number="+70000000000")
    return user.id


async def get_db():
    """Dependency для FastAPI endpoints."""
    async with async_session() as session:
        yield session
