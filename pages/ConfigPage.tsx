import React, { useState, useEffect, useCallback } from 'react';
import { AppConfig, PricingRules, Project, ProjectCreatePayload, Toast } from '../types';
import { apiService } from '../services/apiService';
import { loadUserSavedConfig, saveUserSavedConfig } from '../services/userConfig';
import {
  Save, RefreshCw, Bot, AlertTriangle, CheckCircle,
  Loader2, Play, Square, Trash2, PlusCircle, ChevronDown,
  Key, Zap, Shield, Sparkles, Settings, Film, Video, Eye,
  Sliders, Layers, DollarSign, Globe, Check
} from 'lucide-react';

interface ConfigPageProps {
  config: AppConfig;
  setConfig: (c: AppConfig) => void;
}

// -------------------------------------------------------
// Toast уведомление
// -------------------------------------------------------
function ToastBanner({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }) {
  if (!toast) return null;
  const isErr = toast.type === 'error';
  const isSucc = toast.type === 'success';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 18px', borderRadius: 14,
      background: isErr ? 'rgba(230,57,70,0.15)' : isSucc ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
      border: `1px solid ${isErr ? 'rgba(230,57,70,0.4)' : isSucc ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.12)'}`,
      color: '#fff', fontSize: 13, fontWeight: 600,
      backdropFilter: 'blur(10px)', marginBottom: 12
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {toast.type === 'loading' && <Loader2 size={16} className="animate-spin" color="#e63946" />}
        {isSucc && <CheckCircle size={16} color="#10b981" />}
        {isErr && <AlertTriangle size={16} color="#e63946" />}
        <span>{toast.message}</span>
      </div>
      {toast.type !== 'loading' && (
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 16 }}>×</button>
      )}
    </div>
  );
}

// -------------------------------------------------------
// Стильный переключатель (Toggle) для темной темы
// -------------------------------------------------------
function DarkToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 20,
        background: checked ? 'linear-gradient(135deg, #e63946, #c0392b)' : 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.15)',
        position: 'relative', cursor: 'pointer', transition: 'all 0.25s ease',
        boxShadow: checked ? '0 0 10px rgba(230,57,70,0.4)' : 'none', flexShrink: 0
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 2, left: checked ? 22 : 3,
        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
      }} />
    </div>
  );
}

export const ConfigPage: React.FC<ConfigPageProps> = ({ config, setConfig }) => {
  const savedCfg = loadUserSavedConfig();

  // Список проектов
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Форма проекта
  const [projectName, setProjectName] = useState('Мой проект');
  const [donorChannel, setDonorChannel] = useState(config.sourceUrl || '@durov');
  const [targetChannel, setTargetChannel] = useState(config.destinationChannel || '@my_channel');
  const [rewritePrompt, setRewritePrompt] = useState('Перепиши текст новости: сделай его ярким, вовлекающим, добавь подходящие эмодзи и разбей на читаемые абзацы.');
  const [rewriteEnabled, setRewriteEnabled] = useState(config.useAI);
  const [removeLinks, setRemoveLinks] = useState(config.removeLinks);
  const [useOriginalOnError, setUseOriginalOnError] = useState(config.useOriginalOnError || false);
  const [checkInterval, setCheckInterval] = useState(config.checkInterval || 60);
  const [pricingEnabled, setPricingEnabled] = useState(false);

  // AI провайдер текста
  const [aiProvider, setAiProvider] = useState<'platform' | 'own_gemini' | 'own_openrouter'>('platform');
  const [ownAiKey, setOwnAiKey] = useState('');
  const [hasOwnKey, setHasOwnKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // AI Видео-генерация & Нейросети
  const [videoProvider, setVideoProvider] = useState<'builtin' | 'seedance' | 'replicate' | 'luma' | 'runway'>(savedCfg.videoProvider || 'builtin');
  const [videoApiKey, setVideoApiKey] = useState(savedCfg.videoApiKey || '');
  const [videoMotionStyle, setVideoMotionStyle] = useState<'trending_cinematic' | 'studio_rotation' | 'lifestyle_motion' | 'fast_reels'>(savedCfg.videoMotionStyle || 'trending_cinematic');
  const [videoAutoPrompt, setVideoAutoPrompt] = useState<boolean>(savedCfg.videoAutoPrompt !== undefined ? savedCfg.videoAutoPrompt : true);
  const [testingPrompt, setTestingPrompt] = useState(false);
  const [testPromptOutput, setTestPromptOutput] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<Toast | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const showToast = (type: Toast['type'], message: string, autoDismiss = true) => {
    const id = Math.random().toString(36).slice(2);
    setToast({ id, type, message });
    if (autoDismiss) setTimeout(() => setToast(t => t?.id === id ? null : t), 3500);
  };

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
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const fillForm = (p: Project) => {
    setProjectName(p.name);
    setDonorChannel(p.donor_channel_id);
    setTargetChannel(p.target_channel_id);
    setRewritePrompt(p.rewrite_prompt || '');
    setRewriteEnabled(p.rewrite_enabled);
    setRemoveLinks(p.remove_links);
    setUseOriginalOnError(p.use_original_on_error || false);
    setCheckInterval(p.check_interval);
    setAiProvider(p.ai_provider as any);
    setHasOwnKey(p.has_own_ai_key || false);
    setOwnAiKey('');
    setPricingEnabled(p.pricing_enabled);
    setConfig({
      ...config,
      sourceUrl: p.donor_channel_id,
      destinationChannel: p.target_channel_id,
      useAI: p.rewrite_enabled,
      removeLinks: p.remove_links,
      checkInterval: p.check_interval,
      pricing: {
        wholesalePercent: p.pricing_wholesale_pct,
        dropPercent: p.pricing_drop_pct,
        retailPercent: p.pricing_retail_pct,
        currencySymbol: p.pricing_currency,
      },
    });
  };

  const handleSelectProject = (id: string) => {
    const found = projects.find(p => p.id === id);
    if (found) {
      setActiveProjectId(id);
      fillForm(found);
      setKeyTestResult(null);
      showToast('info', `Выбран проект: ${found.name}`);
    }
  };

  const handleNewProject = () => {
    setActiveProjectId(null);
    setProjectName('Новый проект');
    setDonorChannel('@durov');
    setTargetChannel('@my_channel');
    setRewritePrompt('Перепиши текст новости: сделай его ярким, вовлекающим, добавь эмодзи.');
    setRewriteEnabled(true);
    setRemoveLinks(true);
    setUseOriginalOnError(false);
    setCheckInterval(60);
    setAiProvider('platform');
    setHasOwnKey(false);
    setOwnAiKey('');
    setPricingEnabled(false);
    setKeyTestResult(null);
    showToast('info', 'Заполните поля и нажмите «Сохранить настройки»');
  };

  const handleDeleteProject = async () => {
    if (!activeProjectId) return;
    if (!window.confirm(`Удалить проект "${projectName}"?`)) return;
    try {
      await apiService.deleteProject(activeProjectId);
      showToast('success', 'Проект удалён');
      setActiveProjectId(null);
      await loadProjects();
    } catch (e: any) {
      showToast('error', `Ошибка: ${e.message}`);
    }
  };

  // ---- Проверка AI ключа ----
  const handleTestKey = async () => {
    if (!ownAiKey.trim()) return;
    setTestingKey(true);
    setKeyTestResult(null);
    try {
      const res = await apiService.testAiKey(aiProvider, ownAiKey.trim());
      setKeyTestResult({ ok: res.ok, msg: res.message });
      if (res.ok) showToast('success', '✅ Ключ успешно проверен и работает');
      else showToast('error', `Ошибка ключа: ${res.message}`);
    } catch (e: any) {
      setKeyTestResult({ ok: false, msg: e.message });
      showToast('error', `Ошибка: ${e.message}`);
    } finally {
      setTestingKey(false);
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

  // ---- Сохранить ----
  const handleSave = async () => {
    setIsSaving(true);
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
        showToast('success', '✅ Все настройки и видео-движки сохранены');
      } else {
        saved = await apiService.createProject(payload);
        setActiveProjectId(saved.id);
        showToast('success', '✅ Проект создан и сохранён');
      }
      await loadProjects();
    } catch (e: any) {
      showToast('error', `Ошибка: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 60 }}>
      {/* Toast */}
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      {/* HEADER BAR */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, borderBottom: '1px solid rgba(255,255,255,0.07)',
        paddingBottom: 20
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 26 }}>⚙️</span>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>
              Настройки & AI Видео-генераторы
            </h1>
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4, margin: 0 }}>
            Управление параметрами проекта, API-ключами нейросетей, Seedance/Replicate/Luma/Runway и наценками
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={handleNewProject}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, padding: '10px 16px', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
            }}
          >
            <PlusCircle size={15} color="#e63946" /> Новый проект
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              background: 'linear-gradient(135deg, #e63946, #c0392b)',
              border: 'none', borderRadius: 12, padding: '10px 22px',
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 0 20px rgba(230,57,70,0.3)', display: 'flex', alignItems: 'center', gap: 8
            }}
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {isSaving ? 'Сохранение...' : 'Сохранить настройки'}
          </button>
        </div>
      </div>

      {/* PROJECT SELECTOR BAR */}
      {projects.length > 0 && (
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexWrap: 'wrap', gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 260 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Активный проект:
            </span>
            <select
              value={activeProjectId || ''}
              onChange={e => handleSelectProject(e.target.value)}
              style={{
                flex: 1, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '8px 14px', color: '#fff', fontSize: 13, fontWeight: 600, outline: 'none'
              }}
            >
              {projects.map(p => (
                <option key={p.id} value={p.id} style={{ background: '#111', color: '#fff' }}>
                  {p.name} {p.is_active ? '🟢 (Активен)' : '⚪ (Остановлен)'}
                </option>
              ))}
            </select>
          </div>

          {activeProjectId && (
            <button
              onClick={handleDeleteProject}
              style={{
                background: 'rgba(230,57,70,0.1)', border: '1px solid rgba(230,57,70,0.25)',
                borderRadius: 10, padding: '8px 14px', color: '#e63946', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
              }}
            >
              <Trash2 size={14} /> Удалить проект
            </button>
          )}
        </div>
      )}

      {/* 🎬 CARD: VIP AI VIDEO GENERATOR & EXTERNAL APIS */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(230,57,70,0.12), rgba(0,0,0,0.6))',
        border: '1px solid rgba(230,57,70,0.3)',
        borderRadius: 20, padding: 24, boxShadow: '0 4px 30px rgba(0,0,0,0.4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, background: 'rgba(230,57,70,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e63946'
            }}>
              <Film size={22} />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>
                AI Видео-генерация промо-контента (Image-to-Video)
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                Подключите внешние нейросети для оживления фото товара или используйте встроенный движок (0 ₽)
              </div>
            </div>
          </div>
          <span style={{
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: '#000', fontSize: 11, fontWeight: 900,
            padding: '4px 10px', borderRadius: 8, letterSpacing: 0.5
          }}>
            👑 ТАРИФ VIP / MAX
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 16 }}>
          {/* Выбор провайдера */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
              Движок генерации видео
            </label>
            <select
              value={videoProvider}
              onChange={e => setVideoProvider(e.target.value as any)}
              style={{
                background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(230,57,70,0.4)',
                borderRadius: 12, padding: '11px 14px', color: '#fff', fontSize: 13, fontWeight: 600, outline: 'none'
              }}
            >
              <option value="builtin" style={{ background: '#111' }}>⚡ Встроенный Turbo HD (Бесплатно, 0 ₽, быстро)</option>
              <option value="seedance" style={{ background: '#111' }}>💃 Seedance AI API (ByteDance video engine)</option>
              <option value="replicate" style={{ background: '#111' }}>🤖 Replicate API (Kling AI 1.6 / Wan2.1 / MiniMax)</option>
              <option value="luma" style={{ background: '#111' }}>🎥 Luma Dream Machine API (3D облёт товара)</option>
              <option value="runway" style={{ background: '#111' }}>✨ Runway Gen-3 Alpha API (Ultra Cinema)</option>
            </select>
          </div>

          {/* Стиль движения */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
              Трендовый стиль анимации товара
            </label>
            <select
              value={videoMotionStyle}
              onChange={e => setVideoMotionStyle(e.target.value as any)}
              style={{
                background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 12, padding: '11px 14px', color: '#fff', fontSize: 13, outline: 'none'
              }}
            >
              <option value="trending_cinematic" style={{ background: '#111' }}>🔥 Кинематографичный 360-облёт со студийным светом</option>
              <option value="studio_rotation" style={{ background: '#111' }}>🏷️ Студийный 360-поворот на подиуме с отражениями</option>
              <option value="lifestyle_motion" style={{ background: '#111' }}>✨ Лайфстайл зум и мягкие солнечные блики</option>
              <option value="fast_reels" style={{ background: '#111' }}>⚡ Быстрый ритмичный промо-ролик для Reels</option>
            </select>
          </div>

          {/* Поле API-ключа если выбран сторонний сервис */}
          {videoProvider !== 'builtin' && (
            <div style={{
              gridColumn: '1 / -1', background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(230,57,70,0.3)', borderRadius: 14, padding: 16,
              display: 'flex', flexDirection: 'column', gap: 10
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Shield size={16} color="#e63946" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                  API-ключ для {videoProvider.toUpperCase()}
                </span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  (Хранится зашифрованным Fernet)
                </span>
              </div>
              <input
                type="password"
                value={videoApiKey}
                onChange={e => setVideoApiKey(e.target.value)}
                placeholder={videoApiKey ? '•••••••••••••••• (ключ сохранён)' : videoProvider === 'seedance' ? 'Вставьте токен Seedance API...' : videoProvider === 'replicate' ? 'r8_...' : 'Вставьте API ключ...'}
                style={{
                  background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13,
                  fontFamily: 'monospace', outline: 'none'
                }}
              />
            </div>
          )}

          {/* Gemini Vision Auto-Prompting */}
          <div style={{
            gridColumn: '1 / -1', background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 18,
            display: 'flex', flexDirection: 'column', gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Eye size={18} color="#e63946" />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
                    Gemini Vision: Умный авто-промт для видео
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                    Gemini анализирует геометрию фото и составляет идеальный промт, <strong>строго сохраняя 100% деталей, расцветку и логотипы товара</strong>
                  </div>
                </div>
              </div>
              <DarkToggle checked={videoAutoPrompt} onChange={setVideoAutoPrompt} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={handleTestPrompt}
                disabled={testingPrompt}
                style={{
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 10, padding: '7px 14px', color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
                }}
              >
                {testingPrompt ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} color="#f59e0b" />}
                {testingPrompt ? 'Генерация промта...' : '🧪 Проверить промт Gemini Vision'}
              </button>
            </div>

            {testPromptOutput && (
              <div style={{
                background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(16,185,129,0.3)',
                borderRadius: 10, padding: 12, fontSize: 12, color: '#fff', fontFamily: 'monospace', lineHeight: 1.5
              }}>
                <span style={{ color: '#10b981', fontWeight: 700 }}>Сгенерированный промт для нейросети:</span><br/>
                {testPromptOutput}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2-COLUMN GRID: CHANNELS + TEXT AI REWRITER */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {/* CARD: Канал-донор и целевой */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(230,57,70,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e63946' }}>
              <Layers size={18} />
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>
              Каналы и проект
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>
              Название проекта
            </label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="Мой проект"
              style={{
                background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>
              Канал-донор (откуда копировать)
            </label>
            <input
              type="text"
              value={donorChannel}
              onChange={e => {
                setDonorChannel(e.target.value);
                setConfig({ ...config, sourceUrl: e.target.value });
              }}
              placeholder="@donor_channel"
              style={{
                background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13,
                fontFamily: 'monospace', outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>
              Целевой канал (куда публиковать)
            </label>
            <input
              type="text"
              value={targetChannel}
              onChange={e => {
                setTargetChannel(e.target.value);
                setConfig({ ...config, destinationChannel: e.target.value });
              }}
              placeholder="@my_target_channel"
              style={{
                background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13,
                fontFamily: 'monospace', outline: 'none'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>
              Интервал проверки (сек)
            </label>
            <input
              type="number"
              min={10} max={3600}
              value={checkInterval}
              onChange={e => {
                const v = parseInt(e.target.value) || 60;
                setCheckInterval(v);
                setConfig({ ...config, checkInterval: v });
              }}
              style={{
                background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, outline: 'none'
              }}
            />
          </div>
        </div>

        {/* CARD: AI Текстовый рерайтер & Gemini/OpenRouter */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(124,58,237,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa' }}>
              <Bot size={18} />
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>
              AI Текстовый рерайт
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>
              AI провайдер для текста
            </label>
            <select
              value={aiProvider}
              onChange={e => { setAiProvider(e.target.value as any); setKeyTestResult(null); }}
              style={{
                background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13, outline: 'none'
              }}
            >
              <option value="platform" style={{ background: '#111' }}>Платформа GhostPost (входит в тариф)</option>
              <option value="own_gemini" style={{ background: '#111' }}>Мой личный Gemini API ключ (Безлимит)</option>
              <option value="own_openrouter" style={{ background: '#111' }}>Мой OpenRouter API ключ (Claude, GPT-4o)</option>
            </select>
          </div>

          {aiProvider !== 'platform' && (
            <div style={{
              background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(124,58,237,0.3)',
              borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10
            }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="password"
                  value={ownAiKey}
                  onChange={e => { setOwnAiKey(e.target.value); setKeyTestResult(null); }}
                  placeholder={hasOwnKey ? '••••••••• (ключ сохранён)' : aiProvider === 'own_gemini' ? 'AIza...' : 'sk-or-...'}
                  style={{
                    flex: 1, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 12,
                    fontFamily: 'monospace', outline: 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={handleTestKey}
                  disabled={testingKey || !ownAiKey.trim()}
                  style={{
                    background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)',
                    borderRadius: 8, padding: '8px 12px', color: '#a78bfa', fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  {testingKey ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
                  {testingKey ? '...' : 'Проверить'}
                </button>
              </div>

              {keyTestResult && (
                <div style={{
                  fontSize: 12, fontWeight: 600,
                  color: keyTestResult.ok ? '#10b981' : '#e63946',
                  display: 'flex', alignItems: 'center', gap: 6
                }}>
                  {keyTestResult.ok ? <Check size={14} /> : <AlertTriangle size={14} />}
                  {keyTestResult.msg}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>
              Инструкция / Системный промпт стиля
            </label>
            <textarea
              rows={3}
              value={rewritePrompt}
              onChange={e => setRewritePrompt(e.target.value)}
              placeholder="Перепиши в дерзком стиле молодежного канала..."
              style={{
                background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 12,
                outline: 'none', resize: 'none', lineHeight: 1.4
              }}
            />
          </div>
        </div>
      </div>

      {/* 2-COLUMN GRID: RULES & PRICING */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {/* CARD: Правила обработки */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 14
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>
            🛡️ Правила обработки постов
          </h3>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>AI Рерайт текста</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Переписывать посты через Gemini / нейросеть</div>
            </div>
            <DarkToggle checked={rewriteEnabled} onChange={v => { setRewriteEnabled(v); setConfig({ ...config, useAI: v }); }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Удалять чужие ссылки</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Вырезать http, https, t.me и @mentions донора</div>
            </div>
            <DarkToggle checked={removeLinks} onChange={v => { setRemoveLinks(v); setConfig({ ...config, removeLinks: v }); }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Публиковать оригинал при ошибке AI</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Если AI недоступен — постить исходный текст</div>
            </div>
            <DarkToggle checked={useOriginalOnError} onChange={setUseOriginalOnError} />
          </div>
        </div>

        {/* CARD: Наценки магазина */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20, padding: 22, display: 'flex', flexDirection: 'column', gap: 14
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>
              🏷️ Авто-наценки магазина
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Включить:</span>
              <DarkToggle checked={pricingEnabled} onChange={setPricingEnabled} />
            </div>
          </div>

          <div style={{ opacity: pricingEnabled ? 1 : 0.45, display: 'flex', flexDirection: 'column', gap: 12, transition: 'opacity 0.2s ease' }}>
            {[
              { label: '📦 Наценка Опт', key: 'wholesalePercent' as keyof PricingRules, max: 100 },
              { label: '🤝 Наценка Дроп', key: 'dropPercent' as keyof PricingRules, max: 200 },
              { label: '🏷️ Наценка Розница', key: 'retailPercent' as keyof PricingRules, max: 300 },
            ].map(({ label, key, max }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 700, color: '#e63946' }}>+{config.pricing[key]}%</span>
                </div>
                <input
                  type="range" min={0} max={max}
                  disabled={!pricingEnabled}
                  value={config.pricing[key] as number}
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    setConfig({ ...config, pricing: { ...config.pricing, [key]: val } });
                  }}
                  style={{ width: '100%', accentColor: '#e63946' }}
                />
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Валюта магазина:</span>
              <select
                value={config.pricing.currencySymbol}
                disabled={!pricingEnabled}
                onChange={e => setConfig({ ...config, pricing: { ...config.pricing, currencySymbol: e.target.value } })}
                style={{
                  background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 8, padding: '4px 10px', color: '#fff', fontSize: 12, outline: 'none'
                }}
              >
                <option value="₽">₽ (Рубль)</option>
                <option value="$">$ (Доллар)</option>
                <option value="€">€ (Евро)</option>
                <option value="₸">₸ (Тенге)</option>
                <option value="с">с (Сомони / Сом)</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};