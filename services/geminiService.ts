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
  removeLinks: boolean,
  customPrompt?: string
): Promise<string> => {

  const antiDonorInstruction = `СТРОЖАЙШИЙ ЗАПРЕТ НА ДАННЫЕ И КОНТАКТЫ ДОНОРА:
1. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО оставлять любые номера телефонов (включая +7, 8, WhatsApp, городские и мобильные номера вроде +7(967)...).
2. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО копировать любые ссылки (t.me, wa.me, vk.com, max.ru, instagram), чужие аккаунты (@...) и контакты менеджеров.
3. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать названия рынков, складов, торговых центров, корпусов, линий и павильонов (Садовод, ТК Садовод, Линия, Корпус, Б-2А-49, Павильон, ТЯК, Люблино, этаж, место, оптовый рынок, дропшиппинг поставщик, сборка, отправка через ТК).
4. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО копировать призывы донора "Для оформления заказа", "Для заказа пишите" и реквизиты поставщика.
Текст должен выглядеть как наш собственный фирменный пост магазина от первого лица!`;

  let systemPrompt = '';
  let userPrompt = '';
  const isProduct = Boolean(prices && (prices.retail || prices.opt || prices.drop));

  if (isProduct && prices) {
    // Режим магазина: форматирование цен
    let priceInstruction = '';
    if (prices.mode === 'single' || (!prices.opt && !prices.drop)) {
      priceInstruction = `СТРОЖАЙШИЙ ЗАПРЕТ ПО СТАРЫМ ЦЕНАМ: В исходном тексте были цены поставщика. ТЫ ОБЯЗАН ПОЛНОСТЬЮ УДАЛИТЬ ВСЕ СТАРЫЕ ЦЕНЫ и написать ТОЛЬКО ОДНУ ИТОГОВУЮ ЦЕНУ:\n💰 Цена: ${prices.retail} ${prices.symbol}\n(Категорически запрещено писать слова "Опт" или "Дроп", выдумывать другие суммы или оставлять старые цены поставщика!)`;
    } else if (prices.mode === 'opt_retail') {
      priceInstruction = `СТРОГОЕ ПРАВИЛО ПО ЦЕНАМ: В исходном тексте были цены поставщика. Замени их на наш прайс:\n📦 Опт: ${prices.opt} ${prices.symbol}\n🏷️ Розница: ${prices.retail} ${prices.symbol}\n(Запрещено указывать старые цены поставщика!)`;
    } else {
      priceInstruction = `СТРОГОЕ ПРАВИЛО ПО ЦЕНАМ: В исходном тексте была указана цена поставщика. Замени её на наш прайс с наценками:\n📦 Опт: ${prices.opt} ${prices.symbol}\n🤝 Дроп: ${prices.drop} ${prices.symbol}\n🏷️ Розница: ${prices.retail} ${prices.symbol}\n(Никогда не оставляй и не указывай старую цену поставщика в тексте!)`;
    }

    systemPrompt = `Ты профессиональный SMM-менеджер для Telegram-магазинов. Твоя задача — создавать продающие посты о товарах. НИКОГДА не пиши объяснений, отказов или вопросов. Всегда выдавай готовый пост для публикации без чужих контактов и без ссылок.`;

    userPrompt = customPrompt?.trim()
      ? `${customPrompt.trim()}\n\nОбязательные требования:\n${antiDonorInstruction}\n\n${priceInstruction}\nСохрани характеристики товара (размеры, цвета, ткань).\nВерни ТОЛЬКО готовый текст поста для публикации.\n\nИсходный текст:\n"${text}"`
      : `Создай привлекательный продающий пост для нашего Telegram-магазина на основе следующей информации.\n\nТребования:\n1. Сделай текст продающим, структурированным, добавь уместные эмодзи (🔥, ✨, 🛍️).\n2. ${antiDonorInstruction}\n3. ${priceInstruction}\n4. Сохрани все характеристики товара (размеры, материал, цвета).\n5. Верни ТОЛЬКО готовый текст поста для публикации, без вводных фраз, кавычек и мета-комментариев.\n\nИнформация:\n"${text}"`;
  } else {
    // Режим парсера новостей / каналов по промту
    systemPrompt = `Ты профессиональный SMM-редактор и копирайтер для Telegram-каналов. Твоя задача — качественно переписывать посты, делать их интересными, цепляющими и уникальными. КАТЕГОРИЧЕСКИ удаляй любые чужие ссылки, контакты и номера телефонов. Верни ТОЛЬКО готовый текст поста для публикации.`;

    const basePrompt = customPrompt?.trim() || 'Перепиши этот пост для Telegram-канала. Сделай его ярким, вовлекающим, добавь подходящие эмодзи и разбей на читаемые абзацы.';
    userPrompt = `${basePrompt}\n\nПравила:\n${antiDonorInstruction}\nСохрани суть оригинала.\nВерни ТОЛЬКО готовый текст поста без вступлений, кавычек и объяснений.\n\nИсходный пост:\n"${text}"`;
  }

  const buildFallback = () => {
    let fallbackText = text.replace(/https?:\/\/\S+/g, '').replace(/@\w+/g, '').trim();
    if (prices) {
      if (prices.mode === 'single' || (!prices.opt && !prices.drop)) {
        fallbackText += `\n\n💰 Цена: ${prices.retail || prices.singlePrice} ${prices.symbol}`;
      } else if (prices.mode === 'opt_retail') {
        fallbackText += `\n\n📦 Опт: ${prices.opt} ${prices.symbol}\n🏷️ Розница: ${prices.retail} ${prices.symbol}`;
      } else {
        fallbackText += `\n\n📦 Опт: ${prices.opt} ${prices.symbol}\n🤝 Дроп: ${prices.drop} ${prices.symbol}\n🏷️ Розница: ${prices.retail} ${prices.symbol}`;
      }
    }
    return fallbackText;
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(`${BACKEND_URL}/api/ai/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',  // ← JWT cookie для авторизации на backend
      signal: controller.signal,
      body: JSON.stringify({
        text,
        prompt: userPrompt,
        system_prompt: systemPrompt,
        mode: isProduct ? 'product' : 'news',
      }),
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
      console.warn(`[Gemini] Backend AI returned ${response.status}: ${err.detail}. Using formatted fallback.`);
      return buildFallback();
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
      return buildFallback();
    }

    return candidate || buildFallback();

  } catch (error: any) {
    console.warn('[Gemini] AI Rewrite unavailable or timed out:', error?.message);
    return buildFallback();
  }
};