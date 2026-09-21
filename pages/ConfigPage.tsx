import React, { useState, useEffect } from 'react';
import { AppConfig, Toast } from '../types';
import { apiService } from '../services/apiService';
import { loadUserSavedConfig, saveUserSavedConfig } from '../services/userConfig';
import {
  Save, AlertTriangle, CheckCircle,
  Loader2, Key, Zap, Shield, Film, Eye,
  Bot, Check, Sparkles
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
      padding: '14px 20px', borderRadius: 14,
      background: isErr ? 'rgba(230,57,70,0.15)' : isSucc ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
      border: `1px solid ${isErr ? 'rgba(230,57,70,0.4)' : isSucc ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.12)'}`,
      color: '#fff', fontSize: 13, fontWeight: 600,
      backdropFilter: 'blur(10px)', marginBottom: 16
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {toast.type === 'loading' && <Loader2 size={16} className="animate-spin" color="#e63946" />}
        {isSucc && <CheckCircle size={16} color="#10b981" />}
        {isErr && <AlertTriangle size={16} color="#e63946" />}
        <span>{toast.message}</span>
      </div>
      {toast.type !== 'loading' && (
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
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

  // 👗 Виртуальная примерка на фирменную модель (VTON)
  const [enableVton, setEnableVton] = useState<boolean>(savedCfg.enableVton || false);

  // 1. AI Видео-генерация & Нейросети (Fashion Multi-Color / Seedance / Replicate / Luma / Runway / Builtin)
  const [videoProvider, setVideoProvider] = useState<'builtin' | 'fashion_multicolor' | 'seedance' | 'replicate' | 'luma' | 'runway'>(savedCfg.videoProvider || 'builtin');
  const [videoApiKey, setVideoApiKey] = useState(savedCfg.videoApiKey || '');
  const [videoMotionStyle, setVideoMotionStyle] = useState<'trending_cinematic' | 'studio_rotation' | 'lifestyle_motion' | 'fast_reels'>(savedCfg.videoMotionStyle || 'trending_cinematic');
  const [videoAutoPrompt, setVideoAutoPrompt] = useState<boolean>(savedCfg.videoAutoPrompt !== undefined ? savedCfg.videoAutoPrompt : true);
  const [testingPrompt, setTestingPrompt] = useState(false);
  const [testPromptOutput, setTestPromptOutput] = useState<string | null>(null);

  // 2. AI Текстовый рерайт (Подписка платформы / Личный Gemini / Личный OpenRouter)
  // ВАЖНО: личный ключ держим только в памяти (useState), НЕ сохраняем в localStorage.
  const [textAiProvider, setTextAiProvider] = useState<'platform' | 'own_gemini' | 'own_openrouter'>(
    (localStorage.getItem('ghostpost_text_ai_provider') as any) || 'platform'
  );
  const [textAiKey, setTextAiKey] = useState('');
  const [testingTextKey, setTestingTextKey] = useState(false);
  const [textKeyTestResult, setTextKeyTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Toast & Saving state
  const [toast, setToast] = useState<Toast | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const showToast = (type: Toast['type'], message: string, autoDismiss = true) => {
    const id = Math.random().toString(36).slice(2);
    setToast({ id, type, message });
    if (autoDismiss) setTimeout(() => setToast(t => t?.id === id ? null : t), 3500);
  };

  // ---- Проверка ключа для текстового AI ----
  const handleTestTextKey = async () => {
    if (!textAiKey.trim()) {
      setTextKeyTestResult({ ok: false, msg: 'Введите API-ключ для проверки' });
      return;
    }
    setTestingTextKey(true);
    setTextKeyTestResult(null);
    try {
      const res = await apiService.testAiKey(textAiProvider, textAiKey.trim());
      setTextKeyTestResult({ ok: res.ok, msg: res.message });
      if (res.ok) showToast('success', '✅ Ключ успешно проверен и готов к работе');
      else showToast('error', `Ошибка ключа: ${res.message}`);
    } catch (e: any) {
      setTextKeyTestResult({ ok: false, msg: e.message });
      showToast('error', `Ошибка: ${e.message}`);
    } finally {
      setTestingTextKey(false);
    }
  };

  // ---- Тест промта Gemini Vision для видео ----
  const handleTestVideoPrompt = async () => {
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

  // ---- Сохранить настройки ----
  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Сохраняем настройки видео-генератора (ключ уйдет в sessionStorage, см. userConfig.ts)
      saveUserSavedConfig({
        enableVton,
        videoProvider,
        videoApiKey,
        videoMotionStyle,
        videoAutoPrompt,
      });

      // Сохраняем только провайдер текстового AI. Сам ключ НЕ персистим —
      // он живет только в памяти до перезагрузки и проверяется через backend.
      localStorage.setItem('ghostpost_text_ai_provider', textAiProvider);

      showToast('success', '✅ Настройки AI сохранены (ключи — только до перезагрузки вкладки)');
    } catch (e: any) {
      showToast('error', `Ошибка при сохранении: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 60, maxWidth: 960, margin: '0 auto' }}>
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
              Настройки AI & API-ключей
            </h1>
          </div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4, margin: 0 }}>
            Подключение токенов нейросетей для генерации промо-видео и выбор движка для рерайта текста
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            background: 'linear-gradient(135deg, #e63946, #c0392b)',
            border: 'none', borderRadius: 12, padding: '12px 24px',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 0 20px rgba(230,57,70,0.3)', display: 'flex', alignItems: 'center', gap: 8
          }}
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {isSaving ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
      </div>

      {/* 👗 БЛОК: ВИРТУАЛЬНАЯ ПРИМЕРКА НА ФИРМЕННУЮ МОДЕЛЬ (VTON) */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(0,0,0,0.6))',
        border: '1px solid rgba(16,185,129,0.35)',
        borderRadius: 20, padding: 24, boxShadow: '0 4px 30px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', gap: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, background: 'rgba(16,185,129,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22
            }}>
              👗
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                Виртуальная примерка на фирменную модель (VTON)
                <span style={{
                  background: 'rgba(16,185,129,0.2)', color: '#10b981', border: '1px solid #10b981',
                  fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 6
                }}>
                  0 ₽ / БЕСПЛАТНО
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                Замена фото доноров (диваны, пол, водяные знаки) на студийные фото с нашей моделью-брюнеткой
              </div>
            </div>
          </div>
          <DarkToggle checked={enableVton} onChange={setEnableVton} />
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14, padding: 16, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6
        }}>
          💡 <strong>Как это работает:</strong> При включённом тумблере бот автоматически берёт фото вещи из канала-донора, отсекает чужие логотипы и диванный фон, и надевает вещь на виртуальную модель. В Telegram-канале публикуется стильный альбом, где <strong>первым слайдом идёт фото с моделью</strong>, а затем детальные фото ткани.
        </div>
      </div>

      {/* 🎬 1. БЛОК: AI ВИДЕО-ГЕНЕРАЦИЯ (IMAGE-TO-VIDEO) */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(230,57,70,0.12), rgba(0,0,0,0.6))',
        border: '1px solid rgba(230,57,70,0.3)',
        borderRadius: 20, padding: 24, boxShadow: '0 4px 30px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', gap: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, background: 'rgba(230,57,70,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e63946'
            }}>
              <Film size={22} />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>
                1. AI Видео-генерация промо-контента (Image-to-Video)
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                Выберите нейросеть для создания видео из фотографий товара или используйте встроенный движок (0 ₽)
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {/* Выбор видео-провайдера */}
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
              <option value="builtin" style={{ background: '#111' }}>⚡ Встроенный Turbo HD (Входит в тариф, 0 ₽)</option>
              <option value="fashion_multicolor" style={{ background: '#111' }}>👗 Fashion Мульти-цвет + AI Голос (Все цвета куртки + озвучка 9:16, 0 ₽)</option>
              <option value="seedance" style={{ background: '#111' }}>💃 Seedance AI API (ByteDance e-commerce video)</option>
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

          {/* Поле API-ключа для внешних сервисов */}
          {videoProvider !== 'builtin' && (
            <div style={{
              gridColumn: '1 / -1', background: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(230,57,70,0.3)', borderRadius: 14, padding: 16,
              display: 'flex', flexDirection: 'column', gap: 8
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Shield size={16} color="#e63946" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                  API-токен для {videoProvider.toUpperCase()}
                </span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  (Безопасное хранение)
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

          {/* Gemini Vision Smart Auto-Prompting */}
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
                    Gemini сканирует фото товара и генерирует промт, <strong>строго сохраняя 100% деталей, логотипы и расцветку</strong>
                  </div>
                </div>
              </div>
              <DarkToggle checked={videoAutoPrompt} onChange={setVideoAutoPrompt} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={handleTestVideoPrompt}
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
                <span style={{ color: '#10b981', fontWeight: 700 }}>Сгенерированный промт для видео-нейросети:</span><br/>
                {testPromptOutput}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ✍️ 2. БЛОК: AI ТЕКСТОВЫЙ РЕРАЙТ */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20, padding: 24, boxShadow: '0 4px 25px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', gap: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, background: 'rgba(124,58,237,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa'
            }}>
              <Bot size={22} />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>
                2. AI Текстовый рерайт постов
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                Используйте готовые ключи подписки GhostPost или подключите свой личный ключ
              </div>
            </div>
          </div>
          <span style={{
            background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
            color: '#c4b5fd', fontSize: 11, fontWeight: 800,
            padding: '4px 10px', borderRadius: 8
          }}>
            🤖 ТЕКСТОВАЯ НЕЙРОСЕТЬ
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
              Режим работы текстового AI
            </label>
            <select
              value={textAiProvider}
              onChange={e => {
                setTextAiProvider(e.target.value as any);
                setTextKeyTestResult(null);
              }}
              style={{
                background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(124,58,237,0.4)',
                borderRadius: 12, padding: '12px 14px', color: '#fff', fontSize: 13, fontWeight: 600, outline: 'none'
              }}
            >
              <option value="platform" style={{ background: '#111' }}>💎 Платформа GhostPost (входит в тариф — готовые ключи платформы)</option>
              <option value="own_gemini" style={{ background: '#111' }}>🔑 Мой собственный Gemini API ключ (Google AI Studio, Безлимит)</option>
              <option value="own_openrouter" style={{ background: '#111' }}>🌐 Мой собственный OpenRouter API ключ (Claude 3.5 Sonnet, GPT-4o)</option>
            </select>
          </div>

          {/* Поле для личного ключа */}
          {textAiProvider !== 'platform' && (
            <div style={{
              background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(124,58,237,0.3)',
              borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Shield size={16} color="#a78bfa" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                  {textAiProvider === 'own_gemini' ? 'Личный ключ Gemini API (AIza...)' : 'Личный ключ OpenRouter API (sk-or-...)'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="password"
                  value={textAiKey}
                  onChange={e => {
                    setTextAiKey(e.target.value);
                    setTextKeyTestResult(null);
                  }}
                  placeholder={textAiProvider === 'own_gemini' ? 'AIzaSy...' : 'sk-or-v1-...'}
                  style={{
                    flex: 1, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 13,
                    fontFamily: 'monospace', outline: 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={handleTestTextKey}
                  disabled={testingTextKey || !textAiKey.trim()}
                  style={{
                    background: 'rgba(124,58,237,0.3)', border: '1px solid rgba(124,58,237,0.5)',
                    borderRadius: 10, padding: '10px 18px', color: '#c4b5fd', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap'
                  }}
                >
                  {testingTextKey ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
                  {testingTextKey ? 'Проверка...' : 'Проверить ключ'}
                </button>
              </div>

              {textKeyTestResult && (
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  color: textKeyTestResult.ok ? '#10b981' : '#e63946',
                  display: 'flex', alignItems: 'center', gap: 6, marginTop: 2
                }}>
                  {textKeyTestResult.ok ? <Check size={16} /> : <AlertTriangle size={16} />}
                  {textKeyTestResult.msg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FOOTER SAVE BUTTON */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            background: 'linear-gradient(135deg, #e63946, #c0392b)',
            border: 'none', borderRadius: 12, padding: '12px 28px',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 0 20px rgba(230,57,70,0.3)', display: 'flex', alignItems: 'center', gap: 8
          }}
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {isSaving ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
      </div>
    </div>
  );
};
