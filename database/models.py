"""
database/models.py

SQLAlchemy ORM модели. Совместимы с SQLite (dev) и PostgreSQL (prod).

ИЗМЕНЕНИЯ vs оригинал:
  - Убран импорт pgvector (не нужен для MVP, ломает SQLite)
  - UUID заменён на String для совместимости с SQLite
  - ARRAY заменён на JSON для SQLite
  - LargeBinary оставлен (работает в обоих движках)
  - Добавлены поля: rewrite_prompt_name, check_interval, pricing_*
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Boolean, Float, Integer, BigInteger,
    ForeignKey, JSON, DateTime, LargeBinary, Text
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


def _uuid() -> str:
    """Генерирует UUID как строку — совместимо с SQLite и PostgreSQL."""
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid)
    phone_number = Column(String(50), unique=True, nullable=False)   # +79991234567
    telegram_user_id = Column(BigInteger, unique=True, nullable=True) # Telegram ID пользователя
    username = Column(String(255), nullable=True)                    # @nickname
    full_name = Column(String(255), nullable=True)                   # Имя + Фамилия
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    subscription_tier = Column(String(50), default="free")           # free/starter/pro/business
    subscription_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)
    tg_api_id = Column(Integer, nullable=True)                        # api_id пользователя
    tg_api_hash_encrypted = Column(Text, nullable=True)               # api_hash
    tg_session_string = Column(Text, nullable=True)                   # StringSession

    # Статистика
    total_posts_processed = Column(Integer, default=0)
    total_time_saved_minutes = Column(Integer, default=0)

    # AI лимиты (по тарифу)
    ai_rewrites_today = Column(Integer, default=0)           # Счётчик рерайтов за сегодня
    ai_rewrites_reset_date = Column(String(10), nullable=True)  # Дата последнего сброса "YYYY-MM-DD"

    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    target_channel_id = Column(String(255), nullable=False)

    # Ключи Telegram (опционально — если multi-user в будущем)
    tg_api_id = Column(String(50))
    tg_api_hash = Column(String(64))
    tg_session_string = Column(Text)  # Telethon StringSession

    # AI рерайт
    rewrite_enabled = Column(Boolean, default=True)
    rewrite_model = Column(String(100), default="gemini-1.5-flash")
    rewrite_prompt = Column(Text)
    rewrite_api_key_encrypted = Column(LargeBinary)  # зашифрованный ключ (будущее)

    # Генерация изображений (будущее)
    image_gen_enabled = Column(Boolean, default=False)
    image_model = Column(String(100), default="dall-e-3")
    image_prompt_style = Column(Text)
    image_api_key_encrypted = Column(LargeBinary)

    # Редполитика
    duplicate_threshold = Column(Float, default=0.85)
    remove_links = Column(Boolean, default=True)
    use_original_on_error = Column(Boolean, default=False, nullable=False, server_default="0")  # Если False, не публиковать пост при ошибке AI
    check_interval = Column(Integer, default=60)       # секунды между проверками

    # AI провайдер для рерайта
    ai_provider = Column(String(50), default="platform")    # "platform" | "own_gemini" | "own_openrouter"
    ai_api_key_encrypted = Column(Text, nullable=True)      # Личный ключ (Fernet-зашифрованный)

    # Ценообразование (режим магазина)
    pricing_enabled = Column(Boolean, default=False)
    pricing_wholesale_pct = Column(Float, default=10.0)
    pricing_drop_pct = Column(Float, default=30.0)
    pricing_retail_pct = Column(Float, default=50.0)
    pricing_currency = Column(String(10), default="₽")

    # Статус
    is_active = Column(Boolean, default=False)  # false = остановлен, true = мониторит
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="projects")
    donors = relationship("Donor", secondary="project_donors", back_populates="projects")
    posts = relationship("Post", back_populates="project", cascade="all, delete-orphan")


class Donor(Base):
    __tablename__ = "donors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(String(255), unique=True, nullable=False)  # @username или числовой ID
    username = Column(String(255))
    title = Column(String(255))
    last_scanned_at = Column(DateTime)

    projects = relationship("Project", secondary="project_donors", back_populates="donors")


class ProjectDonor(Base):
    __tablename__ = "project_donors"

    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    donor_id = Column(Integer, ForeignKey("donors.id", ondelete="CASCADE"), primary_key=True)


class Post(Base):
    __tablename__ = "posts"

    id = Column(String(36), primary_key=True, default=_uuid)
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    donor_id = Column(Integer, ForeignKey("donors.id"), nullable=True)

    # Дедупликация
    content_hash = Column(String(64), nullable=False)
    media_hashes = Column(JSON)   # список строк

    # Контент
    original_text = Column(Text)
    processed_text = Column(Text)
    summary = Column(Text)
    entities = Column(JSON)       # список сущностей
    embedding = Column(JSON)      # вектор (заглушка до pgvector)

    # Статус обработки
    cluster_id = Column(String(36))
    status = Column(String(50), default="new")    # new | processing | published | failed | duplicate
    ai_decision_log = Column(JSON)

    # Медиа
    media_type = Column(String(50))               # photo | video | document | none
    telegram_msg_id = Column(Integer)             # ID оригинального сообщения

    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("Project", back_populates="posts")


class ApiKey(Base):
    """
    API-ключи для программного доступа к SaaS API (будущее интеграционное использование).
    Храним хэш ключа (SHA-256), не сам ключ.
    """
    __tablename__ = "api_keys"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)         # Название ключа (напр. "n8n-integration")
    key_hash = Column(String(64), unique=True, nullable=False)  # SHA-256 hex
    key_prefix = Column(String(10), nullable=False)    # Первые 8 символов (для отображения в UI)
    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)       # None = бессрочный
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", backref="api_keys")


class PlatformAiKey(Base):
    """
    AI-ключи платформы (управляются администратором).
    Система ротирует между активными ключами одного провайдера
    при исчерпании квоты. Хранит зашифрованный ключ.
    """
    __tablename__ = "platform_ai_keys"

    id = Column(String(36), primary_key=True, default=_uuid)
    provider = Column(String(50), nullable=False)       # "gemini" | "openrouter" | "openai"
    label = Column(String(255), nullable=True)          # Название для отображения в UI
    key_encrypted = Column(Text, nullable=False)        # Fernet-зашифрованный ключ
    key_prefix = Column(String(12), nullable=True)      # Первые 8 символов (для UI)
    is_active = Column(Boolean, default=True)
    priority = Column(Integer, default=0)               # Выше = приоритетнее при ротации
    daily_limit = Column(Integer, nullable=True)        # None = безлимитный
    requests_today = Column(Integer, default=0)         # Счётчик сегодняшних запросов
    last_reset_date = Column(String(10), nullable=True) # "YYYY-MM-DD" последнего сброса
    last_error_at = Column(DateTime, nullable=True)     # Когда последний раз получил 429
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MiniAppPost(Base):
    """
    Модель постов/товаров для автоматической синхронизации с Telegram Mini App.
    """
    __tablename__ = "miniapp_posts"

    id = Column(String(36), primary_key=True, default=_uuid)
    project_id = Column(String(36), nullable=True)
    title = Column(String(255), nullable=True)
    text = Column(Text, nullable=False)
    price = Column(String(100), nullable=True)
    original_price = Column(String(100), nullable=True)
    media_urls = Column(JSON, default=list)
    source_channel = Column(String(255), nullable=True)
    target_channel = Column(String(255), nullable=True)
    category = Column(String(100), default="General")
    views_count = Column(Integer, default=0)
    published_at = Column(DateTime, default=datetime.utcnow)


class ArticleItem(Base):
    """
    Товар с уникальным артикулом — создаётся при копировании поста из канала-донора.
    Хранит остатки, размеры, цены и привязку к боту заказов.
    """
    __tablename__ = "article_items"

    id = Column(String(36), primary_key=True, default=_uuid)
    article_code = Column(String(50), unique=True, nullable=False)   # ART-0001, SHOE-0042 и т.д.
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)                        # AI-переписанный текст
    original_text = Column(Text, nullable=True)                      # Оригинальный текст поста
    price = Column(String(100), nullable=True)                       # Цена с наценкой (розница)
    wholesale_price = Column(String(100), nullable=True)             # Оптовая цена
    drop_price = Column(String(100), nullable=True)                  # Дроп цена
    currency = Column(String(10), default="₽")
    source_channel = Column(String(255), nullable=True)              # Откуда скопировано
    target_channel = Column(String(255), nullable=True)              # Куда опубликовано
    media_urls = Column(JSON, default=list)                          # Ссылки на фото
    # Остатки по размерам: {"41": 3, "42": 5, "43": 2} или {"one_size": 10}
    stock = Column(JSON, default=dict)
    category = Column(String(100), default="Товар")
    product_type = Column(String(50), default="shoes")               # "shoes" | "clothing" | "general"
    is_active = Column(Boolean, default=True)                        # Активно / снято с продажи
    telegram_post_url = Column(String(512), nullable=True)           # Ссылка на пост в канале
    source_msg_id = Column(Integer, nullable=True)                   # ID сообщения в канале донора (для загрузки фото)
    target_msg_id = Column(Integer, nullable=True)                   # ID сообщения в НАШЕМ канале (для мгновенной отправки из нашего канала)
    orders_count = Column(Integer, default=0)                        # Сколько заказов получено
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    orders = relationship("Order", back_populates="article", cascade="all, delete-orphan")


class OrderBotConfig(Base):
    """
    Конфигурация Telegram-бота для приёма заказов.
    Пользователь вводит токен своего бота и ID менеджера.
    """
    __tablename__ = "order_bot_configs"

    id = Column(String(36), primary_key=True, default=_uuid)
    bot_token = Column(Text, nullable=False)                         # Токен бота от @BotFather
    bot_username = Column(String(255), nullable=True)               # @username бота
    manager_chat_id = Column(String(100), nullable=True)            # chat_id куда слать уведомления
    manager_username = Column(String(255), nullable=True)           # @username менеджера
    welcome_message = Column(Text, default="Привет! Введите артикул товара для заказа (например: ART-0001)")
    article_prefix = Column(String(20), default="ART")              # Префикс артикула
    is_active = Column(Boolean, default=False)                      # Запущен ли бот
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Order(Base):
    """
    Заказ, поступивший через Telegram-бота.
    """
    __tablename__ = "orders"

    id = Column(String(36), primary_key=True, default=_uuid)
    article_id = Column(String(36), ForeignKey("article_items.id", ondelete="CASCADE"), nullable=False)
    article_code = Column(String(50), nullable=False)
    customer_name = Column(String(255), nullable=True)
    customer_phone = Column(String(50), nullable=True)
    customer_telegram_id = Column(String(100), nullable=True)
    customer_username = Column(String(255), nullable=True)
    selected_size = Column(String(50), nullable=True)               # Выбранный размер
    selected_color = Column(String(100), nullable=True)             # Выбранный цвет товара
    foot_size_cm = Column(String(50), nullable=True)                # Длина стопы в см (для обуви)
    height_weight = Column(String(100), nullable=True)              # Рост и вес (для одежды)
    quantity = Column(Integer, default=1)
    price_at_order = Column(String(100), nullable=True)             # Цена на момент заказа
    comment = Column(Text, nullable=True)
    supplier_message = Column(Text, nullable=True)                  # AI-сгенерированный текст для поставщика
    status = Column(String(50), default="new")                     # new | confirmed | shipped | done | cancelled
    created_at = Column(DateTime, default=datetime.utcnow)

    article = relationship("ArticleItem", back_populates="orders")


