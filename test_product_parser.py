"""Offline background pipeline checks, with temporary DB and fake Telegram/provider."""
import base64
import io
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from PIL import Image
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from core import product_images as images, product_parser as parser
from core.product_pricing import prices
from database.models import Base, User, ProductParserJob, MiniAppPost
from telegram_service.client import user_clients


def png(color="red"):
    out = io.BytesIO()
    Image.new("RGB", (24, 24), color).save(out, "PNG")
    return out.getvalue()


class ProductParserTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_async_engine("sqlite+aiosqlite:///" + str(Path(self.temp.name) / "test.db"))
        async with self.engine.begin() as db:
            await db.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.user = SimpleNamespace(id="test-photo-owner")
        async with self.sessions() as db:
            db.add(User(id=self.user.id, phone_number="+79990000008"))
            await db.commit()
        self.patches = [patch.object(parser, "async_session", self.sessions),
                        patch.object(images, "ROOT", Path(self.temp.name) / "images"),
                        patch.object(images, "resolve_configuration", AsyncMock(return_value=(True, "fake", 10, "zapro"))),
                        patch.object(user_clients, "get_client", AsyncMock())]
        for item in self.patches:
            item.start()
        self.telegram = AsyncMock()
        user_clients.get_client.return_value = self.telegram
        self.telegram.send_file.side_effect = lambda target, paths, caption: [SimpleNamespace(id=123+i) for i in range(len(paths))]
        self.post = {"id": 5, "text": "Сумка из кожи. Цена 1000 руб."}
        self.fetch = AsyncMock(return_value=[self.post])
        self.prepare = AsyncMock(return_value=("Новая сумка", None))
        parser.configure(self.fetch, self.prepare, lambda value: value.strip())
        parser.workers.clear()
        parser.task_managers._managers.clear()
        images._busy = False
        images._attempts.clear()
        app = FastAPI()
        app.include_router(parser.router)
        app.dependency_overrides[parser.get_current_user] = lambda: self.user
        async def db_dependency():
            async with self.sessions() as db:
                yield db
        app.dependency_overrides[parser.get_db] = db_dependency
        self.app = app
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        for task in list(parser.workers.values()):
            task.cancel()
        await asyncio_gather_workers()
        await self.client.aclose()
        for item in reversed(self.patches):
            item.stop()
        await self.engine.dispose()
        self.temp.cleanup()

    async def profile(self):
        response = await self.client.put("/api/product-images/parser/model", data={"subject": "Сумка в руке", "scene": "Студия"},
                                         files=[("models", ("front.png", png("blue"), "image/png"))])
        self.assertEqual(response.status_code, 200, response.text)

    async def start(self, request_id=None):
        return await self.client.post("/api/product-images/parser/start", json={"request_id": request_id or str(uuid.uuid4()),
                                     "donors": ["@donor"], "targets": ["@target1", "@target2"], "limit": 1})

    async def test_background_album_generated_once_for_two_targets_and_deduplicated(self):
        await self.profile()
        provider = AsyncMock(return_value=png())
        with patch.object(parser, "collect_album", AsyncMock(return_value=[png("red"), png("green")])), patch.object(images, "edit_product", provider):
            response = await self.start()
            self.assertEqual(response.status_code, 202, response.text)
            await asyncio_gather_workers()
            self.assertEqual(provider.await_count, 2)
            self.assertEqual(self.telegram.send_file.await_count, 2)
            first = self.telegram.send_file.await_args_list[0].args[1]
            second = self.telegram.send_file.await_args_list[1].args[1]
            self.assertEqual(first, second)
            self.assertTrue(all(Path(name).exists() for name in first))
            status = (await self.client.get("/api/product-images/parser/status")).json()
            self.assertEqual(status["status"], "completed", status)
            response = await self.start(response.json()["job_id"])
            self.assertEqual(response.json()["status"], "completed")
            self.assertFalse(parser.workers)
            await self.start()
            await asyncio_gather_workers()
            self.assertEqual(provider.await_count, 2)
            self.assertEqual(self.telegram.send_file.await_count, 2)

    async def test_failure_after_first_variant_never_publishes_partial_album(self):
        await self.profile()
        provider = AsyncMock(side_effect=[png(), ValueError("provider rejected")])
        with patch.object(parser, "collect_album", AsyncMock(return_value=[png(), png("green")])), patch.object(images, "edit_product", provider):
            await self.start()
            await asyncio_gather_workers()
        self.assertEqual(self.telegram.send_file.await_count, 0)
        status = (await self.client.get("/api/product-images/parser/status")).json()
        self.assertEqual(status["status"], "failed")
        self.assertEqual(len(status["generated_files"]), 1)
        self.assertFalse(images._busy)

    async def test_stop_during_generation_prevents_next_edit_and_any_send(self):
        await self.profile()
        async def stop_then_return(*args):
            parser.task_managers.for_user(self.user.id).stop()
            return png()
        with patch.object(parser, "collect_album", AsyncMock(return_value=[png(), png("green")])), patch.object(images, "edit_product", AsyncMock(side_effect=stop_then_return)) as provider:
            await self.start()
            await asyncio_gather_workers()
            self.assertEqual(provider.await_count, 1)
        self.assertEqual(self.telegram.send_file.await_count, 0)
        self.assertEqual((await self.client.get("/api/product-images/parser/status")).json()["status"], "stopped")

    async def test_whole_album_limit_checked_before_paid_call(self):
        await self.profile()
        images.resolve_configuration.return_value = (True, "fake", 1, "zapro")
        with patch.object(parser, "collect_album", AsyncMock(return_value=[png(), png("green")])), patch.object(images, "edit_product", AsyncMock()) as provider:
            await self.start()
            await asyncio_gather_workers()
            self.assertEqual(provider.await_count, 0)
        self.assertEqual(self.telegram.send_file.await_count, 0)

    async def test_profile_ownership_and_auth(self):
        await self.profile()
        self.user = SimpleNamespace(id="different-owner")
        self.assertFalse((await self.client.get("/api/product-images/parser/model")).json()["configured"])
        self.app.dependency_overrides.pop(parser.get_current_user)
        self.assertEqual((await self.client.get("/api/product-images/parser/model")).status_code, 401)
        self.assertEqual((await self.start()).status_code, 401)

    async def test_save_three_model_views_and_keep_them_when_editing_subject(self):
        response = await self.client.put("/api/product-images/parser/model", data={"subject": "Сумка", "scene": "Студия"},
                                        files=[("models", (f"view-{i}.png", png(), "image/png")) for i in range(3)])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["model_count"], 3)
        response = await self.client.put("/api/product-images/parser/model", data={"subject": "Кожаная сумка в руке", "scene": "Студия"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["model_count"], 3)
        self.assertEqual(response.json()["subject"], "Кожаная сумка в руке")

    async def test_store_preparation_preserves_price_and_article_link(self):
        import server
        from database.models import OrderBotConfig
        async with self.sessions() as db:
            db.add(OrderBotConfig(bot_token="offline-dummy", bot_username="offline_order_bot"))
            await db.commit()
        req = parser.ParserStart(request_id=uuid.uuid4(), donors=["@d"], targets=["@t"], module="store", create_articles=True, prompt="Продающий текст")
        with patch("database.session.async_session", self.sessions), patch.object(server, "ai_rewrite", AsyncMock(return_value={"rewritten_text": "Кожаная сумка\nЦена 1000 руб.\nРазмеры 24×18 см"})), patch.object(server, "create_article", AsyncMock(return_value={"article_id": "offline-article", "article_code": "ART-0001"})) as create:
            text, article = await server.prepare_product_parser_post(req, self.post, "@donor", self.user)
        self.assertIn("1300 ₽", text)
        self.assertNotIn("1000 руб", text)
        self.assertIn("Размеры 24×18 см", text)
        self.assertIn("ART-0001", text)
        self.assertIn("https://t.me/offline_order_bot?start=ART-0001", text)
        self.assertEqual(article, "offline-article")
        self.assertEqual(create.await_args.args[0].price, "1300 ₽")

    async def test_restart_marks_interrupted_and_same_id_does_not_restart(self):
        request_id = str(uuid.uuid4())
        async with self.sessions() as db:
            db.add(ProductParserJob(id=request_id, user_id=self.user.id, payload={}, status="running", progress={"pending_image": 1}))
            await db.commit()
        self.assertEqual((await self.client.get("/api/product-images/parser/status")).json()["status"], "interrupted")
        self.assertEqual((await self.start(request_id)).json()["status"], "interrupted")
        self.assertFalse(parser.workers)

    async def test_store_miniapp_sync_after_successful_album(self):
        from sqlalchemy import select
        await self.profile()
        with patch.object(parser, "collect_album", AsyncMock(return_value=[png()])), patch.object(images, "edit_product", AsyncMock(return_value=png())):
            response = await self.client.post("/api/product-images/parser/start", json={"request_id": str(uuid.uuid4()),
                         "module": "store", "donors": ["@donor"], "targets": ["@target"], "limit": 1, "sync_to_miniapp": True})
            self.assertEqual(response.status_code, 202, response.text)
            await asyncio_gather_workers()
        async with self.sessions() as db:
            row = (await db.execute(select(MiniAppPost))).scalar_one()
            self.assertEqual(row.price, "1300 ₽")
            self.assertEqual(row.text, "Новая сумка")

    async def test_unconfirmed_telegram_send_is_not_repeated_by_new_job(self):
        await self.profile()
        self.telegram.send_file.side_effect = RuntimeError("uncertain delivery")
        provider = AsyncMock(return_value=png())
        with patch.object(parser, "collect_album", AsyncMock(return_value=[png()])), patch.object(images, "edit_product", provider):
            await self.start()
            await asyncio_gather_workers()
            self.assertEqual(provider.await_count, 1)
            await self.start()
            await asyncio_gather_workers()
            self.assertEqual(provider.await_count, 1)
            self.assertEqual(self.telegram.send_file.await_count, 1)

    async def test_exact_album_not_neighbor_product(self):
        source = SimpleNamespace(id=5, photo=True, grouped_id=77)
        second = SimpleNamespace(id=6, photo=True, grouped_id=77)
        neighbor = SimpleNamespace(id=7, photo=True, grouped_id=88)
        self.telegram.get_messages.side_effect = [source, [source, second, neighbor]]
        self.telegram.download_media.side_effect = [png(), png("green")]
        result = await parser.collect_album(self.telegram, "@donor", self.post)
        self.assertEqual(len(result), 2)
        self.assertEqual([call.args[0].id for call in self.telegram.download_media.await_args_list], [5, 6])

    async def test_live_monitoring_groups_new_album_and_advances_cursor(self):
        from datetime import datetime, timezone, timedelta
        old = datetime.now(timezone.utc) - timedelta(seconds=30)
        rows = [SimpleNamespace(id=6, photo=True, media=True, grouped_id=77, text="Сумка в двух цветах", date=old),
                SimpleNamespace(id=7, photo=True, media=True, grouped_id=77, text="", date=old),
                SimpleNamespace(id=8, photo=False, media=False, grouped_id=None, text="Объявление магазина", date=old)]
        self.telegram.get_messages.return_value = rows
        result, cursor = await parser.new_posts(self.telegram, "@donor", 5)
        self.assertEqual(result, [{"id": 6, "text": "Сумка в двух цветах"}])
        self.assertEqual(cursor, 8)
        self.assertEqual(self.telegram.get_messages.await_args.kwargs["min_id"], 5)

    async def test_live_monitoring_waits_for_album_upload_to_settle(self):
        from datetime import datetime, timezone
        self.telegram.get_messages.return_value = [SimpleNamespace(id=6, photo=True, media=True, grouped_id=77, text="Сумка в двух цветах", date=datetime.now(timezone.utc))]
        result, cursor = await parser.new_posts(self.telegram, "@donor", 5)
        self.assertEqual(result, [])
        self.assertEqual(cursor, 5)

    async def test_live_worker_processes_a_new_post_after_empty_initial_batch(self):
        await self.profile()
        self.fetch.return_value = []
        self.telegram.get_messages.return_value = [SimpleNamespace(id=4)]
        def send_then_stop(target, paths, caption):
            parser.task_managers.for_user(self.user.id).stop()
            return [SimpleNamespace(id=123)]
        self.telegram.send_file.side_effect = send_then_stop
        with patch.object(parser, "new_posts", AsyncMock(return_value=([self.post], 5))), patch.object(parser, "collect_album", AsyncMock(return_value=[png()])), patch.object(images, "edit_product", AsyncMock(return_value=png())) as provider:
            response = await self.client.post("/api/product-images/parser/start", json={"request_id": str(uuid.uuid4()),
                         "donors": ["@donor"], "targets": ["@target"], "limit": 1, "live_monitoring": True})
            self.assertEqual(response.status_code, 202, response.text)
            await asyncio_gather_workers()
            self.assertEqual(provider.await_count, 1)
        self.assertEqual(self.telegram.send_file.await_count, 1)
        self.assertEqual((await self.client.get("/api/product-images/parser/status")).json()["status"], "stopped")

    async def test_reference_roles_and_all_colors_in_provider_payload(self):
        seen = []
        def respond(request):
            seen.append(request.content)
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png()).decode()}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await images.edit_product(client, "fake", png(), png("blue"), "studio", "high", "zapro", "Сумка", [png("green")], [png("yellow")])
        body = seen[0]
        self.assertEqual(body.count(b'name="image[]"'), 4)
        self.assertIn(b"PRODUCT TRANSFER", body)
        self.assertIn(b"discarding the donor person", body)
        self.assertIn(b"color must match image 1 exactly", body)
        self.assertIn("Сумка".encode(), body)

    def test_store_price_snapshot_matches_maximum_base_and_modes(self):
        req = parser.ParserStart(request_id=uuid.uuid4(), donors=["@d"], targets=["@t"], price_mode="three_tier")
        self.assertEqual(prices("Сумка, опт 1000 руб., розница 1500 руб.", req), {"retail": 1950, "wholesale": 1650, "drop": 1800})
        req.price_mode = "single"
        self.assertEqual(prices("Цена 1000 ₽", req), {"retail": 1300})


async def asyncio_gather_workers():
    import asyncio
    if parser.workers:
        await asyncio.gather(*list(parser.workers.values()), return_exceptions=False)


if __name__ == "__main__":
    unittest.main()
