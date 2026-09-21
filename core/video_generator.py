"""
core/video_generator.py

Модуль AI/FFmpeg генерации динамических промо-видеороликов из фотографий товара.
Поддерживает:
 1. Встроенный бесплатный Turbo HD движок (FFmpeg + Pillow, 0 ₽, моментально)
 2. Внешние Generative AI Video API (Seedance, Replicate/Kling, Luma Dream Machine, Runway Gen-3)
 3. Автоматическое составление трендового кинематографичного промта через Gemini Vision
    (с сохранением 100% деталей, расцветки и логотипов товара)
 4. Асинхронный воркер-пул с семафором для стабильной работы при 200+ пользователях
"""

import os
import io
import base64
import shutil
import logging
import asyncio
import httpx
from typing import List, Optional
from PIL import Image, ImageFilter, ImageDraw, ImageFont

logger = logging.getLogger("ghostpost.video_generator")

# Ограничитель одновременных задач рендера (защита от перегрузки CPU/RAM)
_RENDER_SEMAPHORE = asyncio.Semaphore(8)


class ProductVideoGenerator:
    def __init__(self):
        self.temp_dir = os.path.join(os.getcwd(), "temp_media", "video_gen")
        os.makedirs(self.temp_dir, exist_ok=True)

    def _is_ffmpeg_available(self) -> bool:
        """Проверяет наличие ffmpeg в системе."""
        return shutil.which("ffmpeg") is not None

    async def generate_ai_motion_prompt(
        self,
        image_path: str,
        title: Optional[str] = None,
        motion_style: str = "trending_cinematic"
    ) -> str:
        """
        Использует Gemini Vision для анализа фотографии товара и составления
        профессионального промта на английском языке для оживления в нейросети.
        Строго сохраняет 100% геометрии, логотипов и цветов оригинала.
        """
        default_prompt = (
            f"High-end commercial product showcase of {title or 'luxury merchandise'}, "
            "smooth slow 360-degree turntable camera rotation, dynamic soft studio lighting reflections, "
            "photorealistic 4k, crisp texture, keep exact product colors, logos and shape 100% identical, "
            "clean aesthetic background, shallow depth of field, trending commercial reel."
        )

        try:
            import google.generativeai as genai

            # Получаем ключ Gemini
            gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_KEY")
            if not gemini_key:
                try:
                    from database.session import async_session
                    from database.models import PlatformAiKey
                    from core.crypto import decrypt
                    async with async_session() as s:
                        r = await s.execute(select(PlatformAiKey).where(PlatformAiKey.is_active == True))
                        pk = r.scalars().first()
                        if pk and pk.api_key_encrypted:
                            gemini_key = decrypt(pk.api_key_encrypted)
                except Exception:
                    pass

            if not gemini_key or not os.path.exists(image_path):
                return default_prompt

            genai.configure(api_key=gemini_key)
            try:
                model = genai.GenerativeModel("gemini-3.6-flash")
            except Exception:
                model = genai.GenerativeModel("gemini-2.5-flash")

            with Image.open(image_path) as pil_img:
                rgb_img = pil_img.convert("RGB")

                style_instructions = {
                    "trending_cinematic": "cinematic 360 camera orbit, elegant floating particles, soft luxury studio lighting",
                    "studio_rotation": "clean 360-degree turntable spin, pure white/dark studio background, sharp product reflections",
                    "lifestyle_motion": "slow dynamic zoom-in with realistic camera movement, depth of field blur, warm sunlight highlights",
                    "fast_reels": "trendy fast-cut motion showcase, subtle camera shake, vibrant lighting accents"
                }.get(motion_style, "smooth cinematic product orbit with realistic studio lighting")

                system_prompt = (
                    "You are an expert commercial video director and AI video prompt engineer. "
                    "Analyze this product image carefully. Write a concise, powerful English prompt for Image-to-Video AI (Runway/Kling/Luma/Seedance/Wan2.1). "
                    "CRITICAL CONSTRAINTS: "
                    "1. The product must remain 100% IDENTICAL to this image: keep exact logos, brand markings, materials, colors and shape completely unchanged. Do not alter or hallucinate new features. "
                    f"2. Add {style_instructions}. "
                    "3. Make it look like an ultra-high quality 4K commercial advertisement. "
                    "4. Output ONLY the raw prompt in English without preamble, quotes or markdown."
                )

                response = await asyncio.to_thread(
                    model.generate_content,
                    [system_prompt, rgb_img]
                )

                if response and response.text:
                    generated = response.text.strip().replace('"', '').replace('\n', ' ')
                    logger.info(f"[Gemini Vision Video Prompt] Generated: {generated[:120]}...")
                    return generated

        except Exception as e:
            logger.warning(f"[Gemini Vision Video Prompt] Fallback to default due to: {e}")

        return default_prompt

    async def _call_seedance_api(
        self,
        image_path: str,
        prompt: str,
        api_key: str,
        aspect_ratio: str = "9:16"
    ) -> Optional[str]:
        """
        Генерация видео через Seedance AI API (Image-to-Video).
        """
        logger.info(f"[Seedance AI] Starting video generation with prompt: {prompt[:80]}...")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        # Кодируем изображение в base64
        with open(image_path, "rb") as f:
            b64_img = f"data:image/jpeg;base64,{base64.b64encode(f.read()).decode('utf-8')}"

        payload = {
            "prompt": prompt,
            "image": b64_img,
            "aspect_ratio": "9:16" if aspect_ratio == "9:16" else "1:1",
            "duration": 5,
            "quality": "high"
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                # 1. Создаем задачу генерации
                resp = await client.post("https://api.seedance.ai/v1/video/generate", json=payload, headers=headers)
                if resp.status_code not in (200, 201):
                    logger.warning(f"[Seedance AI] API error {resp.status_code}: {resp.text}")
                    return None

                data = resp.json()
                task_id = data.get("task_id") or data.get("id")
                video_url = data.get("video_url") or data.get("output_url")

                # Если URL отдается сразу
                if video_url:
                    return await self._download_remote_video(video_url)

                # Иначе опрашиваем статус (до 60 секунд)
                if task_id:
                    for _ in range(30):
                        await asyncio.sleep(2)
                        st_resp = await client.get(f"https://api.seedance.ai/v1/video/tasks/{task_id}", headers=headers)
                        if st_resp.status_code == 200:
                            st_data = st_resp.json()
                            if st_data.get("status") in ("completed", "succeeded"):
                                res_url = st_data.get("video_url") or st_data.get("output_url")
                                if res_url:
                                    return await self._download_remote_video(res_url)
                            elif st_data.get("status") == "failed":
                                logger.error(f"[Seedance AI] Task failed: {st_data.get('error')}")
                                return None
            except Exception as e:
                logger.error(f"[Seedance AI] Request failed: {e}")

        return None

    async def _call_replicate_api(
        self,
        image_path: str,
        prompt: str,
        api_key: str,
        aspect_ratio: str = "9:16"
    ) -> Optional[str]:
        """
        Генерация видео через Replicate API (Kling AI / Wan2.1 / MiniMax Video-01).
        """
        logger.info(f"[Replicate AI] Starting video generation...")
        headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": "application/json"
        }

        with open(image_path, "rb") as f:
            b64_img = f"data:image/jpeg;base64,{base64.b64encode(f.read()).decode('utf-8')}"

        payload = {
            "version": "kwaivgi/kling-v1.6-standard",
            "input": {
                "prompt": prompt,
                "input_image": b64_img,
                "duration": 5,
                "aspect_ratio": "9:16" if aspect_ratio == "9:16" else "1:1"
            }
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                resp = await client.post("https://api.replicate.com/v1/predictions", json=payload, headers=headers)
                if resp.status_code not in (200, 201):
                    logger.warning(f"[Replicate AI] API error {resp.status_code}: {resp.text}")
                    return None

                data = resp.json()
                get_url = data.get("urls", {}).get("get")

                if get_url:
                    for _ in range(35):
                        await asyncio.sleep(2.5)
                        st_resp = await client.get(get_url, headers=headers)
                        if st_resp.status_code == 200:
                            st_data = st_resp.json()
                            status = st_data.get("status")
                            if status == "succeeded":
                                output = st_data.get("output")
                                res_url = output if isinstance(output, str) else (output[0] if output else None)
                                if res_url:
                                    return await self._download_remote_video(res_url)
                            elif status in ("failed", "canceled"):
                                return None
            except Exception as e:
                logger.error(f"[Replicate AI] Request failed: {e}")

        return None

    async def _call_luma_api(
        self,
        image_path: str,
        prompt: str,
        api_key: str,
        aspect_ratio: str = "9:16"
    ) -> Optional[str]:
        """
        Генерация видео через Luma Dream Machine API.
        """
        logger.info(f"[Luma AI] Starting video generation...")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        with open(image_path, "rb") as f:
            b64_img = f"data:image/jpeg;base64,{base64.b64encode(f.read()).decode('utf-8')}"

        payload = {
            "prompt": prompt,
            "keyframes": {
                "frame0": {
                    "type": "image",
                    "url": b64_img
                }
            },
            "aspect_ratio": "9:16" if aspect_ratio == "9:16" else "1:1"
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                resp = await client.post("https://api.lumalabs.ai/dream-machine/v1/generations", json=payload, headers=headers)
                if resp.status_code not in (200, 201):
                    logger.warning(f"[Luma AI] API error: {resp.text}")
                    return None

                gen_id = resp.json().get("id")
                if gen_id:
                    for _ in range(35):
                        await asyncio.sleep(2.5)
                        st_resp = await client.get(f"https://api.lumalabs.ai/dream-machine/v1/generations/{gen_id}", headers=headers)
                        if st_resp.status_code == 200:
                            st_data = st_resp.json()
                            if st_data.get("state") == "completed":
                                video_url = st_data.get("assets", {}).get("video")
                                if video_url:
                                    return await self._download_remote_video(video_url)
                            elif st_data.get("state") == "failed":
                                return None
            except Exception as e:
                logger.error(f"[Luma AI] Request failed: {e}")

        return None

    async def _call_runway_api(
        self,
        image_path: str,
        prompt: str,
        api_key: str,
        aspect_ratio: str = "9:16"
    ) -> Optional[str]:
        """
        Генерация видео через Runway Gen-3 Alpha API.
        """
        logger.info(f"[Runway AI] Starting video generation...")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "X-Runway-Version": "2024-09-13",
            "Content-Type": "application/json"
        }

        with open(image_path, "rb") as f:
            b64_img = f"data:image/jpeg;base64,{base64.b64encode(f.read()).decode('utf-8')}"

        payload = {
            "promptText": prompt,
            "promptImage": b64_img,
            "model": "gen3a_turbo",
            "duration": 5,
            "ratio": "9:16" if aspect_ratio == "9:16" else "1:1"
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            try:
                resp = await client.post("https://api.dev.runwayml.com/v1/image_to_video", json=payload, headers=headers)
                if resp.status_code not in (200, 201):
                    logger.warning(f"[Runway AI] API error: {resp.text}")
                    return None

                task_id = resp.json().get("id")
                if task_id:
                    for _ in range(35):
                        await asyncio.sleep(2.5)
                        st_resp = await client.get(f"https://api.dev.runwayml.com/v1/tasks/{task_id}", headers=headers)
                        if st_resp.status_code == 200:
                            st_data = st_resp.json()
                            if st_data.get("status") == "SUCCEEDED":
                                output = st_data.get("output", [])
                                video_url = output[0] if output else None
                                if video_url:
                                    return await self._download_remote_video(video_url)
                            elif st_data.get("status") == "FAILED":
                                return None
            except Exception as e:
                logger.error(f"[Runway AI] Request failed: {e}")

        return None

    async def _download_remote_video(self, url: str) -> Optional[str]:
        """Скачивает готовое сгенерированное видео по URL."""
        try:
            session_id = f"ai_vid_{int(asyncio.get_event_loop().time() * 1000)}"
            out_file = os.path.join(self.temp_dir, f"ai_video_{session_id}.mp4")

            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200 and len(resp.content) > 1000:
                    with open(out_file, "wb") as f:
                        f.write(resp.content)
                    logger.info(f"Successfully downloaded AI generated video: {out_file} ({len(resp.content)} bytes)")
                    return out_file
        except Exception as e:
            logger.error(f"Failed to download remote video from {url}: {e}")
        return None

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
        Создает красиво оформленный кадр для встроенного движка:
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

                # 3. Информационные бейджи на кадре
                draw = ImageDraw.Draw(bg)
                
                # Плашка "🔥 В наличии" вверху
                badge_w, badge_h = 240, 56
                badge_x = (target_w - badge_w) // 2
                badge_y = 90
                
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

                    draw.rounded_rectangle(
                        [card_x, card_y, card_x + card_w, card_y + card_h],
                        radius=24,
                        fill=(15, 15, 15, 225),
                        outline=(255, 255, 255, 45),
                        width=2
                    )

                    if price:
                        price_text = f"💰 {price}"
                        draw.text((card_x + 30, card_y + 30), price_text, fill=(255, 255, 255, 255))
                    
                    if article_code:
                        art_text = f"🏷️ Артикул: {article_code}"
                        draw.text((card_x + 30, card_y + 90), art_text, fill=(230, 57, 70, 255))

                final_frame = bg.convert("RGB")
                final_frame.save(output_path, "JPEG", quality=95)
                return True
        except Exception as e:
            logger.error(f"Error styling frame {img_path}: {e}")
            return False

    async def _generate_builtin_video(
        self,
        valid_images: List[str],
        title: Optional[str] = None,
        price: Optional[str] = None,
        article_code: Optional[str] = None,
        duration_per_slide: float = 2.5,
        aspect_ratio: str = "9:16"
    ) -> Optional[str]:
        """Встроенный быстрый рендеринг через FFmpeg."""
        if not self._is_ffmpeg_available():
            logger.error("FFmpeg not found in system! Cannot generate video.")
            return None

        target_size = (1080, 1920) if aspect_ratio == "9:16" else (1080, 1080)
        session_id = f"vid_{int(asyncio.get_event_loop().time() * 1000)}"
        session_dir = os.path.join(self.temp_dir, session_id)
        os.makedirs(session_dir, exist_ok=True)

        try:
            styled_frames = []
            imgs_to_process = valid_images if len(valid_images) > 1 else [valid_images[0], valid_images[0]]

            for idx, img_p in enumerate(imgs_to_process):
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

            concat_txt = os.path.join(session_dir, "input.txt")
            with open(concat_txt, "w", encoding="utf-8") as f:
                for fr in styled_frames:
                    f.write(f"file '{fr}'\n")
                    f.write(f"duration {duration_per_slide}\n")
                f.write(f"file '{styled_frames[-1]}'\n")

            output_mp4 = os.path.join(self.temp_dir, f"product_promo_{session_id}.mp4")

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

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode == 0 and os.path.exists(output_mp4) and os.path.getsize(output_mp4) > 1000:
                return output_mp4

        except Exception as e:
            logger.error(f"Built-in FFmpeg video generation error: {e}")
        finally:
            try:
                if os.path.exists(session_dir):
                    shutil.rmtree(session_dir, ignore_errors=True)
            except Exception:
                pass

        return None

    async def generate_product_video(
        self,
        image_paths: List[str],
        title: Optional[str] = None,
        price: Optional[str] = None,
        article_code: Optional[str] = None,
        duration_per_slide: float = 2.5,
        aspect_ratio: str = "9:16",
        provider: str = "builtin",
        api_key: Optional[str] = None,
        motion_style: str = "trending_cinematic",
        auto_prompt_ai: bool = True
    ) -> Optional[str]:
        """
        Главная точка входа для генерации видеоролика:
        1. Использует семафор для безопасного распределения нагрузки 200+ пользователей.
        2. Если указан внешний провайдер (Seedance/Replicate/Luma/Runway) и API ключ:
           - Составляет кинематографичный промт через Gemini Vision.
           - Отправляет в нейросеть.
        3. Если провайдер builtin или внешний API вернул ошибку -> запускает встроенный FFmpeg.
        """
        if not image_paths:
            return None

        valid_images = [p for p in image_paths if os.path.exists(p)]
        if not valid_images:
            return None

        # Защита от перегрузки CPU/RAM через семафор
        async with _RENDER_SEMAPHORE:
            primary_image = valid_images[0]

            # 1. Fashion Multi-Color Engine (все расцветки одежды + нейро-озвучка + 9:16 монтаж)
            if provider == "fashion_multicolor" or motion_style == "fashion_multicolor":
                try:
                    from core.fashion_video_engine import fashion_video_engine
                    res_video = await fashion_video_engine.create_multi_color_video(
                        image_paths=valid_images,
                        title=title,
                        price=price,
                        article_code=article_code
                    )
                    if res_video and os.path.exists(res_video):
                        logger.info(f"Generated multi-color Fashion video: {res_video}")
                        return res_video
                except Exception as fe:
                    logger.warning(f"Fashion video engine failed: {fe}. Falling back...")

            # 2. Попытка генерации через внешний AI провайдер (Seedance / Replicate / Luma / Runway)
            if provider and provider not in ("builtin", "fashion_multicolor") and api_key and api_key.strip():
                try:
                    # Генерируем промт через Gemini Vision
                    if auto_prompt_ai:
                        ai_prompt = await self.generate_ai_motion_prompt(primary_image, title=title, motion_style=motion_style)
                    else:
                        ai_prompt = f"Commercial showcase of {title or 'product'}, smooth 360 rotation, studio lighting, photorealistic 4k."

                    res_video = None
                    if provider == "seedance":
                        res_video = await self._call_seedance_api(primary_image, ai_prompt, api_key.strip(), aspect_ratio)
                    elif provider == "replicate":
                        res_video = await self._call_replicate_api(primary_image, ai_prompt, api_key.strip(), aspect_ratio)
                    elif provider == "luma":
                        res_video = await self._call_luma_api(primary_image, ai_prompt, api_key.strip(), aspect_ratio)
                    elif provider == "runway":
                        res_video = await self._call_runway_api(primary_image, ai_prompt, api_key.strip(), aspect_ratio)

                    if res_video and os.path.exists(res_video):
                        logger.info(f"Generated video via AI provider [{provider}]: {res_video}")
                        return res_video
                    else:
                        logger.warning(f"Provider [{provider}] did not return video, falling back to built-in FFmpeg...")
                except Exception as ext_err:
                    logger.warning(f"External AI video generation failed ({provider}): {ext_err}. Falling back to FFmpeg.")

            # 2. Встроенный Turbo HD генератор (FFmpeg + Pillow)
            return await self._generate_builtin_video(
                valid_images=valid_images,
                title=title,
                price=price,
                article_code=article_code,
                duration_per_slide=duration_per_slide,
                aspect_ratio=aspect_ratio
            )


video_generator = ProductVideoGenerator()
