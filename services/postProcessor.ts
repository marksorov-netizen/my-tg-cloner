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

// NEW: Function to send to Telegram
const publishToTelegram = async (text: string, config: AppConfig): Promise<void> => {
  if (!config.telegramBotToken || !config.destinationChannel) {
    console.warn("Skipping Telegram publish: No token or channel set.");
    return;
  }

  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: config.destinationChannel,
        text: text,
        parse_mode: 'HTML',
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Telegram Error: ${data.description}`);
    }
  } catch (error: any) {
    console.error("Publishing failed:", error);
    throw new Error(`Ошибка отправки: ${error.message}. (Возможно, блокировка CORS в браузере)`);
  }
};

export const processSinglePost = async (
  rawText: string,
  config: AppConfig,
  isTestMode: boolean = false
): Promise<ProcessedPost & { calculatedPrice?: number; wholesalePrice?: number; dropPrice?: number }> => {
  const id = Math.random().toString(36).substr(2, 9);
  let processedText = rawText;
  let errorMessage: string | undefined;

  // 1. Clean links if basic cleaning requested (before AI)
  if (config.removeLinks && !config.useAI) {
    processedText = processedText.replace(/https?:\/\/\S+/g, '');
  }

  // 2. Price Extraction & Calculation (ВСЕГДА отталкиваемся от САМОЙ БОЛЬШОЙ суммы)
  const extracted = extractDetailedPrices(rawText);
  const smartPrices = calculateSmartPrices(extracted, config.pricing);

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
        rawText,
        smartPrices,
        config.removeLinks
      );
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
    try {
      await publishToTelegram(processedText, config);
    } catch (e: any) {
      status = 'error';
      errorMessage = e.message;
    }
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