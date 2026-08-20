"""
core/brain.py

Pipeline-оркестратор: получает новое сообщение из listener,
находит активные проекты с этим донором, прогоняет через pipeline,
публикует результат.

Pipeline:
  1. Дедупликация по SimHash (editorial_memory)
  2. AI рерайт через Gemini (/api/ai/rewrite на себя, или напрямую)
  3. Публикация через Telethon (tg_manager.client.send_message)
  4. Запись результата в таблицу posts
"""

import logging
import os
from typing import List, Optional
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database.session import async_session
from database.models import Project, Donor, ProjectDonor, Post
from telegram_service.models import TelegramMessage
from telegram_service.editorial_memory.service import editorial_memory

logger = logging.getLogger(__name__)

# Gemini API ключ берём из окружения (тот же что и в server.py)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")


class ProjectBrain:

    # -------------------------------------------------------
    # Главная точка входа
    # -------------------------------------------------------

    async def process_new_entry(self, message: TelegramMessage):
        """
        Вызывается из listener при каждом новом посте в канале-доноре.
        """
        logger.info(
            f"[Brain] New entry: msg_id={message.message_id} "
            f"chat_id={message.chat_id} user=@{message.chat_username} text_len={len(message.text or '')}"
        )

        if not message.text and not message.has_media:
            logger.debug("[Brain] Empty message without text or media — skip")
            return

        # Ищем активные проекты, подписанные на этого донора
        active_projects = await self.get_projects_by_donor(message)

        if not active_projects:
            logger.info(f"[Brain] No active projects for donor (id={message.chat_id}, @{message.chat_username})")
            return

        for project in active_projects:
            logger.info(f"[Brain] Running pipeline for project '{project.name}' ({project.id})")
            await self.run_pipeline(message, project)

    # -------------------------------------------------------
    # РЕАЛИЗАЦИЯ: гибкий поиск проектов по донору
    # -------------------------------------------------------

    async def get_projects_by_donor(self, message: TelegramMessage) -> List[Project]:
        """
        Находит проекты по числовому ID, @username или ссылке на канал.
        """
        candidates = set()
        cid = str(message.chat_id)
        candidates.add(cid)
        candidates.add(f"-100{cid.lstrip('-')}")
        candidates.add(cid.lstrip('-'))
        if cid.startswith("-100"):
            candidates.add(cid[4:])

        if message.chat_username:
            u = message.chat_username.strip().lstrip('@')
            candidates.add(f"@{u}")
            candidates.add(u)
            candidates.add(f"https://t.me/{u}")
            candidates.add(f"http://t.me/{u}")
            candidates.add(f"t.me/{u}")

        try:
            async with async_session() as session:
                from sqlalchemy import or_

                # Ищем доноров по всем возможным вариантам написания
                conditions = [Donor.telegram_id.in_(list(candidates))]
                if message.chat_username:
                    conditions.append(Donor.username.ilike(f"%{message.chat_username.strip().lstrip('@')}%"))
                    conditions.append(Donor.telegram_id.ilike(f"%{message.chat_username.strip().lstrip('@')}%"))

                donor_result = await session.execute(
                    select(Donor).where(or_(*conditions))
                )
                donors = donor_result.scalars().all()

                if not donors:
                    logger.debug(f"[Brain] Donor '{cid}' (@{message.chat_username}) not found in DB candidates: {candidates}")
                    return []

                donor_ids = [d.id for d in donors]

                # Получаем проекты через join с project_donors
                projects_result = await session.execute(
                    select(Project)
                    .join(ProjectDonor, Project.id == ProjectDonor.project_id)
                    .where(
                        ProjectDonor.donor_id.in_(donor_ids),
                        Project.is_active == True,
                    )
                    .options(selectinload(Project.donors))
                )
                projects = projects_result.scalars().all()
                logger.info(
                    f"[Brain] Found {len(projects)} active project(s) "
                    f"for donor '{cid}' (@{message.chat_username})"
                )
                return list(projects)

        except Exception as e:
            logger.error(f"[Brain] get_projects_by_donor error: {e}")
            return []

    # -------------------------------------------------------
    # Pipeline обработки
    # -------------------------------------------------------

    async def run_pipeline(self, message: TelegramMessage, project: Project):
        """
        Полный конвейер для одного поста:
          1. Дедупликация
          2. AI рерайт (если включён)
          3. Публикация
          4. Сохранение в БД
        """
        post_id = None
        status = "failed"
        processed_text = message.text or ""

        try:
            # ---- Этап 1: Дедупликация ----
            if processed_text:
                post_id = await editorial_memory.check_and_register(
                    project_id=project.id,
                    user_id=project.user_id,
                    text=processed_text,
                    source_url=f"https://t.me/c/{message.chat_id}/{message.message_id}",
                )

                if not post_id:
                    logger.info(f"[Pipeline] DUPLICATE detected — skip (project={project.id})")
                    await self._save_post(project, message, processed_text, "duplicate", None)
                    return

            # ---- Этап 2: AI рерайт ----
            ai_failed = False
            if project.rewrite_enabled and processed_text:
                try:
                    processed_text = await self._rewrite(
                        text=processed_text,
                        prompt=project.rewrite_prompt,
                        remove_links=project.remove_links,
                    )
                except Exception as ai_err:
                    logger.error(f"[Pipeline] AI rewrite failed: {ai_err}")
                    ai_failed = True

            elif project.remove_links and processed_text:
                # Убираем ссылки без AI
                processed_text = self._strip_links(processed_text)

            # ---- Этап 3: Публикация ----
            use_original_fallback = getattr(project, "use_original_on_error", False)
            if ai_failed and not use_original_fallback:
                status = "pending_retry"
                logger.warning(
                    f"[Pipeline] AI error on post {message.message_id} and use_original_on_error=False. "
                    f"Post saved with status='pending_retry'. SKIPPING PUBLISH."
                )
            else:
                await self._publish(project.target_channel_id, processed_text, user_id=project.user_id, message=message)
                status = "published"
                logger.info(f"[Pipeline] Published to {project.target_channel_id}")

        except Exception as e:
            logger.error(f"[Pipeline] Error in pipeline for project {project.id}: {e}")
            status = "failed"

        finally:
            # ---- Этап 4: Запись в БД ----
            await self._save_post(project, message, processed_text, status, post_id)

    # -------------------------------------------------------
    # AI рерайт
    # -------------------------------------------------------

    async def _rewrite(
        self,
        text: str,
        prompt: Optional[str],
        remove_links: bool,
    ) -> str:
        """Вызывает Gemini API для рерайта текста через ai_rewriter."""
        from core.ai_rewriter import call_gemini_with_retry

        link_instruction = (
            "УДАЛИ все внешние ссылки (http/https) и упоминания (@) из текста."
            if remove_links
            else "Сохрани ссылки как есть."
        )

        user_prompt = prompt or (
            "Перепиши следующий текст поста для Telegram-канала. "
            "Сделай его ярким, вовлекающим, добавь подходящие эмодзи и разбей на читаемые абзацы. "
            "Верни ТОЛЬКО готовый текст без вступлений и мета-комментариев."
        )

        full_prompt = (
            f"{user_prompt}\n\n"
            f"Правила:\n1. {link_instruction}\n2. Сохрани все ключевые факты и суть оригинала.\n\n"
            f"Исходный текст:\n\"{text}\""
        )

        rewritten, tokens = await call_gemini_with_retry(
            text=text,
            prompt=full_prompt,
            system_prompt="Ты профессиональный SMM-редактор и копирайтер Telegram-каналов.",
        )
        logger.info(f"[AI] Rewrite done: {len(text)} → {len(rewritten)} chars (tokens={tokens})")
        return rewritten

    # -------------------------------------------------------
    # Публикация
    # -------------------------------------------------------

    async def _publish(
        self,
        target_channel: str,
        text: str,
        user_id: Optional[str] = None,
        message: Optional[TelegramMessage] = None
    ):
        """Отправляет сообщение в целевой канал (или несколько целевых каналов через запятую).
        Поддерживает прикрепление медиа из исходного сообщения.
        """
        targets = [t.strip() for t in target_channel.split(',') if t.strip()]
        if not targets:
            return

        client = None
        if user_id:
            from telegram_service.client import user_clients
            from database.session import async_session
            from database.models import User

            async with async_session() as s:
                from sqlalchemy import select as sa_select
                u_res = await s.execute(sa_select(User).where(User.id == user_id))
                user = u_res.scalar_one_or_none()
            if not user:
                raise RuntimeError(f"Владелец проекта {user_id} не найден")
            client = await user_clients.get_client(user)
        else:
            from telegram_service.client import tg_manager
            if not await tg_manager.is_authorized():
                raise RuntimeError("Telegram не авторизован")
            client = tg_manager.client

        # Скачиваем медиа если пост содержал медиа
        media_file = None
        temp_dir = os.path.join(os.getcwd(), "temp_media")
        os.makedirs(temp_dir, exist_ok=True)

        if message and message.has_media and getattr(message, 'raw_event', None) and getattr(message.raw_event, 'message', None):
            try:
                media_file = await client.download_media(message.raw_event.message, file=temp_dir)
            except Exception as dl_err:
                logger.warning(f"[Publish] Could not download media for msg {message.message_id}: {dl_err}")

        try:
            for target in targets:
                clean_target = target.strip()
                if not clean_target.startswith('@') and not clean_target.startswith('-') and not clean_target.isdigit():
                    clean_target = f"@{clean_target}"

                try:
                    if media_file and os.path.exists(media_file):
                        await client.send_file(clean_target, media_file, caption=text)
                    else:
                        await client.send_message(clean_target, text)
                    logger.info(f"[Publish] Sent successfully to {clean_target}")
                except Exception as t_err:
                    logger.error(f"[Publish] Failed to send to target {clean_target}: {t_err}")
        finally:
            if media_file and os.path.exists(media_file):
                try:
                    os.remove(media_file)
                except Exception:
                    pass

    # -------------------------------------------------------
    # Удаление ссылок (без AI)
    # -------------------------------------------------------

    @staticmethod
    def _strip_links(text: str) -> str:
        """Убирает http/https ссылки и @упоминания из текста."""
        import re
        text = re.sub(r'https?://\S+', '', text)
        text = re.sub(r'@\w+', '', text)
        text = re.sub(r'\s{2,}', ' ', text)
        return text.strip()

    # -------------------------------------------------------
    # Сохранение поста в БД
    # -------------------------------------------------------

    async def _save_post(
        self,
        project: Project,
        message: TelegramMessage,
        processed_text: str,
        status: str,
        post_id: Optional[str],
    ):
        """Записывает запись о посте в таблицу posts."""
        try:
            from telegram_service.editorial_memory.fingerprinter import get_text_hash

            async with async_session() as session:
                post = Post(
                    id=post_id or __import__('uuid').uuid4().__str__(),
                    project_id=project.id,
                    content_hash=get_text_hash(message.text),
                    original_text=message.text[:4000] if message.text else "",
                    processed_text=processed_text[:4000] if processed_text else "",
                    media_type=message.media_type or "none",
                    telegram_msg_id=message.message_id,
                    status=status,
                    created_at=datetime.utcnow(),
                    ai_decision_log={"status": status, "has_rewrite": project.rewrite_enabled},
                )
                session.add(post)
                await session.commit()
                logger.debug(f"[DB] Post saved: {post.id} status={status}")
        except Exception as e:
            logger.error(f"[DB] Failed to save post: {e}")


# Singleton
brain = ProjectBrain()
