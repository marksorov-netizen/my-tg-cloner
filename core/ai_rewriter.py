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

# Задержки между повторными попытками (в секундах)
RETRY_DELAYS = [5, 15, 45]


class AIRewriteError(Exception):
    """Исключение при неисправимой ошибке AI рерайта."""
    pass


async def _call_openai_compatible_api(
    api_key: str,
    text: str,
    prompt: str,
    system_prompt: Optional[str] = None,
    base_url: str = "https://po.zapro.su/v1",
    model_name: str = "gpt-4o-mini",
    model_override: Optional[str] = None,
) -> Tuple[str, int]:
    """Запрос к OpenAI-совместимому API (Zapro.su, OpenRouter, OpenAI, etc.)."""
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
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(endpoint, json=payload, headers=headers)
        if resp.status_code != 200:
            logger.error(f"[AI Queue] API error {resp.status_code}: {resp.text}")
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
    """Нативный вызов Google Gemini API."""
    import google.generativeai as genai
    genai.configure(api_key=api_key)

    full_prompt = f"{prompt}\n\nТекст для обработки:\n{text}"

    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        system_instruction=system_prompt or "Ты профессиональный SMM-менеджер.",
        generation_config=genai.GenerationConfig(
            temperature=0.85,
            max_output_tokens=2048,
        ),
    )

    loop = asyncio.get_running_loop()
    response = await loop.run_in_executor(
        None,
        lambda: model.generate_content(full_prompt)
    )

    rewritten = response.text or text
    tokens_used = 0
    try:
        tokens_used = response.usage_metadata.total_token_count
    except Exception:
        pass

    return rewritten, tokens_used


async def call_gemini_with_retry(
    text: str,
    prompt: str,
    system_prompt: Optional[str] = None,
    mode: str = "news",
    api_key: Optional[str] = None,
) -> Tuple[str, int]:
    """
    Выполняет запрос к AI с авто-выбором провайдера (Zapro.su / OpenAI / Gemini).

    Порядок поиска ключа:
    1. Переданный явно `api_key`
    2. ZAPRO_API_KEY из .env
    3. OPENAI_API_KEY из .env
    4. GEMINI_API_KEY из .env
    """
    zapro_key = os.getenv("ZAPRO_API_KEY", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    zapro_url = os.getenv("ZAPRO_BASE_URL", os.getenv("AI_BASE_URL", "https://po.zapro.su/v1")).strip()

    resolved_key = (api_key or "").strip()
    provider = "auto"

    if not resolved_key:
        if zapro_key:
            resolved_key = zapro_key
            provider = "zapro"
        elif openai_key:
            resolved_key = openai_key
            provider = "openai"
        elif gemini_key:
            resolved_key = gemini_key
            provider = "gemini"

    if not resolved_key:
        raise ValueError("AI_API_KEY_MISSING")

    # Авто-определение провайдера по формату ключа или установленным переменным
    is_openai_compatible = (
        provider in ("zapro", "openai") or
        zapro_key or
        resolved_key.startswith("zp-") or
        resolved_key.startswith("sk-") or
        os.getenv("AI_PROVIDER") in ("zapro", "openai", "openrouter")
    )

    async with ai_semaphore:
        await asyncio.sleep(1.5)

        max_attempts = len(RETRY_DELAYS) + 1
        last_exception = None

        candidate_models = [
            os.getenv("ZAPRO_MODEL", "gemini-3.5-flash"),
            "gemini-3.5-flash",
            "gemini-3.6-flash",
            "gpt-5.4-mini"
        ]

        for attempt in range(1, max_attempts + 1):
            try:
                target_model = candidate_models[(attempt - 1) % len(candidate_models)]
                logger.info(f"[AI Queue] Attempt {attempt}/{max_attempts} (provider: {'Zapro/OpenAI' if is_openai_compatible else 'Gemini'}, model: {target_model})...")

                if is_openai_compatible:
                    rewritten, tokens = await _call_openai_compatible_api(
                        api_key=resolved_key,
                        text=text,
                        prompt=prompt,
                        system_prompt=system_prompt,
                        base_url=zapro_url,
                        model_override=target_model,
                    )
                else:
                    rewritten, tokens = await _call_gemini_native(
                        api_key=resolved_key,
                        text=text,
                        prompt=prompt,
                        system_prompt=system_prompt,
                    )

                logger.info(f"[AI Queue] Attempt {attempt}/{max_attempts} SUCCESS | tokens={tokens}")
                return rewritten, tokens

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
