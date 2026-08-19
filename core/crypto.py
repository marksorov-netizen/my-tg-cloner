"""
core/crypto.py

Симметричное шифрование чувствительных данных через Fernet (AES-128-CBC + HMAC-SHA256).

Использование:
    from core.crypto import encrypt, decrypt

    hash_encrypted = encrypt(raw_api_hash)
    raw_api_hash   = decrypt(hash_encrypted)

Переменные окружения:
    ENCRYPTION_KEY  — base64-url-encoded 32-байтный ключ (44 символа).
                      Сгенерировать: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

ВАЖНО: Если ENCRYPTION_KEY не задан в .env, модуль поднимает ValueError при импорте.
"""

import os
import logging

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

ENCRYPTION_KEY: str | None = os.getenv("ENCRYPTION_KEY")

if not ENCRYPTION_KEY:
    raise ValueError(
        "ENCRYPTION_KEY must be set in .env\n"
        "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
    )

try:
    _fernet = Fernet(ENCRYPTION_KEY.encode())
except Exception as exc:
    raise ValueError(f"Invalid ENCRYPTION_KEY format: {exc}") from exc


def encrypt(text: str) -> str:
    """
    Шифрует строку симметричным ключом.
    Возвращает base64url-строку, безопасную для хранения в TEXT-колонке БД.
    Пустая строка → пустая строка (без шифрования).
    """
    if not text:
        return ""
    try:
        return _fernet.encrypt(text.encode()).decode()
    except Exception as exc:
        logger.error(f"[crypto] encrypt failed: {exc}")
        raise


def decrypt(encrypted: str) -> str:
    """
    Расшифровывает строку, зашифрованную функцией encrypt().
    Пустая строка → пустая строка.
    Бросает InvalidToken при повреждении данных или неверном ключе.
    """
    if not encrypted:
        return ""
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except InvalidToken:
        logger.error("[crypto] decrypt failed — invalid token or wrong key")
        raise
    except Exception as exc:
        logger.error(f"[crypto] decrypt error: {exc}")
        raise


def safe_decrypt(encrypted: str, fallback: str = "") -> str:
    """
    Расшифровывает без исключений — удобно для чтения из БД.
    При ошибке возвращает fallback (по умолчанию пустая строка).
    """
    try:
        return decrypt(encrypted)
    except Exception:
        return fallback
