"""
core/ai_key_manager.py

Менеджер AI-ключей с гибридной архитектурой:

  1. Ключи ПЛАТФОРМЫ (admin → /api/admin/ai-keys):
     - Хранятся в таблице platform_ai_keys (зашифрованы Fernet)
     - Ротация при превышении лимита/429: выбирается следующий активный ключ
     - Суточный счётчик requests_today, сброс в полночь

  2. ЛИЧНЫЙ ключ пользователя (PRO/Business):
     - Хранится в Project.ai_api_key_encrypted
     - Используется если Project.ai_provider != "platform"

  3. Тарифные лимиты (fallback-проверка если платформенный ключ):
     Free:     10  рерайтов/день
     Starter: 100  рерайтов/день
     Pro:     500  рерайтов/день (или ∞ если свой ключ)
     Business: ∞

Использование в server.py:
    from core.ai_key_manager import AiKeyManager
    key, provider = await AiKeyManager.resolve_key(project, user, db)
"""

import logging
from datetime import datetime, date
from typing import Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

logger = logging.getLogger(__name__)

# ── Тарифные лимиты ────────────────────────────────────────────────────────
TIER_DAILY_LIMITS: dict[str, Optional[int]] = {
    "free":     10,
    "starter":  100,
    "pro":      500,
    "business": None,   # None = безлимит
}


class AiKeyManager:
    """Статический класс-фасад для получения нужного AI-ключа."""

    @staticmethod
    async def resolve_key(
        project,           # ORM Project
        user,              # ORM User
        db: AsyncSession,
    ) -> Tuple[str, str]:
        """
        Возвращает (api_key, provider_name) для данного проекта/пользователя.

        Логика:
          1. Если project.ai_provider != "platform" И у пользователя PRO/Business
             → расшифровываем и возвращаем личный ключ
          2. Иначе → выбираем ключ платформы с ротацией
          3. Проверяем суточный лимит пользователя

        Raises:
            ValueError("QUOTA_EXCEEDED") — дневной лимит исчерпан
            RuntimeError("NO_PLATFORM_KEY") — нет активных ключей в БД
        """
        today = str(date.today())

        # ─── Проверяем тарифный лимит (только для ключей платформы) ─────────
        if project.ai_provider == "platform":
            limit = TIER_DAILY_LIMITS.get(user.subscription_tier, 10)
            if limit is not None:
                # Сбрасываем счётчик если новый день
                if user.ai_rewrites_reset_date != today:
                    user.ai_rewrites_today = 0
                    user.ai_rewrites_reset_date = today
                    db.add(user)

                if user.ai_rewrites_today >= limit:
                    raise ValueError(
                        f"QUOTA_EXCEEDED|{user.ai_rewrites_today}|{limit}|{user.subscription_tier}"
                    )

        # ─── Личный ключ пользователя (PRO / Business) ───────────────────────
        if project.ai_provider != "platform" and project.ai_api_key_encrypted:
            allowed_tiers = {"pro", "business"}
            if user.subscription_tier not in allowed_tiers:
                raise ValueError(
                    "OWN_KEY_NOT_ALLOWED|Личный AI ключ доступен только на тарифах Pro и Business"
                )
            from core.crypto import safe_decrypt
            raw_key = safe_decrypt(project.ai_api_key_encrypted, fallback="")
            if not raw_key:
                raise RuntimeError("DECRYPT_FAILED|Не удалось расшифровать личный AI ключ")

            provider_map = {
                "own_gemini":     "gemini",
                "own_openrouter": "openrouter",
            }
            provider = provider_map.get(project.ai_provider, "gemini")
            logger.info(f"[AiKeyManager] Using own {provider} key for project {project.id}")
            return raw_key, provider

        # ─── Ключи платформы с ротацией ──────────────────────────────────────
        from database.models import PlatformAiKey
        result = await db.execute(
            select(PlatformAiKey)
            .where(and_(
                PlatformAiKey.is_active == True,
                PlatformAiKey.provider == "gemini",
            ))
            .order_by(PlatformAiKey.priority.desc(), PlatformAiKey.requests_today.asc())
        )
        keys = result.scalars().all()

        if not keys:
            raise RuntimeError("NO_PLATFORM_KEY|Нет активных AI-ключей платформы. Добавьте ключи в /api/admin/ai-keys")

        # Выбираем лучший ключ: приоритет → меньше запросов сегодня → не в cooldown
        chosen = None
        for k in keys:
            # Сбрасываем счётчик если новый день
            if k.last_reset_date != today:
                k.requests_today = 0
                k.last_reset_date = today
                db.add(k)

            # Пропускаем если превышен дневной лимит
            if k.daily_limit and k.requests_today >= k.daily_limit:
                continue

            # Пропускаем если был 429 менее 60 секунд назад
            if k.last_error_at:
                seconds_since_error = (datetime.utcnow() - k.last_error_at).total_seconds()
                if seconds_since_error < 60:
                    continue

            chosen = k
            break

        if not chosen:
            # Все ключи на cooldown — берём первый доступный без учёта cooldown
            for k in keys:
                if not k.daily_limit or k.requests_today < k.daily_limit:
                    chosen = k
                    break

        if not chosen:
            raise RuntimeError("NO_PLATFORM_KEY|Все ключи платформы исчерпали дневной лимит")

        from core.crypto import safe_decrypt
        raw_key = safe_decrypt(chosen.key_encrypted, fallback="")
        if not raw_key:
            raise RuntimeError("DECRYPT_FAILED|Не удалось расшифровать ключ платформы")

        # Инкрементируем счётчик
        chosen.requests_today += 1
        db.add(chosen)

        # Инкрементируем счётчик пользователя
        if user.ai_rewrites_reset_date != today:
            user.ai_rewrites_today = 0
            user.ai_rewrites_reset_date = today
        user.ai_rewrites_today = (user.ai_rewrites_today or 0) + 1
        db.add(user)

        await db.commit()

        logger.info(
            f"[AiKeyManager] Platform key {chosen.key_prefix}... "
            f"({chosen.requests_today} req today) for user {user.id} [{user.subscription_tier}]"
        )
        return raw_key, "gemini"

    @staticmethod
    async def mark_key_error(key_id: str, db: AsyncSession) -> None:
        """Отмечает ключ платформы как получивший 429 (cooldown)."""
        from database.models import PlatformAiKey
        result = await db.execute(select(PlatformAiKey).where(PlatformAiKey.id == key_id))
        key = result.scalar_one_or_none()
        if key:
            key.last_error_at = datetime.utcnow()
            db.add(key)
            await db.commit()

    @staticmethod
    def get_tier_info(subscription_tier: str, rewrites_today: int) -> dict:
        """Возвращает информацию о лимитах тарифа (для фронтенда)."""
        limit = TIER_DAILY_LIMITS.get(subscription_tier, 10)
        return {
            "tier": subscription_tier,
            "daily_limit": limit,
            "used_today": rewrites_today or 0,
            "remaining": (limit - (rewrites_today or 0)) if limit is not None else None,
            "is_unlimited": limit is None,
        }
