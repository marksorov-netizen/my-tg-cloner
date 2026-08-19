import React, { useState } from 'react';
import { AppConfig } from '../../types';
import { Sparkles, Copy, Check, Play, RefreshCw, Wand2, BookOpen, Loader2 } from 'lucide-react';
import { apiService } from '../../services/apiService';

interface PromptPageProps {
  config: AppConfig;
  setConfig: (c: AppConfig) => void;
}

const TEMPLATES = [
  {
    title: '🔥 Молодежный / Нефор',
    desc: 'Переписывает пост простым языком, со сленгом, эмодзи и мемами для молодежных каналов.',
    prompt: 'Ты — профессиональный SMM-редактор молодежного канала.\nПерепиши текст новости в стиле нефора: используй современный сленг, короткие эмоциональные фразы, уместные эмодзи 🔥. Сохрани все важные цифры и факты.'
  },
  {
    title: '📰 Официальный SMM',
    desc: 'Деловой стиль с подзаголовками и ключевыми выжимками для деловых пабликов.',
    prompt: 'Ты — главред делового Telegram-канала.\nПерепиши текст сухо, фактологически, выдели главное заголовочным блоком и тезисами. Удали субъективные оценки и сторонние ссылки.'
  },
  {
    title: '🛒 Продающее описание товара',
    desc: 'Форматирует описание товара под формат магазина: преимущества, наценка, призыв к покупке.',
    prompt: 'Ты — копирайтер Telegram-магазина.\nПерепиши описание товара: сделай привлекательный заголовок, выдели 3 главных плюса товара списком 📦, удали контакты оригинального продавца.'
  },
  {
    title: '⚡ Краткая выжимка (TL;DR)',
    desc: 'Сокращает длинную новость до 2-3 ключевых предложений.',
    prompt: 'Сократи текст до 3 самых важных предложений. Оставь только суть, факты и цифры. Никакой воды.'
  }
];

export const PromptPage: React.FC<PromptPageProps> = ({ config, setConfig }) => {
  const [activePrompt, setActivePrompt] = useState(
    'Ты — профессиональный SMM-редактор Telegram-канала.\nТвоя задача — переписывать входящие новости интересно, с эмодзи и сохранением всех фактов.'
  );

  const [intentInput, setIntentInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Live Testing
  const [testText, setTestText] = useState('Центральный банк поднял ключевую ставку до 16% из-за высокого уровня инфляции в стране.');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generate prompt via AI
  const handleGeneratePrompt = async () => {
    if (!intentInput.trim()) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/ai/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user_intent: intentInput.trim() })
      });
      const data = await res.json();
      if (data.generated_system_prompt) {
        setActivePrompt(data.generated_system_prompt);
      }
    } catch (e: any) {
      alert('Ошибка генерации промта');
    } finally {
      setIsGenerating(false);
    }
  };

  // Test prompt against sample text
  const handleTestRewrite = async () => {
    if (!testText.trim()) return;
    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/ai/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: testText,
          prompt: activePrompt,
          mode: 'news'
        })
      });
      const data = await res.json();
      if (data.rewritten_text) {
        setTestResult(data.rewritten_text);
      } else {
        throw new Error(data.detail || 'Не удалось выполнить рерайт');
      }
    } catch (e: any) {
      setTestResult(`⚠️ Ошибка проверки: ${e.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(activePrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(124,58,237,0.1), rgba(15,15,15,0.9))',
        border: '1px solid rgba(124,58,237,0.2)',
        borderRadius: 24, padding: 32
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(124,58,237,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
            ✍️
          </div>
          <div>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 800, color: '#fff' }}>
              Раздел 3: Промт-инжиниринг и шаблоны
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 2 }}>
              От качества промта зависит стиль и уникальность вашего канала. Создавайте, тестируйте и сохраняйте промты.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left: Templates & AI Generator */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* AI Generator */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Wand2 size={18} color="#a78bfa" /> Генератор промта по вашему описанию
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={intentInput}
                onChange={e => setIntentInput(e.target.value)}
                placeholder="Опишите пожелание (например: хочу стиль хайп-блогера)"
                style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
              />
              <button
                onClick={handleGeneratePrompt}
                disabled={isGenerating || !intentInput.trim()}
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff', fontWeight: 700, padding: '0 16px', borderRadius: 12, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {isGenerating ? <Loader2 className="animate-spin" size={16} /> : 'Сгенерировать'}
              </button>
            </div>
          </div>

          {/* Templates Library */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <BookOpen size={18} color="#f4a623" /> Библиотека готовых шаблонов
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {TEMPLATES.map((t, idx) => (
                <div
                  key={idx}
                  onClick={() => setActivePrompt(t.prompt)}
                  style={{
                    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 14, padding: 14, cursor: 'pointer', transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
                >
                  <div style={{ fontWeight: 700, color: '#fff', fontSize: 14, marginBottom: 4 }}>{t.title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{t.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Active Prompt Editor & Tester */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Active Prompt */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Текущий системный промт</h3>
              <button onClick={handleCopy} style={{ background: 'none', border: 'none', color: copied ? '#10b981' : 'rgba(255,255,255,0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
            <textarea
              rows={6}
              value={activePrompt}
              onChange={e => setActivePrompt(e.target.value)}
              style={{
                width: '100%', background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(124,58,237,0.3)', borderRadius: 12,
                padding: 14, color: '#fff', fontSize: 13, outline: 'none', lineHeight: 1.6, resize: 'vertical'
              }}
            />
          </div>

          {/* Test Sandbox */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              🧪 Песочница (проверка рерайта)
            </h3>

            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Тестовый текст-оригинал:</div>
            <textarea
              rows={2}
              value={testText}
              onChange={e => setTestText(e.target.value)}
              style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 10, color: '#fff', fontSize: 13, outline: 'none', marginBottom: 12 }}
            />

            <button
              onClick={handleTestRewrite}
              disabled={isTesting}
              style={{
                width: '100%', padding: 12, borderRadius: 12,
                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
              }}
            >
              {isTesting ? <Loader2 className="animate-spin" size={16} /> : <><Play size={16} /> Проверить работу промта</>}
            </button>

            {testResult && (
              <div style={{ marginTop: 16, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', marginBottom: 6 }}>Результат AI:</div>
                <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{testResult}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
