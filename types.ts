// types.ts — TypeScript типы для MyBotAi11

export enum SourceType {
  TELEGRAM = 'TELEGRAM',
  WEBSITE = 'WEBSITE',
  RSS = 'RSS'
}

export interface PricingRules {
  mode?: 'single' | 'three_tier' | 'opt_retail';
  singleMarkupPercent?: number;
  wholesalePercent: number;
  dropPercent: number;
  retailPercent: number;
  currencySymbol: string;
}

export interface TelegramAuthState {
  apiId: string;
  apiHash: string;
  phoneNumber: string;
  verificationCode: string;
  step: 'IDLE' | 'CODE_SENT' | 'AUTHENTICATED';
  isLoading: boolean;
  error: string | null;
}

export interface AppConfig {
  sourceType: SourceType;
  sourceUrl: string;
  destinationChannel: string;
  telegramBotToken: string;
  useAI: boolean;
  removeLinks: boolean;
  useOriginalOnError?: boolean;
  pricing: PricingRules;
  checkInterval: number;
  isSimulationMode: boolean;
  telegramAuth: TelegramAuthState;
}

// -----------------------------------------------
// Project — хранится в БД на backend
// -----------------------------------------------
export interface Project {
  id: string;
  name: string;
  donor_channel_id: string;       // @username канала-донора
  target_channel_id: string;      // @username целевого канала
  rewrite_enabled: boolean;
  rewrite_prompt: string | null;
  remove_links: boolean;
  use_original_on_error?: boolean;
  duplicate_threshold: number;
  check_interval: number;         // секунды
  ai_provider: 'platform' | 'own_gemini' | 'own_openrouter';  // AI провайдер
  has_own_ai_key: boolean;        // Есть ли сохранённый личный ключ
  pricing_enabled: boolean;
  pricing_wholesale_pct: number;
  pricing_drop_pct: number;
  pricing_retail_pct: number;
  pricing_currency: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface ProjectCreatePayload {
  name: string;
  donor_channel_id: string;
  target_channel_id: string;
  rewrite_prompt?: string;
  rewrite_enabled?: boolean;
  remove_links?: boolean;
  use_original_on_error?: boolean;
  duplicate_threshold?: number;
  check_interval?: number;
  ai_provider?: 'platform' | 'own_gemini' | 'own_openrouter';
  ai_api_key?: string;           // plaintext, шифруется на сервере
  pricing_enabled?: boolean;
  pricing_wholesale_pct?: number;
  pricing_drop_pct?: number;
  pricing_retail_pct?: number;
  pricing_currency?: string;
}

// -----------------------------------------------
// Post log entry
// -----------------------------------------------
export interface PostLog {
  id: string;
  status: 'new' | 'processing' | 'published' | 'failed' | 'duplicate' | 'pending_retry';
  original_text: string;
  processed_text: string;
  media_type: string;
  created_at: string | null;
}

// -----------------------------------------------
// Processed post (локальная обработка в UI)
// -----------------------------------------------
export interface ProcessedPost {
  id: string;
  originalContent: string;
  processedContent: string;
  originalPrice: number | null;
  calculatedPrices: {
    opt: number;
    drop: number;
    retail: number;
  } | null;
  status: 'pending' | 'success' | 'error' | 'pending_retry';
  timestamp: string;
  source: string;
  errorMessage?: string;
}

export interface SystemStats {
  totalProcessed: number;
  lastRun: string | null;
  errors: number;
  isServiceRunning: boolean;
}

// -----------------------------------------------
// Toast уведомления
// -----------------------------------------------
export type ToastType = 'success' | 'error' | 'info' | 'loading';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}