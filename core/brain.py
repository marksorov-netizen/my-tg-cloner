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
            f"chat_id={message.chat_id} text_len={len(message.text or '')}"
        )

        if not message.text or not message.text.strip():
            logger.debug("[Brain] Empty text — skip")
            return

        # Ищем активные проекты, подписанные на этого донора
        active_projects = await self.get_projects_by_donor(str(message.chat_id))

        if not active_projects:
            logger.info(f"[Brain] No active projects for donor {message.chat_id}")
            return

        for project in active_projects:
            logger.info(f"[Brain] Running pipeline for project '{project.name}' ({project.id})")
            await self.run_pipeline(message, project)

    # -------------------------------------------------------
    # РЕАЛИЗАЦИЯ: поиск проектов по донору
    # -------------------------------------------------------

    async def get_projects_by_donor(self, donor_id: str) -> List[Project]:
        """
        Возвращает все активные проекты, у которых есть донор с telegram_id == donor_id.

        SQL (упрощённо):
            SELECT projects.*
            FROM projects
            JOIN project_donors ON projects.id = project_donors.project_id
            JOIN donors ON project_donors.donor_id = donors.id
            WHERE donors.telegram_id = :donor_id
              AND projects.is_active = true
        """
        try:
            async with async_session() as session:
                # Ищем донора по telegram_id
                donor_result = await session.execute(
                    select(Donor).where(Donor.telegram_id == donor_id)
                )
                donor = donor_result.scalar_one_or_none()

                if not donor:
                    # Канал может быть задан как @username, но chat_id приходит числом
                    # Попробуем найти по числовому ID (если донор сохранён как строка)
                    logger.debug(f"[Brain] Donor '{donor_id}' not found in DB")
                    return []

                # Получаем проекты через join с project_donors
                projects_result = await session.execute(
                    select(Project)
                    .join(ProjectDonor, Project.id == ProjectDonor.project_id)
                    .where(
                        ProjectDonor.donor_id == donor.id,
                        Project.is_active == True,
                    )
                    .options(selectinload(Project.donors))
                )
                projects = projects_result.scalars().all()
                logger.info(
                    f"[Brain] Found {len(projects)} active project(s) "
                    f"for donor '{donor_id}'"
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
        processed_text = message.text

        try:
            # ---- Этап 1: Дедупликация ----
            post_id = await editorial_memory.check_and_register(
                project_id=project.id,
                user_id=project.user_id,
                text=message.text,
                source_url=f"https://t.me/c/{message.chat_id}/{message.message_id}",
            )

            if not post_id:
                logger.info(f"[Pipeline] DUPLICATE detected — skip (project={project.id})")
                await self._save_post(project, message, message.text, "duplicate", None)
                return

            # ---- Этап 2: AI рерайт ----
            ai_failed = False
            if project.rewrite_enabled:
                try:
                    processed_text = await self._rewrite(
                        text=message.text,
                        prompt=project.rewrite_prompt,
                        remove_links=project.remove_links,
                    )
                except Exception as ai_err:
                    logger.error(f"[Pipeline] AI rewrite failed: {ai_err}")
                    ai_failed = True

            elif project.remove_links:
                # Убираем ссылки без AI
                processed_text = self._strip_links(message.text)

            # ---- Этап 3: Публикация ----
            use_original_fallback = getattr(project, "use_original_on_error", False)
            if ai_failed and not use_original_fallback:
                status = "pending_retry"
                logger.warning(
                    f"[Pipeline] AI error on post {message.message_id} and use_original_on_error=False. "
                    f"Post saved with status='pending_retry'. SKIPPING PUBLISH."
                )
            else:
                await self._publish(project.target_channel_id, processed_text, user_id=project.user_id)
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
            "Сделай его продающим, добавь эмодзи. "
            "Верни ТОЛЬКО готовый текст без вступлений."
        )

        full_prompt = (
            f"{user_prompt}\n\n"
            f"Дополнительно: {link_instruction}\n\n"
            f"Исходный текст:\n\"{text}\""
        )

        rewritten, tokens = await call_gemini_with_retry(
            text=text,
            prompt=full_prompt,
            system_prompt="Ты профессиональный SMM-менеджер Telegram-каналов.",
        )
        logger.info(f"[AI] Rewrite done: {len(text)} → {len(rewritten)} chars (tokens={tokens})")
        return rewritten

    # -------------------------------------------------------
    # Публикация
    # -------------------------------------------------------

    async def _publish(self, target_channel: str, text: str, user_id: Optional[str] = None):
        """Отправляет сообщение в целевой канал через Telethon.

        В многопользовательском режиме публикуем клиентом ВЛАДЕЛЬЦА проекта,
        а не глобальным системным клиентом.
        """
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
            try:
                client = await user_clients.get_client(user)
            except ValueError as e:
                raise RuntimeError(f"Нет активной сессии Telegram у владельца проекта: {e}")
            await client.send_message(target_channel, text)
            return

        from telegram_service.client import tg_manager

        if not await tg_manager.is_authorized():
            raise RuntimeError("Telegram не авторизован")

        await tg_manager.client.send_message(target_channel, text)

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
