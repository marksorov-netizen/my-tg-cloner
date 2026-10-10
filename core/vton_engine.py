"""
core/vton_engine.py

Единый фасад для AI-улучшения фото (AI HD Upscale) и очистки водяных знаков.
Гарантирует 100% сохранение реального товара донора (без замены на чужую одежду).
"""

from typing import Optional, List
from core.watermark_cleaner import watermark_cleaner, WatermarkCleaner
from core.image_upscaler import image_upscaler, ImageUpscaler


class CleanEngineAdapter:
    """Адаптер для улучшения фото и очистки водяных знаков."""
    def __init__(self):
        self.cleaner = watermark_cleaner
        self.upscaler = image_upscaler

    async def try_on_garment(
        self,
        garment_image_path: str,
        human_image_path: Optional[str] = None,
        garment_description: str = "stylish fashionable garment",
        **kwargs
    ) -> Optional[str]:
        """Очищает водяной знак и улучшает качество реального фото товара."""
        cleaned = self.cleaner.clean_image(garment_image_path, mode="hybrid", brand_text="EXCLUSIVE COLLECTION")
        if cleaned:
            return await self.upscaler.upscale_image(cleaned, scale=2.0)
        return await self.upscaler.upscale_image(garment_image_path, scale=2.0)

    async def process_post_media(
        self,
        media_files: list,
        garment_description: str = "stylish fashionable garment",
        use_ai_generation: bool = True,
        brand_text: Optional[str] = None,
        mode: str = "hybrid",
        position: str = "auto",
        **kwargs
    ) -> list:
        """
        1. Очищает все фото альбома от чужих водяных знаков и телефонов донора.
        2. Делает 2x HD Upscale и повышение резкости ткани/швов для каждого реального фото.
        3. Сохраняет 100% реального товара донора!
        """
        # Шаг 1: Очистка от водяных знаков
        try:
            cleaned_media = await self.cleaner.process_post_media(
                media_files,
                brand_text=brand_text,
                mode=mode,
                position=position
            )
        except Exception:
            cleaned_media = media_files

        # Шаг 2: HD Upscale и повышение резкости ткани/швов реального товара
        try:
            upscaled_media = await self.upscaler.upscale_album(cleaned_media, scale=2.0)
            return upscaled_media
        except Exception:
            return cleaned_media


vton_engine = CleanEngineAdapter()
VirtualTryOnEngine = CleanEngineAdapter

__all__ = ["VirtualTryOnEngine", "vton_engine", "image_upscaler", "ImageUpscaler", "watermark_cleaner", "WatermarkCleaner"]

