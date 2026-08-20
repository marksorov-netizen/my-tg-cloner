"""
telegram_service/listener.py

Подписывается на новые сообщения в каналах-донорах через Telethon.
При получении нового поста передаёт его в brain.process_new_entry().

Ключевые исправления vs оригинал:
  - handler теперь вызывает brain.process_new_entry() (а не просто логирует)
  - register_listeners() безопасно сбрасывает старые handlers перед установкой новых
  - Добавлена защита от пустых сообщений и ошибок в handler
"""

import asyncio
import logging
from telethon import events
from telethon.tl.types import PeerChannel

from .models import TelegramMessage

logger = logging.getLogger(__name__)


def build_message(event) -> TelegramMessage:
    """Превращает событие Telethon во внутреннюю модель."""
    msg = event.message
    has_media = msg.media is not None
    media_type = None

    if has_media:
        if msg.photo:
            media_type = "photo"
        elif msg.video:
            media_type = "video"
        elif msg.document:
            media_type = "document"
        else:
            media_type = "other"

    # chat_id может быть отрицательным (каналы в Telethon) или объектом PeerChannel
    chat_id = event.chat_id
    if isinstance(chat_id, PeerChannel):
        chat_id = chat_id.channel_id

    chat_username = None
    try:
        if getattr(event, 'chat', None) and getattr(event.chat, 'username', None):
            chat_username = event.chat.username
    except Exception:
        pass

    return TelegramMessage(
        message_id=msg.id,
        chat_id=chat_id,
        text=msg.text or "",
        date=msg.date,
        sender_id=msg.sender_id,
        has_media=has_media,
        media_type=media_type,
        raw_event=event,
        chat_username=chat_username,
    )


async def register_listeners(client, chat_ids=None):
    """
    Регистрирует event handler для новых сообщений с предварительным резолвингом сущностей.

    Args:
        client: Telethon TelegramClient
        chat_ids: список каналов-доноров (@username или числовые ID).
                  None = слушаем все входящие (не рекомендуется в prod).

    Важно: безопасно вызывать повторно — сбрасывает все старые handlers.
    """
    from core.brain import brain

    # Сброс всех предыдущих handlers чтобы не было дублей
    try:
        for handler, _ in list(client.list_event_handlers()):
            client.remove_event_handler(handler)
        logger.info("Cleared previous event handlers.")
    except Exception as e:
        logger.warning(f"Could not clear handlers: {e}")

    async def handler(event):
        """Неблокирующий обработчик нового сообщения — запускает brain в фоне."""
        try:
            # Игнорируем служебные/пустые сообщения
            if not event.message:
                return

            data = build_message(event)
            logger.info(
                f"[Listener] New message: id={data.message_id} "
                f"chat={data.chat_id} (user=@{data.chat_username}) len={len(data.text or '')}"
            )

            # Передаём в pipeline в отдельном асинхронном таске, чтобы не блокировать event loop
            asyncio.create_task(brain.process_new_entry(data))

        except Exception as e:
            logger.error(f"[Listener] Handler error: {e}", exc_info=True)

    # Резолвинг и регистрация handler
    if chat_ids:
        resolved_chats = []
        for ch in chat_ids:
            clean_ch = str(ch).strip()
            if not clean_ch:
                continue
            try:
                # Резолвим entity в Telethon для надёжного матчинга обновлений
                entity = await client.get_entity(clean_ch)
                resolved_chats.append(entity)
            except Exception as ent_err:
                logger.warning(f"[Listener] Could not resolve entity '{clean_ch}': {ent_err}. Using string.")
                resolved_chats.append(clean_ch)

        client.add_event_handler(
            handler,
            events.NewMessage(chats=resolved_chats, incoming=True)
        )
        logger.info(
            f"[Listener] Registered on {len(resolved_chats)} channel(s): {chat_ids}"
        )
    else:
        client.add_event_handler(handler, events.NewMessage(incoming=True))
        logger.info("[Listener] Registered on ALL incoming messages")

    return handler

