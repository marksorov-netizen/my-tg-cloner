// services/apiService.ts
// HTTP-клиент к Python backend.
// Vite proxy в dev-режиме направляет все запросы на http://localhost:8000

import { Project, ProjectCreatePayload, PostLog } from '../types';

// Пустой базовый URL → Vite proxy подхватывает в dev
// В prod настрой nginx или укажи полный URL
const API_URL = '';

// ------------------------------------------------------------------
// Вспомогательная функция: fetch с обработкой ошибок
// credentials: 'include' обязателен для передачи httpOnly cookie (JWT)
// ------------------------------------------------------------------
async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',   // ← Отправляем httpOnly cookie с JWT токеном
    ...options,
  });

  if (res.status === 204) return undefined as T; // No Content

  // Если 401 — пользователь не авторизован, перенаправляем на страницу входа
  if (res.status === 401) {
    const data = await res.json().catch(() => ({ detail: 'Unauthorized' }));
    throw new Error(data.detail || 'Сессия истекла. Войдите заново.');
  }

  const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data as T;
}

// ------------------------------------------------------------------
// Telegram Message тип (для batch import)
// ------------------------------------------------------------------
export interface TelegramMessage {
  id: number;
  text: string;
  date: string;
  media_type: string;
  url: string;
}

// ------------------------------------------------------------------
// API методы
// ------------------------------------------------------------------
export const apiService = {

  // ---------- Служебные ----------

  checkStatus: async (): Promise<{ status: string; user?: string }> => {
    try {
      return await apiFetch('/status');
    } catch {
      return { status: 'offline' };
    }
  },

  checkHealth: async () => {
    try {
      return await apiFetch<{
        status: string;
        telegram_authorized: boolean;
        gemini_configured: boolean;
        active_monitors: string[];
      }>('/health');
    } catch {
      return null;
    }
  },

  // ---------- Telegram авторизация ----------

  requestAuthCode: async (apiId: string, apiHash: string, phone: string) =>
    apiFetch('/auth/request_code', {
      method: 'POST',
      body: JSON.stringify({ api_id: apiId, api_hash: apiHash, phone }),
    }),

  login: async (phone: string, code: string) =>
    apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),

  logout: async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch { /* игнорируем ошибки разлогина */ }
  },

  // ---------- Batch операции ----------

  fetchHistory: async (channel: string, limit: number): Promise<TelegramMessage[]> =>
    apiFetch('/batch/fetch', {
      method: 'POST',
      body: JSON.stringify({ channel, limit }),
    }),

  sendPost: async (
    destination: string,
    text: string,
    sourceChannel?: string,
    msgId?: number,
    downloadMedia: boolean = true,
    articleCode?: string,
    botUsername?: string,
    generateVideo: boolean = false,
    videoAspectRatio: string = '9:16',
    productPrice?: string,
    videoProvider: string = 'builtin',
    videoApiKey?: string,
    videoMotionStyle: string = 'trending_cinematic',
    videoAutoPrompt: boolean = true
  ) =>
    apiFetch('/batch/send', {
      method: 'POST',
      body: JSON.stringify({
        destination,
        text,
        source_channel: sourceChannel,
        msg_id: msgId,
        download_media: downloadMedia,
        article_code: articleCode,
        bot_username: botUsername,
        generate_video: generateVideo,
        video_aspect_ratio: videoAspectRatio,
        product_price: productPrice,
        video_provider: videoProvider,
        video_api_key: videoApiKey || undefined,
        video_motion_style: videoMotionStyle,
        video_auto_prompt: videoAutoPrompt,
      }),
    }),

  /** Тестовая генерация промта через Gemini Vision */
  testVideoPrompt: async (title: string, motionStyle = 'trending_cinematic') =>
    apiFetch('/api/video/test_prompt', {
      method: 'POST',
      body: JSON.stringify({ title, motion_style: motionStyle }),
    }),

  // ---------- CRUD Проектов ----------

  /** Создать новый проект */
  createProject: async (payload: ProjectCreatePayload): Promise<Project> =>
    apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Список всех проектов */
  getProjects: async (): Promise<Project[]> =>
    apiFetch('/api/projects'),

  /** Детали одного проекта */
  getProject: async (id: string): Promise<Project> =>
    apiFetch(`/api/projects/${id}`),

  /** Обновить проект */
  updateProject: async (id: string, payload: Partial<ProjectCreatePayload>): Promise<Project> =>
    apiFetch(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  /** Удалить проект */
  deleteProject: async (id: string): Promise<void> =>
    apiFetch(`/api/projects/${id}`, { method: 'DELETE' }),

  /** Запустить автомониторинг */
  startProject: async (id: string): Promise<{ status: string; project_id: string }> =>
    apiFetch(`/api/projects/${id}/start`, { method: 'POST' }),

  /** Остановить автомониторинг */
  stopProject: async (id: string): Promise<{ status: string; project_id: string }> =>
    apiFetch(`/api/projects/${id}/stop`, { method: 'POST' }),

  /** Лог публикаций проекта */
  getProjectLogs: async (id: string, limit = 50): Promise<PostLog[]> =>
    apiFetch(`/api/projects/${id}/logs?limit=${limit}`),

  // ---------- Запарсенные посты (Архив) ----------

  /** Получить архив запарсенных постов */
  getParsedPosts: async (limit = 100, offset = 0, sourceChannel?: string, targetChannel?: string): Promise<{ status: string; total: number; count: number; posts: any[] }> => {
    let url = `/api/parsed_posts?limit=${limit}&offset=${offset}`;
    if (sourceChannel) url += `&source_channel=${encodeURIComponent(sourceChannel)}`;
    if (targetChannel) url += `&target_channel=${encodeURIComponent(targetChannel)}`;
    return apiFetch(url);
  },

  /** Удалить один запарсенный пост */
  deleteParsedPost: async (id: string): Promise<{ status: string; deleted_id: string }> =>
    apiFetch(`/api/parsed_posts/${id}`, { method: 'DELETE' }),

  /** Очистить весь архив запарсенных постов */
  clearParsedPosts: async (): Promise<{ status: string; message: string }> =>
    apiFetch('/api/parsed_posts', { method: 'DELETE' }),
};
