"""
core/ai_fashion_studio.py

AI Fashion Studio — генерация студийных фотографий товаров на моделях
для каждого цвета/фото из поста-донора через Tooken Club (GPT Image 2.5).

Пайплайн:
  1. Получает массив фотографий из поста-донора (разные цвета/ракурсы).
  2. Для каждого фото определяет цвет и тип одежды.
  3. Генерирует качественную фотосессию на живой модели в этом цвете через Tooken Club (gpt-image-2.5).
  4. Сохраняет готовые HD-фотографии в temp_media/ и возвращает готовый альбом для публикации.
"""

import os
import io
import re
import uuid
import base64
import logging
import asyncio
from typing import List, Optional, Tuple
from PIL import Image
import httpx

logger = logging.getLogger("ai_fashion_studio")

# Базовые настройки Tooken Club
TOOKEN_BASE_URL = os.getenv("TOOKEN_BASE_URL", "https://tooken.club/v1").rstrip("/")
TOOKEN_API_KEY = os.getenv("TOOKEN_API_KEY", "").strip()
DEFAULT_IMAGE_MODEL = os.getenv("TOOKEN_IMAGE_MODEL", "gpt-image-2.5").strip()

# Цветовая палитра для точного определения оттенка вещи
COLOR_KEYWORDS = {
    "красн": "crimson red",
    "черн": "elegant black",
    "бел": "pure white",
    "беж": "beige nude",
    "син": "navy blue",
    "голуб": "sky blue",
    "зелен": "emerald green",
    "розов": "dusty pink",
    "сер": "classic grey",
    "коричн": "chocolate brown",
    "борд": "burgundy wine",
    "желт": "sunny yellow",
    "оранж": "terracotta orange",
    "фиолет": "royal purple",
    "сирен": "lavender",
    "мятн": "mint green",
    "хаки": "khaki green",
    "золот": "gold luxury",
    "серебр": "silver metallic",
}

GARMENT_TYPES = {
    "плать": "evening luxury dress",
    "костюм": "tailored stylish modern suit",
    "куртк": "trendy modern jacket",
    "пальто": "elegant wool coat",
    "рубашк": "crisp modern shirt",
    "блузк": "flowing silk blouse",
    "брюк": "tailored modern trousers",
    "юбк": "stylish midi skirt",
    "пиджак": "structured modern blazer",
    "свитер": "cozy knit sweater",
    "кардиган": "minimalist chic cardigan",
    "худи": "streetwear premium hoodie",
    "толстовк": "streetwear modern sweatshirt",
    "футболк": "minimalist premium t-shirt",
    "топ": "stylish cropped top",
    "джинс": "premium denim jeans",
    "шорт": "summer stylish shorts",
    "кроссовк": "designer luxury sneakers",
    "туфл": "luxury high heel shoes",
    "ботильон": "designer leather ankle boots",
    "сумк": "luxury designer handbag",
}


class AiFashionStudio:
    """Генератор фотосессий одежды на базе GPT Image 2.5."""

    def __init__(self):
        self.endpoint = f"{TOOKEN_BASE_URL}/images/generations"

    def _detect_item_and_color(self, text: str, index: int = 0) -> Tuple[str, str]:
        """Извлекает тип одежды и цвет из текста/контекста."""
        lowered = (text or "").lower()

        # Определяем тип одежды
        detected_item = "fashion garment"
        for kw, val in GARMENT_TYPES.items():
            if kw in lowered:
                detected_item = val
                break

        # Определяем цвет
        found_colors = []
        for kw, val in COLOR_KEYWORDS.items():
            if kw in lowered:
                found_colors.append(val)

        if found_colors:
            detected_color = found_colors[index % len(found_colors)]
        else:
            palette = ["luxury monochromatic", "pure white", "elegant black", "beige nude", "dusty emerald"]
            detected_color = palette[index % len(palette)]

        return detected_item, detected_color

    def _build_studio_prompt(self, garment_type: str, color: str, extra_desc: str = "") -> str:
        """Формирует профессиональный студийный промт для модной генерации."""
        return (
            f"Commercial high-fashion studio lookbook photography. "
            f"A gorgeous high-end fashion model wearing a {color} {garment_type}. "
            f"Minimalist luxury architectural studio interior with soft natural ambient light. "
            f"Photorealistic fabric texture, exact color fidelity, sharp focus on clothing details, "
            f"magazine editorial style (Vogue / Zara / ASOS catalogue), 8k UHD, masterpiece."
        )

    async def generate_single_color_image(
        self,
        garment_type: str,
        color: str,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        size: str = "1024x1024",
    ) -> Optional[bytes]:
        """Генерирует одно студийное изображение через Tooken Club (GPT Image 2.5)."""
        key = (api_key or TOOKEN_API_KEY).strip()
        if not key:
            logger.warning("[Fashion Studio] TOOKEN_API_KEY is missing, skipping AI generation.")
            return None

        chosen_model = model or DEFAULT_IMAGE_MODEL or "gpt-image-2.5"
        prompt = self._build_studio_prompt(garment_type, color)

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": chosen_model,
            "prompt": prompt,
            "n": 1,
            "size": size,
            "response_format": "b64_json",
        }

        try:
            logger.info(f"[Fashion Studio] Generating photo for {color} {garment_type} using {chosen_model}...")
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(self.endpoint, json=payload, headers=headers)

                if resp.status_code != 200:
                    logger.error(f"[Fashion Studio] API error HTTP {resp.status_code}: {resp.text[:300]}")
                    return None

                data = resp.json()
                items = data.get("data", [])
                if not items:
                    return None

                b64_str = items[0].get("b64_json")
                if b64_str:
                    return base64.b64decode(b64_str)

                # Если вернулся прямой URL
                img_url = items[0].get("url")
                if img_url:
                    img_resp = await client.get(img_url, timeout=30.0)
                    if img_resp.status_code == 200:
                        return img_resp.content

                return None

        except Exception as e:
            logger.error(f"[Fashion Studio] Generation failed: {e}")
            return None

    async def process_donor_album(
        self,
        media_files: List[str],
        post_text: str = "",
        api_key: Optional[str] = None,
        max_generations: int = 5,
    ) -> List[str]:
        """
        Обрабатывает альбом донора поочередно:
        Для каждого фото/цвета генерирует новое студийное изображение через gpt-image-2.5.
        Сохраняет во временную папку и возвращает список путей к новым файлам.
        """
        if not media_files:
            return []

        temp_dir = os.path.join(os.getcwd(), "temp_media")
        os.makedirs(temp_dir, exist_ok=True)

        processed_album: List[str] = []
        limit = min(len(media_files), max_generations)

        logger.info(f"[Fashion Studio] Processing donor album of {len(media_files)} photos (up to {limit} items)...")

        for idx in range(limit):
            original_file = media_files[idx]
            if not os.path.exists(original_file):
                continue

            garment_type, color = self._detect_item_and_color(post_text, index=idx)

            # Генерируем студийное фото
            img_bytes = await self.generate_single_color_image(
                garment_type=garment_type,
                color=color,
                api_key=api_key
            )

            if img_bytes:
                out_path = os.path.join(temp_dir, f"ai_fashion_{uuid.uuid4().hex[:10]}.jpg")
                with open(out_path, "wb") as f:
                    f.write(img_bytes)
                processed_album.append(out_path)
                logger.info(f"[Fashion Studio] ✅ Generated studio photo #{idx+1} ({color} {garment_type}) -> {out_path}")
            else:
                # Если генерация не удалась — сохраняем исходное фото (или очищенное от водяных знаков)
                logger.warning(f"[Fashion Studio] Fallback to cleaned original photo for item #{idx+1}")
                processed_album.append(original_file)

        # Добавляем оставшиеся оригинальные фото (если альбом был длиннее лимита)
        for idx in range(limit, len(media_files)):
            processed_album.append(media_files[idx])

        return processed_album


ai_fashion_studio = AiFashionStudio()
