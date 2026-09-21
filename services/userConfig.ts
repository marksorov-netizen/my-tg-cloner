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

  enableVton: boolean;
  enableVideoGen: boolean;
  videoAspectRatio: '9:16' | '1:1';
  videoProvider: 'builtin' | 'fashion_multicolor' | 'seedance' | 'replicate' | 'luma' | 'runway';
  // NOTE: videoApiKey специально НЕ хранится в localStorage ( persistent XSS = кража ключа ).
  // Только sessionStorage (чистится при закрытии вкладки) + память. См. get/setVideoApiKey ниже.
  videoApiKey: string;
  videoMotionStyle: 'trending_cinematic' | 'studio_rotation' | 'lifestyle_motion' | 'fast_reels';
  videoAutoPrompt: boolean;
}

const STORAGE_KEY = 'ghostpost_user_saved_channels';
const VIDEO_KEY_SESSION = 'ghostpost_video_api_key_session';

// API-ключ видео — только sessionStorage, никогда localStorage.
export const getVideoApiKey = (): string => {
  try { return sessionStorage.getItem(VIDEO_KEY_SESSION) || ''; } catch { return ''; }
};
export const setVideoApiKey = (key: string): void => {
  try {
    if (!key) sessionStorage.removeItem(VIDEO_KEY_SESSION);
    else sessionStorage.setItem(VIDEO_KEY_SESSION, key);
  } catch {}
};

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

        parserDonors: (parsed.parserDonors && parsed.parserDonors.filter((d: string) => d !== '@breakingnews_ru').length > 0)
          ? parsed.parserDonors.filter((d: string) => d !== '@breakingnews_ru')
          : ['@durov'],
        parserTargets: parsed.parserTargets || ['@my_channel'],
        parserPrompt: parsed.parserPrompt || 'Перепиши текст новости: сделай его ярким, вовлекающим, добавь подходящие эмодзи и разбей на читаемые абзацы.',
        copyCount: parsed.copyCount || 100,
        intervalMinutes: parsed.intervalMinutes !== undefined ? parsed.intervalMinutes : 15,

        enableVton: parsed.enableVton !== undefined ? parsed.enableVton : false,
        enableVideoGen: parsed.enableVideoGen !== undefined ? parsed.enableVideoGen : false,
        videoAspectRatio: parsed.videoAspectRatio || '9:16',
        videoProvider: parsed.videoProvider || 'builtin',
        videoApiKey: getVideoApiKey(),
        videoMotionStyle: parsed.videoMotionStyle || 'trending_cinematic',
        videoAutoPrompt: parsed.videoAutoPrompt !== undefined ? parsed.videoAutoPrompt : true,
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

    parserDonors: ['@durov'],
    parserTargets: ['@my_channel'],
    parserPrompt: 'Перепиши текст новости: сделай его ярким, вовлекающим, добавь подходящие эмодзи и разбей на читаемые абзацы.',
    copyCount: 100,
    intervalMinutes: 15,

    enableVton: false,
    enableVideoGen: false,
    videoAspectRatio: '9:16',
    videoProvider: 'builtin',
    videoApiKey: getVideoApiKey(),
    videoMotionStyle: 'trending_cinematic',
    videoAutoPrompt: true,
  };
};

export const saveUserSavedConfig = (partial: Partial<UserSavedConfig>): void => {
  // videoApiKey никогда не пишем в localStorage — только в sessionStorage.
  const { videoApiKey, ...rest } = partial as any;
  if (videoApiKey !== undefined) setVideoApiKey(videoApiKey || '');
  const current = loadUserSavedConfig();
  const { videoApiKey: _drop, ...currentSafe } = current as any;
  const updated = { ...currentSafe, ...rest };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
};

