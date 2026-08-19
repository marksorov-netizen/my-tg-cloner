"""
editorial_memory/service.py

Фасад для системы дедупликации контента.
Использует lazy-инициализацию БД через get_editorial_db().
"""

import logging
from typing import Optional

from .fingerprinter import get_text_hash, get_media_hash
from .database import get_editorial_db

logger = logging.getLogger(__name__)


class EditorialMemoryService:
    """
    Проверяет входящие посты на дубликаты.
    Использует:
      - Layer 1: SimHash текста + pHash изображений (быстро, точно)
      - Layer 2: Семантический поиск через embeddings (TODO)
    """

    async def check_and_register(
        self,
        project_id: str,
        user_id: str,
        text: str,
        media_bytes: Optional[list] = None,
        source_url: Optional[str] = None,
    ) -> Optional[str]:
        """
        Проверяет сообщение на дубликат.
        Если уникально — регистрирует в базе и возвращает ID.
        Если дубль — возвращает None.

        Args:
            project_id: UUID проекта
            user_id: UUID пользователя
            text: текст поста
            media_bytes: список байт медиафайлов (опционально)
            source_url: исходная ссылка на пост (опционально)

        Returns:
            str: UUID нового поста, если уникален
            None: если дубликат
        """
        # 1. Считаем хэш текста
        content_hash = get_text_hash(text)

        # 2. Считаем хэши медиа (если есть)
        media_hashes = []
        if media_bytes:
            for b in media_bytes:
                media_hashes.append(get_media_hash(b))

        # 3. Получаем БД (lazy init, не крашит при старте)
        try:
            db = await get_editorial_db()
        except Exception as e:
            logger.error(
                f"EditorialDB недоступна: {e}. "
                f"Пост {source_url!r} будет обработан без проверки дубликатов."
            )
            # Graceful degradation: если БД недоступна, не блокируем пайплайн
            import uuid
            return str(uuid.uuid4())

        # 4. Атомарная попытка записи в БД (Layer 1)
        post_id = await db.insert_if_new(
            project_id=project_id,
            user_id=user_id,
            content_hash=content_hash,
            media_hashes=media_hashes,
            source_url=source_url,
        )

        if post_id:
            logger.info(
                f"New unique content registered: {post_id} "
                f"(Hash: {content_hash[:12]}...)"
            )
            return post_id
        else:
            logger.info(f"Duplicate detected by hash: {content_hash[:12]}...")
            return None


# Singleton экземпляр сервиса (сам по себе не держит соединений)
editorial_memory = EditorialMemoryService()
