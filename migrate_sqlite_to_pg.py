"""
migrate_sqlite_to_pg.py — разовый перенос данных из SQLite (editorial.db) в PostgreSQL.

Зачем: docker-compose поднимает прод с PostgreSQL, а все накопленные данные
(пользователи, проекты, товары, заказы, конфиг бота) лежат в dev-SQLite.

Что делает:
  1. Создаёт таблицы в PostgreSQL по ORM-моделям (если их ещё нет)
  2. Копирует строки таблицами в порядке зависимостей (родители → дети)
  3. Идемпотентно: конфликт первичного ключа = пропуск (ON CONFLICT DO NOTHING),
     повторный запуск не создаёт дублей
  4. Чинит sequence для donors.id (autoincrement) после прямой вставки
  5. Ничего не удаляет и не меняет в исходном SQLite

Использование:
  python migrate_sqlite_to_pg.py --dry-run                  # показать, что перенесётся
  python migrate_sqlite_to_pg.py                            # перенос
  python migrate_sqlite_to_pg.py --database-url postgresql+psycopg2://user:pass@localhost:5432/ghostpost

DATABASE_URL берётся из .env / окружения; +asyncpg автоматически заменяется на +psycopg2
(миграция синхронная). Порядок таблиц важен — не менять без проверки FK.
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime

from dotenv import load_dotenv
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.types import JSON as SAJSON, DateTime as SADateTime

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("migrate")

# Порядок важен: сначала родители, потом ссылающиеся на них таблицы (FK)
TABLE_ORDER = [
    "users",
    "projects",
    "donors",
    "project_donors",
    "posts",
    "api_keys",
    "platform_ai_keys",
    "miniapp_posts",
    "article_items",
    "order_bot_configs",
    "orders",
]

BATCH_SIZE = 500


def normalize_db_url(url: str) -> str:
    """Миграция синхронная — asyncpg не годится, меняем на psycopg2."""
    return url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")


def get_tables_metadata(base_metadata):
    """Отображение имя_таблицы → Table из метаданных ORM-моделей."""
    return {name: base_metadata.tables[name] for name in TABLE_ORDER if name in base_metadata.tables}


def coerce_row_values(row: dict, table):
    """
    Приводит значения из raw-SQLite к типам целевых колонок:
      - JSON: SQLite отдаёт текст → парсим в объект, иначе PG сохранит
        его как СТРОКУ и приложение получит str вместо dict/list
      - DateTime: SQLite отдаёт строку → datetime
    """
    result = dict(row)
    for col in table.columns:
        if col.name not in result or result[col.name] is None:
            continue
        value = result[col.name]
        if isinstance(col.type, SAJSON) and isinstance(value, str):
            try:
                result[col.name] = json.loads(value)
            except (ValueError, TypeError):
                logger.warning(f"[{table.name}] колонка {col.name}: не JSON ('{value[:50]}...'), оставлено как есть")
        elif isinstance(col.type, SADateTime) and isinstance(value, str):
            try:
                result[col.name] = datetime.fromisoformat(value)
            except ValueError:
                pass
    return result


def main():
    parser = argparse.ArgumentParser(description="Перенос данных SQLite → PostgreSQL")
    parser.add_argument("--sqlite", default=os.path.join(os.path.dirname(__file__), "editorial.db"),
                        help="Путь к исходному SQLite (по умолчанию ./editorial.db)")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", ""),
                        help="URL PostgreSQL (по умолчанию DATABASE_URL из .env)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Только показать счётчики, ничего не записывать")
    args = parser.parse_args()

    if not args.dry_run:
        if not args.database_url:
            logger.error("❌ Не указан PostgreSQL URL (--database-url или DATABASE_URL в .env)")
            sys.exit(1)
        if args.database_url.startswith("sqlite"):
            logger.error("❌ DATABASE_URL указывает на SQLite — для миграции нужен PostgreSQL URL")
            sys.exit(1)
    if not os.path.exists(args.sqlite):
        logger.error(f"❌ SQLite файл не найден: {args.sqlite}")
        sys.exit(1)

    # ── ORM-метаданные (те же модели, что и в приложении) ──────
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from database.models import Base
    tables = get_tables_metadata(Base.metadata)

    sqlite_engine = create_engine(f"sqlite:///{args.sqlite}")

    # ── Читаем SQLite ──────────────────────────────────────────
    src_inspect = inspect(sqlite_engine)
    src_tables = set(src_inspect.get_table_names())

    plan = {}
    for name in TABLE_ORDER:
        if name not in tables:
            logger.warning(f"Таблица {name} отсутствует в ORM-моделях — пропущена")
            continue
        if name not in src_tables:
            logger.info(f"[{name}] нет в исходной базе — пропущена")
            plan[name] = []
            continue
        with sqlite_engine.connect() as conn:
            rows = conn.execute(text(f"SELECT * FROM {name}")).mappings().all()
        table = tables[name]
        plan[name] = [coerce_row_values(dict(r), table) for r in rows]
        logger.info(f"[{name}] прочитано строк: {len(plan[name])}")

    total = sum(len(v) for v in plan.values())
    logger.info(f"Итого к переносу: {total} строк из {sum(1 for v in plan.values() if v)} таблиц(ы)")

    if args.dry_run:
        logger.info("DRY RUN — запись не выполнялась.")
        return

    # ── Пишем в PostgreSQL ─────────────────────────────────────
    pg_engine = create_engine(normalize_db_url(args.database_url), pool_pre_ping=True)

    # 1. Таблицы (create_all идемпотентен)
    Base.metadata.create_all(pg_engine)
    logger.info("Таблицы в PostgreSQL созданы/проверены")

    inserted_total = 0
    skipped_total = 0
    with pg_engine.begin() as pg_conn:
        for name in TABLE_ORDER:
            rows = plan.get(name)
            if not rows:
                continue
            table = tables[name]

            # Только колонки, существующие в целевой таблице (на случай расширения схемы)
            pg_columns = {c["name"] for c in inspect(pg_conn).get_columns(name)}
            for i in range(0, len(rows), BATCH_SIZE):
                batch = rows[i:i + BATCH_SIZE]
                values = [{k: v for k, v in row.items() if k in pg_columns} for row in batch]
                stmt = pg_insert(table).values(values)
                stmt = stmt.on_conflict_do_nothing()
                result = pg_conn.execute(stmt)
                inserted = result.rowcount
                inserted_total += max(inserted, 0)
                skipped_total += len(batch) - max(inserted, 0)
            logger.info(f"[{name}] вставлено (новое): {len(rows)} → обработано, конфликты пропущены")

    # 2. Sequence для autoincrement-таблиц (иначе следующий INSERT в donors упадёт с duplicate key)
    with pg_engine.begin() as pg_conn:
        for name in TABLE_ORDER:
            if name == "donors" and plan.get("donors"):
                pg_conn.execute(text("SELECT setval('donors_id_seq', COALESCE((SELECT MAX(id) FROM donors), 1))"))
                logger.info("[donors] sequence выставлен на MAX(id)")

    logger.info("=" * 50)
    logger.info(f"✅ Миграция завершена. Новых строк: {inserted_total}, пропущено дубликатов: {skipped_total}")
    logger.info("   Исходный SQLite не изменён.")
    sqlite_engine.dispose()
    pg_engine.dispose()


if __name__ == "__main__":
    main()
