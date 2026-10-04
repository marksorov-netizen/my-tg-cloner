r"""Offline regressions. Uses temporary databases; never starts Telegram or app lifespan.

Run: .venv\Scripts\python.exe -m unittest test_auth_orders -v
"""
import ast
import asyncio
import logging
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from typing import Optional
from unittest.mock import AsyncMock, patch

_temporary = tempfile.TemporaryDirectory(prefix="clonner-auth-orders-")
_database = Path(_temporary.name) / "regressions.db"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///" + _database.as_posix()
os.environ["EDITORIAL_DB_URL"] = os.environ["DATABASE_URL"]
os.environ["JWT_SECRET_KEY"] = "offline-regression-key-not-for-production"
os.environ["TRUST_PROXY_HEADERS"] = "false"

import httpx
from sqlalchemy import create_engine, delete, select, text
from sqlalchemy.orm import Session
from database.models import Base, User, ArticleItem, Order, UserImageSettings
from database.session import engine, init_db, async_session
from database.migrations import backup_sqlite_before_upgrade, upgrade_auth_orders
from core.pin_auth import hash_pin, verify_pin, normalize_phone
from core.auth import create_access_token
import server
logging.getLogger("httpx").setLevel(logging.WARNING)


class AuthOrderTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        asyncio.get_running_loop().set_debug(False)
        await init_db()
        server._RATE_BUCKETS.clear()
        server.task_managers._managers.clear()
        async with async_session() as db:
            for model in (UserImageSettings, Order, ArticleItem, User):
                await db.execute(delete(model))
            self.user = User(id="test-user", phone_number="+79990000001", is_active=True, pin_hash=hash_pin("678901"))
            db.add(self.user)
            await db.commit()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        await engine.dispose()

    async def login(self, phone="+79990000001", pin="678901", **kwargs):
        return await self.client.post("/auth/quick_login", json={"phone": phone, "pin": pin}, **kwargs)

    def authorize(self):
        self.client.headers["Authorization"] = "Bearer " + create_access_token(self.user.id, self.user.phone_number)

    async def test_no_implicit_auth_even_with_active_user(self):
        response = await self.client.get("/api/me")
        self.assertEqual(response.status_code, 401)

    async def test_personal_image_settings_encrypted_and_isolated(self):
        from cryptography.fernet import Fernet
        with patch.dict(os.environ, {"ENCRYPTION_KEY": Fernet.generate_key().decode()}):
            import core.crypto as crypto
            with patch.object(crypto, "_fernet", Fernet(Fernet.generate_key())):
                self.authorize()
                payload = {"provider": "zapro", "api_key": "offline-personal-zapro-key", "enabled": True, "daily_limit": 3}
                response = await self.client.put("/api/product-images/settings", json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertTrue(response.json()["key_configured"])
                self.assertNotIn(payload["api_key"], response.text)
                async with async_session() as db:
                    row = await db.get(UserImageSettings, self.user.id)
                    self.assertNotEqual(row.key_encrypted, payload["api_key"])
                    self.assertEqual(crypto.decrypt(row.key_encrypted), payload["api_key"])
                    db.add(User(id="another-owner", phone_number="+79990000004", is_active=True))
                    await db.commit()
                status = (await self.client.get("/api/product-images/status")).json()
                self.assertEqual(status["provider"], "zapro")
                self.assertTrue(status["ready"])
                self.assertEqual(status["remaining"], 3)
                self.client.headers["Authorization"] = "Bearer " + create_access_token("another-owner", "+79990000004")
                other = (await self.client.get("/api/product-images/settings")).json()
                self.assertFalse(other["key_configured"])
                self.authorize()
                payload.pop("api_key")
                payload["daily_limit"] = 2
                self.assertEqual((await self.client.put("/api/product-images/settings", json=payload)).status_code, 200)
                # Delete must disable the personal route instead of falling back to a shared key.
                self.assertEqual((await self.client.delete("/api/product-images/settings")).status_code, 200)
                with patch.dict(os.environ, {"OPENAI_IMAGE_ENABLED": "true", "OPENAI_IMAGE_API_KEY": "offline-shared-key"}):
                    self.assertFalse((await self.client.get("/api/product-images/status")).json()["ready"])

    async def test_image_settings_require_auth_and_valid_credentials(self):
        for method in (self.client.get, self.client.put, self.client.delete):
            self.assertEqual((await method("/api/product-images/settings")).status_code, 401)
        self.assertEqual((await self.client.post("/api/product-images/settings/check")).status_code, 401)
        self.authorize()
        response = await self.client.put("/api/product-images/settings", json={"provider": "zapro", "enabled": True})
        self.assertEqual(response.status_code, 422)
        response = await self.client.put("/api/product-images/settings", json={"provider": "https://evil.example", "enabled": False})
        self.assertEqual(response.status_code, 422)

    async def test_image_key_not_saved_if_encryption_fails(self):
        from cryptography.fernet import Fernet
        with patch.dict(os.environ, {"ENCRYPTION_KEY": Fernet.generate_key().decode()}):
            with patch("core.crypto.encrypt", side_effect=ValueError("offline failure")):
                self.authorize()
                response = await self.client.put("/api/product-images/settings", json={"provider": "zapro", "api_key": "offline-personal-key", "enabled": True})
                self.assertEqual(response.status_code, 503)
                async with async_session() as db:
                    self.assertIsNone(await db.get(UserImageSettings, self.user.id))

    async def test_image_catalog_check_does_not_generate(self):
        from core import product_images
        self.authorize()
        fake = AsyncMock()
        fake.get.return_value = httpx.Response(200, json={"data": [{"id": "gpt-image-2"}]})
        fake.__aenter__.return_value = fake
        with patch.object(product_images, "resolve_configuration", AsyncMock(return_value=(True, "offline-zapro-key", 5, "zapro"))), patch.object(product_images.httpx, "AsyncClient", return_value=fake), patch.object(product_images, "edit_product", AsyncMock()) as edit:
            response = await self.client.post("/api/product-images/settings/check")
            self.assertTrue(response.json()["available"])
            fake.get.assert_awaited_once_with("https://po.zapro.su/v1/models", headers={"Authorization": "Bearer offline-zapro-key"})
            edit.assert_not_awaited()

    async def test_task_control_requires_auth(self):
        for path in ("/api/tasks/start", "/api/tasks/sync", "/api/tasks/stop"):
            self.assertEqual((await self.client.post(path, json={})).status_code, 401)
        self.assertEqual((await self.client.get("/api/tasks/status")).status_code, 401)
        self.assertFalse(server.task_managers._managers)

    async def test_task_state_and_stop_are_isolated_between_users(self):
        async with async_session() as db:
            db.add(User(id="second-user", phone_number="+79990000003", is_active=True))
            await db.commit()
        self.authorize()
        response = await self.client.post("/api/tasks/start", json={"module": "store", "donor": "@donor-a", "targets": ["@target-a"], "total": 10})
        self.assertEqual(response.status_code, 200)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test", headers={"Authorization": "Bearer " + create_access_token("second-user", "+79990000003")}) as other:
            self.assertFalse((await other.get("/api/tasks/status")).json()["is_running"])
            response = await other.post("/api/tasks/sync", json={"user_id": self.user.id, "is_running": True, "donor": "@donor-b", "current": 5})
            self.assertEqual(response.status_code, 200)
            self.assertEqual((await self.client.get("/api/tasks/status")).json()["donor"], "@donor-a")
            self.assertEqual((await other.get("/api/tasks/status")).json()["donor"], "@donor-b")
            await other.post("/api/tasks/stop")
            own = (await self.client.get("/api/tasks/status")).json()
            self.assertTrue(own["is_running"])
            self.assertFalse(own["should_stop"])
            self.assertTrue((await other.get("/api/tasks/status")).json()["should_stop"])

    async def test_remote_stop_survives_stale_sync_and_explicit_start_resumes(self):
        self.authorize()
        await self.client.post("/api/tasks/start", json={"total": 10, "targets": ["@old"]})
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test", headers=dict(self.client.headers)) as phone:
            self.assertTrue((await phone.get("/api/tasks/status")).json()["is_running"])
            await phone.post("/api/tasks/stop")
        await self.client.post("/api/tasks/sync", json={"is_running": True, "should_stop": False, "status_message": "stale", "current": 5})
        state = (await self.client.get("/api/tasks/status")).json()
        self.assertTrue(state["should_stop"])
        self.assertFalse(state["is_running"])
        self.assertEqual(state["status_message"], "Остановлено пользователем")
        await self.client.post("/api/tasks/start", json={"total": 0, "targets": []})
        state = (await self.client.get("/api/tasks/status")).json()
        self.assertTrue(state["is_running"])
        self.assertFalse(state["should_stop"])
        self.assertEqual(state["targets"], [])
        self.assertEqual(state["total"], 0)

    async def test_personal_pin_cookie_and_bearer(self):
        response = await self.login(phone="+7 (999) 000-00-01")
        self.assertEqual(response.status_code, 200)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertNotIn("pin_code", response.json())
        self.assertNotIn("pin_hash", response.json())
        self.assertEqual((await self.client.get("/api/me")).status_code, 200)
        self.client.cookies.clear()
        self.client.headers["Authorization"] = "Bearer " + response.json()["token"]
        self.assertEqual((await self.client.get("/api/me")).status_code, 200)

    async def test_shared_default_does_not_bypass_personal_pin(self):
        self.assertEqual((await self.login(pin="1234")).status_code, 401)

    async def test_missing_pin_rejected(self):
        response = await self.client.post("/auth/quick_login", json={"phone": self.user.phone_number})
        self.assertEqual(response.status_code, 422)

    async def test_empty_partial_and_unknown_phone_rejected(self):
        for phone in ("", "000001", "+79990000002"):
            self.assertEqual((await self.login(phone=phone)).status_code, 401)

    async def test_inactive_account_cannot_login(self):
        async with async_session() as db:
            user = await db.get(User, self.user.id)
            user.is_active = False
            await db.commit()
        self.assertEqual((await self.login()).status_code, 401)

    async def test_full_telegram_login_rejects_inactive_user(self):
        async with async_session() as db:
            user = await db.get(User, self.user.id)
            user.is_active = False
            await db.commit()
        with patch.object(server.tg_manager, "sign_in", AsyncMock(return_value={"me": {"phone_number": self.user.phone_number}})):
            response = await self.client.post("/auth/login", json={"phone": self.user.phone_number, "code": "00000"})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("set-cookie", response.headers)

    async def test_account_attempt_limit_applies_across_client_ips(self):
        for index in range(6):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=server.app, client=(f"203.0.113.{index}", 12345)),
                base_url="http://test",
            ) as client:
                response = await client.post("/auth/quick_login", json={"phone": self.user.phone_number, "pin": "9999"})
                self.assertEqual(response.status_code, 401 if index < 5 else 429)

    async def test_startup_backs_up_and_upgrades_existing_sqlite(self):
        async with engine.begin() as db:
            await db.execute(text("ALTER TABLE users DROP COLUMN pin_hash"))
            await db.execute(text("ALTER TABLE orders DROP COLUMN status"))
            await db.execute(text("UPDATE users SET pin_code = '6789' WHERE id = 'test-user'"))
        await init_db()
        async with async_session() as db:
            user = await db.get(User, self.user.id)
            self.assertTrue(verify_pin("6789", user.pin_hash))
            self.assertIsNone(user.pin_code)
        backups = list((_database.parent / "backups").glob("*.db"))
        self.assertTrue(backups)
        with closing(sqlite3.connect(str(backups[-1]))) as saved:
            self.assertEqual(saved.execute("SELECT pin_code FROM users WHERE id='test-user'").fetchone()[0], "6789")

    async def test_attempt_limit_cannot_be_spoofed_by_forwarded_header(self):
        for index in range(5):
            self.assertEqual((await self.login(pin="9999", headers={"X-Forwarded-For": f"203.0.113.{index}"})).status_code, 401)
        response = await self.login()
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)

    async def test_pin_change_persists_and_does_not_disclose_pin(self):
        self.authorize()
        response = await self.client.post("/api/user/pin", json={"pin_code": "987654"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "pin_configured": True})
        self.assertEqual((await self.client.get("/api/user/pin")).json(), {"pin_configured": True})
        async with async_session() as db:
            user = await db.get(User, self.user.id)
            self.assertIsNone(user.pin_code)
            self.assertTrue(verify_pin("987654", user.pin_hash))
            self.assertNotIn("987654", user.pin_hash)
        self.assertEqual((await self.login()).status_code, 401)
        self.assertEqual((await self.login(pin="987654")).status_code, 200)

    async def test_invalid_pin_change_rejected(self):
        self.authorize()
        for pin in ("1234", "123", "abcd", "1" * 13):
            response = await self.client.post("/api/user/pin", json={"pin_code": pin})
            self.assertEqual(response.status_code, 400)

    async def test_bot_order_save_then_api_list_and_change_status(self):
        async with async_session() as db:
            db.add(ArticleItem(id="test-product", article_code="ART-TEST", title="Test product", price="1000"))
            await db.commit()
        # Load the exact persistence function, excluding bot module's import-time startup.
        source = Path(__file__).with_name("order_bot_handler.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ("_save_order", "generate_supplier_text")]
        sync_engine = create_engine("sqlite:///" + _database.as_posix())
        namespace = {"Session": Session, "engine": sync_engine, "select": select,
                     "ArticleItem": ArticleItem, "Order": Order, "Optional": Optional,
                     "logger": logging.getLogger("offline-bot-test")}
        try:
            exec(compile(ast.Module(body=nodes, type_ignores=[]), "order_bot_handler.py", "exec"), namespace)
            order_id, supplier_message = namespace["_save_order"]("ART-TEST", "Test customer", "+79990000002", "42", "test", "M", price_at_order="1000")
            self.assertTrue(supplier_message)
            with Session(sync_engine) as db:
                self.assertEqual(db.get(Order, order_id).status, "new")
                self.assertEqual(db.get(ArticleItem, "test-product").orders_count, 1)
        finally:
            sync_engine.dispose()
        self.authorize()
        response = await self.client.get("/api/orders")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["orders"][0]["status"], "new")
        response = await self.client.put(f"/api/orders/{order_id}/status", json={"status": "confirmed"})
        self.assertEqual(response.status_code, 200)
        async with async_session() as db:
            self.assertEqual((await db.get(Order, order_id)).status, "confirmed")
        self.assertEqual((await self.client.put(f"/api/orders/{order_id}/status", json={"status": "invalid"})).status_code, 400)


class MigrationTests(unittest.TestCase):
    def test_legacy_schema_upgrade_is_idempotent_and_preserves_data(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "legacy.db"
            legacy = create_engine("sqlite:///" + path.as_posix())
            try:
                with legacy.begin() as db:
                    Base.metadata.create_all(db)
                    db.execute(text("ALTER TABLE users DROP COLUMN pin_hash"))
                    db.execute(text("ALTER TABLE orders DROP COLUMN status"))
                    db.execute(text("INSERT INTO users (id, phone_number, pin_code) VALUES ('personal', '+79990000001', '6789'), ('default', '+79990000002', '1234')"))
                    db.execute(text("INSERT INTO article_items (id, article_code, title) VALUES ('article', 'ART-1', 'Preserved')"))
                    db.execute(text("INSERT INTO orders (id, article_id, article_code) VALUES ('order', 'article', 'ART-1')"))
                backup = backup_sqlite_before_upgrade(str(path))
                self.assertIsNotNone(backup)
                with closing(sqlite3.connect(str(backup))) as saved:
                    self.assertEqual(saved.execute("SELECT pin_code FROM users WHERE id='personal'").fetchone()[0], "6789")
                with legacy.begin() as db:
                    upgrade_auth_orders(db)
                    first = db.execute(text("SELECT pin_hash FROM users WHERE id='personal'")).scalar_one()
                    upgrade_auth_orders(db)
                    self.assertEqual(first, db.execute(text("SELECT pin_hash FROM users WHERE id='personal'")).scalar_one())
                    self.assertTrue(verify_pin("6789", first))
                    self.assertIsNone(db.execute(text("SELECT pin_hash FROM users WHERE id='default'")).scalar_one())
                    self.assertEqual(db.execute(text("SELECT count(*) FROM users WHERE pin_code IS NOT NULL")).scalar_one(), 0)
                    self.assertEqual(db.execute(text("SELECT status FROM orders WHERE id='order'")).scalar_one(), "new")
                    self.assertEqual(db.execute(text("SELECT title FROM article_items WHERE id='article'")).scalar_one(), "Preserved")
                self.assertIsNone(backup_sqlite_before_upgrade(str(path)))
            finally:
                legacy.dispose()

    def test_hash_salt_and_invalid_hash(self):
        first, second = hash_pin("6789"), hash_pin("6789")
        self.assertNotEqual(first, second)
        self.assertTrue(verify_pin("6789", first))
        self.assertFalse(verify_pin("0000", first))
        self.assertFalse(verify_pin("6789", "broken"))


def tearDownModule():
    asyncio.run(engine.dispose())
    _temporary.cleanup()


if __name__ == "__main__":
    unittest.main()
