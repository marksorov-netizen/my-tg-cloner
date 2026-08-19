"""
telegram_service/listener.py

Подписывается на новые сообщения в каналах-донорах через Telethon.
При получении нового поста передаёт его в brain.process_new_entry().

Ключевые исправления vs оригинал:
  - handler теперь вызывает brain.process_new_entry() (а не просто логирует)
  - register_listeners() безопасно сбрасывает старые handlers перед установкой новых
  - Добавлена защита от пустых сообщений и ошибок в handler
"""

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

    return TelegramMessage(
        message_id=msg.id,
        chat_id=chat_id,
        text=msg.text or "",
        date=msg.date,
        sender_id=msg.sender_id,
        has_media=has_media,
        media_type=media_type,
        raw_event=event,
    )


def register_listeners(client, chat_ids=None):
    """
    Регистрирует event handler для новых сообщений.

    Args:
        client: Telethon TelegramClient
        chat_ids: список каналов-доноров (@username или числовые ID).
                  None = слушаем все входящие (не рекомендуется в prod).

    Важно: безопасно вызывать повторно — сбрасывает все старые handlers.
    """
    from core.brain import brain

    # Сброс всех предыдущих handlers чтобы не было дублей
    # (Telethon не позволяет remove_event_handler(None), обходим через list)
    try:
        for handler, _ in list(client.list_event_handlers()):
            client.remove_event_handler(handler)
        logger.info("Cleared previous event handlers.")
    except Exception as e:
        logger.warning(f"Could not clear handlers: {e}")

    async def handler(event):
        """Обработчик нового сообщения — передаёт в brain pipeline."""
        try:
            # Игнорируем служебные/пустые сообщения
            if not event.message or not event.message.text:
                return

            data = build_message(event)
            logger.info(
                f"[Listener] New message: id={data.message_id} "
                f"chat={data.chat_id} len={len(data.text)}"
            )

            # Передаём в pipeline
            await brain.process_new_entry(data)

        except Exception as e:
            logger.error(f"[Listener] Handler error: {e}", exc_info=True)

    # Регистрируем handler
    if chat_ids:
        # Конвертируем @username в строки на случай если пришли числа
        normalized = [str(ch) for ch in chat_ids]
        client.add_event_handler(
            handler,
            events.NewMessage(chats=normalized, incoming=True)
        )
        logger.info(
            f"[Listener] Registered on {len(normalized)} channel(s): {normalized}"
        )
    else:
        client.add_event_handler(handler, events.NewMessage(incoming=True))
        logger.info("[Listener] Registered on ALL incoming messages")

    return handler  # возвращаем ссылку на handler (для тестов)
