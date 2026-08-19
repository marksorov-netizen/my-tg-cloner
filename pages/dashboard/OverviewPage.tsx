import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AppConfig, SystemStats } from '../../types';
import { Zap, Activity, AlertTriangle, Layers, ShoppingBag, Sparkles, ArrowRight, Play, CheckCircle2 } from 'lucide-react';
import { ActionHistoryPanel } from '../../components/ActionHistoryPanel';
import { getActionHistory } from '../../services/actionHistory';
import { loadUserSavedConfig } from '../../services/userConfig';
import { taskExecutionService } from '../../services/taskExecutionService';

interface OverviewPageProps {
  config: AppConfig;
  stats: SystemStats;
  onToggleService: () => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ config, stats, onToggleService }) => {
  const navigate = useNavigate();
  const isAuth = config.telegramAuth.step === 'AUTHENTICATED';

  // Dynamic live statistics calculation
  const history = getActionHistory();
  const publishedCount = history.filter(h => h.type === 'success').length;
  const userCfg = loadUserSavedConfig();

  const totalDonors = new Set([...userCfg.storeDonors, ...userCfg.parserDonors]).size;
  const totalTargets = new Set([...userCfg.storeTargets, ...userCfg.parserTargets]).size;

  const isStoreActive = taskExecutionService.getStoreState().isProcessing;
  const isParserActive = taskExecutionService.getParserState().isProcessing;
  const isAnyActive = stats.isServiceRunning || isStoreActive || isParserActive;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Banner if not authenticated */}
      {!isAuth && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(230,57,70,0.15), rgba(244,166,35,0.1))',
          border: '1px solid rgba(230,57,70,0.3)',
          borderRadius: 20, padding: '20px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, background: 'rgba(230,57,70,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e63946'
            }}>
              <AlertTriangle size={24} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Telegram аккаунт не подключён</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                Для реального парсинга и автопостинга необходимо войти через Telegram API ID.
              </div>
            </div>
          </div>
          <button
            onClick={() => navigate('/login')}
            style={{
              background: 'linear-gradient(135deg, #e63946, #c0392b)',
              color: '#fff', fontWeight: 700, fontSize: 14,
              padding: '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              boxShadow: '0 0 20px rgba(230,57,70,0.3)', display: 'flex', alignItems: 'center', gap: 8
            }}
          >
            Подключить <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Dynamic Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
        {[
          { label: 'Опубликовано постов', val: publishedCount, icon: Zap, color: '#10b981' },
          { label: 'Активных доноров', val: totalDonors, icon: Activity, color: '#f4a623' },
          { label: 'Моих каналов', val: totalTargets, icon: Layers, color: '#e63946' },
          { label: 'Статус парсинга', val: isAnyActive ? '🟢 Запущен' : '⏹ Остановлен', icon: Play, color: isAnyActive ? '#10b981' : 'rgba(255,255,255,0.4)' },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 20, padding: 20,
              display: 'flex', flexDirection: 'column', gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{card.label}</span>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: card.color }}>
                  <Icon size={18} />
                </div>
              </div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 800, color: '#fff' }}>
                {card.val}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Modules Quick Access */}
      <div style={{ marginTop: 8 }}>
        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 16, color: '#fff' }}>
          Рабочие модули
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {/* Module 1 */}
          <div
            onClick={() => navigate('/dashboard/parser')}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20, padding: 24, cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(230,57,70,0.4)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(230,57,70,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 16 }}>
              📰
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#fff' }}>1. Парсер ТГ каналов</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: 16 }}>
              Мониторинг новостных/тематических каналов, рерайт постов под ваш стиль и публикация.
            </div>
            <div style={{ fontSize: 13, color: '#e63946', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              Открыть парсер <ArrowRight size={14} />
            </div>
          </div>

          {/* Module 2 */}
          <div
            onClick={() => navigate('/dashboard/store')}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20, padding: 24, cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(244,166,35,0.4)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(244,166,35,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 16 }}>
              🛒
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#fff' }}>2. Интернет магазин</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: 16 }}>
              Копирование товаров с каналов-доноров, автоматическая наценка %, очистка рекламы.
            </div>
            <div style={{ fontSize: 13, color: '#f4a623', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              Открыть магазин <ArrowRight size={14} />
            </div>
          </div>

          {/* Module 3 */}
          <div
            onClick={() => navigate('/dashboard/prompt')}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20, padding: 24, cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(124,58,237,0.4)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.08)';
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 16 }}>
              ✍️
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#fff' }}>3. Промт-инжиниринг</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: 16 }}>
              Конструктор идеального стиля для AI, библиотека готовых шаблонов и тестирование.
            </div>
            <div style={{ fontSize: 13, color: '#a78bfa', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              Конструктор промтов <ArrowRight size={14} />
            </div>
          </div>
        </div>
      </div>

      {/* Control Box */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20, padding: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Автоматический режим мониторинга</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
            {stats.isServiceRunning ? '🟢 Служба активно проверяет доноры каждые X минут' : '🔴 Автоматический сервис остановлен'}
          </div>
        </div>
        <button
          onClick={onToggleService}
          style={{
            padding: '12px 24px', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer',
            background: stats.isServiceRunning ? 'rgba(230,57,70,0.2)' : 'linear-gradient(135deg, #10b981, #059669)',
            color: stats.isServiceRunning ? '#e63946' : '#fff',
            border: stats.isServiceRunning ? '1px solid rgba(230,57,70,0.4)' : 'none',
            boxShadow: stats.isServiceRunning ? 'none' : '0 0 20px rgba(16,185,129,0.3)',
            display: 'flex', alignItems: 'center', gap: 8
          }}
        >
          {stats.isServiceRunning ? '⏹ Остановить службу' : '▶ Запустить автопилот'}
        </button>
      </div>

      {/* PERSISTENT ACTION HISTORY PANEL */}
      <ActionHistoryPanel />
    </div>
  );
};
