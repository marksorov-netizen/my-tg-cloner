/**
 * services/userConfig.ts
 *
 * Персистентное сохранение всех пользовательских настроек (каналов-доноров,
 * целевых каналов публикации, промтов, режимов наценки и цен) в localStorage.
 * Гарантирует, что при перезагрузке или возврате на сайт настройки НЕ СБРАСЫВАЮТСЯ.
 */

export interface UserSavedConfig {
  storeDonors: string[];
  storeTargets: string[];
  storePrompt: string;
  priceMode: 'single' | 'three_tier' | 'opt_retail';
  singleMarkupPct: number;
  wholesalePct: number;
  dropPct: number;
  retailPct: number;
  
  parserDonors: string[];
  parserTargets: string[];
  parserPrompt: string;

  copyCount: number;
  intervalMinutes: number;
}

const STORAGE_KEY = 'ghostpost_user_saved_channels';

export const loadUserSavedConfig = (): UserSavedConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        storeDonors: parsed.storeDonors || ['@somoniyon1998'],
        storeTargets: parsed.storeTargets || ['@my_store'],
        storePrompt: parsed.storePrompt || 'Перепиши описание товара в привлекательном продающем стиле. Удали все ссылки, телефоны и контакты стороннего продавца. Выдели ключевые особенности товара списком 📦.',
        priceMode: parsed.priceMode || 'single',
        singleMarkupPct: parsed.singleMarkupPct !== undefined ? parsed.singleMarkupPct : 30,
        wholesalePct: parsed.wholesalePct !== undefined ? parsed.wholesalePct : 10,
        dropPct: parsed.dropPct !== undefined ? parsed.dropPct : 20,
        retailPct: parsed.retailPct !== undefined ? parsed.retailPct : 30,

        parserDonors: parsed.parserDonors || ['@breakingnews_ru'],
        parserTargets: parsed.parserTargets || ['@my_channel'],
        parserPrompt: parsed.parserPrompt || 'Перепиши текст новости в стиле нефора: молодежный сленг, мемы, эмодзи, без официальщины.',
        copyCount: parsed.copyCount || 100,
        intervalMinutes: parsed.intervalMinutes !== undefined ? parsed.intervalMinutes : 15,
      };
    }
  } catch {}
  return {
    storeDonors: ['@somoniyon1998'],
    storeTargets: ['@my_store'],
    storePrompt: 'Перепиши описание товара в привлекательном продающем стиле. Удали все ссылки, телефоны и контакты стороннего продавца. Выдели ключевые особенности товара списком 📦.',
    priceMode: 'single',
    singleMarkupPct: 30,
    wholesalePct: 10,
    dropPct: 20,
    retailPct: 30,

    parserDonors: ['@breakingnews_ru'],
    parserTargets: ['@my_channel'],
    parserPrompt: 'Перепиши текст новости в стиле нефора: молодежный сленг, мемы, эмодзи, без официальщины.',
    copyCount: 100,
    intervalMinutes: 15,
  };
};

export const saveUserSavedConfig = (partial: Partial<UserSavedConfig>): void => {
  const current = loadUserSavedConfig();
  const updated = { ...current, ...partial };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
};
