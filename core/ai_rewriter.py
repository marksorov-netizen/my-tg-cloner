"""
core/ai_rewriter.py

Универсальный модуль взаимодействия с AI (Gemini / Zapro.su / OpenAI / OpenRouter)
с защитой от Rate Limit (429) и повторными попытками.

Поддерживает:
1. Zapro.su (агрегатор API ключей OpenAI/Gemini/Claude)
2. Google Gemini API (нативная интеграция)
3. Любые OpenAI-совместимые провайдеры (OpenRouter, VseGPT, etc.)
"""

import asyncio
import logging
import os
import httpx
from typing import Optional, Tuple
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("ai_rewriter")

# Семафор: не более 3 одновременных запросов к AI
ai_semaphore = asyncio.Semaphore(3)

# Короткие задержки между попытками: быстро перезапрашиваем, не подвешивая интерфейс
RETRY_DELAYS = [1, 2]

# Жесткие тайм-ауты: соединение макс 3.5 сек, чтение макс 15 сек
AI_HTTP_TIMEOUT = httpx.Timeout(timeout=15.0, connect=3.5)


import re

class AIRewriteError(Exception):
    """Исключение при неисправимой ошибке AI рерайта."""
    pass


def clean_ai_commentary(text: str) -> str:
    """Удаляет вводные фразы и мета-комментарии нейросети (почему этот текст, пояснения и т.д.)."""
    if not text:
        return text
    
    cleaned = text.strip()
    # Удаляем кавычки вокруг всего текста если модель обернула его в ""
    if (cleaned.startswith('"') and cleaned.endswith('"')) or (cleaned.startswith('«') and cleaned.endswith('»')):
        cleaned = cleaned[1:-1].strip()
        
    # Удаляем вводные фразы типа "Вот продающий вариант...", "Конечно, вот переписанный пост: "
    cleaned = re.sub(r'^(?:Вот\s+(?:готовый|продающий|переписанный|новый|отредактированный)\s+[^\n]+:|Конечно[^\n]*:|Вот\s+ваш\s+пост[^\n]*:)\s*\n*', '', cleaned, flags=re.I)
    
    # Удаляем мета-комментарии в конце поста ("### Почему этот текст...", "### Пояснения:", "---", etc.)
    cleaned = re.sub(r'\n+###?\s*(?:Почему этот текст|Пояснени|Обоснование|Комментари|Разбор|Что было изменено)[^\n]*[\s\S]*$', '', cleaned, flags=re.I)
    cleaned = re.sub(r'\n+\*?(?:Не забудьте прикрепить|Примечание:)[^\n]*\*?\s*$', '', cleaned, flags=re.I)
    
    return cleaned.strip()


async def _call_openai_compatible_api(
    api_key: str,
    text: str,
    prompt: str,
    system_prompt: Optional[str] = None,
    base_url: str = "https://po.zapro.su/v1",
    model_name: str = "gemini-3.6-flash",
    model_override: Optional[str] = None,
) -> Tuple[str, int]:
    """Запрос к OpenAI-совместимому API (Zapro.su, OpenRouter, Groq, VseGPT, OpenAI, etc.)."""
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    
    sys_content = system_prompt or "Ты профессиональный SMM-менеджер Telegram-канала."
    user_content = f"{prompt}\n\nИсходящий текст новости/поста:\n{text}"

    chosen_model = model_override or os.getenv("ZAPRO_MODEL", os.getenv("AI_MODEL", model_name))

    payload = {
        "model": chosen_model,
        "messages": [
            {"role": "system", "content": sys_content},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.85,
        "max_tokens": 2048,
    }

    logger.info(f"[AI Queue] Calling OpenAI-compatible API ({endpoint}) model={payload['model']}...")
    async with httpx.AsyncClient(timeout=AI_HTTP_TIMEOUT) as client:
        resp = await client.post(endpoint, json=payload, headers=headers)
        if resp.status_code != 200:
            logger.error(f"[AI Queue] API error {resp.status_code}: {resp.text[:300]}")
            raise AIRewriteError(f"API Error HTTP {resp.status_code}: {resp.text[:200]}")
        
        data = resp.json()
        try:
            rewritten = data["choices"][0]["message"]["content"]
            tokens_used = data.get("usage", {}).get("total_tokens", 0)
            return rewritten, tokens_used
        except (KeyError, IndexError, TypeError) as e:
            raise AIRewriteError(f"Invalid API response structure: {data}") from e


async def _call_gemini_native(
    api_key: str,
    text: str,
    prompt: str,
    system_prompt: Optional[str] = None,
) -> Tuple[str, int]:
    """Нативный вызов Google Gemini API с поддержкой актуальных моделей 3.6/3.5."""
    import google.generativeai as genai
    genai.configure(api_key=api_key)

    full_prompt = f"{prompt}\n\nТекст для обработки:\n{text}"

    gemini_models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"]
    last_err = None

    for m_name in gemini_models:
        try:
            model = genai.GenerativeModel(
                model_name=m_name,
                system_instruction=system_prompt or "Ты профессиональный SMM-менеджер.",
                generation_config=genai.GenerationConfig(
                    temperature=0.85,
                    max_output_tokens=2048,
                ),
            )

            loop = asyncio.get_running_loop()
            response = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: model.generate_content(full_prompt)),
                timeout=12.0
            )

            rewritten = response.text or text
            tokens_used = 0
            try:
                tokens_used = response.usage_metadata.total_token_count
            except Exception:
                pass

            return rewritten, tokens_used
        except Exception as e:
            last_err = e
            logger.warning(f"[Gemini Native] Model {m_name} failed: {e}")
            continue

    raise AIRewriteError(f"All Gemini native models failed: {last_err}")


async def call_gemini_with_retry(
    text: str,
    prompt: str,
    system_prompt: Optional[str] = None,
    mode: str = "news",
    api_key: Optional[str] = None,
) -> Tuple[str, int]:
    """
    Выполняет запрос к AI с авто-выбором провайдера (Zapro.su / OpenRouter / Groq / VseGPT / OpenAI / Gemini).
    """
    zapro_key = os.getenv("ZAPRO_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    vsegpt_key = os.getenv("VSEGPT_API_KEY", "").strip()

    zapro_url = os.getenv("ZAPRO_BASE_URL", os.getenv("AI_BASE_URL", "https://po.zapro.su/v1")).strip()

    resolved_key = (api_key or "").strip()
    provider = "auto"
    base_url = zapro_url

    if not resolved_key:
        pref = os.getenv("AI_PROVIDER", "").lower().strip()
        if pref == "openrouter" and openrouter_key:
            resolved_key, provider, base_url = openrouter_key, "openrouter", "https://openrouter.ai/api/v1"
        elif pref == "groq" and groq_key:
            resolved_key, provider, base_url = groq_key, "groq", "https://api.groq.com/openai/v1"
        elif pref == "vsegpt" and vsegpt_key:
            resolved_key, provider, base_url = vsegpt_key, "vsegpt", "https://api.vsegpt.ru/v1"
        elif pref == "gemini" and gemini_key:
            resolved_key, provider = gemini_key, "gemini"
        elif pref == "zapro" and zapro_key:
            resolved_key, provider, base_url = zapro_key, "zapro", zapro_url
        elif pref == "openai" and openai_key:
            resolved_key, provider, base_url = openai_key, "openai", "https://api.openai.com/v1"
        elif zapro_key:
            resolved_key, provider, base_url = zapro_key, "zapro", zapro_url
        elif openrouter_key:
            resolved_key, provider, base_url = openrouter_key, "openrouter", "https://openrouter.ai/api/v1"
        elif groq_key:
            resolved_key, provider, base_url = groq_key, "groq", "https://api.groq.com/openai/v1"
        elif gemini_key:
            resolved_key, provider = gemini_key, "gemini"
        elif openai_key:
            resolved_key, provider, base_url = openai_key, "openai", "https://api.openai.com/v1"

    if not resolved_key:
        raise ValueError("AI_API_KEY_MISSING")

    is_openai_compatible = (
        provider in ("zapro", "openai", "openrouter", "groq", "vsegpt") or
        resolved_key.startswith("zp-") or
        resolved_key.startswith("sk-") or
        resolved_key.startswith("gsk_")
    )

    async with ai_semaphore:
        max_attempts = len(RETRY_DELAYS) + 1
        last_exception = None

        if provider == "groq":
            candidate_models = ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"]
        elif provider == "openrouter":
            candidate_models = ["google/gemini-2.0-flash-exp:free", "meta-llama/llama-3.3-70b-instruct:free"]
        else:
            candidate_models = [
                os.getenv("ZAPRO_MODEL", "gemini-3.6-flash"),
                "gemini-3.6-flash",
                "claude-haiku-4-5-20251001",
                "gpt-4o-mini"
            ]

        for attempt in range(1, max_attempts + 1):
            try:
                target_model = candidate_models[(attempt - 1) % len(candidate_models)]
                logger.info(f"[AI Queue] Attempt {attempt}/{max_attempts} (provider: {provider}, model: {target_model})...")

                if is_openai_compatible:
                    rewritten, tokens = await _call_openai_compatible_api(
                        api_key=resolved_key,
                        text=text,
                        prompt=prompt,
                        system_prompt=system_prompt,
                        base_url=base_url,
                        model_override=target_model,
                    )
                else:
                    rewritten, tokens = await _call_gemini_native(
                        api_key=resolved_key,
                        text=text,
                        prompt=prompt,
                        system_prompt=system_prompt,
                    )

                clean_text = clean_ai_commentary(rewritten)
                logger.info(f"[AI Queue] Attempt {attempt}/{max_attempts} SUCCESS | tokens={tokens}")
                return clean_text, tokens

            except Exception as e:
                last_exception = e
                err_msg = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
                logger.warning(f"[AI Queue] Attempt {attempt}/{max_attempts} failed: {err_msg}")

                if attempt < max_attempts:
                    delay = RETRY_DELAYS[attempt - 1]
                    logger.info(f"Retrying in {delay}s...")
                    await asyncio.sleep(delay)
                else:
                    logger.error(f"[AI Queue] All {max_attempts} attempts failed: {err_msg}")
                    raise AIRewriteError(f"AI API Error after {max_attempts} attempts: {err_msg}") from e
