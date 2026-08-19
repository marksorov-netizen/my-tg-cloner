
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Any

@dataclass
class TelegramMessage:
    message_id: int
    chat_id: int
    text: Optional[str]
    date: datetime
    sender_id: Optional[int]
    has_media: bool
    media_type: Optional[str]
    raw_event: Any  # Для доступа к низкоуровневым данным при необходимости
