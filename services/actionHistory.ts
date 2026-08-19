/**
 * services/actionHistory.ts
 *
 * Персистентная система хранения истории действий пользователя (localStorage + Backend SQLite).
 */

export interface ActionLogItem {
  id: string;
  time: string;
  date: string;
  action: string;      // Например: "Перенос товаров", "Публикация", "Остановка"
  details: string;     // Описание: "Скопировано 10 постов из @somoniyon1998 в @my_store"
  type: 'success' | 'warning' | 'error' | 'stopped';
  timestamp?: number;
}

const STORAGE_KEY = 'ghostpost_action_history';

export const getActionHistory = (): ActionLogItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const fetchCombinedActionHistory = async (): Promise<ActionLogItem[]> => {
  const localHistory = getActionHistory();
  try {
    const res = await fetch('/api/activity/history');
    if (res.ok) {
      const data = await res.json();
      const serverHistory: ActionLogItem[] = data.history || [];
      
      // Объединяем серверную историю и локальные события, исключая дубликаты
      const idSet = new Set<string>();
      const combined: ActionLogItem[] = [];

      // Сначала локальные новые
      for (const item of localHistory) {
        if (!idSet.has(item.id)) {
          idSet.add(item.id);
          combined.push(item);
        }
      }

      // Затем серверные
      for (const item of serverHistory) {
        if (!idSet.has(item.id)) {
          idSet.add(item.id);
          combined.push(item);
        }
      }

      // Сохраняем объединенные данные в localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(combined.slice(0, 150)));
      } catch {}

      return combined.slice(0, 150);
    }
  } catch (e) {
    console.warn('[ActionHistory] Failed to fetch server activity history:', e);
  }
  return localHistory;
};

export const addActionLog = (
  action: string,
  details: string,
  type: 'success' | 'warning' | 'error' | 'stopped' = 'success'
): ActionLogItem[] => {
  const current = getActionHistory();
  const now = new Date();
  const newItem: ActionLogItem = {
    id: 'local-' + Math.random().toString(36).substring(2, 9),
    time: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    date: now.toLocaleDateString('ru-RU'),
    action,
    details,
    type,
    timestamp: now.getTime() / 1000
  };
  const updated = [newItem, ...current].slice(0, 150);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
  return updated;
};

export const clearActionHistory = (): ActionLogItem[] => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  return [];
};
