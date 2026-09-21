"""
core/fashion_video_engine.py

Движок создания динамических 9:16 Fashion-видеороликов из фотографий товара:
1. Автоматический анализ всех расцветок куртки / одежды из альбома (Gemini Vision + локальный RGB-анализатор).
2. Генерация коммерческого продающего сценария (12-16 секунд).
3. Студийная русская нейро-озвучка (Edge-TTS, без ключей и оплат).
4. Автоматический монтаж вертикального 9:16 видео (1080x1920) с размытым фоном, тенями,
   плашками всех расцветок, ценой, артикулом и размерами.
5. Готовый MP4 файл для публикации в Telegram, YouTube Shorts, VK Клипы, Reels и TikTok.
"""

import os
import sys
import io
import asyncio
import logging
import subprocess
import shutil
from typing import List, Optional, Tuple, Dict
from PIL import Image, ImageFilter, ImageDraw, ImageFont

try:
    import edge_tts
    HAS_EDGE_TTS = True
except ImportError:
    HAS_EDGE_TTS = False

logger = logging.getLogger("ghostpost.fashion_video")

# ── 1. Палитра базовых оттенков для локального распознавания ─────────
FASHION_COLOR_PALETTE = {
    "Чёрный оникс": (22, 22, 24),
    "Графитовый серый": (75, 75, 80),
    "Светло-серый меланж": (175, 175, 180),
    "Белый базовый": (245, 245, 248),
    "Песочный беж": (210, 185, 145),
    "Кэмел / Карамель": (185, 130, 80),
    "Шоколадный мокко": (95, 60, 40),
    "Оливковый хаки": (80, 100, 60),
    "Глубокий изумруд": (30, 75, 55),
    "Тёмно-синий нави": (25, 40, 85),
    "Кобальтовый синий": (35, 70, 150),
    "Бордовый марсала": (115, 25, 40),
    "Винный / Бургунди": (90, 20, 35),
    "Терракотовый": (175, 75, 45),
    "Ярко-красный": (205, 30, 35),
    "Мятный пастель": (150, 200, 180),
    "Лавандовый": (160, 140, 190),
}


def _get_system_font(size: int, bold: bool = True):
    """Подбирает системный TTF шрифт для четкого рендеринга надписей."""
    font_candidates = [
        "segoeui.ttf", "segoeuib.ttf", "arial.ttf", "arialbd.ttf",
        "calibri.ttf", "calibrib.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf"
    ]
    for name in font_candidates:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def detect_dominant_color_local(img_path: str) -> str:
    """
    Быстрое локальное определение цвета вещи по центральному кропу (Pillow).
    Работает моментально без обращения к внешним API.
    """
    try:
        with Image.open(img_path) as img:
            img = img.convert("RGB")
            w, h = img.size
            # Берем центральную область (25% - 75%), где расположена сама вещь
            crop_box = (int(w * 0.25), int(h * 0.25), int(w * 0.75), int(h * 0.75))
            cropped = img.crop(crop_box).resize((40, 40), Image.Resampling.BOX)
            
            pixels = list(cropped.getdata())
            if not pixels:
                return "Трендовый оттенок"
                
            avg_r = sum(p[0] for p in pixels) // len(pixels)
            avg_g = sum(p[1] for p in pixels) // len(pixels)
            avg_b = sum(p[2] for p in pixels) // len(pixels)
            
            best_name = "Трендовый оттенок"
            min_dist = float("inf")
            for name, (cr, cg, cb) in FASHION_COLOR_PALETTE.items():
                dist = (avg_r - cr)**2 + (avg_g - cg)**2 + (avg_b - cb)**2
                if dist < min_dist:
                    min_dist = dist
                    best_name = name
            return best_name
    except Exception as e:
        logger.warning(f"Local color detection error for {img_path}: {e}")
        return "В наличии"


class FashionVideoEngine:
    """
    Автоматический движок создания мульти-цветовых fashion видеороликов 9:16.
    """

    def __init__(self):
        self.output_dir = os.path.join(os.getcwd(), "temp_media", "fashion_videos")
        os.makedirs(self.output_dir, exist_ok=True)

    def _is_ffmpeg_available(self) -> bool:
        return shutil.which("ffmpeg") is not None

    async def analyze_colors_with_gemini(
        self,
        image_paths: List[str],
        title: Optional[str] = None,
        donor_text: Optional[str] = None
    ) -> List[str]:
        """
        Использует Gemini Vision для распознавания точных расцветок на всех фото альбома.
        """
        gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_KEY")
        if not gemini_key:
            return [detect_dominant_color_local(p) for p in image_paths]

        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            try:
                model = genai.GenerativeModel("gemini-3.6-flash")
            except Exception:
                model = genai.GenerativeModel("gemini-2.5-flash")

            prompt = (
                "Ты эксперт fashion-магазина. Перед тобой фотографии одной и той же модели одежды/куртки в разных расцветках. "
                "Определи точный цвет изделия на каждой фотографии по порядку. "
                "Ответь списком названий цветов на русском языке через запятую, например: "
                "Чёрный оникс, Песочный беж, Оливковый хаки, Тёмно-синий. "
                "Только названия цветов через запятую, без лишних слов."
            )

            pil_images = []
            for p in image_paths[:6]:
                if os.path.exists(p):
                    pil_images.append(Image.open(p).convert("RGB"))

            if not pil_images:
                return [detect_dominant_color_local(p) for p in image_paths]

            content = [prompt] + pil_images
            resp = await asyncio.to_thread(model.generate_content, content)
            
            if resp and resp.text:
                raw_colors = [c.strip().strip('"').strip("'") for c in resp.text.split(",") if c.strip()]
                # Дополняем если цветов меньше чем фото
                while len(raw_colors) < len(image_paths):
                    raw_colors.append(detect_dominant_color_local(image_paths[len(raw_colors)]))
                return raw_colors[:len(image_paths)]

        except Exception as e:
            logger.warning(f"[FashionEngine] Gemini Vision color analysis fallback: {e}")

        return [detect_dominant_color_local(p) for p in image_paths]

    async def generate_voiceover_script(
        self,
        title: str,
        colors: List[str],
        price: Optional[str] = None,
        article_code: Optional[str] = None,
        donor_text: Optional[str] = None
    ) -> str:
        """
        Составляет цепляющий рекламный сценарий на 12-15 секунд для видео.
        """
        gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_KEY")
        unique_colors = list(dict.fromkeys(colors))[:4]
        colors_str = ", ".join(unique_colors) if unique_colors else "все топовые расцветки"
        price_str = price if price else "по специальной цене"

        if gemini_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=gemini_key)
                try:
                    model = genai.GenerativeModel("gemini-3.6-flash")
                except Exception:
                    model = genai.GenerativeModel("gemini-2.5-flash")

                prompt = (
                    f"Напиши ультра-цепляющий продающий текст для 15-секундного вертикального видео Reels/Shorts. "
                    f"Товар: {title}. "
                    f"Расцветки в наличии: {colors_str}. "
                    f"Цена: {price_str}. "
                    f"Оригинальное описание: {donor_text or ''}. "
                    f"Требования: динамичный тон, упомянуть наличие расцветок и идеальную посадку, "
                    f"в конце сильный призыв к заказу. Длина текста ровно 25-35 слов на русском языке. "
                    f"Выведи только текст речи диктора без ремарок и смайликов."
                )
                resp = await asyncio.to_thread(model.generate_content, prompt)
                if resp and resp.text:
                    clean = resp.text.strip().replace('"', '').replace('\n', ' ')
                    if len(clean) > 20:
                        return clean
            except Exception as e:
                logger.warning(f"[FashionEngine] Gemini script fallback: {e}")

        # Надежный красивый шаблонный сценарий
        return (
            f"Новинка сезона! {title}. "
            f"В наличии все трендовые расцветки: {colors_str}. "
            f"Плотные премиальные материалы, удобный крой и полная размерная сетка. "
            f"Цена всего {price_str}. "
            f"Успей оформить заказ по ссылке под этим постом!"
        )

    async def synthesize_speech(
        self,
        script_text: str,
        output_mp3: str,
        voice: str = "ru-RU-DmitryNeural"
    ) -> float:
        """
        Генерирует естественную русскую речь через Edge-TTS и возвращает длительность в секундах.
        """
        if not HAS_EDGE_TTS:
            logger.error("edge-tts library is not installed!")
            return 12.0

        try:
            communicate = edge_tts.Communicate(script_text, voice=voice, rate="+10%")
            await communicate.save(output_mp3)

            # Получаем длительность через ffprobe
            cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                output_mp3
            ]
            res = subprocess.run(cmd, capture_output=True, text=True)
            duration = float(res.stdout.strip()) if res.stdout.strip() else 12.0
            return duration
        except Exception as e:
            logger.error(f"[FashionEngine] Speech synthesis error: {e}")
            return 12.0

    def render_fashion_slide(
        self,
        img_path: str,
        output_frame_path: str,
        color_name: str,
        title: str,
        price: Optional[str],
        article_code: Optional[str],
        slide_idx: int,
        total_slides: int,
        top_badge_text: str = "🔥 ВСЕ ЦВЕТА В НАЛИЧИИ",
        target_size: Tuple[int, int] = (1080, 1920)
    ) -> bool:
        """
        Отрисовывает премиальный вертикальный кадр 9:16 со всеми плашками.
        """
        target_w, target_h = target_size
        try:
            with Image.open(img_path) as src_img:
                src_img = src_img.convert("RGBA")

                # 1. Размытый стильный задний фон
                bg = src_img.copy()
                bg_ratio = max(target_w / bg.width, target_h / bg.height)
                new_size = (int(bg.width * bg_ratio * 1.15), int(bg.height * bg_ratio * 1.15))
                bg = bg.resize(new_size, Image.Resampling.LANCZOS)

                l = (bg.width - target_w) // 2
                t = (bg.height - target_h) // 2
                bg = bg.crop((l, t, l + target_w, t + target_h))
                bg = bg.filter(ImageFilter.GaussianBlur(radius=40))

                # Затемнение фона
                dark_overlay = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 115))
                bg.paste(dark_overlay, (0, 0), dark_overlay)

                # 2. Основная вещь по центру с тенью
                max_w = int(target_w * 0.88)
                max_h = int(target_h * 0.68)
                fit_ratio = min(max_w / src_img.width, max_h / src_img.height)
                fg_w = int(src_img.width * fit_ratio)
                fg_h = int(src_img.height * fit_ratio)
                fg = src_img.resize((fg_w, fg_h), Image.Resampling.LANCZOS)

                fg_x = (target_w - fg_w) // 2
                fg_y = (target_h - fg_h) // 2 - 30

                # 3D Тень
                shadow = Image.new("RGBA", (fg_w + 40, fg_h + 40), (0, 0, 0, 160))
                shadow = shadow.filter(ImageFilter.GaussianBlur(radius=20))
                bg.paste(shadow, (fg_x - 20, fg_y - 10), shadow)
                bg.paste(fg, (fg_x, fg_y), fg)

                # 3. Информационные плашки
                draw = ImageDraw.Draw(bg)
                font_bold_28 = _get_system_font(28, bold=True)
                font_bold_34 = _get_system_font(34, bold=True)
                font_regular_22 = _get_system_font(22, bold=False)

                # Верхний топ-бейдж: "🔥 В НАЛИЧИИ ВСЕ РАСЦВЕТКИ"
                top_w, top_h = 430, 62
                top_x = (target_w - top_w) // 2
                top_y = 85
                draw.rounded_rectangle(
                    [top_x, top_y, top_x + top_w, top_y + top_h],
                    radius=20,
                    fill=(230, 57, 70, 240),
                    outline=(255, 255, 255, 140),
                    width=2
                )
                draw.text((top_x + 30, top_y + 16), top_badge_text, fill=(255, 255, 255, 255), font=font_bold_28)

                # Плавающий бейдж цвета
                col_w, col_h = 380, 56
                col_x = 45
                col_y = 175
                draw.rounded_rectangle(
                    [col_x, col_y, col_x + col_w, col_y + col_h],
                    radius=18,
                    fill=(18, 18, 22, 230),
                    outline=(230, 57, 70, 190),
                    width=2
                )
                draw.text((col_x + 22, col_y + 15), f"🎨 Цвет: {color_name}", fill=(255, 255, 255, 255), font=font_bold_28)

                # Индикатор слайда (1/4)
                ind_text = f"{slide_idx + 1}/{total_slides}"
                draw.rounded_rectangle(
                    [target_w - 140, 175, target_w - 45, 175 + 56],
                    radius=18,
                    fill=(18, 18, 22, 230),
                    outline=(255, 255, 255, 80),
                    width=1
                )
                draw.text((target_w - 115, 190), ind_text, fill=(245, 166, 35, 255), font=font_bold_28)

                # Нижняя коммерческая карточка
                card_w = target_w - 90
                card_h = 175
                card_x = 45
                card_y = target_h - card_h - 95

                draw.rounded_rectangle(
                    [card_x, card_y, card_x + card_w, card_y + card_h],
                    radius=28,
                    fill=(12, 12, 16, 235),
                    outline=(255, 255, 255, 50),
                    width=2
                )

                # Тексты карточки
                display_title = title if len(title) <= 34 else title[:31] + "..."
                draw.text((card_x + 30, card_y + 24), f"📦 {display_title}", fill=(255, 255, 255, 255), font=font_bold_28)

                display_price = price if price else "Уточняйте в канале"
                draw.text((card_x + 30, card_y + 68), f"💰 {display_price}", fill=(245, 166, 35, 255), font=font_bold_34)

                sub_info = []
                if article_code:
                    sub_info.append(f"🏷️ Артикул: {article_code}")
                sub_info.append("📏 Размеры в наличии")
                draw.text((card_x + 30, card_y + 122), "   |   ".join(sub_info), fill=(200, 200, 200, 255), font=font_regular_22)

                final_img = bg.convert("RGB")
                final_img.save(output_frame_path, "JPEG", quality=95)
                return True

        except Exception as e:
            logger.error(f"[FashionEngine] Frame render error for {img_path}: {e}")
            return False

    async def create_multi_color_video(
        self,
        image_paths: List[str],
        title: Optional[str] = None,
        price: Optional[str] = None,
        article_code: Optional[str] = None,
        donor_text: Optional[str] = None,
        voice: str = "ru-RU-DmitryNeural"
    ) -> Optional[str]:
        """
        Главный пайплайн генерации видеоролика со всеми цветами куртки и озвучкой.
        Возвращает путь к скомпилированному MP4 файлу.
        """
        if not self._is_ffmpeg_available():
            logger.error("FFmpeg not found! Cannot build video.")
            return None

        valid_images = [p for p in image_paths if os.path.exists(p)]
        if not valid_images:
            return None

        session_id = f"fashion_{int(asyncio.get_event_loop().time() * 1000)}"
        session_dir = os.path.join(self.output_dir, session_id)
        os.makedirs(session_dir, exist_ok=True)

        final_output_mp4 = os.path.join(self.output_dir, f"fashion_reel_{session_id}.mp4")

        try:
            display_title = title or "Стильная брендовая куртка"

            # 1. Распознаем цвета всех фото
            colors = await self.analyze_colors_with_gemini(valid_images, title=display_title, donor_text=donor_text)
            logger.info(f"[FashionEngine] Detected colors: {colors}")

            # 2. Генерируем продающий текст
            script = await self.generate_voiceover_script(
                title=display_title,
                colors=colors,
                price=price,
                article_code=article_code,
                donor_text=donor_text
            )
            logger.info(f"[FashionEngine] Voice script: {script}")

            # 3. Синтезируем голос диктора
            audio_path = os.path.join(session_dir, "voiceover.mp3")
            audio_duration = await self.synthesize_speech(script, audio_path, voice=voice)
            logger.info(f"[FashionEngine] Audio duration: {audio_duration:.2f}s")

            # 4. Формируем список слайдов (включая аватар-модель при наличии)
            slides_to_render = []
            avatar_path = os.path.join(os.getcwd(), "assets", "avatar", "test_vton_result.jpg")
            if not os.path.exists(avatar_path):
                avatar_path = os.path.join(os.getcwd(), "assets", "avatar", "model_base_vton.jpg")

            if os.path.exists(avatar_path):
                slides_to_render.append((avatar_path, "Образ на модели", "✨ ВЫБОР СТИЛИСТА"))

            for idx, img_p in enumerate(valid_images):
                col_name = colors[idx] if idx < len(colors) else "Трендовый цвет"
                slides_to_render.append((img_p, col_name, "🔥 ВСЕ ЦВЕТА В НАЛИЧИИ"))

            num_slides = len(slides_to_render)
            dur_per_slide = max(2.5, audio_duration / num_slides)

            rendered_frames = []
            for idx, (img_p, color_name, top_badge) in enumerate(slides_to_render):
                frame_p = os.path.join(session_dir, f"frame_{idx:02d}.jpg")
                ok = self.render_fashion_slide(
                    img_path=img_p,
                    output_frame_path=frame_p,
                    color_name=color_name,
                    title=display_title,
                    price=price,
                    article_code=article_code,
                    slide_idx=idx,
                    total_slides=num_slides,
                    top_badge_text=top_badge
                )
                if ok and os.path.exists(frame_p):
                    rendered_frames.append(frame_p)

            if not rendered_frames:
                return None

            # 5. Concat лист для FFmpeg
            concat_txt = os.path.join(session_dir, "input.txt")
            with open(concat_txt, "w", encoding="utf-8") as f:
                for fr in rendered_frames:
                    f.write(f"file '{os.path.abspath(fr)}'\n")
                    f.write(f"duration {dur_per_slide:.2f}\n")
                f.write(f"file '{os.path.abspath(rendered_frames[-1])}'\n")

            # 6. Финальный монтаж FFmpeg
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_txt,
                "-i", audio_path,
                "-vf", "scale=1080:1920,format=yuv420p",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "22",
                "-r", "30",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                "-movflags", "+faststart",
                final_output_mp4
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode == 0 and os.path.exists(final_output_mp4):
                logger.info(f"[FashionEngine] Video created: {final_output_mp4} ({os.path.getsize(final_output_mp4)} bytes)")
                return final_output_mp4
            else:
                logger.error(f"[FashionEngine] FFmpeg failed: {stderr.decode('utf-8', errors='ignore')}")

        except Exception as e:
            logger.error(f"[FashionEngine] Multi-color video creation failed: {e}")
        finally:
            # Очистка временных кадров
            try:
                if os.path.exists(session_dir):
                    shutil.rmtree(session_dir, ignore_errors=True)
            except Exception:
                pass

        return None


fashion_video_engine = FashionVideoEngine()
