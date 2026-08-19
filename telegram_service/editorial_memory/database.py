"""
editorial_memory/database.py

Слой дедупликации постов.

Поддерживает два режима:
  - SQLite (dev, по умолчанию): нет дополнительных зависимостей
  - PostgreSQL (prod): раскомментировать asyncpg в requirements.txt

Переменная окружения: EDITORIAL_DB_URL
  SQLite:     sqlite+aiosqlite:///./editorial.db  (default)
  PostgreSQL: postgresql+asyncpg://user:pass@host:5432/dbname

ИЗМЕНЕНИЯ vs оригинал:
  - Убран module-level `db = EditorialDB()` (вызывал crash при старте)
  - Убран синхронный psycopg2 (блокировал async event loop FastAPI)
  - Добавлен lazy init через get_editorial_db()
  - Реализован fallback SQLite → PostgreSQL через SQLAlchemy async
  - INSERT ON CONFLICT работает на обоих движках (SQL совместимость)
"""

import os
import json
import logging
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------
# URL базы данных: SQLite по умолчанию, PostgreSQL в prod
# ---------------------------------------------------------
EDITORIAL_DB_URL: str = os.getenv(
    "EDITORIAL_DB_URL",
    "sqlite+aiosqlite:///./editorial.db",
)

_IS_SQLITE = EDITORIAL_DB_URL.startswith("sqlite")

# DDL под SQLite (нет UUID-функций, нет TEXT[], нет JSONB)
_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS editorial_posts (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    media_hashes TEXT,    -- JSON-строка вместо TEXT[]
    source_url  TEXT,
    status      TEXT NOT NULL DEFAULT 'new',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_ep_project_time
    ON editorial_posts (project_id, created_at);
"""

# DDL под PostgreSQL (нативные типы)
_DDL_POSTGRES = """
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE IF NOT EXISTS editorial_posts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id  UUID NOT NULL,
    user_id     UUID NOT NULL,
    content_hash TEXT NOT NULL,
    media_hashes TEXT[],
    source_url  TEXT,
    status      TEXT NOT NULL DEFAULT 'new',
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (project_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_ep_project_time
    ON editorial_posts (project_id, created_at);
"""


class EditorialDB:
    """
    Async-безопасный слой дедупликации постов.
    Инициализируется лениво через get_editorial_db(), а не при импорте.
    """

    def __init__(self, engine: AsyncEngine):
        self._engine = engine
        self._initialized = False

    async def _ensure_schema(self):
        """Создаёт таблицы при первом использовании (lazy DDL)."""
        if self._initialized:
            return
        ddl = _DDL_SQLITE if _IS_SQLITE else _DDL_POSTGRES
        async with self._engine.begin() as conn:
            # Для SQLite выполняем каждый statement отдельно
            for statement in ddl.strip().split(";"):
                stmt = statement.strip()
                if stmt:
                    await conn.execute(text(stmt))
        self._initialized = True
        logger.info(
            f"EditorialDB schema ready "
            f"({'SQLite' if _IS_SQLITE else 'PostgreSQL'})"
        )

    async def insert_if_new(
        self,
        project_id: str,
        user_id: str,
        content_hash: str,
        media_hashes: Optional[list] = None,
        source_url: Optional[str] = None,
    ) -> Optional[str]:
        """
        Атомарная вставка поста.
        Возвращает строковый UUID если пост новый, None если дубликат.
        """
        await self._ensure_schema()

        new_id = str(uuid.uuid4())

        if _IS_SQLITE:
            # SQLite: media_hashes сериализуем в JSON-строку
            media_json = json.dumps(media_hashes or [])
            query = text("""
                INSERT OR IGNORE INTO editorial_posts
                    (id, project_id, user_id, content_hash, media_hashes, source_url, status)
                VALUES
                    (:id, :project_id, :user_id, :content_hash, :media_hashes, :source_url, 'new')
            """)
            params = {
                "id": new_id,
                "project_id": project_id,
                "user_id": user_id,
                "content_hash": content_hash,
                "media_hashes": media_json,
                "source_url": source_url,
            }
        else:
            # PostgreSQL: ON CONFLICT DO NOTHING RETURNING id
            query = text("""
                INSERT INTO editorial_posts
                    (project_id, user_id, content_hash, media_hashes, source_url, status)
                VALUES
                    (:project_id, :user_id, :content_hash, :media_hashes, :source_url, 'new')
                ON CONFLICT (project_id, content_hash) DO NOTHING
                RETURNING id::text
            """)
            params = {
                "project_id": project_id,
                "user_id": user_id,
                "content_hash": content_hash,
                "media_hashes": media_hashes or [],
                "source_url": source_url,
            }

        try:
            async with self._engine.begin() as conn:
                result = await conn.execute(query, params)

                if _IS_SQLITE:
                    # INSERT OR IGNORE: проверяем по rowcount
                    if result.rowcount > 0:
                        return new_id
                    return None  # дубликат
                else:
                    row = result.fetchone()
                    return row[0] if row else None  # дубликат если None

        except Exception as e:
            logger.error(f"EditorialDB insert error: {e}")
            return None


# ---------------------------------------------------------
# Singleton с lazy initialization
# ---------------------------------------------------------
_db_instance: Optional[EditorialDB] = None


async def get_editorial_db() -> EditorialDB:
    """
    Возвращает singleton EditorialDB.
    Создаёт движок и инициализирует схему при первом вызове.
    Безопасно для async: не блокирует event loop при старте сервера.
    """
    global _db_instance
    if _db_instance is None:
        logger.info(f"Initializing EditorialDB: {EDITORIAL_DB_URL}")
        try:
            engine = create_async_engine(
                EDITORIAL_DB_URL,
                echo=False,
                # Для SQLite: без pool (файловая БД)
                **({"connect_args": {"check_same_thread": False}} if _IS_SQLITE else {}),
            )
            _db_instance = EditorialDB(engine)
            await _db_instance._ensure_schema()
        except Exception as e:
            logger.error(
                f"Failed to initialize EditorialDB ({EDITORIAL_DB_URL}): {e}\n"
                f"Дедупликация отключена до следующего запроса."
            )
            raise

    return _db_instance
