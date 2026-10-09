"""
core/vton_engine.py

Единый фасад для AI-фотосессий (AI Fashion Studio / GPT Image 2.5) и очистки водяных знаков.
Обеспечивает 100% обратную совместимость со всеми вызовами vton_engine в проекте.
"""

from typing import Optional, List
from core.watermark_cleaner import watermark_cleaner, WatermarkCleaner
from core.ai_fashion_studio import ai_fashion_studio, AiFashionStudio


class CleanEngineAdapter:
    """Адаптер для модных фотосессий и очистки фото."""
    def __init__(self):
        self.cleaner = watermark_cleaner
        self.studio = ai_fashion_studio

    async def try_on_garment(
        self,
        garment_image_path: str,
        human_image_path: Optional[str] = None,
        garment_description: str = "stylish fashionable garment",
        **kwargs
    ) -> Optional[str]:
        """Генерирует новую студийную фотографию вещи или очищает водяной знак."""
        res = await self.studio.process_donor_album([garment_image_path], post_text=garment_description, max_generations=1)
        if res and len(res) > 0:
            return res[0]
        return self.cleaner.clean_image(garment_image_path, mode="hybrid", brand_text="EXCLUSIVE COLLECTION")

    async def process_post_media(
        self,
        media_files: list,
        garment_description: str = "stylish fashionable garment",
        use_ai_generation: bool = True,
        **kwargs
    ) -> list:
        """
        Поочередно генерирует студийные фото каждого цвета через Tooken Club (GPT Image 2.5)
        или очищает фото от водяных знаков.
        """
        if use_ai_generation:
            try:
                ai_album = await self.studio.process_donor_album(media_files, post_text=garment_description)
                if ai_album:
                    return ai_album
            except Exception:
                pass

        return await self.cleaner.process_post_media(media_files, brand_text="EXCLUSIVE STORE", mode="hybrid")


vton_engine = CleanEngineAdapter()
VirtualTryOnEngine = CleanEngineAdapter

__all__ = ["VirtualTryOnEngine", "vton_engine", "ai_fashion_studio", "AiFashionStudio", "watermark_cleaner", "WatermarkCleaner"]

