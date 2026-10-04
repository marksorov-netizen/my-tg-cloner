"""Idempotent schema upgrade for PIN hashes and order status (SQLite/PostgreSQL)."""
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import inspect, text
from core.pin_auth import hash_pin


def backup_sqlite_before_upgrade(database: str | None) -> Path | None:
    if not database or database == ":memory:":
        return None
    source = Path(database).resolve()
    if not source.is_file():
        return None
    with closing(sqlite3.connect(str(source))) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        needs_upgrade = any(
            table in tables and column not in {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
            for table, column in (("users", "pin_hash"), ("orders", "status"))
        )
        if not needs_upgrade:
            return None
        folder = source.parent / "backups"
        folder.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        target = folder / f"{source.stem}-before-auth-orders-{stamp}-{uuid4().hex[:8]}.db"
        with closing(sqlite3.connect(str(target))) as destination:
            connection.backup(destination)
        return target


def upgrade_auth_orders(connection):
    """Run inside a transaction; errors must stop startup instead of being ignored."""
    inspector = inspect(connection)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    order_columns = {column["name"] for column in inspector.get_columns("orders")}
    if "pin_hash" not in user_columns:
        connection.execute(text("ALTER TABLE users ADD COLUMN pin_hash TEXT"))
    if "status" not in order_columns:
        connection.execute(text("ALTER TABLE orders ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'new'"))
    connection.execute(text("UPDATE orders SET status = 'new' WHERE status IS NULL OR status = ''"))
    if "pin_code" in user_columns:
        rows = connection.execute(text("SELECT id, pin_code, pin_hash FROM users WHERE pin_code IS NOT NULL")).all()
        for user_id, legacy_pin, stored_hash in rows:
            # The shared default is deliberately disabled. Personal legacy PINs keep working.
            migrated = stored_hash or (hash_pin(legacy_pin) if legacy_pin and legacy_pin != "1234" else None)
            connection.execute(
                text("UPDATE users SET pin_hash = :pin_hash, pin_code = NULL WHERE id = :id"),
                {"id": user_id, "pin_hash": migrated},
            )
