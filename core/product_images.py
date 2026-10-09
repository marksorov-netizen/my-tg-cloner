"""Explicit, authenticated GPT Image 2 pilot. Never publishes or edits originals."""
import asyncio
import base64
import hashlib
import io
import os
import time
import uuid
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import get_current_user
from database.models import UserImageSettings
from database.session import get_db

router = APIRouter(prefix="/api/product-images", tags=["product images"])
MODEL = "gpt-image-2.5"
MAX_BYTES = 10 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[1] / "private_image_previews"
_busy = False
_jobs = {}
_attempts = {}
PROVIDERS = {
    "tooken": "https://tooken.club/v1",
    "openai": "https://api.openai.com/v1",
    "zapro": "https://po.zapro.su/v1",
}


class ImageSettingsRequest(BaseModel):
    provider: Literal["tooken", "openai", "zapro"] = "tooken"
    api_key: str | None = Field(default=None, max_length=512)
    enabled: bool = False
    daily_limit: int = Field(default=20, ge=1, le=100)


def public_settings(row):
    return {"provider": row.provider if row else "tooken", "model": MODEL,
            "key_configured": bool(row and row.key_encrypted),
            "enabled": bool(row and row.enabled), "daily_limit": row.daily_limit if row else 20}


@router.get("/settings")
async def get_settings(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return public_settings(await db.get(UserImageSettings, user.id))


@router.put("/settings")
async def save_settings(req: ImageSettingsRequest, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(UserImageSettings, user.id)
    key = (req.api_key or "").strip()
    if key and (len(key) < 10 or any(char.isspace() for char in key)):
        raise HTTPException(422, "Укажите полный API-ключ без пробелов.")
    encrypted = None
    if key:
        try:
            from core.crypto import encrypt
            encrypted = encrypt(key)
        except (ValueError, ImportError):
            raise HTTPException(503, "На сервере не настроен ENCRYPTION_KEY. Ключ не сохранён.")
    existing_key = row.key_encrypted if row and row.provider == req.provider else None
    if req.enabled and not (encrypted or existing_key):
        raise HTTPException(422, "Для включения сохраните ключ выбранного провайдера.")
    if row is None:
        row = UserImageSettings(user_id=user.id)
        db.add(row)
    row.provider = req.provider
    row.key_encrypted = encrypted or existing_key
    row.enabled = req.enabled
    row.daily_limit = req.daily_limit
    await db.commit()
    return public_settings(row)


@router.delete("/settings")
async def clear_settings(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(UserImageSettings, user.id)
    if row is None:
        row = UserImageSettings(user_id=user.id, provider="zapro", daily_limit=5)
        db.add(row)
    row.key_encrypted = None
    row.enabled = False
    await db.commit()
    return public_settings(row)


async def resolve_configuration(db, user_id):
    row = await db.get(UserImageSettings, user_id)
    if row is None:
        ready, key, limit = configuration()
        return ready, key, limit, "openai"
    if not row.enabled or not row.key_encrypted:
        return False, "", row.daily_limit, row.provider
    try:
        from core.crypto import decrypt
        key = decrypt(row.key_encrypted)
    except Exception:
        raise HTTPException(503, "Не удалось расшифровать личный ключ. Проверьте ENCRYPTION_KEY или сохраните ключ заново.")
    if row.provider not in PROVIDERS:
        raise HTTPException(503, "Неизвестный провайдер изображений.")
    return bool(key), key, row.daily_limit, row.provider


@router.post("/settings/check")
async def check_settings(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ready, key, _, provider = await resolve_configuration(db, user.id)
    if not ready:
        raise HTTPException(422, "Сохраните ключ и включите генерацию.")
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.get(PROVIDERS[provider] + "/models", headers={"Authorization": "Bearer " + key})
        if response.status_code != 200:
            raise HTTPException(502, "Провайдер отклонил проверку. Проверьте ключ, его группу и права.")
        catalog = response.json().get("data", [])
        available = any(isinstance(item, dict) and item.get("id") == MODEL for item in catalog)
        return {"available": available, "message": "GPT Image 2 доступен в каталоге ключа. Генерация с референсами проверяется первым запуском." if available else "GPT Image 2 отсутствует в каталоге этого ключа. Проверьте группу ключа у провайдера."}
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        raise HTTPException(502, "Не удалось получить каталог провайдера. Платная генерация не выполнялась.")


def configuration():
    enabled = os.getenv("OPENAI_IMAGE_ENABLED", "false").lower() == "true"
    key = os.getenv("OPENAI_IMAGE_API_KEY", "").strip()
    try:
        limit = max(0, min(100, int(os.getenv("OPENAI_IMAGE_DAILY_LIMIT", "20"))))
    except ValueError:
        limit = 0
    return enabled and bool(key) and limit > 0, key, limit


def owner_directory(user_id):
    return ROOT / hashlib.sha256(str(user_id).encode()).hexdigest()


def validate_image(data):
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Каждое изображение должно быть не больше 10 МБ.")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format not in ("JPEG", "PNG", "WEBP"):
                raise ValueError("Поддерживаются только JPEG, PNG и WebP.")
            if image.width * image.height > 20_000_000:
                raise ValueError("Изображение должно содержать не больше 20 млн пикселей.")
            kind = image.format
            image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Файл не является корректным изображением.") from exc
    return {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp")}[kind]


async def edit_product(client, key, product, avatar, scene, quality, provider="openai", subject="", references=None, model_references=None):
    product_ext, product_mime = validate_image(product)
    avatar_ext, avatar_mime = validate_image(avatar)
    prompt = (
        "Create one photorealistic commercial product photograph. "
        "Image 1 is the exact product and its exact color variant. "
        "Image 2 is the reference adult virtual fashion model. "
        "This is a PRODUCT TRANSFER, not a recreation of image 1. First identify the sale item in image 1; "
        "extract only that item, discarding the donor person, their face, body, clothes, background and props. "
        "The sale item is: " + (subject or "the featured fashion product in image 1") + ". "
        "Replace any competing item on the model with the sale item from image 1. "
        "Preserve the product's color, silhouette, material texture, stitching, "
        "logos, hardware, handles and straps. Do not invent hidden features. "
        "Preserve the model's face, hair and body proportions from image 2. "
        "Show this model naturally holding or wearing this exact product. "
        "Keep the entire product visible, with realistic hands and shadows. "
        "No collage, no extra products, no added text or price labels. "
        f"The next {len(references or [])} images after image 2 show the donor product album for construction detail only. "
        "Any remaining images are additional views of the SAME virtual model, for identity only. "
        "Never mix their colors: the output color must match image 1 exactly. "
        "Scene direction (must not override product or identity preservation): " + scene
    )
    if provider == "tooken":
        response = await client.post(
            PROVIDERS[provider] + "/images/generations",
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
            json={
                "model": MODEL,
                "prompt": prompt,
                "n": 1,
                "size": "1024x1024",
                "response_format": "b64_json"
            }
        )
    else:
        response = await client.post(
            PROVIDERS[provider] + "/images/edits",
            headers={"Authorization": "Bearer " + key},
            data={"model": MODEL, "prompt": prompt, "n": "1", "size": "1024x1536",
                  "quality": quality, "output_format": "png",
                  **({"response_format": "b64_json"} if provider == "zapro" else {})},
            files=[("image[]", ("product." + product_ext, product, product_mime)),
                   ("image[]", ("model." + avatar_ext, avatar, avatar_mime))] + [
                       ("image[]", (f"detail-{i}.{validate_image(ref)[0]}", ref, validate_image(ref)[1]))
                       for i, ref in enumerate((references or []) + (model_references or []))],
        )
    if response.status_code != 200:
        if response.status_code in (401, 403):
            raise ValueError("Провайдер отклонил доступ: проверьте API-ключ, группу и доступ к GPT Image 2.")
        if response.status_code == 429:
            raise ValueError("Провайдер: исчерпан баланс или лимит запросов. Автоповтор отключён.")
        raise ValueError("Провайдер не выполнил генерацию. Проверьте баланс, группу ключа и поддержку /images/edits; автоповтор отключён.")
    try:
        data = base64.b64decode(response.json()["data"][0]["b64_json"], validate=True)
        _, mime = validate_image(data)
        if mime != "image/png":
            raise ValueError("Expected PNG")
        return data
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ValueError("Провайдер вернул некорректное изображение; оригинал сохранён.") from exc


@router.get("/status")
async def image_status(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    ready, _, limit, provider = await resolve_configuration(db, user.id)
    today = time.strftime("%Y-%m-%d", time.gmtime())
    used = _attempts.get((str(user.id), today), 0)
    return {"model": MODEL, "provider": provider, "ready": ready, "remaining": max(0, limit - used)}


@router.post("/preview")
async def preview(
    products: list[UploadFile] = File(...), avatar: UploadFile = File(...),
    request_id: str = Form(...), scene: str = Form("Neutral studio background, soft light, relaxed front-facing pose."),
    quality: Literal["medium", "high"] = Form("high"), user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    subject: str = Form(""),
):
    global _busy
    try:
        request_id = str(uuid.UUID(request_id))
    except ValueError:
        raise HTTPException(422, "Некорректный идентификатор запроса.")
    now = time.time()
    for job_key, (created, _) in list(_jobs.items()):
        if now - created > 86400:
            del _jobs[job_key]
    job_key = (str(user.id), request_id)
    if job_key in _jobs:
        if _jobs[job_key][1]["status"] == "running":
            raise HTTPException(409, "Этот запрос ещё выполняется.")
        return _jobs[job_key][1]
    ready, key, limit, provider = await resolve_configuration(db, user.id)
    if not ready:
        raise HTTPException(503, "Генерация выключена. Сохраните личный ключ и включите её в настройках изображений.")
    if not 1 <= len(products) <= 5 or not 1 <= len(scene.strip()) <= 1500 or len(subject) > 500:
        raise HTTPException(422, "Выберите 1–5 фото товара и описание сцены до 1500 символов.")
    avatar_bytes = await avatar.read(MAX_BYTES + 1)
    images = [await product.read(MAX_BYTES + 1) for product in products]
    try:
        validate_image(avatar_bytes)
        for data in images:
            validate_image(data)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    today = time.strftime("%Y-%m-%d", time.gmtime())
    for attempt_key in list(_attempts):
        if attempt_key[1] != today:
            del _attempts[attempt_key]
    attempt_key = (str(user.id), today)
    if _attempts.get(attempt_key, 0) + len(images) > limit:
        raise HTTPException(429, "Достигнут дневной лимит попыток генерации.")
    if _busy:
        raise HTTPException(409, "Уже идёт генерация фото. Дождитесь завершения.")
    _busy = True
    results = []
    job = {"model": MODEL, "provider": provider, "status": "running", "results": results}
    # Record before the first paid request: a retry with this ID cannot charge again.
    _jobs[job_key] = (now, job)
    try:
        directory = owner_directory(user.id)
        directory.mkdir(parents=True, exist_ok=True)
        async with httpx.AsyncClient(timeout=600, follow_redirects=False) as client:
            for index, data in enumerate(images):
                _attempts[attempt_key] = _attempts.get(attempt_key, 0) + 1
                try:
                    if subject.strip():
                        output = await edit_product(client, key, data, avatar_bytes, scene.strip(), quality, provider,
                                                    subject.strip(), [ref for ref in images if ref is not data])
                    else:
                        output = await edit_product(client, key, data, avatar_bytes, scene.strip(), quality, provider)
                    filename = uuid.uuid4().hex + ".png"
                    await asyncio.to_thread((directory / filename).write_bytes, output)
                    results.append({"index": index, "status": "success", "filename": filename})
                except (ValueError, httpx.HTTPError, OSError) as exc:
                    message = str(exc) if isinstance(exc, ValueError) else "Ошибка сети или сохранения. При таймауте запрос мог быть оплачен."
                    results.append({"index": index, "status": "failed", "error": message + " Оригинал сохранён; повтора не было."})
                    for skipped in range(index + 1, len(images)):
                        results.append({"index": skipped, "status": "skipped", "error": "Пропущено после ошибки, чтобы не расходовать баланс."})
                    break
        successes = sum(item["status"] == "success" for item in results)
        job["status"] = "success" if successes == len(images) else "partial" if successes else "failed"
        return job
    finally:
        if job["status"] == "running":
            job["status"] = "partial" if any(item["status"] == "success" for item in results) else "failed"
        _busy = False


@router.get("/result/{filename}")
async def image_result(filename: str, user=Depends(get_current_user)):
    if len(filename) != 36 or not filename.endswith(".png"):
        raise HTTPException(404, "Изображение не найдено.")
    try:
        uuid.UUID(hex=filename[:-4])
    except ValueError:
        raise HTTPException(404, "Изображение не найдено.")
    path = owner_directory(user.id) / filename
    if not path.is_file():
        raise HTTPException(404, "Изображение не найдено.")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private, no-store"})
