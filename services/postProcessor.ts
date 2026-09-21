import { AppConfig, ProcessedPost, PricingRules } from '../types';
import { rewriteContent, SmartPricePayload } from './geminiService';

export interface ExtractedPrices {
  allPrices: number[];
  maxPrice: number | null;
  minPrice: number | null;
  retailPrice: number | null;
  wholesalePrice: number | null;
  basePrice: number | null; // Всегда САМАЯ БОЛЬШАЯ сумма в исходном тексте
}

/**
 * Извлекает все цены из текста донора и отталкивается от САМОЙ БОЛЬШОЙ суммы.
 * Например, если в тексте "Опт: 1500, Дроп: 2200, Розница: 2500" -> basePrice = 2500.
 */
export const extractDetailedPrices = (text: string): ExtractedPrices => {
  if (!text) return { allPrices: [], maxPrice: null, minPrice: null, retailPrice: null, wholesalePrice: null, basePrice: null };

  const found: number[] = [];

  // 1. Поиск явной оптовой цены (например: "Оптом 2200", "Опт: 2200 руб", "от 5 шт 2200")
  let explicitOpt: number | null = null;
  const optMatch = text.match(/(?:оптом|опт|от\s*\d+\s*(?:шт|пар|ед|уп))\s*[:\-—]?\s*(\d[\d\s\.,]*)/i);
  if (optMatch && optMatch[1]) {
    const n = parseFloat(optMatch[1].replace(/\s+/g, '').replace(',', '.'));
    if (!isNaN(n) && n >= 50 && n <= 10000000) {
      explicitOpt = n;
      found.push(n);
    }
  }

  // 2. Поиск явной цены дропа (например: "Дроп: 2200", "Дропшиппинг 2200")
  const dropMatch = text.match(/(?:дроп|дропшиппинг)\s*[:\-—]?\s*(\d[\d\s\.,]*)/i);
  if (dropMatch && dropMatch[1]) {
    const n = parseFloat(dropMatch[1].replace(/\s+/g, '').replace(',', '.'));
    if (!isNaN(n) && n >= 50 && n <= 10000000) {
      found.push(n);
    }
  }

  // 3. Поиск явной розничной / основной цены (например: "Цена 2400", "Розница 2500", "Стоимость: 2400")
  let explicitRetail: number | null = null;
  const retailMatch = text.match(/(?:цена|стоимость|розница|в\s*розницу|прайс|штучно)\s*[:\-—]?\s*(\d[\d\s\.,]*)/i);
  if (retailMatch && retailMatch[1]) {
    const n = parseFloat(retailMatch[1].replace(/\s+/g, '').replace(',', '.'));
    if (!isNaN(n) && n >= 50 && n <= 10000000) {
      explicitRetail = n;
      found.push(n);
    }
  }

  // 4. Поиск чисел с валютой (руб, рублей, р, ₽, $, €)
  const currencyRegex = /(\d[\d\s\.,]*)\s*(?:руб|рублей|р\b|₽|\$|€|usd)/gi;
  let match;
  while ((match = currencyRegex.exec(text)) !== null) {
    if (match[1]) {
      const n = parseFloat(match[1].replace(/\s+/g, '').replace(',', '.'));
      if (!isNaN(n) && n >= 50 && n <= 10000000) {
        found.push(n);
      }
    }
  }

  // 5. Поиск 3-6 значных чисел в тексте (цены без прямого указания слова "руб")
  const genericNumRegex = /\b([1-9]\d{2,5})\b/g;
  while ((match = genericNumRegex.exec(text)) !== null) {
    const n = parseFloat(match[1]);
    // Исключаем годы (2024, 2025, 2026, 2027) и размеры обуви/одежды (40-48)
    if (n >= 150 && n <= 1000000 && ![2024, 2025, 2026, 2027].includes(n)) {
      found.push(n);
    }
  }

  const uniquePrices = Array.from(new Set(found)).sort((a, b) => a - b);
  const maxPrice = uniquePrices.length > 0 ? uniquePrices[uniquePrices.length - 1] : null;
  const minPrice = uniquePrices.length > 0 ? uniquePrices[0] : null;

  // Базовая цена — ВСЕГДА САМАЯ БОЛЬШАЯ СУММА (maxPrice)
  const basePrice = maxPrice;
  const retailPrice = explicitRetail || maxPrice;
  const wholesalePrice = explicitOpt || (uniquePrices.length > 1 ? minPrice : null);

  return {
    allPrices: uniquePrices,
    maxPrice,
    minPrice,
    retailPrice,
    wholesalePrice,
    basePrice
  };
};

export const extractPrice = (text: string): number | null => {
  return extractDetailedPrices(text).basePrice;
};

/**
 * Расчет наценок: Опт, Дроп и Розница считаются напрямую от САМОЙ БОЛЬШОЙ базовой цены донора.
 * Например: исходная цена 1500 ₽, Опт +20% -> 1800 ₽, Дроп +30% -> 1950 ₽, Розница +50% -> 2250 ₽.
 */
export const calculateSmartPrices = (
  extracted: ExtractedPrices,
  rules: PricingRules
): SmartPricePayload | null => {
  const base = extracted.basePrice;
  if (!base) return null;

  const mode = rules.mode || 'single';
  const symbol = rules.currencySymbol || '₽';

  if (mode === 'single') {
    // Единая розничная цена с заданной наценкой к исходной цене
    const markupPct = rules.singleMarkupPercent !== undefined
      ? rules.singleMarkupPercent
      : (rules.retailPercent !== undefined ? rules.retailPercent : 30);
    const finalPrice = Math.round(base * (1 + markupPct / 100));
    return {
      mode: 'single',
      retail: finalPrice,
      singlePrice: finalPrice,
      symbol
    };
  }

  if (mode === 'opt_retail') {
    // Опт и Розница рассчитываются напрямую от цены донора
    const opt = Math.round(base * (1 + (rules.wholesalePercent !== undefined ? rules.wholesalePercent : 10) / 100));
    const retail = Math.round(base * (1 + (rules.retailPercent !== undefined ? rules.retailPercent : 30) / 100));
    return {
      mode: 'opt_retail',
      opt,
      retail,
      singlePrice: retail,
      symbol
    };
  }

  // mode === 'three_tier' — все 3 цены от исходной цены донора без каких-либо понижающих коэффициентов!
  const opt = Math.round(base * (1 + (rules.wholesalePercent !== undefined ? rules.wholesalePercent : 20) / 100));
  const drop = Math.round(base * (1 + (rules.dropPercent !== undefined ? rules.dropPercent : 30) / 100));
  const retail = Math.round(base * (1 + (rules.retailPercent !== undefined ? rules.retailPercent : 50) / 100));
  return {
    mode: 'three_tier',
    opt,
    drop,
    retail,
    singlePrice: retail,
    symbol
  };
};

export const calculatePrices = (basePrice: number, rules: PricingRules) => {
  return {
    opt: Math.round(basePrice * (1 + (rules.wholesalePercent !== undefined ? rules.wholesalePercent : 20) / 100)),
    drop: Math.round(basePrice * (1 + (rules.dropPercent !== undefined ? rules.dropPercent : 30) / 100)),
    retail: Math.round(basePrice * (1 + (rules.retailPercent !== undefined ? rules.retailPercent : 50) / 100)),
  };
};

/**
 * Абсолютная зачистка текста донора от телефонов, чужих ссылок, павильонов и рыночных маркеров.
 */
export const sanitizeDonorContent = (text: string, allowedBotUsername?: string): string => {
  if (!text) return '';

  const botClean = allowedBotUsername?.trim().replace(/^@/, '').toLowerCase();

  const phoneRuRegex = /(?:\+?7|8)[\s\-\(]*\d{3}[\s\-\)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/;
  const phoneIntlRegex = /\+?\d{1,3}[\s\-\(]*\d{2,4}[\s\-\)]*[\d\s\-]{5,10}\d/;
  const phoneKeywordRegex = /(?:тел(?:ефон)?|сот(?:овый)?|моб(?:ильный)?|ва(?:т|тс)?апп?|whatsapp|wa|viber|вайбер|tg|контакт[ы]?|номер|связь|звон[ок]?|заказ[ы]?)[\s\:\-—\.\(]*\+?[\d\s\-\(\)]{7,}\d/i;

  const marketKeywordsRegex = /(?:садовод|тк\s*садовод|тяк(?:\s*москва)?|люблино|дубровка|южные\s*ворота|апрашка|апраксин|таганский\s*ряд|линия\s*\d+|корпус\s*[а-яё\d]+|павильон\s*[\w\-]+|место\s*[\w\-]+|этаж\s*\d+|контейнер\s*[\w\-]+)/i;
  const pavilionCodeRegex = /\b[А-Яа-яA-Za-z]{1,3}\s*[-–—]\s*\d+[А-Яа-яA-Za-z]?\s*[-–—]\s*\d+\b/;

  const donorCtaRegex = /^(?:[🛍️🛒👉👆📞📲☎️✅▪️•\*\s]*)(?:для\s*(?:оформления\s*)?заказа|оформить\s*заказ|заказ[ы]?\s*принимает|менеджер|по\s*вопросам\s*заказа|связаться|написать|бронь(?:\s*от)?|сборка|минималк[а-я]*|прямой\s*поставщик|поставщик|рынок|садовод|отправка\s*(?:по\s*всей\s*россии|автобусами|тк)|самовывоз|штучно\s*(?:от|по))[\s\:\-—\.\*]*$/i;
  const supplierRawPriceRegex = /^(?:[▪️•\*\s]*)(?:штучно|опт(?:ом)?)\s*[:\-—]?\s*\d+.*$/i;
  const donorHashtagsRegex = /#(?:садовод|velvet|тяк|рынок|поставщик|люблино|дубровка|женскаяодежда_садовод|мужскаяодежда_садовод|тксадовод|вещисадовод|одеждасадовод)[\w]*/gi;
  const danglingIconsRegex = /^[🛍️🛒👉👆📞📲☎️✅▪️•\-–—\s\*\#]+$/;

  const lines = text.split('\n');
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) {
      cleanedLines.push('');
      continue;
    }

    // 1. Проверка на телефоны
    if (phoneRuRegex.test(stripped) || phoneKeywordRegex.test(stripped) || phoneIntlRegex.test(stripped)) {
      continue;
    }

    // 2. Проверка на призывы донора к заказу
    if (donorCtaRegex.test(stripped)) {
      continue;
    }

    // 3. Сырые цены поставщика
    if (supplierRawPriceRegex.test(stripped)) {
      continue;
    }

    // 4. Рыночные локации и павильоны
    if (marketKeywordsRegex.test(stripped) || pavilionCodeRegex.test(stripped)) {
      continue;
    }

    // 5. Очистка Markdown-ссылок
    let lineClean = line.replace(/\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g, (match, linkText, url) => {
      if (botClean && url.toLowerCase().includes(botClean)) {
        return match;
      }
      return '';
    });

    // 6. Очистка прямых URL
    lineClean = lineClean.replace(/https?:\/\/\S+/g, (url) => {
      if (botClean && url.toLowerCase().includes(botClean)) {
        return url;
      }
      return '';
    });

    // 7. Очистка чужих упоминаний @username
    lineClean = lineClean.replace(/@[\w_]+/g, (mention) => {
      const uname = mention.replace(/^@/, '').toLowerCase();
      if (botClean && botClean === uname) {
        return mention;
      }
      return '';
    });

    // 8. Донорские хэштеги
    lineClean = lineClean.replace(donorHashtagsRegex, '');

    // 9. Висячие символы
    const lineSub = lineClean.replace(/[\*\_`]/g, '').trim();
    if (donorCtaRegex.test(lineSub) || danglingIconsRegex.test(lineClean)) {
      continue;
    }

    if (lineClean.trim()) {
      cleanedLines.push(lineClean.trimEnd());
    } else {
      cleanedLines.push('');
    }
  }

  return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

export const processSinglePost = async (
  rawText: string,
  config: AppConfig,
  isTestMode: boolean = false,
  customPrompt?: string,
  isStoreMode: boolean = false
): Promise<ProcessedPost & { calculatedPrice?: number; wholesalePrice?: number; dropPrice?: number }> => {
  const id = Math.random().toString(36).substr(2, 9);
  let errorMessage: string | undefined;

  // 1. Извлекаем цены донора из сырого текста ДО очистки
  const extracted = isStoreMode || config.pricing?.mode ? extractDetailedPrices(rawText) : { allPrices: [], maxPrice: null, minPrice: null, retailPrice: null, wholesalePrice: null, basePrice: null };
  const smartPrices = (isStoreMode || config.pricing?.mode) ? calculateSmartPrices(extracted, config.pricing) : null;

  // 2. Предварительная зачистка текста донора перед отправкой в AI (удаляем телефоны, ссылки, павильоны)
  const cleanInputText = sanitizeDonorContent(rawText, config.telegramBotToken);
  let processedText = cleanInputText;

  const prices = smartPrices ? {
    mode: smartPrices.mode,
    opt: smartPrices.opt,
    drop: smartPrices.drop,
    retail: smartPrices.retail,
    singlePrice: smartPrices.singlePrice,
    symbol: smartPrices.symbol,
  } : null;

  const originalPrice = extracted.basePrice;

  // 3. AI Processing
  let aiSuccess = true;
  if (config.useAI) {
    try {
      processedText = await rewriteContent(
        cleanInputText,
        smartPrices,
        config.removeLinks,
        customPrompt
      );
      // Финишная гарантированная зачистка ПОСЛЕ работы AI
      processedText = sanitizeDonorContent(processedText, config.telegramBotToken);
    } catch (e: any) {
      console.error("AI Generation failed:", e);
      aiSuccess = false;
      errorMessage = e.message || "Пост отложен из-за ошибки AI, будет обработан позже";

      if (config.useOriginalOnError && smartPrices) {
        if (smartPrices.mode === 'single' || (!smartPrices.opt && !smartPrices.drop)) {
          processedText += `\n\n💰 Цена: ${smartPrices.retail} ${smartPrices.symbol}`;
        } else if (smartPrices.mode === 'opt_retail') {
          processedText += `\n\n📦 Опт: ${smartPrices.opt} ${smartPrices.symbol}\n🏷️ Розница: ${smartPrices.retail} ${smartPrices.symbol}`;
        } else {
          processedText += `\n\n📦 Опт: ${smartPrices.opt} ${smartPrices.symbol}\n🤝 Дроп: ${smartPrices.drop} ${smartPrices.symbol}\n🏷️ Розница: ${smartPrices.retail} ${smartPrices.symbol}`;
        }
      }
    }
  } else if (smartPrices) {
    if (smartPrices.mode === 'single' || (!smartPrices.opt && !smartPrices.drop)) {
      processedText += `\n\n💰 Цена: ${smartPrices.retail} ${smartPrices.symbol}`;
    } else if (smartPrices.mode === 'opt_retail') {
      processedText += `\n\n📦 Опт: ${smartPrices.opt} ${smartPrices.symbol}\n🏷️ Розница: ${smartPrices.retail} ${smartPrices.symbol}`;
    } else {
      processedText += `\n\n📦 Опт: ${smartPrices.opt} ${smartPrices.symbol}\n🤝 Дроп: ${smartPrices.drop} ${smartPrices.symbol}\n🏷️ Розница: ${smartPrices.retail} ${smartPrices.symbol}`;
    }
  }

  // 4. Determine status
  let status: 'success' | 'error' | 'pending_retry' = 'success';
  if (config.useAI && !aiSuccess && !config.useOriginalOnError) {
    status = 'pending_retry';
  } else if (isTestMode && config.telegramBotToken) {
    // Тестовая отправка из браузера отключена: токен нельзя светить в DevTools.
    // Для реальной отправки используйте backend POST /batch/send.
    console.warn('[security] test-mode direct Telegram publish disabled, use backend /batch/send');
  }

  return {
    id,
    originalContent: rawText,
    processedContent: processedText,
    originalPrice,
    calculatedPrices: prices ? {
      opt: prices.opt || prices.retail,
      drop: prices.drop || prices.retail,
      retail: prices.retail
    } : null,
    calculatedPrice: smartPrices?.retail,
    wholesalePrice: smartPrices?.opt,
    dropPrice: smartPrices?.drop,
    status,
    timestamp: new Date().toISOString(),
    source: config.sourceType,
    errorMessage
  };
};