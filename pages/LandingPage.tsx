import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── Анимированный фон ───────────────────────────────────────────────────────
const BgEffects = () => (
  <>
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute', width: 700, height: 700, borderRadius: '50%',
        background: '#e63946', filter: 'blur(120px)', opacity: 0.1,
        top: -200, left: -200, animation: 'orbFloat 12s ease-in-out infinite'
      }} />
      <div style={{
        position: 'absolute', width: 500, height: 500, borderRadius: '50%',
        background: '#f4a623', filter: 'blur(120px)', opacity: 0.08,
        bottom: -100, right: -100, animation: 'orbFloat 15s ease-in-out infinite reverse'
      }} />
      <div style={{
        position: 'absolute', width: 400, height: 400, borderRadius: '50%',
        background: '#7c3aed', filter: 'blur(120px)', opacity: 0.07,
        top: '50%', left: '50%', marginTop: -200, marginLeft: -200,
        animation: 'orbFloat 10s ease-in-out infinite 3s'
      }} />
    </div>
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
      backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
      backgroundSize: '50px 50px'
    }} />
  </>
);

// ─── Hero ────────────────────────────────────────────────────────────────────
const HeroSection = ({ onStart, isMobile }: { onStart: () => void; isMobile: boolean }) => (
  <section style={{ minHeight: '85vh', display: 'flex', alignItems: 'center', padding: isMobile ? '60px 0 30px' : '90px 0 50px', position: 'relative', zIndex: 1 }}>
    <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 20px', width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 32, alignItems: 'center' }}>
        {/* Левая часть */}
        <div style={{ textAlign: isMobile ? 'center' : 'left', position: 'relative' }}>
          {/* Animated Floating Social Badges */}
          <div style={{
            position: 'absolute', top: -30, left: 10, zIndex: 10,
            background: 'rgba(230,57,70,0.18)', border: '1px solid rgba(230,57,70,0.4)',
            color: '#e63946', fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 100,
            boxShadow: '0 10px 25px rgba(230,57,70,0.2)', pointerEvents: 'none',
            animation: 'fbFloat 3.5s ease-in-out infinite'
          }}>✈️ Telegram 24/7</div>

          <div style={{
            position: 'absolute', top: -10, right: 10, zIndex: 10,
            background: 'rgba(244,166,35,0.18)', border: '1px solid rgba(244,166,35,0.4)',
            color: '#f4a623', fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 100,
            boxShadow: '0 10px 25px rgba(244,166,35,0.2)', pointerEvents: 'none',
            animation: 'fbFloat 4.5s ease-in-out infinite 0.8s'
          }}>🤖 AI Rewriter</div>

          <div style={{ marginBottom: 20, display: 'flex', justifyContent: isMobile ? 'center' : 'flex-start' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(244,166,35,0.12)', border: '1px solid rgba(244,166,35,0.25)',
              color: '#f4a623', fontSize: 12, fontWeight: 700,
              padding: '5px 14px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '1.2px'
            }}>⚡ AI-автопилот для Telegram каналов</span>
          </div>

          <h1 style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 'clamp(34px, 5.5vw, 68px)', fontWeight: 800,
            lineHeight: 1.1, marginBottom: 20, letterSpacing: -1.5,
            color: '#f5f5f5'
          }}>
            Контент<br />
            на{' '}
            <span style={{
              background: 'linear-gradient(135deg, #ffffff 0%, #f4a623 50%, #e63946 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
            }}>автопилоте</span>
          </h1>

          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: 32, maxWidth: 480, margin: isMobile ? '0 auto 28px' : '0 0 32px' }}>
            Подключи каналы-доноры, задай стиль — GhostPost сам читает, 
            переписывает и публикует контент. Твой канал растёт, пока ты занимаешься другим.
          </p>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: isMobile ? 'center' : 'flex-start', marginBottom: 40 }}>
            <button onClick={onStart} style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'linear-gradient(135deg, #e63946, #c0392b)',
              color: '#fff', fontWeight: 700, fontSize: 15,
              padding: '14px 32px', borderRadius: 12, border: 'none', cursor: 'pointer',
              boxShadow: '0 0 30px rgba(230,57,70,0.35), 0 4px 20px rgba(0,0,0,0.4)',
              width: isMobile ? '100%' : 'auto',
              transition: 'all 0.3s ease'
            }}>🚀 Начать бесплатно 7 дней</button>
            <a href="#how" style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: 'transparent', color: '#f5f5f5', fontWeight: 600, fontSize: 15,
              padding: '13px 24px', borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', textDecoration: 'none',
              width: isMobile ? '100%' : 'auto',
              transition: 'all 0.3s ease'
            }}>Как это работает →</a>
          </div>

          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, paddingTop: 24,
            borderTop: '1px solid rgba(255,255,255,0.07)', textAlign: 'center'
          }}>
            {[
              { val: '2 400+', label: 'Активных каналов' },
              { val: '1.8M', label: 'Постов опубликовано' },
              { val: '99.7%', label: 'Аптайм сервиса' },
            ].map(s => (
              <div key={s.val}>
                <div style={{
                  fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 800,
                  background: 'linear-gradient(135deg, #f5f5f5, #f4a623)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
                }}>{s.val}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Правая часть — 3D Видео Демонстрация */}
        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: -20, borderRadius: 40,
            border: '1px solid rgba(230,57,70,0.2)',
            animation: 'ringPulse 3s ease-in-out infinite'
          }} />
          <div style={{
            position: 'relative', width: '100%', borderRadius: 24, padding: 3,
            background: 'linear-gradient(135deg, #e63946, #f4a623, #7c3aed)',
            boxShadow: '0 0 50px rgba(230, 57, 70, 0.4), 0 20px 40px rgba(0,0,0,0.8)',
            zIndex: 2
          }}>
            <div style={{ position: 'relative', width: '100%', borderRadius: 22, overflow: 'hidden', background: '#090909' }}>
              <video 
                autoPlay 
                loop 
                muted 
                playsInline 
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 22, aspectRatio: '16/9', objectFit: 'cover' }}
              >
                <source src="/hero_video.mp4" type="video/mp4" />
                <source src="/components/hero_video.mp4" type="video/mp4" />
              </video>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(9,9,9,0.7) 0%, transparent 40%)', pointerEvents: 'none' }} />
            </div>
          </div>

          {/* Floating badges */}
          <div style={{
            position: 'absolute', top: -16, right: -10,
            background: 'linear-gradient(135deg, #f4a623, #e67e22)',
            color: '#000', fontSize: 11, fontWeight: 800,
            padding: '6px 12px', borderRadius: 100,
            boxShadow: '0 0 30px rgba(244,166,35,0.4)',
            zIndex: 10,
            animation: 'fbFloat 3s ease-in-out infinite'
          }}>⚡ AI авто-перенос</div>
          <div style={{
            position: 'absolute', bottom: 20, left: -10,
            background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff', fontSize: 11, fontWeight: 800,
            padding: '6px 12px', borderRadius: 100,
            boxShadow: '0 0 30px rgba(16,185,129,0.4)',
            zIndex: 10,
            animation: 'fbFloat 3s ease-in-out infinite 1.5s'
          }}>💰 Наценка %</div>
        </div>
      </div>
    </div>
  </section>
);

// ─── Ticker ───────────────────────────────────────────────────────────────────
const Ticker = () => {
  const items = ['Парсинг TG каналов','AI рерайт текстов','Скачивание медиа','Автопубликация','Интернет магазины','Наценки на товары','Несколько доноров','Фильтрация рекламы','Гибкие промты','Интервал постинга'];
  return (
    <div style={{ overflow: 'hidden', padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 36 }}>
      <div style={{ display: 'flex', whiteSpace: 'nowrap', animation: 'tickerScroll 30s linear infinite' }}>
        {[...items, ...items].map((item, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '0 40px', color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: 500 }}>
            <span style={{ color: '#e63946', fontSize: 20 }}>●</span> {item}
          </span>
        ))}
      </div>
    </div>
  );
};

// ─── Reusable 3D Video Frame Component ─────────────────────────────────────────
const SectionVideoShowcase = ({
  src,
  altSrc,
  posterGlow,
  badge,
  caption,
  aspectRatio = '16/9',
  maxWidth = 920,
}: {
  src: string;
  altSrc?: string;
  posterGlow: string;
  badge: string;
  caption?: string;
  aspectRatio?: string;
  maxWidth?: number;
}) => {
  const [hasError, setHasError] = useState(false);

  return (
    <div style={{
      maxWidth,
      margin: '0 auto 28px',
      position: 'relative',
      zIndex: 2,
    }}>
      {/* Dynamic Ambient Background Glow */}
      <div style={{
        position: 'absolute',
        inset: -10,
        borderRadius: 32,
        background: posterGlow,
        filter: 'blur(40px)',
        opacity: 0.28,
        zIndex: 0,
        pointerEvents: 'none',
        animation: 'ringPulse 4s ease-in-out infinite'
      }} />

      {/* Frame Container */}
      <div style={{
        position: 'relative',
        borderRadius: 22,
        padding: 2,
        background: 'linear-gradient(135deg, rgba(230,57,70,0.5), rgba(244,166,35,0.35), rgba(124,58,237,0.4))',
        boxShadow: '0 16px 40px rgba(0,0,0,0.8), 0 0 30px rgba(230,57,70,0.18)',
        zIndex: 1,
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'relative',
          width: '100%',
          borderRadius: 20,
          overflow: 'hidden',
          background: '#090909',
          aspectRatio,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {!hasError ? (
            <video
              autoPlay
              loop
              muted
              playsInline
              onError={() => setHasError(true)}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit: 'cover',
              }}
            >
              <source src={src} type="video/mp4" />
              {altSrc && <source src={altSrc} type="video/mp4" />}
            </video>
          ) : (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'radial-gradient(circle at center, rgba(230,57,70,0.12) 0%, rgba(9,9,9,0.95) 75%)',
              padding: 20,
              textAlign: 'center'
            }}>
              <div style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #e63946, #f4a623)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                boxShadow: '0 0 25px rgba(230,57,70,0.4)',
                marginBottom: 12,
                animation: 'fbFloat 3s ease-in-out infinite'
              }}>🎬</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f5f5f5', marginBottom: 4 }}>
                {badge}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', maxWidth: 400 }}>
                Поместите файл <code>{src.replace('/', '')}</code> в папку <code>public/</code>
              </div>
            </div>
          )}

          {/* Top Badge */}
          <div style={{
            position: 'absolute',
            top: 12,
            left: 14,
            background: 'rgba(9,9,9,0.78)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: '#f4a623',
            fontSize: 11,
            fontWeight: 800,
            padding: '4px 10px',
            borderRadius: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
            zIndex: 5
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
            {badge}
          </div>

          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(9,9,9,0.65) 0%, transparent 35%)',
            pointerEvents: 'none'
          }} />
        </div>
      </div>

      {caption && (
        <div style={{
          textAlign: 'center',
          fontSize: 13,
          color: 'rgba(255,255,255,0.4)',
          marginTop: 8
        }}>
          {caption}
        </div>
      )}
    </div>
  );
};

// ─── How It Works ─────────────────────────────────────────────────────────────
const HowSection = () => {
  const steps = [
    { n: '1', title: 'Регистрация', text: 'Заходишь на сайт, создаёшь аккаунт за 1 минуту. Email или Telegram никнейм.' },
    { n: '2', title: 'Подключи Telegram', text: 'Вводишь свой API ID и API Hash (инструкция внутри). Авторизуешься по коду.' },
    { n: '3', title: 'Настрой проект', text: 'Выбираешь каналы-доноры, канал куда постить, пишешь промт для AI.' },
    { n: '4', title: 'Запусти и забудь', text: 'Жмёшь «Старт» — GhostPost работает 24/7 сам. Канал растёт.' },
  ];
  return (
    <section id="how" style={{ padding: '30px 0 50px', position: 'relative', zIndex: 1 }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px' }}>
        {/* 🎬 3D ВИДЕО НА САМОМ ВЕРХУ БЛОКА */}
        <SectionVideoShowcase
          src="/how_it_works.mp4"
          altSrc="/public/how_it_works.mp4"
          posterGlow="linear-gradient(135deg, #e63946, #f4a623)"
          badge="⚡ 3D ДЕМО: Автоматический конвейер"
        />

        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <span style={{ display: 'inline-flex', background: 'rgba(244,166,35,0.12)', border: '1px solid rgba(244,166,35,0.25)', color: '#f4a623', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 100, textTransform: 'uppercase' as const, letterSpacing: '1.2px' }}>📋 Процесс</span>
        </div>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 'clamp(28px,3.8vw,48px)', fontWeight: 800, textAlign: 'center', letterSpacing: -1.2, marginBottom: 12 }}>
          Запустить за <span style={{ background: 'linear-gradient(135deg,#fff,#f4a623,#e63946)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>4 шага</span>
        </h2>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', textAlign: 'center', maxWidth: 560, margin: '0 auto 36px' }}>Никаких сложных настроек — всё автоматизировано.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
          {steps.map(s => (
            <div key={s.n} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, padding: '24px 20px', transition: 'all 0.3s ease' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(230,57,70,0.3)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 800, background: 'linear-gradient(135deg,#e63946,#c0392b)', boxShadow: '0 0 20px rgba(230,57,70,0.35)' }}>{s.n}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ─── Features ─────────────────────────────────────────────────────────────────
const FeaturesSection = () => {
  const features = [
    { icon: '🤖', title: 'AI рерайт любого стиля', text: 'Переписывает в любом стиле: официальный, дружеский, нефорский, продающий. Каждый раз уникальный текст.', large: false },
    { icon: '📸', title: 'Медиа автоматически', text: 'Скачивает фото и видео из постов донора и публикует вместе с текстом.', large: false },
    { icon: '⏱️', title: 'Гибкий интервал', text: 'Настрой постинг каждые 2 часа, раз в день или по расписанию.', large: false },
    { icon: '🎯', title: 'Несколько доноров', text: 'Добавь 5-10 каналов-доноров — система берёт лучший свежий контент из всех.', large: false },
    { icon: '🚫', title: 'Фильтр рекламы', text: 'AI определяет рекламные посты и пропускает их автоматически.', large: false },
    { icon: '💰', title: 'Автонаценки', text: 'Для магазинов: находит цену товара и добавляет нужный процент.', large: false },
  ];
  return (
    <section style={{ padding: '35px 0 55px', position: 'relative', zIndex: 1 }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px' }}>
        {/* 🎬 3D ВИДЕО НА САМОМ ВЕРХУ БЛОКА */}
        <SectionVideoShowcase
          src="/features_video.mp4"
          altSrc="/public/features_video.mp4"
          posterGlow="linear-gradient(135deg, #f4a623, #7c3aed)"
          badge="🤖 3D AI: Нейросетевой рерайтер и аналитика"
        />

        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <span style={{ display: 'inline-flex', background: 'rgba(244,166,35,0.12)', border: '1px solid rgba(244,166,35,0.25)', color: '#f4a623', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 100, textTransform: 'uppercase' as const, letterSpacing: '1.2px' }}>⚙️ Возможности</span>
        </div>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(28px,3.8vw,48px)', fontWeight: 800, textAlign: 'center', letterSpacing: -1.2, marginBottom: 12 }}>
          Всё для <span style={{ background: 'linear-gradient(135deg,#fff,#f4a623,#e63946)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>роста канала</span>
        </h2>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', textAlign: 'center', maxWidth: 560, margin: '0 auto 36px' }}>Полный набор инструментов — от парсинга до публикации.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {features.map((f, i) => (
            <div key={i} style={{ gridColumn: f.large ? 'span 2' : 'span 1', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, padding: '26px 22px', transition: 'all 0.3s ease', position: 'relative', overflow: 'hidden' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(230,57,70,0.3)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, background: 'rgba(230,57,70,0.1)', border: '1px solid rgba(230,57,70,0.2)' }}>{f.icon}</div>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>{f.title}</h3>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.65 }}>{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ─── Modules ──────────────────────────────────────────────────────────────────
const ModulesSection = () => {
  const mods = [
    { n: '01', icon: '📰', title: 'Парсер каналов', text: 'Для новостных, развлекательных, тематических каналов. Копируй контент конкурентов и переделывай в своём стиле.', tags: ['Живой мониторинг','Пакетный импорт','Несколько доноров'] },
    { n: '02', icon: '🛒', title: 'Интернет магазин', text: 'Для владельцев магазинов в Telegram. Копируй товары, меняй описание, добавляй наценку и публикуй у себя.', tags: ['Автонаценка','Фильтр рекламы','Фото товаров'] },
    { n: '03', icon: '✍️', title: 'Промт-инжиниринг', text: 'Помогает написать идеальный промт для AI. Конструктор + готовые шаблоны для разных типов каналов.', tags: ['Шаблоны','AI-помощник','Тест промта'] },
  ];
  return (
    <section id="modules" style={{ padding: '35px 0 55px', position: 'relative', zIndex: 1 }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px' }}>
        {/* 🎬 3D ВИДЕО НА САМОМ ВЕРХУ БЛОКА */}
        <SectionVideoShowcase
          src="/modules_video.mp4"
          altSrc="/public/modules_video.mp4"
          posterGlow="linear-gradient(135deg, #e63946, #7c3aed)"
          badge="📦 3D Модули: Парсинг, Магазин и Промты"
        />

        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <span style={{ display: 'inline-flex', background: 'rgba(244,166,35,0.12)', border: '1px solid rgba(244,166,35,0.25)', color: '#f4a623', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 100, textTransform: 'uppercase' as const, letterSpacing: '1.2px' }}>📦 Модули</span>
        </div>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(28px,3.8vw,48px)', fontWeight: 800, textAlign: 'center', letterSpacing: -1.2, marginBottom: 12 }}>
          Три модуля — <span style={{ background: 'linear-gradient(135deg,#fff,#f4a623,#e63946)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>любая задача</span>
        </h2>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', textAlign: 'center', maxWidth: 560, margin: '0 auto 36px' }}>Каждый раздел платформы заточен под конкретную задачу.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {mods.map(m => (
            <div key={m.n} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, padding: '26px 22px', transition: 'all 0.35s ease', cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(230,57,70,0.3)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-6px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 50px rgba(230,57,70,0.1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 11, fontWeight: 800, color: '#e63946', textTransform: 'uppercase' as const, letterSpacing: 2, marginBottom: 12 }}>Модуль {m.n}</div>
              <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 10 }}>{m.icon} {m.title}</h3>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.65, marginBottom: 16 }}>{m.text}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {m.tags.map(t => <span key={t} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: 500, padding: '3px 10px', borderRadius: 100 }}>{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ─── Pricing ──────────────────────────────────────────────────────────────────
const PricingSection = ({ onStart }: { onStart: () => void }) => {
  const plans = [
    { name: 'Free', price: '0 ₽', desc: 'Попробуй без риска', featured: false, features: ['1 проект','10 AI рерайтов в день','1 канал-донор','Базовые промты','Интервал от 6 часов'] },
    { name: 'Pro', price: '990 ₽', desc: 'Для серьёзного роста', featured: true, features: ['5 проектов','500 AI рерайтов в день','До 10 доноров','Все 3 модуля','Интервал от 30 минут','Приоритетная поддержка','Свой API ключ (безлимит)'] },
    { name: 'Business', price: '2 990 ₽', desc: 'Для команд и агентств', featured: false, features: ['Безлимит проектов','Безлимит рерайтов','Безлимит доноров','Интервал от 1 минуты','API доступ','Dedicated поддержка','White-label'] },
  ];
  return (
    <section id="pricing" style={{ padding: '35px 0 55px', position: 'relative', zIndex: 1 }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px' }}>
        {/* 🎬 3D ВИДЕО НА САМОМ ВЕРХУ БЛОКА */}
        <SectionVideoShowcase
          src="/pricing_video.mp4"
          altSrc="/public/pricing_video.mp4"
          posterGlow="linear-gradient(135deg, #10b981, #f4a623)"
          badge="💰 3D Графика: Окупаемость и доход"
        />

        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <span style={{ display: 'inline-flex', background: 'rgba(244,166,35,0.12)', border: '1px solid rgba(244,166,35,0.25)', color: '#f4a623', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 100, textTransform: 'uppercase' as const, letterSpacing: '1.2px' }}>💳 Тарифы</span>
        </div>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(28px,3.8vw,48px)', fontWeight: 800, textAlign: 'center', letterSpacing: -1.2, marginBottom: 12 }}>
          Прозрачные <span style={{ background: 'linear-gradient(135deg,#fff,#f4a623,#e63946)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>цены</span>
        </h2>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', textAlign: 'center', maxWidth: 560, margin: '0 auto 36px' }}>Начни бесплатно. Переходи на платный когда вырастешь.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {plans.map(p => (
            <div key={p.name} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${p.featured ? '#e63946' : 'rgba(255,255,255,0.07)'}`, borderRadius: 22, padding: '30px 24px', position: 'relative', boxShadow: p.featured ? '0 0 50px rgba(230,57,70,0.15)' : 'none', transition: 'transform 0.3s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}>
              {p.featured && <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg,#e63946,#c0392b)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 14px', borderRadius: 100, whiteSpace: 'nowrap' }}>🔥 Популярный</div>}
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 12 }}>{p.name}</div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 42, fontWeight: 800, marginBottom: 6, lineHeight: 1 }}>{p.price}<span style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>/мес</span></div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 20 }}>{p.desc}</div>
              <ul style={{ listStyle: 'none', marginBottom: 24 }}>
                {p.features.map(f => <li key={f} style={{ fontSize: 13, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: '#e63946', fontWeight: 700, flexShrink: 0 }}>✓</span>{f}</li>)}
              </ul>
              <button onClick={onStart} style={{ width: '100%', padding: 12, borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'all 0.3s ease', border: p.featured ? 'none' : '1px solid rgba(255,255,255,0.1)', background: p.featured ? 'linear-gradient(135deg,#e63946,#c0392b)' : 'transparent', color: p.featured ? '#fff' : '#f5f5f5', boxShadow: p.featured ? '0 0 25px rgba(230,57,70,0.35)' : 'none' }}>
                {p.name === 'Free' ? 'Начать бесплатно' : p.name === 'Pro' ? 'Выбрать Pro' : 'Связаться'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ─── FAQ ──────────────────────────────────────────────────────────────────────
const FaqSection = () => {
  const [open, setOpen] = useState<number | null>(null);
  const faqs = [
    { q: 'Это легально? Не заблокируют мой аккаунт?', a: 'Парсинг публичных каналов — обычное чтение информации. Мы используем официальное Telegram API и соблюдаем лимиты. При разумном интервале (от 1 часа) риск минимален.' },
    { q: 'Нужно оставлять компьютер включённым?', a: 'Нет! GhostPost работает на наших серверах 24/7. После настройки система работает сама в облаке.' },
    { q: 'Что такое API ID и API Hash?', a: 'Ключи доступа к Telegram API — нужны чтобы система работала от имени твоего аккаунта. Получить бесплатно на my.telegram.org за 2 минуты. Внутри есть пошаговая инструкция.' },
    { q: 'Мои данные в безопасности?', a: 'API Hash хранится в зашифрованном виде (Fernet). Мы не имеем доступа к вашим сообщениям и не передаём данные третьим лицам.' },
    { q: 'Можно использовать для интернет-магазина?', a: 'Да! Модуль «Интернет магазин» специально для этого. Копирует товары, переписывает описание, добавляет наценку и публикует с фотографиями.' },
  ];
  return (
    <section id="faq" style={{ padding: '35px 0 55px', position: 'relative', zIndex: 1 }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <span style={{ display: 'inline-flex', background: 'rgba(244,166,35,0.12)', border: '1px solid rgba(244,166,35,0.25)', color: '#f4a623', fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 100, textTransform: 'uppercase' as const, letterSpacing: '1.2px' }}>❓ Вопросы</span>
        </div>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(28px,3.8vw,48px)', fontWeight: 800, textAlign: 'center', letterSpacing: -1.2, marginBottom: 36 }}>
          Частые <span style={{ background: 'linear-gradient(135deg,#fff,#f4a623,#e63946)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>вопросы</span>
        </h2>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {faqs.map((f, i) => (
            <div key={i} style={{ border: `1px solid ${open === i ? 'rgba(230,57,70,0.3)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 16, marginBottom: 12, overflow: 'hidden', transition: 'border-color 0.3s' }}>
              <div onClick={() => setOpen(open === i ? null : i)} style={{ padding: '18px 22px', fontSize: 15, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                {f.q}
                <span style={{ color: '#e63946', fontSize: 20, transition: 'transform 0.3s', transform: open === i ? 'rotate(45deg)' : 'rotate(0)' }}>+</span>
              </div>
              {open === i && <div style={{ padding: '0 22px 18px', color: 'rgba(255,255,255,0.45)', fontSize: 14, lineHeight: 1.65 }}>{f.a}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ─── CTA ──────────────────────────────────────────────────────────────────────
const CtaSection = ({ onStart }: { onStart: () => void }) => (
  <section style={{ padding: '35px 0 70px', position: 'relative', zIndex: 1 }}>
    <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px' }}>
      <div style={{ background: 'linear-gradient(135deg,rgba(230,57,70,0.12),rgba(124,58,237,0.08))', border: '1px solid rgba(230,57,70,0.25)', borderRadius: 28, padding: '48px 32px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '60%', height: 1, background: 'linear-gradient(90deg,transparent,#e63946,#f4a623,#e63946,transparent)' }} />
        
        {/* 🎬 3D ВИДЕО НА САМОМ ВЕРХУ CTA */}
        <SectionVideoShowcase
          src="/cta_video.mp4"
          altSrc="/public/cta_video.mp4"
          posterGlow="linear-gradient(135deg, #e63946, #c0392b)"
          badge="🚀 3D Запуск: Мгновенный старт 24/7"
          maxWidth={720}
        />

        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(28px,3.8vw,48px)', fontWeight: 800, marginBottom: 12, letterSpacing: -1.2 }}>
          Готов запустить{' '}
          <span style={{ background: 'linear-gradient(135deg,#fff,#f4a623,#e63946)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>канал на автопилоте?</span>
        </h2>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', marginBottom: 28 }}>Зарегистрируйся за 2 минуты и получи 7 дней Pro бесплатно</p>

        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={onStart} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'linear-gradient(135deg,#e63946,#c0392b)', color: '#fff', fontWeight: 700, fontSize: 15, padding: '14px 36px', borderRadius: 12, border: 'none', cursor: 'pointer', boxShadow: '0 0 25px rgba(230,57,70,0.35)', transition: 'all 0.3s' }}>🚀 Начать — 7 дней Pro бесплатно</button>
        </div>
      </div>
    </div>
  </section>
);

// ─── MAIN LANDING PAGE ────────────────────────────────────────────────────────
export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const goToRegister = () => navigate('/register');
  const goToLogin = () => navigate('/login');

  return (
    <div style={{ background: '#090909', color: '#f5f5f5', fontFamily: "'Inter', sans-serif", minHeight: '100vh' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@700;800&display=swap');
        @keyframes orbFloat { 0%,100% { transform:translate(0,0) scale(1); } 33% { transform:translate(30px,-20px) scale(1.05); } 66% { transform:translate(-20px,30px) scale(0.97); } }
        @keyframes tickerScroll { 0% { transform:translateX(0); } 100% { transform:translateX(-50%); } }
        @keyframes ringPulse { 0%,100% { opacity:0.5; transform:scale(1); } 50% { opacity:1; transform:scale(1.01); } }
        @keyframes fbFloat { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-8px); } }
        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-track { background:#0f0f0f; }
        ::-webkit-scrollbar-thumb { background:#e63946; border-radius:3px; }
      `}</style>

      <BgEffects />

      {/* NAV */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        padding: isMobile ? '12px 0' : '16px 0',
        background: scrolled ? 'rgba(9,9,9,0.97)' : 'rgba(9,9,9,0.8)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        transition: 'background 0.3s'
      }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Space Grotesk',sans-serif", fontSize: isMobile ? 18 : 22, fontWeight: 800 }}>
            <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, background: 'linear-gradient(135deg,#e63946,#c0392b)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? 16 : 18, boxShadow: '0 0 20px rgba(230,57,70,0.35)' }}>👻</div>
            Ghost<span style={{ color: '#e63946' }}>Post</span>
          </div>
          {!isMobile && (
            <ul style={{ display: 'flex', alignItems: 'center', gap: 32, listStyle: 'none' }}>
              {[['#how','Как работает'],['#modules','Модули'],['#pricing','Тарифы'],['#faq','FAQ']].map(([href,label]) => (
                <li key={href}><a href={href} style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: 500, textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e=>(e.currentTarget.style.color='#f5f5f5')} onMouseLeave={e=>(e.currentTarget.style.color='rgba(255,255,255,0.45)')}>{label}</a></li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!isMobile && (
              <button onClick={goToLogin} style={{ background: 'transparent', color: '#f5f5f5', fontWeight: 600, fontSize: 14, padding: '10px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', transition: 'all 0.2s' }}>Войти</button>
            )}
            <button onClick={goToRegister} style={{ background: 'linear-gradient(135deg,#e63946,#c0392b)', color: '#fff', fontWeight: 700, fontSize: isMobile ? 12 : 14, padding: isMobile ? '8px 14px' : '10px 22px', borderRadius: 100, border: 'none', cursor: 'pointer', boxShadow: '0 0 20px rgba(230,57,70,0.35)', transition: 'all 0.2s' }}>🚀 Начать</button>
          </div>
        </div>
      </nav>

      <HeroSection onStart={goToRegister} isMobile={isMobile} />
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px' }}><Ticker /></div>
      <HowSection />
      <FeaturesSection />
      <ModulesSection />
      <PricingSection onStart={goToRegister} />
      <FaqSection />
      <CtaSection onStart={goToRegister} />

      {/* Footer */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '48px 0' }}>
        <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 800 }}>
            <div style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#e63946,#c0392b)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>👻</div>
            Ghost<span style={{ color: '#e63946' }}>Post</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>© 2025 GhostPost. Все права защищены.</div>
          <div style={{ display: 'flex', gap: 24 }}>
            {['Конфиденциальность','Условия','Поддержка'].map(l => <a key={l} href="#" style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14, textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e=>(e.currentTarget.style.color='#e63946')} onMouseLeave={e=>(e.currentTarget.style.color='rgba(255,255,255,0.35)')}>{l}</a>)}
          </div>
        </div>
      </footer>
    </div>
  );
};
