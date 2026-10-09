"""Owner-scoped background photo parser. No paid retries or restart resumption."""
import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select

from core.auth import get_current_user
from core import product_images as images
from core.task_manager import task_managers
from database.models import ProductParserProfile, ProductParserJob, User, ParsedPostItem
from database.session import async_session, get_db

router = APIRouter(prefix="/api/product-images/parser", tags=["background product parser"])
workers = {}
start_lock = asyncio.Lock()
fetch_posts = prepare_post = clean_channel = None


def configure(fetch, prepare, clean):
    global fetch_posts, prepare_post, clean_channel
    fetch_posts, prepare_post, clean_channel = fetch, prepare, clean


class ParserStart(BaseModel):
    request_id: uuid.UUID
    module: Literal["parser", "store"] = "parser"
    donors: list[str] = Field(min_length=1, max_length=10)
    targets: list[str] = Field(min_length=1, max_length=3)
    limit: int = Field(default=1, ge=1, le=100)
    interval_seconds: int = Field(default=0, ge=0, le=86400)
    prompt: str = Field(default="", max_length=8000)
    quality: Literal["medium", "high"] = "high"
    create_articles: bool = False
    sync_to_miniapp: bool = False
    article_prefix: str = Field(default="ART", min_length=1, max_length=20)
    filter_ads: bool = False
    live_monitoring: bool = False
    price_mode: Literal["single", "opt_retail", "three_tier"] = "single"
    single_markup: float = Field(default=30, ge=0, le=1000)
    wholesale_markup: float = Field(default=10, ge=0, le=1000)
    drop_markup: float = Field(default=20, ge=0, le=1000)
    retail_markup: float = Field(default=30, ge=0, le=1000)
    currency: str = Field(default="₽", max_length=10)


def profile_public(row):
    return {"configured": bool(row and row.model_files), "model_count": len(row.model_files) if row else 0,
            "subject": row.subject if row else "Сумка", "scene": row.scene if row else "Светлая студия, мягкий свет. Товар полностью виден."}


@router.get("/model")
async def get_model(user=Depends(get_current_user), db=Depends(get_db)):
    return profile_public(await db.get(ProductParserProfile, user.id))


@router.put("/model")
async def save_model(subject: str = Form(...), scene: str = Form(...), models: list[UploadFile] = File(default=[]),
                     user=Depends(get_current_user), db=Depends(get_db)):
    if not 1 <= len(subject.strip()) <= 500 or not 1 <= len(scene.strip()) <= 1500 or len(models) > 3:
        raise HTTPException(422, "Укажите товар, сцену и до 3 фото одной взрослой виртуальной модели.")
    if str(user.id) in workers:
        raise HTTPException(409, "Дождитесь окончания фонового парсинга перед изменением модели.")
    row = await db.get(ProductParserProfile, user.id)
    data = [await model.read(images.MAX_BYTES + 1) for model in models]
    try:
        for value in data:
            images.validate_image(value)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if not data and not (row and row.model_files):
        raise HTTPException(422, "Прикрепите хотя бы одно фото виртуальной модели.")
    if row is None:
        row = ProductParserProfile(user_id=user.id)
        db.add(row)
    if data:
        directory = images.owner_directory(user.id)
        directory.mkdir(parents=True, exist_ok=True)
        filenames = []
        for value in data:
            name = uuid.uuid4().hex + "." + images.validate_image(value)[0]
            await asyncio.to_thread((directory / name).write_bytes, value)
            filenames.append(name)
        row.model_files = filenames
    row.subject, row.scene = subject.strip(), scene.strip()
    await db.commit()
    return profile_public(row)


@router.post("/start", status_code=202)
async def start(req: ParserStart, user=Depends(get_current_user), db=Depends(get_db)):
    async with start_lock:
        existing = await db.get(ProductParserJob, str(req.request_id))
        if existing:
            if existing.user_id != str(user.id):
                raise HTTPException(404, "Задача не найдена.")
            return {"job_id": existing.id, "status": existing.status}
        manager = task_managers.for_user(user.id)
        if str(user.id) in workers or manager.get_state()["is_running"]:
            raise HTTPException(409, "Сначала остановите или дождитесь текущего переноса.")
        profile = await db.get(ProductParserProfile, user.id)
        if not profile or not profile.model_files:
            raise HTTPException(422, "Сохраните фото модели и описание товара.")
        try:
            model_data = [(images.owner_directory(user.id) / name).read_bytes() for name in profile.model_files]
            for value in model_data:
                images.validate_image(value)
        except (OSError, ValueError):
            raise HTTPException(422, "Не удалось прочитать фото модели. Сохраните их заново.")
        ready, _, _, _ = await images.resolve_configuration(db, user.id)
        if not ready:
            raise HTTPException(422, "Включите личный API изображений в профиле.")
        # Validate Telegram access before recording or charging anything.
        from telegram_service.client import user_clients
        try:
            client = await user_clients.get_client(user)
        except ValueError:
            raise HTTPException(401, "Сначала подключите свой Telegram-аккаунт.")
        for channel in req.donors + req.targets:
            if not channel.strip():
                raise HTTPException(422, "Канал не может быть пустым.")
            try:
                entity = await client.get_entity(clean_channel(channel))
                if channel in req.targets and getattr(entity, "broadcast", False):
                    permissions = await client.get_permissions(entity, "me")
                    if not (permissions.is_creator or permissions.post_messages):
                        raise ValueError("No posting permission")
            except Exception:
                raise HTTPException(422, "Не удалось открыть один из каналов. Проверьте доноров, целевые каналы и права Telegram-аккаунта.")
        payload = req.model_dump(mode="json")
        payload.update(subject=profile.subject, scene=profile.scene)
        row = ProductParserJob(id=str(req.request_id), user_id=str(user.id), status="running", payload=payload,
                               progress={"current": 0, "total": 0, "message": "Загрузка донорских альбомов", "logs": []})
        db.add(row)
        await db.commit()
        manager.start(req.module, ", ".join(req.donors), req.targets, req.limit)
        task = asyncio.create_task(run(row.id, str(user.id), req, payload, model_data))
        workers[str(user.id)] = task
        return {"job_id": row.id, "status": "running"}


@router.get("/status")
async def status(user=Depends(get_current_user), db=Depends(get_db)):
    async with start_lock:
        return await job_status(user, db)


async def job_status(user, db):
    row = (await db.execute(select(ProductParserJob).where(ProductParserJob.user_id == str(user.id))
                           .order_by(ProductParserJob.created_at.desc()).limit(1))).scalar_one_or_none()
    if not row:
        return {"status": "idle"}
    if row.status == "running" and str(user.id) not in workers:
        row.status = "interrupted"
        row.progress = {**row.progress, "message": "Сервер был перезапущен. Автоповтор отключён: последний запрос мог быть оплачен."}
        await db.commit()
    return {"job_id": row.id, "status": row.status, **row.progress}


async def update(job_id, **changes):
    async with async_session() as db:
        row = await db.get(ProductParserJob, job_id)
        row.progress = {**row.progress, **changes}
        await db.commit()


async def collect_album(client, donor, post):
    """Use exact Telegram group IDs; never borrow a neighboring product."""
    source = await client.get_messages(donor, ids=post["id"])
    if not source or not source.photo:
        raise ValueError("В посте нет фотографии товара. Видео и документы в этом режиме не обрабатываются.")
    group = getattr(source, "grouped_id", None)
    messages = [source]
    if group:
        nearby = await client.get_messages(donor, ids=list(range(max(1, source.id - 10), source.id + 11)))
        messages = sorted([m for m in nearby if m and getattr(m, "grouped_id", None) == group], key=lambda m: m.id)
        if not messages or any(not m.photo for m in messages):
            raise ValueError("Альбом содержит не только фото. Пост пропущен целиком.")
    if not 1 <= len(messages) <= 10:
        raise ValueError("Поддерживаются альбомы из 1–10 фотографий.")
    data = [await client.download_media(m, file=bytes) for m in messages]
    for value in data:
        images.validate_image(value)
    return data


async def generate_album(job_id, user_id, data, models, payload, quality, stopped):
    """Validate/reserve whole album before spending; reuse outputs across targets."""
    if images._busy:
        raise ValueError("Генератор занят другим запросом. Запросов на генерацию фото не было.")
    for value in data + models:
        images.validate_image(value)
    async with async_session() as db:
        ready, key, limit, provider = await images.resolve_configuration(db, user_id)
    tooken_key = os.getenv("TOOKEN_API_KEY", "").strip()
    if not ready and tooken_key:
        ready, key, limit, provider = True, tooken_key, 100, "tooken"

    if not ready:
        raise ValueError("API изображений отключён.")
    day = time.strftime("%Y-%m-%d", time.gmtime())
    counter = (user_id, day)
    if images._attempts.get(counter, 0) + len(data) > limit:
        raise ValueError(f"Для альбома нужно {len(data)} попыток; дневного лимита недостаточно. Запросов на генерацию фото не было.")
    # No await between the final busy check and acquisition.
    if images._busy:
        raise ValueError("Генератор занят. Запросов на генерацию фото не было.")
    images._busy = True
    paths = []
    try:
        from core.ai_fashion_studio import ai_fashion_studio
        for index, value in enumerate(data):
            if stopped():
                raise ValueError("Остановлено пользователем; готовые фото сохранены, альбом не опубликован.")
            await update(job_id, message=f"Генерация фото {index + 1}/{len(data)}", pending_image=index + 1)
            images._attempts[counter] = images._attempts.get(counter, 0) + 1
            
            temp_in = os.path.join(os.getcwd(), "temp_media", f"parser_in_{uuid.uuid4().hex[:8]}.jpg")
            os.makedirs(os.path.dirname(temp_in), exist_ok=True)
            with open(temp_in, "wb") as f_in:
                f_in.write(value)

            generated_list = await ai_fashion_studio.process_donor_album(
                [temp_in],
                post_text=payload.get("caption", "") or payload.get("subject", ""),
                api_key=key,
                max_generations=1
            )

            directory = images.owner_directory(user_id)
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / (uuid.uuid4().hex + ".jpg")

            if generated_list and os.path.exists(generated_list[0]):
                shutil.copy(generated_list[0], path)
            else:
                path.write_bytes(value)

            paths.append(path)
            await update(job_id, generated_files=[p.name for p in paths], pending_image=None)
        return paths
    finally:
        images._busy = False


async def new_posts(client, donor, cursor):
    """Poll only after the last seen ID; wait for an album upload to settle."""
    raw = await client.get_messages(donor, limit=100, min_id=cursor, reverse=True)
    raw = sorted([m for m in raw if m and m.id > cursor], key=lambda m: m.id)
    if not raw:
        return [], cursor
    last_date = getattr(raw[-1], "date", None)
    if last_date:
        if last_date.tzinfo is None:
            last_date = last_date.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - last_date).total_seconds() < 10:
            return [], cursor
    result, seen = [], set()
    for index, message in enumerate(raw):
        if message.id in seen or not message.photo:
            continue
        group = getattr(message, "grouped_id", None)
        album = [m for m in raw if group and getattr(m, "grouped_id", None) == group] if group else [message]
        seen.update(m.id for m in album)
        caption = max(((m.text or "").strip() for m in album), key=len)
        last_index = max(raw.index(m) for m in album)
        if not caption and last_index + 1 < len(raw):
            following = raw[last_index + 1]
            if not following.media:
                caption = (following.text or "").strip()
        if len(caption) >= 10:
            result.append({"id": album[0].id, "text": caption})
    # If a capped page ends inside an album, defer that last group to the next poll.
    next_cursor = raw[-1].id
    if len(raw) == 100 and getattr(raw[-1], "grouped_id", None):
        last_group = raw[-1].grouped_id
        first_id = min(m.id for m in raw if getattr(m, "grouped_id", None) == last_group)
        result = [post for post in result if post["id"] < first_id]
        next_cursor = first_id - 1
    return result, next_cursor


async def post_stream(client, posts, req, cursors, manager, job_id):
    pending = list(posts)
    current = 0
    while not manager.get_state()["should_stop"]:
        for donor, post in pending:
            if manager.get_state()["should_stop"]:
                return
            current += 1
            total = max(len(posts), current)
            manager.update_state({"total": total})
            await update(job_id, total=total)
            yield current - 1, donor, post
        if not req.live_monitoring:
            return
        manager.update_state({"is_live_monitoring": True, "status_message": "Живой мониторинг: ждём новые фото товаров"})
        await update(job_id, message="Живой мониторинг: ждём новые фото товаров")
        pending = []
        for donor in req.donors:
            channel = clean_channel(donor)
            incoming, cursors[channel] = await new_posts(client, channel, cursors[channel])
            pending.extend((channel, post) for post in incoming)
        if not pending:
            for _ in range(30):
                if manager.get_state()["should_stop"]:
                    return
                await asyncio.sleep(1)


async def run(job_id, user_id, req, payload, models):
    manager = task_managers.for_user(user_id)
    logs = []
    final = "completed"
    try:
        from telegram_service.client import user_clients
        async with async_session() as db:
            user = await db.get(User, user_id)
        client = await user_clients.get_client(user)
        posts = []
        cursors = {}
        for donor in req.donors:
            if req.live_monitoring:
                latest = await client.get_messages(clean_channel(donor), limit=1)
                cursors[clean_channel(donor)] = latest[0].id if latest else 0
            posts += [(clean_channel(donor), p) for p in await fetch_posts(donor, req.limit, user)]
        manager.update_state({"total": len(posts)})
        await update(job_id, total=len(posts))
        async for index, donor, post in post_stream(client, posts, req, cursors, manager, job_id):
            if manager.get_state()["should_stop"]:
                final = "stopped"
                break
            total = manager.get_state()["total"]
            manager.update_state({"current": index + 1, "status_message": f"Товар {index + 1}/{total}: загрузка фото"})
            await update(job_id, current=index + 1, message=f"Товар {index + 1}/{total}: загрузка фото", generated_files=[])
            if req.filter_ads and any(word in post["text"].lower() for word in ("реклама", "подпишись")):
                continue
            data = await collect_album(client, donor, post)
            # Durable per-owner/donor/message/target history prevents repeat publication/spending.
            async with async_session() as db:
                history = (await db.execute(select(ProductParserJob).where(ProductParserJob.user_id == user_id))).scalars().all()
                published = {key for item in history for key in item.progress.get("published", [])}
            uncertain = {item.progress.get("pending_target") for item in history if item.progress.get("pending_target")}
            targets = [target for target in req.targets if f"{donor}:{post['id']}:{clean_channel(target)}" not in published]
            if any(f"{donor}:{post['id']}:{clean_channel(target)}" in uncertain for target in targets):
                raise ValueError("У прошлого запуска неизвестен результат отправки этого товара. Проверьте целевой канал; автоматическая повторная отправка заблокирована.")
            if not targets:
                logs.insert(0, {"text": "Пропущен уже опубликованный товар", "status": "skipped"})
                continue
            # Text preparation must succeed before paid image edits.
            text, article = await prepare_post(req, post, donor, user)
            manager.update_state({"status_message": f"Товар {index + 1}: генерация {len(data)} фото"})
            paths = await generate_album(job_id, user_id, data, models, {**payload, "caption": post["text"]}, req.quality,
                                         lambda: manager.get_state()["should_stop"])
            if manager.get_state()["should_stop"]:
                final = "stopped"
                break
            for target in targets:
                if manager.get_state()["should_stop"]:
                    final = "stopped"
                    break
                destination = clean_channel(target)
                marker = f"{donor}:{post['id']}:{destination}"
                # Persist uncertainty before Telegram send. No automatic send retry.
                await update(job_id, message=f"Отправка альбома в {destination}", pending_target=marker)
                sent = await client.send_file(destination, [str(path) for path in paths], caption=text)
                sent_id = sent[0].id if isinstance(sent, list) else sent.id
                published.add(marker)
                await update(job_id, published=sorted(published), pending_target=None)
                async with async_session() as db:
                    db.add(ParsedPostItem(title=text.splitlines()[0][:120], original_text=post["text"], processed_text=text,
                                         source_channel=donor, source_msg_id=post["id"], target_channel=destination,
                                         target_msg_id=sent_id, media_count=len(paths), status="published",
                                         target_post_url=f"https://t.me/{destination.lstrip('@')}/{sent_id}"))
                    if article:
                        from database.models import ArticleItem
                        row = await db.get(ArticleItem, article)
                        row.target_msg_id, row.target_channel = sent_id, destination
                        row.telegram_post_url = f"https://t.me/{destination.lstrip('@')}/{sent_id}"
                        row.media_urls = [str(item.id) for item in sent] if isinstance(sent, list) else [str(sent.id)]
                    await db.commit()
            if manager.get_state()["should_stop"]:
                final = "stopped"
                break
            if req.module == "store" and req.sync_to_miniapp:
                from database.models import MiniAppPost
                from core.product_pricing import prices
                calculated = prices(post["text"], req)
                async with async_session() as db:
                    db.add(MiniAppPost(title=text.splitlines()[0][:120], text=text,
                                       price=f"{calculated['retail']} {req.currency}" if calculated else None,
                                       source_channel=donor, target_channel=targets[0], category="Store", media_urls=[]))
                    await db.commit()
            logs.insert(0, {"text": f"Товар {post['id']}: {len(paths)} фото", "status": "success"})
            await update(job_id, logs=logs[:50])
            if req.live_monitoring or index + 1 < len(posts):
                for seconds in range(req.interval_seconds, 0, -1):
                    if manager.get_state()["should_stop"]:
                        break
                    manager.update_state({"countdown_sec": seconds, "status_message": "Пауза между товарами"})
                    await asyncio.sleep(1)
        if manager.get_state()["should_stop"]:
            final = "stopped"
    except asyncio.CancelledError:
        final = "interrupted"
    except Exception as exc:
        final = "stopped" if manager.get_state()["should_stop"] else "failed"
        error = str(exc) if isinstance(exc, ValueError) else "Ошибка подготовки, провайдера или Telegram. Автоповтор отключён; проверьте готовые фото и последний целевой канал."
        logs.insert(0, {"text": error, "status": "error"})
    finally:
        message = {"completed": "Фоновый перенос завершён", "stopped": "Остановлено пользователем",
                   "failed": "Перенос остановлен после ошибки", "interrupted": "Перенос прерван"}[final]
        try:
            async with async_session() as db:
                row = await db.get(ProductParserJob, job_id)
                row.status = final
                row.progress = {**row.progress, "message": message, "logs": logs[:50]}
                await db.commit()
        finally:
            manager.update_state({"is_running": False, "is_live_monitoring": False, "countdown_sec": 0, "status_message": message})
            for log in logs[:50]:
                manager.add_log("Фото товара", log["text"], log["status"])
            workers.pop(user_id, None)
