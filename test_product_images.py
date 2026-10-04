"""Offline image pilot checks: fake provider, temporary files, no Telegram or DB."""
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
from core import product_images as images


def png():
    output = io.BytesIO()
    Image.new("RGB", (32, 32), "red").save(output, format="PNG")
    return output.getvalue()


class ProductImageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="clonner-images-")
        self.root = patch.object(images, "ROOT", Path(self.folder.name))
        self.root.start()
        self.env = patch.dict("os.environ", {"OPENAI_IMAGE_ENABLED": "true", "OPENAI_IMAGE_API_KEY": "offline-dummy", "OPENAI_IMAGE_DAILY_LIMIT": "5"})
        self.env.start()
        images._busy = False
        images._jobs.clear()
        images._attempts.clear()
        self.user = SimpleNamespace(id="owner-a")
        app = FastAPI()
        app.include_router(images.router)
        app.dependency_overrides[images.get_current_user] = lambda: self.user
        app.dependency_overrides[images.get_db] = lambda: None
        async def configuration(db, user_id):
            ready, key, limit = images.configuration()
            return ready, key, limit, "openai"
        self.configuration_patch = patch.object(images, "resolve_configuration", configuration)
        self.configuration_patch.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.provider = AsyncMock(return_value=png())
        self.provider_patch = patch.object(images, "edit_product", self.provider)
        self.provider_patch.start()

    async def asyncTearDown(self):
        await self.client.aclose()
        self.provider_patch.stop()
        self.configuration_patch.stop()
        self.env.stop()
        self.root.stop()
        self.folder.cleanup()

    async def generate(self, count=1, request_id=None, invalid=False):
        files = [("avatar", ("model.png", png(), "image/png"))]
        files += [("products", (f"variant-{n}.png", b"bad" if invalid and n == count - 1 else png(), "image/png")) for n in range(count)]
        return await self.client.post("/api/product-images/preview", files=files,
                                      data={"request_id": request_id or str(uuid.uuid4()), "scene": "Studio"})

    async def test_five_variants_and_owned_results(self):
        response = await self.generate(5)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "success")
        self.assertEqual(self.provider.await_count, 5)
        filename = response.json()["results"][0]["filename"]
        self.assertEqual((await self.client.get("/api/product-images/result/" + filename)).content, png())
        self.user = SimpleNamespace(id="owner-b")
        self.assertEqual((await self.client.get("/api/product-images/result/" + filename)).status_code, 404)

    async def test_retry_same_id_never_repeats_paid_calls(self):
        request_id = str(uuid.uuid4())
        first = await self.generate(2, request_id)
        second = await self.generate(2, request_id)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(self.provider.await_count, 2)
        self.assertEqual((await self.client.get("/api/product-images/status")).json()["remaining"], 3)

    async def test_all_inputs_validated_before_any_paid_call(self):
        response = await self.generate(3, invalid=True)
        self.assertEqual(response.status_code, 422)
        self.provider.assert_not_awaited()

    async def test_disabled_and_limit_prevent_paid_calls(self):
        with patch.dict("os.environ", {"OPENAI_IMAGE_ENABLED": "false"}):
            self.assertEqual((await self.generate()).status_code, 503)
        with patch.dict("os.environ", {"OPENAI_IMAGE_DAILY_LIMIT": "1"}):
            self.assertEqual((await self.generate(2)).status_code, 429)
        self.provider.assert_not_awaited()

    async def test_failure_stops_remaining_variants_no_retry(self):
        self.provider.side_effect = [png(), httpx.ReadTimeout("offline timeout")]
        response = await self.generate(5)
        self.assertEqual(response.json()["status"], "partial")
        self.assertEqual([r["status"] for r in response.json()["results"]], ["success", "failed", "skipped", "skipped", "skipped"])
        self.assertEqual(self.provider.await_count, 2)
        self.assertFalse(images._busy)

    async def test_busy_and_invalid_filename(self):
        images._busy = True
        self.assertEqual((await self.generate()).status_code, 409)
        self.assertEqual((await self.client.get("/api/product-images/result/unknown.png")).status_code, 404)
        self.provider.assert_not_awaited()

    async def test_auth_required(self):
        app = FastAPI()
        app.include_router(images.router)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            self.assertEqual((await client.get("/api/product-images/status")).status_code, 401)
            self.assertEqual((await client.get("/api/product-images/result/unknown.png")).status_code, 401)
            self.assertEqual((await client.post("/api/product-images/preview")).status_code, 401)

    async def test_official_request_contract(self):
        # Exercise the real adapter against a mock HTTP transport, not the provider.
        self.provider_patch.stop()
        async def respond(request):
            self.assertEqual(str(request.url), "https://api.openai.com/v1/images/edits")
            self.assertEqual(request.headers["Authorization"], "Bearer offline-dummy")
            body = (await request.aread()).decode("latin1")
            self.assertIn("gpt-image-2", body)
            self.assertEqual(body.count('name="image[]"'), 2)
            self.assertNotIn("input_fidelity", body)
            self.assertIn("1024x1536", body)
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png()).decode()}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            output = await images.edit_product(client, "offline-dummy", png(), png(), "Studio", "high")
        self.assertEqual(output, png())

    async def test_zapro_reference_edit_contract(self):
        self.provider_patch.stop()
        async def respond(request):
            self.assertEqual(str(request.url), "https://po.zapro.su/v1/images/edits")
            self.assertEqual(request.headers["Authorization"], "Bearer offline-zapro-key")
            body = (await request.aread()).decode("latin1")
            self.assertEqual(body.count('name="image[]"'), 2)
            self.assertIn('name="response_format"', body)
            self.assertIn("b64_json", body)
            self.assertIn("gpt-image-2", body)
            self.assertNotIn("input_fidelity", body)
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png()).decode()}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            self.assertEqual(await images.edit_product(client, "offline-zapro-key", png(), png(), "Studio", "medium", "zapro"), png())


if __name__ == "__main__":
    unittest.main()
