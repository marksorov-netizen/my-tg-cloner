import React, { useState, useEffect, useRef } from 'react';
import { AppConfig } from '../../types';
import { Plus, Trash2, Play, Square, Sparkles, Layers, Lock, Loader2, Radio, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../../services/apiService';
import { processSinglePost } from '../../services/postProcessor';
import { ActionHistoryPanel } from '../../components/ActionHistoryPanel';
import { IntervalSelector } from '../../components/IntervalSelector';
import { taskExecutionService, ActiveTaskState } from '../../services/taskExecutionService';

import { loadUserSavedConfig, saveUserSavedConfig } from '../../services/userConfig';

interface ParserPageProps {
  config: AppConfig;
  setConfig: (c: AppConfig) => void;
}

export const ParserPage: React.FC<ParserPageProps> = ({ config, setConfig }) => {
  const navigate = useNavigate();
  const isAuth = config.telegramAuth.step === 'AUTHENTICATED';

  // Saved user config from localStorage
  const savedCfg = loadUserSavedConfig();

  // Global persistent state from taskExecutionService
  const [taskState, setTaskState] = useState<ActiveTaskState>(taskExecutionService.getParserState());

  // Multi-donor & Multi-Target channels (up to 3 destination channels simultaneously)
  const [donors, setDonors] = useState<string[]>(savedCfg.parserDonors.length ? savedCfg.parserDonors : ['@breakingnews_ru']);
  const [newDonor, setNewDonor] = useState('');

  const [targetChannels, setTargetChannels] = useState<string[]>(savedCfg.parserTargets.length ? savedCfg.parserTargets : ['@my_channel']);
  const [newTarget, setNewTarget] = useState('');
  
  // Prompt settings
  const [promptText, setPromptText] = useState(savedCfg.parserPrompt);
  
  // Batch & Interval settings
  const [copyCount, setCopyCount] = useState<number>(savedCfg.copyCount || 100);
  const [intervalMinutes, setIntervalMinutes] = useState<number>(savedCfg.intervalMinutes || 15);

  // HYBRID MODE: Enable Live Monitoring after Batch Copy
  const [enableLiveMonitoringAfterBatch, setEnableLiveMonitoringAfterBatch] = useState<boolean>(true);

  // Cancel ref for instant loop termination
  const cancelRef = useRef(false);

  // Subscribe to task execution service updates so state persists across tab switches
  useEffect(() => {
    const unsubscribe = taskExecutionService.subscribe(() => {
      setTaskState(taskExecutionService.getParserState());
    });
    return unsubscribe;
  }, []);

  const cleanChannel = (input: string): string => {
    let s = input.trim();
    if (s.startsWith('@http://') || s.startsWith('@https://') || s.startsWith('@t.me/')) s = s.slice(1);
    if (s.includes('t.me/')) {
      const parts = s.split('t.me/').pop()?.split('/')[0].split('?')[0];
      if (parts && !parts.startsWith('+') && !parts.startsWith('joinchat/')) return `@${parts}`;
      return s;
    }
    if (!s.startsWith('@') && !s.startsWith('-')) return `@${s}`;
    return s;
  };

  const addDonor = () => {
    if (!newDonor.trim()) return;
    const clean = cleanChannel(newDonor);
    if (!donors.includes(clean)) {
      const updated = [...donors, clean];
      setDonors(updated);
      taskExecutionService.updateParserState({ donors: updated });
      saveUserSavedConfig({ parserDonors: updated });
    }
    setNewDonor('');
  };

  const removeDonor = (idx: number) => {
    const updated = donors.filter((_, i) => i !== idx);
    setDonors(updated);
    taskExecutionService.updateParserState({ donors: updated });
    saveUserSavedConfig({ parserDonors: updated });
  };

  const addTargetChannel = () => {
    if (!newTarget.trim()) return;
    if (targetChannels.length >= 3) {
      alert('Можно вести максимум 3 целевых канала одновременно');
      return;
    }
    const clean = cleanChannel(newTarget);
    if (!targetChannels.includes(clean)) {
      const updated = [...targetChannels, clean];
      setTargetChannels(updated);
      taskExecutionService.updateParserState({ targets: updated });
      saveUserSavedConfig({ parserTargets: updated });
    }
    setNewTarget('');
  };

  const removeTargetChannel = (idx: number) => {
    if (targetChannels.length <= 1) {
      alert('Укажите хотя бы один целевой канал');
      return;
    }
    const updated = targetChannels.filter((_, i) => i !== idx);
    setTargetChannels(updated);
    taskExecutionService.updateParserState({ targets: updated });
    saveUserSavedConfig({ parserTargets: updated });
  };

  // МГНОВЕННАЯ ОСТАНОВКА
  const stopImport = () => {
    cancelRef.current = true;
    taskExecutionService.stopParser();
    addActionLog('⏹ Остановка', 'Парсинг ТГ каналов остановлен вручную', 'stopped');
  };

  const formatCountdown = (totalSec: number): string => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h} ч ${m.toString().padStart(2, '0')} мин ${s.toString().padStart(2, '0')} сек`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartParser = async () => {
    if (!isAuth && !config.isSimulationMode) {
      alert('Сначала войдите в систему через Telegram!');
      navigate('/login');
      return;
    }

    if (donors.length === 0) {
      alert('Добавьте хотя бы один канал-донор');
      return;
    }

    if (targetChannels.length === 0) {
      alert('Укажите хотя бы один целевой канал для публикации');
      return;
    }

    cancelRef.current = false;
    taskExecutionService.startParserTask();

    const donorClean = cleanChannel(donors[0]);
    const targetCleanList = targetChannels.map(cleanChannel);

    taskExecutionService.updateParserState({
      donors: [donorClean],
      targets: targetCleanList,
      current: 0,
      total: copyCount,
      countdownSec: 0,
      statusMessage: `Загрузка ${copyCount} постов из канала-донора ${donorClean}...`,
      logs: []
    });

    addActionLog('📰 Запуск парсера', `Запрошено ${copyCount} постов из ${donorClean} ➔ ${targetCleanList.join(', ')}`, 'success');

    try {
      // 1. Fetch N messages from donor channel
      const messages = await apiService.fetchHistory(donorClean, copyCount);
      if (cancelRef.current || taskExecutionService.isParserCancelled()) return;

      if (!messages || messages.length === 0) {
        taskExecutionService.updateParserState({
          isProcessing: false,
          statusMessage: `Не удалось прочитать посты из ${donorClean}`
        });
        return;
      }

      taskExecutionService.updateParserState({
        total: messages.length,
        statusMessage: `Найдено ${messages.length} постов. Начинаем перенос в каналы: ${targetCleanList.join(', ')}...`
      });

      // 2. Sequential processing and publishing to ALL target channels
      for (let i = 0; i < messages.length; i++) {
        if (cancelRef.current || taskExecutionService.isParserCancelled()) break;

        const msg = messages[i];
        taskExecutionService.updateParserState({
          current: i + 1,
          countdownSec: 0,
          statusMessage: `Обработка поста ${i + 1} из ${messages.length} — AI рерайт по промту...`
        });

        if (cancelRef.current || taskExecutionService.isParserCancelled()) break;

        // AI Rewrite
        const result = await processSinglePost(msg.text, {
          ...config,
          useAI: true,
          removeLinks: true,
          sourceUrl: donorClean,
          destinationChannel: targetCleanList[0]
        }, false);

        if (cancelRef.current || taskExecutionService.isParserCancelled()) break;

        // REAL POSTING TO ALL TARGET CHANNELS SIMULTANEOUSLY
        let lastMediaCount = 0;
        let isSkipped = false;

        for (const target of targetCleanList) {
          if (cancelRef.current || taskExecutionService.isParserCancelled()) break;
          taskExecutionService.updateParserState({
            statusMessage: `Публикация поста ${i + 1} в канал ${target}...`
          });

          const sendRes: any = await apiService.sendPost(target, result.processedContent, donorClean, msg.id, true);
          if (sendRes && sendRes.status === 'skipped') {
            isSkipped = true;
          } else if (sendRes) {
            lastMediaCount = sendRes.media_count || (sendRes.has_media ? 1 : 0);
          }
        }

        if (cancelRef.current || taskExecutionService.isParserCancelled()) break;

        const currentLogs = taskExecutionService.getParserState().logs;

        if (isSkipped) {
          taskExecutionService.updateParserState({
            logs: [
              {
                id: msg.id,
                title: `Пост #${i + 1}`,
                text: msg.text,
                status: 'skipped_duplicate',
                detail: 'Пропущен (дубликат)',
                time: new Date().toLocaleTimeString()
              },
              ...currentLogs
            ]
          });
          addActionLog('🛡️ Дубликат', `Пост #${i + 1} пропущен (уже выкладывался)`, 'warning');
          continue;
        }

        taskExecutionService.updateParserState({
          logs: [
            {
              id: msg.id,
              title: `Пост #${i + 1}`,
              original: msg.text,
              processed: result.processedContent,
              mediaCount: lastMediaCount,
              time: new Date().toLocaleTimeString(),
              status: 'published'
            },
            ...currentLogs
          ]
        });
        addActionLog('✅ Опубликовано', `Пост #${i + 1} выложен в ${targetCleanList.join(', ')}`, 'success');

        // Interval delay countdown (with instant abort check!)
        if (intervalMinutes > 0 && i < messages.length - 1) {
          const totalWaitSec = intervalMinutes * 60;
          for (let sec = totalWaitSec; sec > 0; sec--) {
            if (cancelRef.current || taskExecutionService.isParserCancelled()) break;
            taskExecutionService.updateParserState({
              current: i + 1,
              countdownSec: sec,
              statusMessage: `Опубликовано ${i + 1}/${messages.length}. Пауза до следующего поста: ${formatCountdown(sec)}`
            });
            await new Promise(r => setTimeout(r, 1000));
          }
        }
        if (cancelRef.current || taskExecutionService.isParserCancelled()) break;
      }

      // 3. HYBRID TRANSITION TO LIVE MONITORING
      if (!cancelRef.current && !taskExecutionService.isParserCancelled() && enableLiveMonitoringAfterBatch) {
        taskExecutionService.updateParserState({
          isLiveMonitoring: true,
          countdownSec: 0,
          statusMessage: `✅ Пакетный импорт ${messages.length} постов завершён! Включён ЖИВОЙ АВТО-МОНИТОРИНГ для ${targetCleanList.length} каналов...`
        });
        addActionLog('🔴 Живой мониторинг', `Система отслеживает новые посты в ${donorClean}`, 'success');
      } else if (!cancelRef.current && !taskExecutionService.isParserCancelled()) {
        taskExecutionService.updateParserState({
          isProcessing: false,
          countdownSec: 0,
          statusMessage: `🎉 Все ${messages.length} постов успешно скопированы в ${targetCleanList.join(', ')}!`
        });
        addActionLog('🎉 Завершено', `Парсинг ${messages.length} постов завершён`, 'success');
      }
    } catch (e: any) {
      if (!cancelRef.current && !taskExecutionService.isParserCancelled()) {
        taskExecutionService.updateParserState({
          isProcessing: false,
          statusMessage: `Ошибка: ${e.message}`
        });
        addActionLog('❌ Ошибка', e.message, 'error');
      }
    } finally {
      if (!enableLiveMonitoringAfterBatch || cancelRef.current || taskExecutionService.isParserCancelled()) {
        taskExecutionService.updateParserState({ isProcessing: false, countdownSec: 0 });
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(230,57,70,0.12), rgba(15,15,15,0.95))',
        border: '1px solid rgba(230,57,70,0.25)',
        borderRadius: 24, padding: 32
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(230,57,70,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
            📰
          </div>
          <div>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 800, color: '#fff' }}>
              Раздел: Парсер ТГ каналов по промту (Мульти-канальный режим)
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 2 }}>
              Ведение до 3-х целевых каналов одновременно по одному API ID. Перенос N новостей с интервалом и переход в авто-мониторинг.
            </p>
          </div>
        </div>
      </div>

      {!isAuth && (
        <div style={{
          background: 'rgba(244,166,35,0.1)', border: '1px solid rgba(244,166,35,0.3)',
          borderRadius: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 12, color: '#f4a623', fontSize: 14
        }}>
          <Lock size={18} />
          <span>Для запуска парсера необходимо подключить Telegram аккаунт.</span>
          <button onClick={() => navigate('/login')} style={{ marginLeft: 'auto', background: '#f4a623', color: '#000', fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>
            Войти
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 20 }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Donors */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              🎯 Каналы-доноры (откуда брать посты)
            </h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                value={newDonor}
                onChange={e => setNewDonor(e.target.value)}
                placeholder="@username_donora или ссылка"
                onKeyDown={e => e.key === 'Enter' && addDonor()}
                style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
              />
              <button onClick={addDonor} style={{ background: 'rgba(230,57,70,0.2)', border: '1px solid rgba(230,57,70,0.4)', color: '#e63946', borderRadius: 12, padding: '0 16px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Plus size={16} /> Добавить
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {donors.map((d, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '10px 14px', fontSize: 14 }}>
                  <span style={{ color: '#fff', fontWeight: 600 }}>{d}</span>
                  <button onClick={() => removeDonor(idx)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* MULTI-TARGET CHANNELS (UP TO 3 CHANNELS SIMULTANEOUSLY) */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
              📢 Целевые каналы для публикации (до 3-х одновременно)
            </h3>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 14 }}>
              Каждая новость будет одновременно публиковаться во все добавленные каналы.
            </p>

            {targetChannels.length < 3 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input
                  type="text"
                  value={newTarget}
                  onChange={e => setNewTarget(e.target.value)}
                  placeholder="@my_channel_2"
                  onKeyDown={e => e.key === 'Enter' && addTargetChannel()}
                  style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
                />
                <button onClick={addTargetChannel} style={{ background: 'rgba(230,57,70,0.2)', border: '1px solid rgba(230,57,70,0.4)', color: '#e63946', borderRadius: 12, padding: '0 16px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={16} /> Канал
                </button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {targetChannels.map((t, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(230,57,70,0.2)', borderRadius: 12, padding: '10px 14px', fontSize: 14 }}>
                  <span style={{ color: '#e63946', fontWeight: 700 }}>Канал #{idx + 1}: {t}</span>
                  {targetChannels.length > 1 && (
                    <button onClick={() => removeTargetChannel(idx)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Prompt */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={18} color="#e63946" /> Промт для AI-рерайта
            </h3>
            <textarea
              rows={4}
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              placeholder="Опишите желаемый стиль переписывания..."
              style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 14, color: '#fff', fontSize: 14, outline: 'none', lineHeight: 1.6, resize: 'vertical' }}
            />
          </div>

          {/* Batch & Interval & Hybrid Checkbox */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={18} color="#e63946" /> Параметры переноса и интервал
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  📰 Сколько постов скопировать
                </label>
                <select
                  value={copyCount}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setCopyCount(val);
                    saveUserSavedConfig({ copyCount: val });
                  }}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 10, color: '#fff', fontSize: 14 }}
                >
                  <option value={5}>5 постов</option>
                  <option value={10}>10 постов</option>
                  <option value={20}>20 постов</option>
                  <option value={50}>50 постов</option>
                  <option value={100}>100 постов</option>
                  <option value={200}>200 постов</option>
                </select>
              </div>

              {/* Настраиваемый интервал с ручным вводом и пресетами */}
              <IntervalSelector
                value={intervalMinutes}
                onChange={val => {
                  setIntervalMinutes(val);
                  saveUserSavedConfig({ intervalMinutes: val });
                }}
                accentColor="#e63946"
              />
            </div>

            {/* HYBRID CHECKBOX */}
            <div style={{
              background: 'rgba(230,57,70,0.08)', border: '1px solid rgba(230,57,70,0.25)',
              borderRadius: 14, padding: 14
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={enableLiveMonitoringAfterBatch}
                  onChange={e => setEnableLiveMonitoringAfterBatch(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#e63946' }}
                />
                <span>🔴 После публикации {copyCount} постов переключиться в режим ЖИВОГО МОНИТОРИНГА НОВЫХ ПОСТОВ</span>
              </label>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 12 }}>
            {taskState.isProcessing ? (
              <button
                onClick={stopImport}
                style={{
                  width: '100%', padding: 14, borderRadius: 12,
                  background: 'rgba(230,57,70,0.2)', border: '1px solid rgba(230,57,70,0.4)',
                  color: '#e63946', fontWeight: 800, fontSize: 15, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                }}
              >
                <Square size={18} fill="currentColor" /> Остановить мгновенно
              </button>
            ) : (
              <button
                onClick={handleStartParser}
                style={{
                  width: '100%', padding: 14, borderRadius: 12,
                  background: 'linear-gradient(135deg, #e63946, #c0392b)',
                  color: '#fff', fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer',
                  boxShadow: '0 0 30px rgba(230,57,70,0.35)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                }}
              >
                <Play size={18} /> Запустить на {targetChannels.length} {targetChannels.length === 1 ? 'канал' : 'канала'} ({copyCount} постов {enableLiveMonitoringAfterBatch ? '+ Мониторинг' : ''})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Progress & Live Log & Prominent Countdown Timer Widget */}
      {taskState.statusMessage && (
        <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: taskState.isLiveMonitoring ? '#10b981' : '#e63946', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            {taskState.isProcessing && !taskState.isLiveMonitoring && <Loader2 className="animate-spin" size={18} />}
            {taskState.isLiveMonitoring && <Radio className="animate-pulse" size={18} color="#10b981" />}
            {taskState.statusMessage}
          </div>

          {/* LIVE COUNTDOWN TIMER BADGE */}
          {taskState.countdownSec > 0 && (
            <div style={{
              background: 'rgba(230,57,70,0.12)', border: '1px solid rgba(230,57,70,0.3)',
              borderRadius: 14, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 16
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#e63946', fontWeight: 700, fontSize: 14 }}>
                <Clock className="animate-spin" size={18} />
                <span>Ожидание следующей публикации в каналы...</span>
              </div>
              <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 20, fontWeight: 800, color: '#e63946' }}>
                ⏳ {formatCountdown(taskState.countdownSec)}
              </div>
            </div>
          )}

          {taskState.total > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', background: '#e63946', width: `${(taskState.current / taskState.total) * 100}%`, transition: 'width 0.3s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                <span>Опубликовано: {taskState.current} из {taskState.total} постов</span>
                <span>Целевых каналов: {targetChannels.length}</span>
              </div>
            </div>
          )}

          {taskState.logs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflowY: 'auto' }}>
              {taskState.logs.map((log, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.03)', padding: 14, borderRadius: 12, fontSize: 13, borderLeft: '4px solid #10b981' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#fff', fontWeight: 700 }}>{log.title}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{log.time}</span>
                  </div>
                  {log.processed && (
                    <div style={{ color: 'rgba(255,255,255,0.7)', whiteSpace: 'pre-wrap', lineHeight: 1.5, marginTop: 4 }}>
                      {log.processed}
                    </div>
                  )}
                  {log.status === 'skipped_duplicate' && (
                    <div style={{ color: '#e63946', fontSize: 12 }}>🛡️ Пропущен (дубликат: {log.detail})</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PERSISTENT ACTION HISTORY PANEL */}
      <ActionHistoryPanel />
    </div>
  );
};
