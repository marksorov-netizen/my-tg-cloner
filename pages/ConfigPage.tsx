import React, { useState, useEffect, useCallback } from 'react';
import { AppConfig, SourceType, PricingRules, Project, ProjectCreatePayload, Toast } from '../types';
import { apiService } from '../services/apiService';
import {
  Save, RefreshCw, Bot, AlertTriangle, CheckCircle,
  Loader2, Play, Square, Trash2, PlusCircle, ChevronDown,
  Key, Zap, Shield
} from 'lucide-react';

// Вспомогательная функция для прямого fetch с cookies
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',
    ...options,
  });
  const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error((data as any).detail || `HTTP ${res.status}`);
  return data as T;
}

import { loadUserSavedConfig, saveUserSavedConfig } from '../services/userConfig';

interface ConfigPageProps {
  config: AppConfig;
  setConfig: (c: AppConfig) => void;
}

// -------------------------------------------------------
// Toast уведомление
// -------------------------------------------------------
function ToastBanner({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }) {
  if (!toast) return null;
  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error:   'bg-red-50 border-red-200 text-red-800',
    info:    'bg-blue-50 border-blue-200 text-blue-800',
    loading: 'bg-slate-50 border-slate-200 text-slate-700',
  };
  return (
    <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium animate-in slide-in-from-top-2 duration-300 ${styles[toast.type]}`}>
      <div className="flex items-center gap-2">
        {toast.type === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
        {toast.type === 'success' && <CheckCircle className="w-4 h-4" />}
        {toast.type === 'error'   && <AlertTriangle className="w-4 h-4" />}
        <span>{toast.message}</span>
      </div>
      {toast.type !== 'loading' && (
        <button onClick={onDismiss} className="ml-4 opacity-60 hover:opacity-100 text-lg leading-none">×</button>
      )}
    </div>
  );
}

// -------------------------------------------------------
// Переключатель (toggle)
// -------------------------------------------------------
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
    </label>
  );
}

// -------------------------------------------------------
// Главный компонент
// -------------------------------------------------------
export const ConfigPage: React.FC<ConfigPageProps> = ({ config, setConfig }) => {
  const savedCfg = loadUserSavedConfig();

  // Список проектов
  const [projects, setProjects]     = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Форма
  const [projectName, setProjectName]             = useState('Мой проект');
  const [donorChannel, setDonorChannel]           = useState(config.sourceUrl);
  const [targetChannel, setTargetChannel]         = useState(config.destinationChannel);
  const [rewritePrompt, setRewritePrompt]         = useState('');
  const [rewriteEnabled, setRewriteEnabled]       = useState(config.useAI);
  const [removeLinks, setRemoveLinks]             = useState(config.removeLinks);
  const [useOriginalOnError, setUseOriginalOnError] = useState(config.useOriginalOnError || false);
  const [checkInterval, setCheckInterval]         = useState(config.checkInterval);
  const [pricingEnabled, setPricingEnabled]       = useState(false);

  // AI провайдер текста
  const [aiProvider, setAiProvider] = useState<'platform' | 'own_gemini' | 'own_openrouter'>('platform');
  const [ownAiKey, setOwnAiKey]     = useState('');
  const [hasOwnKey, setHasOwnKey]   = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<{ok: boolean; msg: string} | null>(null);

  // AI Видео-генерация & Нейросети
  const [videoProvider, setVideoProvider] = useState<'builtin' | 'seedance' | 'replicate' | 'luma' | 'runway'>(savedCfg.videoProvider || 'builtin');
  const [videoApiKey, setVideoApiKey]     = useState(savedCfg.videoApiKey || '');
  const [videoMotionStyle, setVideoMotionStyle] = useState<'trending_cinematic' | 'studio_rotation' | 'lifestyle_motion' | 'fast_reels'>(savedCfg.videoMotionStyle || 'trending_cinematic');
  const [videoAutoPrompt, setVideoAutoPrompt]   = useState<boolean>(savedCfg.videoAutoPrompt !== undefined ? savedCfg.videoAutoPrompt : true);
  const [testingPrompt, setTestingPrompt]       = useState(false);
  const [testPromptOutput, setTestPromptOutput] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<Toast | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const showToast = (type: Toast['type'], message: string, autoDismiss = true) => {
    const id = Math.random().toString(36).slice(2);
    setToast({ id, type, message });
    if (autoDismiss && type !== 'loading') {
      setTimeout(() => setToast(t => t?.id === id ? null : t), 3500);
    }
  };

  // ---- Загрузка проектов при маунте ----
  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const list = await apiService.getProjects();
      setProjects(list);
      if (list.length > 0 && !activeProjectId) {
        fillForm(list[0]);
        setActiveProjectId(list[0].id);
      }
    } catch {
      // backend offline — молча игнорируем
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // ---- Заполнить форму из проекта ----
  const fillForm = (p: Project) => {
    setProjectName(p.name);
    setDonorChannel(p.donor_channel_id);
    setTargetChannel(p.target_channel_id);
    setRewritePrompt(p.rewrite_prompt || '');
    setRewriteEnabled(p.rewrite_enabled);
    setRemoveLinks(p.remove_links);
    setUseOriginalOnError(p.use_original_on_error || false);
    setCheckInterval(p.check_interval);
    setPricingEnabled(p.pricing_enabled);
    setAiProvider(p.ai_provider || 'platform');
    setHasOwnKey(p.has_own_ai_key || false);
    setOwnAiKey('');
    setKeyTestResult(null);
    setConfig({
      ...config,
      sourceUrl: p.donor_channel_id,
      destinationChannel: p.target_channel_id,
      useAI: p.rewrite_enabled,
      removeLinks: p.remove_links,
      useOriginalOnError: p.use_original_on_error || false,
      checkInterval: p.check_interval,
      pricing: {
        wholesalePercent: p.pricing_wholesale_pct,
        dropPercent: p.pricing_drop_pct,
        retailPercent: p.pricing_retail_pct,
        currencySymbol: p.pricing_currency,
      },
    });
  };

  const handlePricingChange = (key: keyof PricingRules, value: any) => {
    setConfig({ ...config, pricing: { ...config.pricing, [key]: value } });
  };

  // ---- Сохранить / создать проект ----
  const handleSave = async () => {
    if (!donorChannel.trim() || !targetChannel.trim()) {
      showToast('error', 'Укажите канал-донор и целевой канал');
      return;
    }
    setIsSaving(true);
    showToast('loading', 'Сохраняем настройки...', false);

    const payload: ProjectCreatePayload = {
      name: projectName.trim() || 'Мой проект',
      donor_channel_id: donorChannel.trim(),
      target_channel_id: targetChannel.trim(),
      rewrite_prompt: rewritePrompt || undefined,
      rewrite_enabled: rewriteEnabled,
      remove_links: removeLinks,
      use_original_on_error: useOriginalOnError,
      check_interval: checkInterval,
      ai_provider: aiProvider,
      ai_api_key: (aiProvider !== 'platform' && ownAiKey.trim()) ? ownAiKey.trim() : undefined,
      pricing_enabled: pricingEnabled,
      pricing_wholesale_pct: config.pricing.wholesalePercent,
      pricing_drop_pct: config.pricing.dropPercent,
      pricing_retail_pct: config.pricing.retailPercent,
      pricing_currency: config.pricing.currencySymbol,
    };

    try {
      saveUserSavedConfig({
        videoProvider,
        videoApiKey,
        videoMotionStyle,
        videoAutoPrompt,
      });

      let saved: Project;
      if (activeProjectId) {
        saved = await apiService.updateProject(activeProjectId, payload);
        showToast('success', '✅ Настройки сохранены');
      } else {
        saved = await apiService.createProject(payload);
        setActiveProjectId(saved.id);
        showToast('success', '✅ Проект создан');
      }
      await loadProjects();
    } catch (e: any) {
      showToast('error', `Ошибка: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ---- Тест промта Gemini Vision ----
  const handleTestPrompt = async () => {
    setTestingPrompt(true);
    setTestPromptOutput(null);
    try {
      const res = await apiService.testVideoPrompt('Кроссовки Nike Air Max', videoMotionStyle);
      if (res && res.generated_prompt) {
        setTestPromptOutput(res.generated_prompt);
      }
    } catch (e: any) {
      setTestPromptOutput(`Ошибка генерации промта: ${e.message}`);
    } finally {
      setTestingPrompt(false);
    }
  };

  // ---- Старт / стоп ----
  const handleToggleActive = async () => {
    if (!activeProjectId) {
      showToast('info', 'Сначала сохраните проект');
      return;
    }
    const project = projects.find(p => p.id === activeProjectId);
    if (!project) return;

    showToast('loading', project.is_active ? 'Останавливаем...' : 'Запускаем...', false);
    try {
      if (project.is_active) {
        await apiService.stopProject(activeProjectId);
        showToast('success', '⏹ Мониторинг остановлен');
      } else {
        await apiService.startProject(activeProjectId);
        showToast('success', '▶ Мониторинг запущен!');
      }
      await loadProjects();
    } catch (e: any) {
      showToast('error', `Ошибка: ${e.message}`);
    }
  };

  // ---- Удалить проект ----
  const handleDelete = async () => {
    if (!activeProjectId) return;
    if (!window.confirm('Удалить проект? Это действие нельзя отменить.')) return;
    try {
      await apiService.deleteProject(activeProjectId);
      setActiveProjectId(null);
      showToast('success', 'Проект удалён');
      await loadProjects();
    } catch (e: any) {
      showToast('error', `Ошибка: ${e.message}`);
    }
  };

  // ---- Проверка личного AI ключа ----
  const handleTestKey = async () => {
    if (!ownAiKey.trim()) {
      setKeyTestResult({ ok: false, msg: 'Введите API ключ' });
      return;
    }
    setTestingKey(true);
    setKeyTestResult(null);
    try {
      const result = await apiFetch<{status: string; message: string}>('/api/ai/test-key', {
        method: 'POST',
        body: JSON.stringify({ api_key: ownAiKey.trim(), provider: aiProvider }),
      });
      setKeyTestResult({ ok: true, msg: result.message });
    } catch (e: any) {
      setKeyTestResult({ ok: false, msg: e.message });
    } finally {
      setTestingKey(false);
    }
  };

  const activeProject = projects.find(p => p.id === activeProjectId);

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Toast */}
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      {/* Выбор проекта */}
      {!loadingProjects && projects.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Активный проект
              </label>
              <div className="relative">
                <select
                  value={activeProjectId || ''}
                  onChange={e => {
                    const pid = e.target.value;
                    setActiveProjectId(pid || null);
                    if (pid) {
                      const p = projects.find(pr => pr.id === pid);
                      if (p) fillForm(p);
                    }
                  }}
                  className="w-full appearance-none border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.is_active ? '🟢 ' : '⚫ '}{p.name} ({p.donor_channel_id})
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>
            <button
              onClick={() => { setActiveProjectId(null); setProjectName('Новый проект'); setDonorChannel(''); setTargetChannel(''); setRewritePrompt(''); }}
              className="flex items-center gap-1.5 text-sm font-bold text-indigo-600 hover:text-indigo-800 px-3 py-2 rounded-lg hover:bg-indigo-50 transition-colors"
            >
              <PlusCircle className="w-4 h-4" /> Новый
            </button>
          </div>
        </div>
      )}

      {/* Режим работы */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start space-x-3">
        <AlertTriangle className="text-amber-600 w-6 h-6 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-semibold text-amber-800">Режим работы</h4>
          <p className="text-sm text-amber-700 mt-1">
            В боевом режиме система реально парсит канал-донор и публикует в целевой канал.
            Для тестирования включите симуляцию.
          </p>
          <div className="mt-3 flex items-center space-x-2">
            <Toggle
              checked={config.isSimulationMode}
              onChange={v => setConfig({ ...config, isSimulationMode: v })}
            />
            <span className="text-sm font-medium text-slate-700">
              {config.isSimulationMode ? 'СИМУЛЯЦИЯ (Фейковые данные)' : 'БОЕВОЙ РЕЖИМ'}
            </span>
          </div>
        </div>
      </div>

      {/* Основные настройки */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-5 flex items-center">
          <RefreshCw className="w-5 h-5 mr-2 text-blue-500" />
          Настройка проекта
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Название */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Название проекта</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="Мой новостной канал"
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Тип источника */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Тип источника</label>
            <div className="flex space-x-2 bg-slate-100 p-1 rounded-lg">
              {Object.values(SourceType).map(type => (
                <button
                  key={type}
                  onClick={() => setConfig({ ...config, sourceType: type })}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                    config.sourceType === type
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Канал-донор */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Канал-донор (откуда парсим)</label>
            <input
              type="text"
              value={donorChannel}
              onChange={e => { setDonorChannel(e.target.value); setConfig({ ...config, sourceUrl: e.target.value }); }}
              placeholder="@channel_name"
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono text-sm"
            />
          </div>

          {/* Целевой канал */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
              <Bot className="w-4 h-4 text-slate-500" /> Целевой канал (куда публикуем)
            </label>
            <input
              type="text"
              value={targetChannel}
              onChange={e => { setTargetChannel(e.target.value); setConfig({ ...config, destinationChannel: e.target.value }); }}
              placeholder="@my_channel"
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono text-sm"
            />
            <p className="text-xs text-slate-400">Аккаунт Telegram должен быть подписан на оба канала</p>
          </div>

          {/* Интервал */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Интервал проверки (сек)</label>
            <input
              type="number"
              min={10}
              max={3600}
              value={checkInterval}
              onChange={e => { const v = parseInt(e.target.value); setCheckInterval(v); setConfig({ ...config, checkInterval: v }); }}
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Промпт */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              AI промпт (стиль рерайта)
            </label>
            <textarea
              value={rewritePrompt}
              onChange={e => setRewritePrompt(e.target.value)}
              rows={3}
              placeholder="Пример: Перепиши в дерзком стиле молодёжного тг-канала. Добавь актуальные мемы. Без официоза."
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none text-sm"
            />
          </div>
        </div>
      </div>

      {/* Правила обработки */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-5">Правила обработки</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div>
                <p className="font-medium text-slate-900">AI рерайт</p>
                <p className="text-sm text-slate-500">Переписывать текст через Gemini</p>
              </div>
              <Toggle checked={rewriteEnabled} onChange={v => { setRewriteEnabled(v); setConfig({ ...config, useAI: v }); }} />
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div>
                <p className="font-medium text-slate-900">Удалять ссылки</p>
                <p className="text-sm text-slate-500">Убирать http/https и @mentions</p>
              </div>
              <Toggle checked={removeLinks} onChange={v => { setRemoveLinks(v); setConfig({ ...config, removeLinks: v }); }} />
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-amber-100">
              <div>
                <p className="font-medium text-slate-900">Публиковать оригинал при ошибке AI</p>
                <p className="text-sm text-slate-500">Выключено: при ошибке AI пост откладывается на повтор</p>
              </div>
              <Toggle checked={useOriginalOnError} onChange={v => { setUseOriginalOnError(v); setConfig({ ...config, useOriginalOnError: v }); }} />
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div>
                <p className="font-medium text-slate-900">Режим магазина (цены)</p>
                <p className="text-sm text-slate-500">Парсить цены и добавлять наценку</p>
              </div>
              <Toggle checked={pricingEnabled} onChange={setPricingEnabled} />
            </div>
          </div>
        </div>

        {/* AI Провайдер */}
        <div className="bg-white rounded-2xl shadow-sm border border-violet-100 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-1 flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-500" />
            AI Провайдер
          </h3>
          <p className="text-sm text-slate-500 mb-5">
            Используйте ключи платформы (входит в тариф) или свой ключ для неограниченных рерайтов.
          </p>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">AI провайдер для рерайта</label>
              <select
                value={aiProvider}
                onChange={e => { setAiProvider(e.target.value as any); setKeyTestResult(null); }}
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-violet-500 focus:outline-none"
              >
                <option value="platform">Платформа (входит в тариф)</option>
                <option value="own_gemini">Мой Gemini ключ (Pro / Business)</option>
                <option value="own_openrouter">Мой OpenRouter ключ (Pro / Business)</option>
              </select>
            </div>

            {aiProvider !== 'platform' && (
              <div className="space-y-3 p-4 bg-violet-50 rounded-xl border border-violet-100">
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-violet-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-violet-700">
                    Ключ шифруется Fernet и хранится только на сервере.
                    {hasOwnKey && <strong> Ключ уже сохранён — оставьте поле пустым чтобы не менять его.</strong>}
                  </p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={ownAiKey}
                    onChange={e => { setOwnAiKey(e.target.value); setKeyTestResult(null); }}
                    placeholder={hasOwnKey ? '••••••••• (ключ сохранён)' : aiProvider === 'own_gemini' ? 'AIza...' : 'sk-or-...'}
                    className="flex-1 border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-violet-500 focus:outline-none font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleTestKey}
                    disabled={testingKey || !ownAiKey.trim()}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    {testingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                    {testingKey ? 'Проверка...' : 'Проверить'}
                  </button>
                </div>
                {keyTestResult && (
                  <div className={`flex items-center gap-2 text-sm font-medium ${
                    keyTestResult.ok ? 'text-emerald-700' : 'text-red-600'
                  }`}>
                    {keyTestResult.ok
                      ? <CheckCircle className="w-4 h-4" />
                      : <AlertTriangle className="w-4 h-4" />}
                    {keyTestResult.msg}
                  </div>
                )}
                <p className="text-xs text-violet-600">
                  Функция доступна только на тарифах <strong>Pro</strong> и <strong>Business</strong>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 🎬 AI Видео-генераторы (Image-to-Video & Seedance / Replicate / Luma / Runway) */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:col-span-2">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <span>🎬</span> AI Видео-генераторы & Нейросети (Image-to-Video)
            </h3>
            <span className="bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 text-xs font-black px-2.5 py-1 rounded-md tracking-wider">
              👑 ТАРИФ VIP / MAX
            </span>
          </div>
          <p className="text-sm text-slate-500 mb-5">
            Подключите внешние нейросети генерации видео из фото товара или используйте встроенный бесплатный движок Turbo HD.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Выбор видео-провайдера */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Видео-нейросеть / Движок</label>
              <select
                value={videoProvider}
                onChange={e => setVideoProvider(e.target.value as any)}
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-rose-500 focus:outline-none font-medium"
              >
                <option value="builtin">⚡ Встроенный Turbo HD (Бесплатно, 0 ₽, быстро)</option>
                <option value="seedance">💃 Seedance AI API (ByteDance e-commerce video)</option>
                <option value="replicate">🤖 Replicate API (Kling AI 1.6 / Wan2.1 / MiniMax)</option>
                <option value="luma">🎥 Luma Dream Machine API (3D облёт товара)</option>
                <option value="runway">✨ Runway Gen-3 Alpha API (Ultra Cinema)</option>
              </select>
            </div>

            {/* Стиль движения */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Трендовый стиль анимации</label>
              <select
                value={videoMotionStyle}
                onChange={e => setVideoMotionStyle(e.target.value as any)}
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-rose-500 focus:outline-none"
              >
                <option value="trending_cinematic">🔥 Кинематографичный 360-облёт со студийным светом</option>
                <option value="studio_rotation">🏷️ Студийный 360-поворот на подиуме с отражениями</option>
                <option value="lifestyle_motion">✨ Лайфстайл зум и мягкие солнечные блики</option>
                <option value="fast_reels">⚡ Быстрый ритмичный промо-ролик для Reels/Shorts</option>
              </select>
            </div>

            {/* Поле API ключа */}
            {videoProvider !== 'builtin' && (
              <div className="md:col-span-2 space-y-3 p-4 bg-rose-50 rounded-xl border border-rose-100">
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-rose-800">
                    API-ключ для <strong>{videoProvider.toUpperCase()}</strong>:
                    {videoApiKey ? ' ключ сохранён. Оставьте поле пустым, чтобы не менять.' : ' введите ваш токен от сервиса.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={videoApiKey}
                    onChange={e => setVideoApiKey(e.target.value)}
                    placeholder={videoProvider === 'seedance' ? 'seedance-api-key...' : videoProvider === 'replicate' ? 'r8_...' : 'api-key-...'}
                    className="flex-1 border border-slate-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-rose-500 focus:outline-none font-mono text-sm"
                  />
                </div>
              </div>
            )}

            {/* Gemini Vision Auto Prompting */}
            <div className="md:col-span-2 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base">👁️</span>
                    <p className="font-semibold text-slate-900 text-sm">Gemini Vision: Умный авто-промт для видео</p>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Gemini анализирует фото товара и составляет кинематографичный промт, <strong>строго сохраняя 100% деталей, расцветку и логотипы</strong>.
                  </p>
                </div>
                <Toggle checked={videoAutoPrompt} onChange={setVideoAutoPrompt} />
              </div>

              {/* Тестирование промта */}
              <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleTestPrompt}
                  disabled={testingPrompt}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-900 disabled:opacity-50 transition-colors"
                >
                  {testingPrompt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
                  {testingPrompt ? 'Составление промта...' : '🧪 Проверить промт Gemini Vision'}
                </button>
              </div>

              {testPromptOutput && (
                <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200 text-xs font-mono text-slate-800 leading-relaxed">
                  <span className="font-bold text-emerald-700">Сгенерированный промт для нейросети:</span><br/>
                  {testPromptOutput}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Наценки (показываем только если включён режим магазина) */}
        <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-6 transition-opacity ${pricingEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          <h3 className="text-lg font-semibold text-slate-900 mb-5">Настройка наценок</h3>
          <div className="space-y-5">
            {[
              { label: '📦 Наценка Опт', key: 'wholesalePercent' as keyof PricingRules, max: 100, color: 'accent-blue-600' },
              { label: '🤝 Наценка Дроп', key: 'dropPercent' as keyof PricingRules, max: 200, color: 'accent-emerald-600' },
              { label: '🏷️ Наценка Розница', key: 'retailPercent' as keyof PricingRules, max: 300, color: 'accent-violet-600' },
            ].map(({ label, key, max, color }) => (
              <div key={key}>
                <label className="flex justify-between text-sm font-medium text-slate-700 mb-1">
                  <span>{label}</span>
                  <span>+{config.pricing[key as keyof PricingRules]}%</span>
                </label>
                <input
                  type="range" min={0} max={max}
                  value={config.pricing[key as keyof PricingRules] as number}
                  onChange={e => handlePricingChange(key, parseInt(e.target.value))}
                  className={`w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer ${color}`}
                />
              </div>
            ))}
            <div className="pt-3 border-t border-slate-100">
              <label className="block text-sm font-medium text-slate-700 mb-2">Валюта</label>
              <select
                value={config.pricing.currencySymbol}
                onChange={e => handlePricingChange('currencySymbol', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-4 py-2"
              >
                <option value="₽">₽ (Рубль)</option>
                <option value="$">$ (Доллар)</option>
                <option value="€">€ (Евро)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Кнопки действий */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex gap-3">
          {/* Старт/Стоп */}
          {activeProjectId && (
            <button
              onClick={handleToggleActive}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all shadow-md ${
                activeProject?.is_active
                  ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200'
              }`}
            >
              {activeProject?.is_active
                ? <><Square className="w-4 h-4" fill="currentColor" /> Остановить мониторинг</>
                : <><Play className="w-4 h-4" fill="currentColor" /> Запустить мониторинг</>
              }
            </button>
          )}
          {/* Удалить */}
          {activeProjectId && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all"
            >
              <Trash2 className="w-4 h-4" /> Удалить
            </button>
          )}
        </div>

        {/* Сохранить */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-xl hover:bg-slate-800 transition-colors shadow-lg disabled:opacity-60 disabled:cursor-not-allowed font-bold"
        >
          {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save size={18} />}
          <span>{activeProjectId ? 'Сохранить изменения' : 'Создать проект'}</span>
        </button>
      </div>

      {/* Статус активного мониторинга */}
      {activeProject?.is_active && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              Мониторинг активен — {activeProject.donor_channel_id}
            </p>
            <p className="text-xs text-emerald-600 mt-0.5">
              Проверка каждые {activeProject.check_interval}с → публикация в {activeProject.target_channel_id}
            </p>
          </div>
        </div>
      )}

    </div>
  );
};