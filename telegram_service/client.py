import os
import json
import logging
from typing import Optional, Dict, Any

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import (
    SessionPasswordNeededError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    PhoneNumberInvalidError,
    ApiIdInvalidError,
    FloodWaitError,
)

logger = logging.getLogger(__name__)

# Файл, в котором сохраняется авторизация пользователя.
# Данные приходят с сайта, поэтому .env для ключей больше не нужен.
SESSION_STORE = os.path.join(os.getcwd(), "user_session.json")


class TelegramManager:
    """
    Управляет одним пользовательским Telegram-клиентом.
    Ключи (api_id / api_hash) приходят из веб-интерфейса, а не из .env.

    Теперь вход (request_code/sign_in) ведётся ПО НОМЕРУ ТЕЛЕФОНА:
    два пользователя, запрашивающие код одновременно, не затирают сессии друг друга.
    self.client — «системный» клиент (legacy/бот заказов), входы пользователей — в _pending.
    """

    def __init__(self):
        self.client: Optional[TelegramClient] = None
        self.api_id: Optional[int] = None
        self.api_hash: Optional[str] = None
        self.phone: Optional[str] = None
        self.phone_code_hash: Optional[str] = None
        # phone -> {"client", "api_id", "api_hash", "phone_code_hash"}
        self._pending: Dict[str, Dict[str, Any]] = {}

    # ---------- Хранение сессии на диске ----------

    def _save_session(self):
        if not self.client:
            return
        try:
            data = {
                "api_id": self.api_id,
                "api_hash": self.api_hash,
                "phone": self.phone,
                "session": self.client.session.save(),
            }
            with open(SESSION_STORE, "w", encoding="utf-8") as f:
                json.dump(data, f)
            logger.info("Session saved to disk.")
        except Exception as e:
            logger.error(f"Failed to save session: {e}")

    def _load_session_data(self) -> Optional[Dict[str, Any]]:
        if not os.path.exists(SESSION_STORE):
            return None
        try:
            with open(SESSION_STORE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read session file: {e}")
            return None

    def clear_session(self):
        try:
            if os.path.exists(SESSION_STORE):
                os.remove(SESSION_STORE)
        except Exception as e:
            logger.error(f"Failed to remove session file: {e}")

    # ---------- Восстановление при старте сервера ----------

    async def restore(self) -> bool:
        """Пробует восстановить прошлую авторизацию. True — пользователь уже вошёл."""
        data = self._load_session_data()
        if not data:
            logger.info("No saved session. Waiting for credentials from the website.")
            return False

        try:
            self.api_id = int(data["api_id"])
            self.api_hash = data["api_hash"]
            self.phone = data.get("phone")
            self.client = TelegramClient(
                StringSession(data["session"]), self.api_id, self.api_hash
            )
            await self.client.connect()
            if await self.client.is_user_authorized():
                logger.info("Previous Telegram session restored successfully.")
                return True
            logger.warning("Saved session is no longer authorized.")
            return False
        except Exception as e:
            logger.error(f"Could not restore session: {e}")
            self.client = None
            return False

    # ---------- Шаг 1: запрос кода (per-phone, не затирает чужие входы) ----------

    async def request_code(self, api_id: str, api_hash: str, phone: str) -> dict:
        try:
            num_api_id = int(api_id)
        except (TypeError, ValueError):
            raise ValueError("API ID должен быть числом. Скопируйте его с my.telegram.org")

        clean_hash = (api_hash or "").strip()
        clean_phone = (phone or "").strip()

        if not clean_hash:
            raise ValueError("Укажите API Hash")
        if not clean_phone:
            raise ValueError("Укажите номер телефона")

        # Отдельная сессия под этот номер — параллельные входы не конфликтуют
        client = TelegramClient(StringSession(), num_api_id, clean_hash)
        await client.connect()

        try:
            sent = await client.send_code_request(clean_phone)
        except ApiIdInvalidError:
            await client.disconnect()
            raise ValueError("Неверные API ID или API Hash")
        except PhoneNumberInvalidError:
            await client.disconnect()
            raise ValueError("Неверный формат номера телефона")
        except FloodWaitError as e:
            await client.disconnect()
            raise ValueError(f"Слишком много попыток. Подождите {e.seconds} секунд")

        # Закрываем предыдущий незавершённый вход этого же номера, если был
        prev = self._pending.get(clean_phone)
        if prev and prev.get("client") is not client:
            try:
                await prev["client"].disconnect()
            except Exception:
                pass

        self._pending[clean_phone] = {
            "client": client,
            "api_id": num_api_id,
            "api_hash": clean_hash,
            "phone_code_hash": sent.phone_code_hash,
        }
        logger.info(f"Confirmation code sent to {self._mask_phone(clean_phone)}")
        return {"status": "code_sent"}

    @staticmethod
    def _mask_phone(phone: str) -> str:
        return phone[:-4] + "****" if phone and len(phone) > 4 else "****"

    # ---------- Шаг 2: вход по коду (per-phone) ----------

    async def sign_in(self, phone: str, code: str, password: Optional[str] = None) -> dict:
        clean_phone = (phone or "").strip()
        entry = self._pending.get(clean_phone)
        if not entry:
            raise ValueError("Сессия не начата. Сначала запросите код.")
        client: TelegramClient = entry["client"]

        try:
            await client.sign_in(
                phone=clean_phone,
                code=(code or "").strip(),
                phone_code_hash=entry["phone_code_hash"],
            )
        except PhoneCodeInvalidError:
            raise ValueError("Неверный код подтверждения")
        except PhoneCodeExpiredError:
            raise ValueError("Код устарел. Запросите новый.")
        except SessionPasswordNeededError:
            if not password:
                raise ValueError("Включена двухфакторная защита — нужен пароль (2FA)")
            await client.sign_in(password=password)

        me = await client.get_me()

        # Вошедший клиент становится системным (бот заказов / legacy-пути),
        # параллельные входы других номеров продолжают жить в _pending
        self.client = client
        self.api_id = entry["api_id"]
        self.api_hash = entry["api_hash"]
        self.phone = clean_phone
        self.phone_code_hash = None
        self._pending.pop(clean_phone, None)
        self._save_session()

        full_name = f"{me.first_name or ''} {me.last_name or ''}".strip() or me.username or clean_phone
        session_str = client.session.save()

        user_info = {
            "telegram_user_id": me.id,
            "phone_number": clean_phone or getattr(me, "phone", "") or "",
            "username": me.username or "",
            "full_name": full_name,
            "session_string": session_str,
            "api_id": self.api_id,
            "api_hash": self.api_hash,
        }

        logger.info(f"Telegram login successful: {me.username or full_name} (ID: {me.id})")
        return {"status": "authenticated", "user": me.username or full_name, "me": user_info}

    # ---------- Состояние ----------

    async def is_authorized(self) -> bool:
        if not self.client:
            return False
        try:
            if not self.client.is_connected():
                await self.client.connect()
            return await self.client.is_user_authorized()
        except Exception:
            return False

    async def get_me_details(self) -> Optional[dict]:
        if not await self.is_authorized():
            return None
        me = await self.client.get_me()
        full_name = f"{me.first_name or ''} {me.last_name or ''}".strip() or me.username or self.phone
        session_str = self.client.session.save() if self.client and self.client.session else ""
        return {
            "telegram_user_id": me.id,
            "phone_number": self.phone or getattr(me, "phone", "") or "",
            "username": me.username or "",
            "full_name": full_name,
            "session_string": session_str,
            "api_id": self.api_id,
            "api_hash": self.api_hash,
        }

    async def get_me_name(self) -> Optional[str]:
        details = await self.get_me_details()
        return details["username"] if details and details.get("username") else (details["full_name"] if details else None)

    async def logout(self):
        try:
            if self.client:
                await self.client.log_out()
                await self.client.disconnect()
        except Exception as e:
            logger.error(f"Logout error: {e}")
        finally:
            self.client = None
            self.phone_code_hash = None
            self.clear_session()
            logger.info("User logged out.")

    async def disconnect_all(self):
        if self.client and self.client.is_connected():
            await self.client.disconnect()
            logger.info("Telegram client disconnected.")


tg_manager = TelegramManager()


class UserClientManager:
    """
    Фабрика per-user Telegram-клиентов.

    Каждый пользователь сайта работает через СВОЙ аккаунт Telegram:
    сессия достаётся из БД (User.tg_session_string, зашифрован),
    клиент кэшируется по user_id и переиспользуется.

    Это ключевая часть многопользовательского режима: раньше все
    пользователи делили один глобальный клиент и затирали сессии друг друга.
    """

    def __init__(self, max_clients: int = 100):
        self._clients: Dict[str, TelegramClient] = {}
        self.max_clients = max_clients

    async def get_client(self, user) -> TelegramClient:
        """
        Возвращает подключённого клиента для пользователя (ORM-объект User).
        Бросает ValueError, если у пользователя нет валидной сессии.
        """
        cached = self._clients.get(user.id)
        if cached:
            try:
                if not cached.is_connected():
                    await cached.connect()
                if await cached.is_user_authorized():
                    return cached
            except Exception:
                pass
            # Мёртвый клиент — выкидываем и создадим заново
            try:
                await cached.disconnect()
            except Exception:
                pass
            self._clients.pop(user.id, None)

        from database.session import _try_decrypt

        session_str = _try_decrypt(user.tg_session_string)
        api_id = user.tg_api_id
        api_hash = _try_decrypt(user.tg_api_hash_encrypted)

        if not session_str or not api_id or not api_hash:
            raise ValueError(
                "Сессия Telegram не найдена. Войдите заново на вкладке «Аккаунт Telegram»."
            )

        client = TelegramClient(StringSession(session_str), int(api_id), api_hash)
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            raise ValueError("Сессия Telegram истекла. Войдите заново.")

        self._evict_if_full()
        self._clients[user.id] = client
        logger.info(f"[UserClients] Client connected for user {user.id} ({len(self._clients)} active)")
        return client

    def _evict_if_full(self):
        """При переполнении отключаем самые старые клиенты (dict сохраняет порядок вставки)."""
        while len(self._clients) >= self.max_clients:
            oldest_id, oldest = next(iter(self._clients.items()))
            try:
                import asyncio
                asyncio.get_event_loop().create_task(oldest.disconnect())
            except Exception:
                pass
            self._clients.pop(oldest_id, None)
            logger.info(f"[UserClients] Evicted idle client for user {oldest_id}")

    async def is_authorized(self, user) -> bool:
        try:
            await self.get_client(user)
            return True
        except Exception:
            return False

    async def register_session(self, user_id: str, session_string: str, api_id, api_hash):
        """Сразу после /auth/login — кладёт свежую сессию в кэш, чтобы не пересобирать из БД."""
        if not session_string or not api_id or not api_hash:
            return
        try:
            client = TelegramClient(StringSession(session_string), int(api_id), api_hash)
            await client.connect()
            if await client.is_user_authorized():
                self._evict_if_full()
                self._clients[user_id] = client
        except Exception as e:
            logger.warning(f"[UserClients] register_session failed: {e}")

    async def disconnect_user(self, user_id: str):
        client = self._clients.pop(user_id, None)
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass

    async def disconnect_all(self):
        for client in self._clients.values():
            try:
                await client.disconnect()
            except Exception:
                pass
        self._clients.clear()


user_clients = UserClientManager()
