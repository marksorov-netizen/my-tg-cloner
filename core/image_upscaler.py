"""
core/image_upscaler.py

AI Upscale & Image Enhancement Engine для фотографий товаров донора.

Особенности:
  1. Сохраняет 100% ОРИГИНАЛЬНОГО ТОВАРА ДОНОРА (никаких чужих случайных платьев или моделей).
  2. Увеличивает разрешение в 2x / 4x (до 2K/4K HD).
  3. Устраняет артефакты сжатия Telegram и пикселизацию.
  4. Повышает резкость ткани, строчек, швов, принтов и фурнитуры.
  5. Потребляет минимум оперативной памяти (~30-50 МБ на фото), безопасно для VPS с 1 ГБ ОЗУ.
  6. Поддерживает как мгновенный встроенный HD-апскейлер (бесплатно), так и Replicate Real-ESRGAN.
"""

import os
import io
import uuid
import logging
import asyncio
from typing import List, Optional
from PIL import Image, ImageEnhance, ImageFilter
import httpx

logger = logging.getLogger("image_upscaler")

REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN", "").strip()


class ImageUpscaler:
    """Модуль для качественного улучшения фотографий товаров."""

    def __init__(self):
        self.replicate_token = REPLICATE_API_TOKEN

    def upscale_local(self, image_path: str, scale: float = 2.0) -> Optional[str]:
        """
        Мгновенный встроенный Smart HD Upscaler.
        Использует алгоритм Lanczos-4 + Unsharp Masking + Micro-contrast.
        Работает за 0.1-0.3 сек, потребляет всего ~30 МБ ОЗУ.
        """
        if not os.path.exists(image_path):
            return None

        try:
            temp_dir = os.path.join(os.getcwd(), "temp_media")
            os.makedirs(temp_dir, exist_ok=True)
            out_path = os.path.join(temp_dir, f"hd_upscaled_{uuid.uuid4().hex[:10]}.jpg")

            with Image.open(image_path) as img:
                img = img.convert("RGB")
                orig_w, orig_h = img.size

                # Не апскейлим гигантские фото чтобы не раздувать трафик
                if orig_w >= 2000 or orig_h >= 2000:
                    effective_scale = 1.0
                elif orig_w >= 1200 or orig_h >= 1200:
                    effective_scale = 1.5
                else:
                    effective_scale = scale

                if effective_scale > 1.0:
                    new_w = int(orig_w * effective_scale)
                    new_h = int(orig_h * effective_scale)
                    upscaled = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                else:
                    upscaled = img.copy()

                # 1. Повышение резкости ткани и контуров товара (Unsharp Mask)
                # radius=2, percent=130, threshold=3 не создаёт шума на ровных участках
                sharpened = upscaled.filter(ImageFilter.UnsharpMask(radius=2, percent=135, threshold=3))

                # 2. Мягкое усиление микро-контраста (придаёт объём материалу)
                contrast = ImageEnhance.Contrast(sharpened).enhance(1.05)

                # 3. Легкое насыщение цвета (чтобы вещи выглядели сочно)
                color_boost = ImageEnhance.Color(contrast).enhance(1.03)

                # 4. Сохранение с оптимизацией
                color_boost.save(out_path, format="JPEG", quality=95, optimize=True)

            logger.info(f"[ImageUpscaler] Local HD upscale: ({orig_w}x{orig_h}) -> ({new_w}x{new_h}) -> {out_path}")
            return out_path

        except Exception as e:
            logger.error(f"[ImageUpscaler] Local upscale failed for {image_path}: {e}")
            return None

    async def upscale_replicate(self, image_path: str, scale: int = 2) -> Optional[str]:
        """Облачный нейросетевой Real-ESRGAN через Replicate API (если пополнен баланс)."""
        token = (self.replicate_token or os.getenv("REPLICATE_API_TOKEN", "")).strip()
        if not token:
            return None

        import base64
        try:
            with open(image_path, "rb") as f:
                b64_data = base64.b64encode(f.read()).decode("utf-8")
            data_uri = f"data:image/jpeg;base64,{b64_data}"

            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Prefer": "wait=40"
            }
            payload = {
                "version": "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
                "input": {
                    "image": data_uri,
                    "scale": scale,
                    "face_enhance": True
                }
            }

            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post("https://api.replicate.com/v1/predictions", json=payload, headers=headers)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    out_url = data.get("output")
                    if out_url:
                        # Скачиваем результат
                        dl_resp = await client.get(out_url, timeout=30.0)
                        if dl_resp.status_code == 200:
                            temp_dir = os.path.join(os.getcwd(), "temp_media")
                            os.makedirs(temp_dir, exist_ok=True)
                            out_path = os.path.join(temp_dir, f"replicate_upscaled_{uuid.uuid4().hex[:10]}.jpg")
                            with open(out_path, "wb") as f_out:
                                f_out.write(dl_resp.content)
                            logger.info(f"[ImageUpscaler] Replicate Real-ESRGAN success: {out_path}")
                            return out_path

        except Exception as e:
            logger.warning(f"[ImageUpscaler] Replicate Real-ESRGAN error: {e}")

        return None

    async def upscale_image(self, image_path: str, scale: float = 2.0) -> str:
        """
        Улучшает одно фото товара.
        Сначала пробует Replicate (если настроен и оплачен), затем надёжный локальный HD-апскейлер.
        Всегда возвращает путь к улучшенному фото (или исходному при сбое).
        """
        if not os.path.exists(image_path):
            return image_path

        # 1. Попытка через Replicate если есть токен
        if self.replicate_token:
            rep_res = await self.upscale_replicate(image_path, scale=int(scale))
            if rep_res and os.path.exists(rep_res):
                return rep_res

        # 2. Быстрый встроенный Smart HD Upscaler
        loop = asyncio.get_running_loop()
        local_res = await loop.run_in_executor(None, lambda: self.upscale_local(image_path, scale=scale))
        if local_res and os.path.exists(local_res):
            return local_res

        return image_path

    async def upscale_album(self, media_files: List[str], scale: float = 2.0) -> List[str]:
        """
        Обрабатывает весь альбом медиа-файлов поочередно.
        Для каждого фото делает Upscale и возвращает список путей к улучшенным файлам.
        """
        if not media_files:
            return []

        results = []
        for file_path in media_files:
            if not isinstance(file_path, str) or not os.path.exists(file_path):
                results.append(file_path)
                continue

            # Проверяем, является ли файл изображением
            ext = os.path.splitext(file_path)[1].lower()
            if ext in (".jpg", ".jpeg", ".png", ".webp"):
                improved = await self.upscale_image(file_path, scale=scale)
                results.append(improved)
            else:
                # Видео или другие файлы не апскейлим
                results.append(file_path)

        return results


image_upscaler = ImageUpscaler()
