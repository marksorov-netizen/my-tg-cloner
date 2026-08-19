/**
 * geminiService.ts
 *
 * Раньше здесь был прямой вызов @google/genai SDK из браузера.
 * ПРОБЛЕМЫ:
 *  1. process.env.API_KEY не работает в Vite runtime (нужен VITE_ prefix)
 *  2. API ключ был виден любому в DevTools → кража ключа
 *
 * РЕШЕНИЕ (Задача 3): все AI-запросы идут через backend /api/ai/rewrite
 * Этот файл теперь является тонкой обёрткой над fetch к backend.
 */

// Пустая строка = относительный URL, Vite proxy направит на backend
// В prod настройте nginx reverse proxy или используйте полный URL
const BACKEND_URL = '';

export interface SmartPricePayload {
  mode?: 'single' | 'three_tier' | 'opt_retail';
  opt?: number;
  drop?: number;
  retail: number;
  singlePrice?: number;
  symbol: string;
}

interface RewriteOptions {
  text: string;
  prices: SmartPricePayload | null;
  removeLinks: boolean;
}

interface RewriteResult {
  rewritten_text: string;
  tokens_used: number;
}

/**
 * Отправляет текст на backend для AI-рерайта через Gemini.
 * API ключ хранится ТОЛЬКО на сервере — безопасно.
 */
export const rewriteContent = async (
  text: string,
  prices: SmartPricePayload | null,
  removeLinks: boolean
): Promise<string> => {

  // Формируем промпт с ценами в зависимости от выбранного режима
  let priceInstruction = '';
  if (prices) {
    if (prices.mode === 'single' || (!prices.opt && !prices.drop)) {
      priceInstruction = `СТРОЖАЙШИЙ ЗАПРЕТ ПО СТАРЫМ ЦЕНАМ: В исходном тексте были цены поставщика. ТЫ ОБЯЗАН ПОЛНОСТЬЮ УДАЛИТЬ ВСЕ СТАРЫЕ ЦЕНЫ и написать ТОЛЬКО ОДНУ ИТОГОВУЮ ЦЕНУ:\n💰 Цена: ${prices.retail} ${prices.symbol}\n(Категорически запрещено писать слова "Опт" или "Дроп", выдумывать другие суммы или оставлять старые цены поставщика!)`;
    } else if (prices.mode === 'opt_retail') {
      priceInstruction = `СТРОГОЕ ПРАВИЛО ПО ЦЕНАМ: В исходном тексте были цены поставщика. Замени их на наш прайс:\n📦 Опт: ${prices.opt} ${prices.symbol}\n🏷️ Розница: ${prices.retail} ${prices.symbol}\n(Запрещено указывать старые цены поставщика!)`;
    } else {
      priceInstruction = `СТРОГОЕ ПРАВИЛО ПО ЦЕНАМ: В исходном тексте была указана цена поставщика. Замени её на наш прайс с наценками:\n📦 Опт: ${prices.opt} ${prices.symbol}\n🤝 Дроп: ${prices.drop} ${prices.symbol}\n🏷️ Розница: ${prices.retail} ${prices.symbol}\n(Никогда не оставляй и не указывай старую цену поставщика в тексте!)`;
    }
  } else {
    priceInstruction = 'Если в тексте товара есть цена, пересчитай её с наценкой продавца.';
  }

  const linkInstruction = removeLinks
    ? 'УДАЛИ все внешние ссылки (http/https) и упоминания (@) из исходного текста.'
    : 'Сохрани ссылки как есть.';

  const systemPrompt = `Ты профессиональный SMM-менеджер для Telegram-магазинов. Твоя задача — создавать продающие посты о товарах. НИКОГДА не пиши объяснений, отказов или вопросов. Всегда выдавай готовый пост для публикации.`;

  const userPrompt = `Создай продающий пост для Telegram-магазина на основе следующей информации.

Требования:
1. Сделай текст продающим, структурированным, добавь уместные эмодзи (🔥, ✨, 🛍️).
2. ${linkInstruction}
3. ${priceInstruction}
4. Сохрани все имеющиеся характеристики (размеры, материал, цвета).
5. Верни ТОЛЬКО готовый текст поста для публикации, без вводных фраз, кавычек и мета-комментариев.
6. НИ В КОЕМ СЛУЧАЕ не пиши, что информации мало или текст отсутствует — напиши красивый продающий пост на основе того, что есть!

Информация:
"${text}"`;

  try {
    const response = await fetch(`${BACKEND_URL}/api/ai/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',  // ← JWT cookie для авторизации на backend
      body: JSON.stringify({
        text,
        prompt: userPrompt,
        system_prompt: systemPrompt,
        mode: prices ? 'product' : 'news',
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Неизвестная ошибка сервера' }));
      throw new Error(err.detail || `HTTP ${response.status}`);
    }

    const data: RewriteResult = await response.json();
    console.log(`[Gemini] Tokens used: ${data.tokens_used}`);
    const candidate = (data.rewritten_text || '').trim();

    // Защита от отказов и комментариев нейросети
    const refusalPatterns = [
      'отсутствует описание',
      'пришлите текст',
      'не могу сделать',
      'предоставленном исходном тексте',
      'нет описания',
      'пожалуйста, пришлите'
    ];
    const isRefusal = refusalPatterns.some(pat => candidate.toLowerCase().includes(pat));
    if (isRefusal) {
      console.warn('[Gemini] Model returned refusal commentary, falling back to cleaned original text');
      let fallbackText = text.replace(/https?:\/\/\S+/g, '').replace(/@\w+/g, '').trim();
      if (prices) {
        if (prices.mode === 'single' || (!prices.opt && !prices.drop)) {
          fallbackText += `\n\n💰 Цена: ${prices.retail} ${prices.symbol}`;
        } else if (prices.mode === 'opt_retail') {
          fallbackText += `\n\n📦 Опт: ${prices.opt} ${prices.symbol}\n🏷️ Розница: ${prices.retail} ${prices.symbol}`;
        } else {
          fallbackText += `\n\n📦 Опт: ${prices.opt} ${prices.symbol}\n🤝 Дроп: ${prices.drop} ${prices.symbol}\n🏷️ Розница: ${prices.retail} ${prices.symbol}`;
        }
      }
      return fallbackText;
    }

    return candidate || text;

  } catch (error: any) {
    console.error('[Gemini] API Error:', error);
    if (error.message?.includes('fetch') || error.message?.includes('NetworkError')) {
      throw new Error('Backend недоступен. Убедитесь, что запущен server.py');
    }
    throw error;
  }
};