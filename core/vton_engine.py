"""
core/vton_engine.py

Единый фасад для обработки и очистки медиа товаров (Watermark Cleaner & Branding).
Обеспечивает 100% обратную совместимость со всеми вызовами vton_engine в проекте.
"""

from typing import Optional, List
from core.watermark_cleaner import watermark_cleaner, WatermarkCleaner


class CleanEngineAdapter:
    """Адаптер для обратной совместимости с вызовами vton_engine."""
    def __init__(self):
        self.cleaner = watermark_cleaner

    async def try_on_garment(
        self,
        garment_image_path: str,
        human_image_path: Optional[str] = None,
        garment_description: str = "stylish fashionable garment",
        **kwargs
    ) -> Optional[str]:
        """Очищает водяной знак и накладывает стильный бренд-бейдж с сохранением 100% качества оригинала."""
        brand_name = "EXCLUSIVE COLLECTION"
        if garment_description and len(garment_description.strip()) < 35:
            brand_name = garment_description.strip().upper()
        return self.cleaner.clean_image(garment_image_path, mode="hybrid", brand_text=brand_name)

    async def process_post_media(
        self,
        media_files: list,
        garment_description: str = "stylish fashionable garment",
        **kwargs
    ) -> list:
        """Очищает все фото альбома от водяных знаков каналов-доноров."""
        return await self.cleaner.process_post_media(media_files, brand_text="EXCLUSIVE STORE", mode="hybrid")


vton_engine = CleanEngineAdapter()
VirtualTryOnEngine = CleanEngineAdapter

__all__ = ["VirtualTryOnEngine", "vton_engine", "watermark_cleaner", "WatermarkCleaner"]
