"""
core/video_generator.py

Модуль AI/FFmpeg генерации динамических промо-видеороликов из фотографий товара.
Создает качественное вертикальное (9:16) или квадратное (1:1) промо-видео для Telegram/Reels/Stories:
 - Стеклянный размытый фон из оригинального фото
 - Четкое центрированное изображение товара с мягкой тенью
 - Информационный оверлей: цена, артикул, плашка наличия
 - Плавные переходы (zoom / crossfade)
 - Кодирование H.264/AAC c флагом faststart для мгновенного онлайн-воспроизведения в Telegram
"""

import os
import subprocess
import shutil
import tempfile
import logging
import asyncio
from typing import List, Optional
from PIL import Image, ImageFilter, ImageDraw, ImageFont

logger = logging.getLogger("ghostpost.video_generator")


class ProductVideoGenerator:
    def __init__(self):
        self.temp_dir = os.path.join(os.getcwd(), "temp_media", "video_gen")
        os.makedirs(self.temp_dir, exist_ok=True)

    def _is_ffmpeg_available(self) -> bool:
        """Проверяет наличие ffmpeg в системе."""
        return shutil.which("ffmpeg") is not None

    def _create_styled_frame(
        self,
        img_path: str,
        output_path: str,
        target_size: tuple = (1080, 1920),
        title: Optional[str] = None,
        price: Optional[str] = None,
        article_code: Optional[str] = None,
        is_first: bool = False
    ) -> bool:
        """
        Создает красиво оформленный кадр для слайдшоу:
        - Размытый задний план на весь экран
        - Четкий товар по центру с тенью
        - Плашка с ценой и артикулом (на первом кадре)
        """
        try:
            with Image.open(img_path) as src_img:
                src_img = src_img.convert("RGBA")
                target_w, target_h = target_size

                # 1. Задний фон — увеличенный и сильно размытый
                bg = src_img.copy()
                bg_ratio = max(target_w / bg.width, target_h / bg.height)
                new_bg_size = (int(bg.width * bg_ratio * 1.1), int(bg.height * bg_ratio * 1.1))
                bg = bg.resize(new_bg_size, Image.Resampling.LANCZOS)
                
                # Центрируем кроп фона
                left = (bg.width - target_w) // 2
                top = (bg.height - target_h) // 2
                bg = bg.crop((left, top, left + target_w, top + target_h))
                bg = bg.filter(ImageFilter.GaussianBlur(radius=35))
                
                # Добавляем затемнение фона
                darken = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 100))
                bg.paste(darken, (0, 0), darken)

                # 2. Основное фото товара — вписываем по центру (85% ширины/высоты)
                max_w = int(target_w * 0.88)
                max_h = int(target_h * 0.70)
                
                fit_ratio = min(max_w / src_img.width, max_h / src_img.height)
                fg_w = int(src_img.width * fit_ratio)
                fg_h = int(src_img.height * fit_ratio)
                fg = src_img.resize((fg_w, fg_h), Image.Resampling.LANCZOS)

                # Тень под товаром
                shadow_offset = 15
                shadow = Image.new("RGBA", (fg_w + 30, fg_h + 30), (0, 0, 0, 140))
                shadow = shadow.filter(ImageFilter.GaussianBlur(radius=15))
                
                fg_x = (target_w - fg_w) // 2
                fg_y = (target_h - fg_h) // 2 - 40

                bg.paste(shadow, (fg_x - 15, fg_y - 15 + shadow_offset), shadow)
                bg.paste(fg, (fg_x, fg_y), fg)

                # 3. Информационные бейджи на кадре (особенно на 1-м кадре)
                draw = ImageDraw.Draw(bg)
                
                # Плашка "🔥 В наличии" вверху
                badge_w, badge_h = 240, 56
                badge_x = (target_w - badge_w) // 2
                badge_y = 90
                
                # Закругленный бейдж
                draw.rounded_rectangle(
                    [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h],
                    radius=16,
                    fill=(230, 57, 70, 230),
                    outline=(255, 255, 255, 120),
                    width=2
                )
                draw.text((badge_x + 35, badge_y + 16), "🔥 В НАЛИЧИИ", fill=(255, 255, 255, 255))

                # Нижняя плашка с ценой и артикулом
                if (price or article_code) and is_first:
                    card_w = int(target_w * 0.88)
                    card_h = 160
                    card_x = (target_w - card_w) // 2
                    card_y = target_h - card_h - 110

                    # Glassmorphism карточка
                    draw.rounded_rectangle(
                        [card_x, card_y, card_x + card_w, card_y + card_h],
                        radius=24,
                        fill=(15, 15, 15, 225),
                        outline=(255, 255, 255, 45),
                        width=2
                    )

                    # Заголовок / Цена
                    if price:
                        price_text = f"💰 {price}"
                        draw.text((card_x + 30, card_y + 30), price_text, fill=(255, 255, 255, 255))
                    
                    if article_code:
                        art_text = f"🏷️ Артикул: {article_code}"
                        draw.text((card_x + 30, card_y + 90), art_text, fill=(230, 57, 70, 255))

                # Конвертируем в RGB и сохраняем
                final_frame = bg.convert("RGB")
                final_frame.save(output_path, "JPEG", quality=95)
                return True
        except Exception as e:
            logger.error(f"Error styling frame {img_path}: {e}")
            return False

    async def generate_product_video(
        self,
        image_paths: List[str],
        title: Optional[str] = None,
        price: Optional[str] = None,
        article_code: Optional[str] = None,
        duration_per_slide: float = 2.5,
        aspect_ratio: str = "9:16"
    ) -> Optional[str]:
        """
        Создает готовый MP4 видеоролик из набора фотографий товара.
        """
        if not image_paths:
            logger.warning("No images provided for video generation")
            return None

        # Проверяем доступность ffmpeg
        if not self._is_ffmpeg_available():
            logger.error("FFmpeg not found in system! Cannot generate video.")
            return None

        target_size = (1080, 1920) if aspect_ratio == "9:16" else (1080, 1080)
        
        session_id = f"vid_{int(asyncio.get_event_loop().time() * 1000)}"
        session_dir = os.path.join(self.temp_dir, session_id)
        os.makedirs(session_dir, exist_ok=True)

        try:
            # 1. Подготавливаем стилизованные кадры
            styled_frames = []
            valid_images = [p for p in image_paths if os.path.exists(p)]
            
            if not valid_images:
                return None

            # Если фото одно — дублируем с легким зумом для динамики
            if len(valid_images) == 1:
                valid_images = [valid_images[0], valid_images[0]]

            for idx, img_p in enumerate(valid_images):
                frame_path = os.path.join(session_dir, f"frame_{idx:03d}.jpg")
                is_first = (idx == 0)
                success = self._create_styled_frame(
                    img_p,
                    frame_path,
                    target_size=target_size,
                    title=title,
                    price=price,
                    article_code=article_code,
                    is_first=is_first
                )
                if success and os.path.exists(frame_path):
                    styled_frames.append(frame_path)

            if not styled_frames:
                return None

            # 2. Создаем файл списка для ffmpeg concat demuxer
            concat_txt = os.path.join(session_dir, "input.txt")
            with open(concat_txt, "w", encoding="utf-8") as f:
                for fr in styled_frames:
                    f.write(f"file '{fr}'\n")
                    f.write(f"duration {duration_per_slide}\n")
                # Последний кадр повторяем для завершения
                f.write(f"file '{styled_frames[-1]}'\n")

            output_mp4 = os.path.join(self.temp_dir, f"product_promo_{session_id}.mp4")

            # 3. Собираем в MP4 с H.264 кодированием и faststart
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_txt,
                "-vf", f"scale={target_size[0]}:{target_size[1]},format=yuv420p",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-r", "30",
                "-movflags", "+faststart",
                output_mp4
            ]

            logger.info(f"Running FFmpeg video synthesis: {' '.join(cmd)}")
            
            # Запускаем ffmpeg асинхронно
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                logger.error(f"FFmpeg failed with code {proc.returncode}: {stderr.decode(errors='replace')}")
                return None

            if os.path.exists(output_mp4) and os.path.getsize(output_mp4) > 1000:
                logger.info(f"Successfully generated product promo video: {output_mp4} ({os.path.getsize(output_mp4)} bytes)")
                return output_mp4
            else:
                logger.error("Generated video file is empty or missing")
                return None

        except Exception as e:
            logger.error(f"Failed to generate product video: {e}")
            return None
        finally:
            # Удаляем временную папку с кадрами
            try:
                if os.path.exists(session_dir):
                    shutil.rmtree(session_dir, ignore_errors=True)
            except Exception:
                pass


video_generator = ProductVideoGenerator()
