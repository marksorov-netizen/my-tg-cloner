import React, { useState, useEffect, useRef } from 'react';
import { AppConfig } from '../../types';
import { ShoppingBag, Plus, Trash2, DollarSign, Play, Square, Loader2, Lock, Sparkles, Layers, Radio, Clock, CheckCircle2, Smartphone, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiService } from '../../services/apiService';
import { processSinglePost } from '../../services/postProcessor';
import { addActionLog } from '../../services/actionHistory';
import { ActionHistoryPanel } from '../../components/ActionHistoryPanel';
import { IntervalSelector } from '../../components/IntervalSelector';
import { taskExecutionService, ActiveTaskState } from '../../services/taskExecutionService';
import { loadUserSavedConfig, saveUserSavedConfig } from '../../services/userConfig';
import { MiniAppShowcaseModal } from '../../components/MiniAppShowcaseModal';

interface StorePageProps {
  config: AppConfig;
  setConfig: (c: AppConfig) => void;
}

export const StorePage: React.FC<StorePageProps> = ({ config, setConfig }) => {
  const navigate = useNavigate();
  const isAuth = config.telegramAuth.step === 'AUTHENTICATED';

  // Saved user config from localStorage
  const savedCfg = loadUserSavedConfig();

  // Global persistent state from taskExecutionService
  const [taskState, setTaskState] = useState<ActiveTaskState>(taskExecutionService.getStoreState());

  // Multi-donor and Multi-Target channels (up to 3 destination channels simultaneously)
  const [donors, setDonors] = useState<string[]>(savedCfg.storeDonors.length ? savedCfg.storeDonors : ['@somoniyon1998']);
  const [newDonor, setNewDonor] = useState('');
  
  const [targetChannels, setTargetChannels] = useState<string[]>(savedCfg.storeTargets.length ? savedCfg.storeTargets : ['@my_store']);
  const [newTarget, setNewTarget] = useState('');

  // AI Prompt for Store
  const [promptRules, setPromptRules] = useState(savedCfg.storePrompt);

  // Pricing markups
  const [priceMode, setPriceMode] = useState<'single' | 'opt_retail' | 'three_tier'>(savedCfg.priceMode || 'single');
  const [singleMarkupPct, setSingleMarkupPct] = useState(savedCfg.singleMarkupPct !== undefined ? savedCfg.singleMarkupPct : 30);
  const [wholesalePct, setWholesalePct] = useState(savedCfg.wholesalePct !== undefined ? savedCfg.wholesalePct : 10);
  const [dropPct, setDropPct] = useState(savedCfg.dropPct !== undefined ? savedCfg.dropPct : 20);
  const [retailPct, setRetailPct] = useState(savedCfg.retailPct !== undefined ? savedCfg.retailPct : 30);
  const [currency, setCurrency] = useState(config.pricing.currencySymbol || '₽');

  // Batch & Interval settings
  const [copyCount, setCopyCount] = useState<number>(savedCfg.copyCount || 100);
  const [intervalMinutes, setIntervalMinutes] = useState<number>(savedCfg.intervalMinutes || 15);
  
  // HYBRID MODE: Enable Live Monitoring after Batch Copy
  const [enableLiveMonitoringAfterBatch, setEnableLiveMonitoringAfterBatch] = useState<boolean>(true);

  // Toggles
  const [filterAds, setFilterAds] = useState(true);
  const [downloadPhotos, setDownloadPhotos] = useState(true);
  const [syncToMiniApp, setSyncToMiniApp] = useState(true);
  const [createArticles, setCreateArticles] = useState(true);
  const [articlePrefix, setArticlePrefix] = useState(savedCfg.articlePrefix || 'ART');
  const [isMiniAppModalOpen, setIsMiniAppModalOpen] = useState(false);


  // Cancel ref for instant loop termination
  const cancelRef = useRef(false);

  // Subscribe to task execution service updates so state persists across tab switches
  useEffect(() => {
    const unsubscribe = taskExecutionService.subscribe(() => {
      setTaskState(taskExecutionService.getStoreState());
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
      taskExecutionService.updateStoreState({ donors: updated });
      saveUserSavedConfig({ storeDonors: updated });
    }
    setNewDonor('');
  };

  const removeDonor = (idx: number) => {
    const updated = donors.filter((_, i) => i !== idx);
    setDonors(updated);
    taskExecutionService.updateStoreState({ donors: updated });
    saveUserSavedConfig({ storeDonors: updated });
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
      taskExecutionService.updateStoreState({ targets: updated });
      saveUserSavedConfig({ storeTargets: updated });
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
    taskExecutionService.updateStoreState({ targets: updated });
    saveUserSavedConfig({ storeTargets: updated });
  };

  // МГНОВЕННАЯ ОСТАНОВКА ИМПОРТА
  const stopImport = () => {
    cancelRef.current = true;
    taskExecutionService.stopStore();
    addActionLog('⏹ Остановка', 'Парсинг магазина остановлен пользователем', 'stopped');
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

  const handleStartStore = async () => {
    if (!isAuth && !config.isSimulationMode) {
      alert('Подключите Telegram аккаунт!');
      navigate('/login');
      return;
    }

    if (donors.length === 0) {
      alert('Укажите хотя бы один магазин-донор');
      return;
    }

    if (targetChannels.length === 0) {
      alert('Укажите хотя бы один целевой канал для публикации');
      return;
    }

    cancelRef.current = false;
    taskExecutionService.startStoreTask();

    const donorClean = cleanChannel(donors[0]);
    const targetCleanList = targetChannels.map(cleanChannel);

    taskExecutionService.updateStoreState({
      donors: [donorClean],
      targets: targetCleanList,
      current: 0,
      total: copyCount,
      countdownSec: 0,
      statusMessage: `Загрузка ${copyCount} товаров из канала ${donorClean}...`,
      logs: []
    });

    addActionLog('🛒 Запуск магазина', `Запрошено ${copyCount} постов из ${donorClean} ➔ ${targetCleanList.join(', ')}`, 'success');

    try {
      // 1. Fetch N messages from donor channel
      const messages = await apiService.fetchHistory(donorClean, copyCount);
      if (cancelRef.current || taskExecutionService.isStoreCancelled()) return;

      if (!messages || messages.length === 0) {
        taskExecutionService.updateStoreState({
          isProcessing: false,
          statusMessage: `Канал ${donorClean} пуст или не удалось прочитать посты.`
        });
        return;
      }

      taskExecutionService.updateStoreState({
        total: messages.length,
        statusMessage: `Найдено ${messages.length} товаров. Публикация в каналы: ${targetCleanList.join(', ')}...`
      });

      // 2. Sequential processing and publishing to ALL target channels
      for (let i = 0; i < messages.length; i++) {
        if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;

        const msg = messages[i];

        // Skip ads filter option
        if (filterAds && (msg.text.toLowerCase().includes('реклама') || msg.text.toLowerCase().includes('подпишись'))) {
          const currentLogs = taskExecutionService.getStoreState().logs;
          taskExecutionService.updateStoreState({
            logs: [{ title: `Товар #${i + 1}`, text: msg.text, status: 'skipped_ad' }, ...currentLogs]
          });
          continue;
        }

        taskExecutionService.updateStoreState({
          current: i + 1,
          countdownSec: 0,
          statusMessage: `Импорт товара ${i + 1} из ${messages.length} — AI рерайт и расчет цен...`
        });

        if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;

        // AI rewrite & price calculation
        const result = await processSinglePost(msg.text, {
          ...config,
          useAI: true,
          removeLinks: true,
          pricing: {
            mode: priceMode,
            singleMarkupPercent: singleMarkupPct,
            wholesalePercent: wholesalePct,
            dropPercent: dropPct,
            retailPercent: retailPct,
            currencySymbol: currency
          }
        }, false);

        if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;

        // ── ШАГ 1: Получаем конфиг бота (username для ссылки) ─────
        let botUsername = '';
        try {
          const botCfgRes = await fetch('/api/orderbot/config');
          if (botCfgRes.ok) {
            const botData = await botCfgRes.json();
            if (botData.config?.bot_username) {
              botUsername = botData.config.bot_username.replace('@', '');
            }
          }
        } catch (_) {}

        if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;

        // ── ШАГ 2: Создаём артикул ЗАРАНЕЕ (до отправки поста) ────
        let articleCode = '';
        if (createArticles) {
          try {
            const articleRes = await fetch('/api/articles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: result.processedContent.split('\n')[0]?.slice(0, 120) || `Товар #${i + 1}`,
                description: result.processedContent,
                original_text: msg.text,
                price: result.calculatedPrice ? `${result.calculatedPrice} ${currency}` : undefined,
                wholesale_price: result.wholesalePrice ? `${result.wholesalePrice} ${currency}` : undefined,
                drop_price: result.dropPrice ? `${result.dropPrice} ${currency}` : undefined,
                currency,
                source_channel: donorClean,
                target_channel: targetCleanList[0],
                category: 'Товар',
                article_prefix: articlePrefix || 'ART',
                source_msg_id: msg.id   // ← ID поста донора для загрузки фото ботом
              })
            });

            if (articleRes.ok) {
              const artData = await articleRes.json();
              articleCode = artData.article_code || '';
            }
          } catch (err) {
            console.error('Article creation error:', err);
          }
        }

        if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;

        // ── ШАГ 3: Дописываем артикул и скрытую кнопку-ссылку в текст поста ──────
        if (articleCode) {
          result.processedContent += `\n\n🏷️ **Артикул:** \`${articleCode}\``;
          if (botUsername) {
            result.processedContent += `\n👉 [🛒 Чтобы заказать — нажмите сюда](https://t.me/${botUsername}?start=${articleCode})`;
          }
          taskExecutionService.updateStoreState({
            statusMessage: `Товар ${i + 1}: артикул ${articleCode} присвоен, отправляю в канал...`
          });
        }

        if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;

        // ── ШАГ 4: ОТПРАВКА ВО ВСЕ ЦЕЛЕВЫЕ КАНАЛЫ ────────────────
        let lastMediaCount = 0;
        let isSkipped = false;

        for (const target of targetCleanList) {
          if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;
          taskExecutionService.updateStoreState({
            statusMessage: `Публикация товара ${i + 1} в канал ${target}...`
          });

          const sendRes: any = await apiService.sendPost(
            target,
            result.processedContent,
            donorClean,
            msg.id,
            downloadPhotos,
            articleCode || undefined,
            botUsername || undefined
          );
          
          if (sendRes && sendRes.status === 'skipped') {
            isSkipped = true;
            var skipDetail = sendRes.detail || 'Пропущен (дубликат)';
          } else if (sendRes) {
            lastMediaCount = sendRes.media_count || (sendRes.has_media ? 1 : 0);
          }
        }

        if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;

        const currentLogs = taskExecutionService.getStoreState().logs;

        if (isSkipped) {
          taskExecutionService.updateStoreState({
            logs: [
              {
                id: msg.id,
                title: `Товар #${i + 1}`,
                text: msg.text,
                status: 'skipped_duplicate',
                detail: skipDetail || 'Пропущен (дубликат 24ч)',
                time: new Date().toLocaleTimeString()
              },
              ...currentLogs
            ]
          });
          addActionLog('🛡️ Пропущен дубликат', `Товар #${i + 1}: ${skipDetail}`, 'warning');
          continue;
        }

        // ── ШАГ 5: Синхронизация с Mini App (после успешной публикации) ──
        if (syncToMiniApp) {
          fetch('/api/miniapp/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: result.processedContent.split('\n')[0] || `Товар #${i + 1}`,
              text: result.processedContent,
              price: result.calculatedPrice ? `${result.calculatedPrice} ${currency}` : undefined,
              source_channel: donorClean,
              target_channel: targetCleanList[0],
              category: 'Store'
            })
          }).catch(err => console.error('MiniApp sync error:', err));
        }

        taskExecutionService.updateStoreState({
          logs: [
            {
              id: msg.id,
              title: `Товар #${i + 1}`,
              original: msg.text,
              processed: result.processedContent,
              prices: result.calculatedPrices,
              mediaCount: lastMediaCount,
              status: 'published',
              time: new Date().toLocaleTimeString()
            },
            ...currentLogs
          ]
        });
        addActionLog('✅ Опубликовано', `Товар #${i + 1} выложен в ${targetCleanList.join(', ')}`, 'success');

        // Interval delay countdown (with instant abort check!)
        if (intervalMinutes > 0 && i < messages.length - 1) {
          const totalWaitSec = intervalMinutes * 60;
          for (let sec = totalWaitSec; sec > 0; sec--) {
            if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;
            taskExecutionService.updateStoreState({
              current: i + 1,
              countdownSec: sec,
              statusMessage: `Опубликовано ${i + 1}/${messages.length}. Пауза до следующего товара: ${formatCountdown(sec)}`
            });
            await new Promise(r => setTimeout(r, 1000));
          }
        }
        if (cancelRef.current || taskExecutionService.isStoreCancelled()) break;
      }

      // 3. HYBRID TRANSITION TO LIVE MONITORING
      if (!cancelRef.current && !taskExecutionService.isStoreCancelled() && enableLiveMonitoringAfterBatch) {
        taskExecutionService.updateStoreState({
          isLiveMonitoring: true,
          countdownSec: 0,
          statusMessage: `✅ Пакетный импорт ${messages.length} товаров завершён! Включён ЖИВОЙ АВТО-МОНИТОРИНГ для ${targetCleanList.length} каналов...`
        });
        addActionLog('🔴 Живой мониторинг', `Система отслеживает новые посты в ${donorClean}`, 'success');
      } else if (!cancelRef.current && !taskExecutionService.isStoreCancelled()) {
        taskExecutionService.updateStoreState({
          isProcessing: false,
          countdownSec: 0,
          statusMessage: `🎉 Все ${messages.length} товаров успешно выложены в ${targetCleanList.join(', ')}!`
        });
        addActionLog('🎉 Завершено', `Перенос ${messages.length} товаров завершён`, 'success');
      }
    } catch (e: any) {
      if (!cancelRef.current && !taskExecutionService.isStoreCancelled()) {
        taskExecutionService.updateStoreState({
          isProcessing: false,
          statusMessage: `Ошибка переноса: ${e.message}`
        });
        addActionLog('❌ Ошибка', e.message, 'error');
      }
    } finally {
      if (!enableLiveMonitoringAfterBatch || cancelRef.current || taskExecutionService.isStoreCancelled()) {
        taskExecutionService.updateStoreState({ isProcessing: false, countdownSec: 0 });
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(244,166,35,0.12), rgba(15,15,15,0.95))',
        border: '1px solid rgba(244,166,35,0.25)',
        borderRadius: 24, padding: 32
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(244,166,35,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
            🛒
          </div>
          <div>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 800, color: '#fff' }}>
              Раздел: Парсер интернет-магазинов (Мульти-канальный режим)
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 2 }}>
              Ведение до 3-х целевых каналов одновременно по одному API ID. Перенос N постов с интервалом и переход в авто-мониторинг.
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
          <span>Для автопубликации товаров подключите Telegram аккаунт.</span>
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
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 16 }}>
              🛍️ Магазин-донор (откуда копировать)
            </h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                value={newDonor}
                onChange={e => setNewDonor(e.target.value)}
                placeholder="@somoniyon1998 или ссылка"
                onKeyDown={e => e.key === 'Enter' && addDonor()}
                style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
              />
              <button onClick={addDonor} style={{ background: 'rgba(244,166,35,0.2)', border: '1px solid rgba(244,166,35,0.4)', color: '#f4a623', borderRadius: 12, padding: '0 16px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Plus size={16} /> Добавить
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {donors.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '10px 14px', fontSize: 14 }}>
                  <span style={{ color: '#fff', fontWeight: 600 }}>{d}</span>
                  <button onClick={() => removeDonor(i)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* MULTI-TARGET CHANNELS (UP TO 3 CHANNELS SIMULTANEOUSLY) */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
              📢 Мои каналы для публикации (до 3-х одновременно)
            </h3>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 14 }}>
              Каждый товар будет одновременно публиковаться во все добавленные каналы.
            </p>

            {targetChannels.length < 3 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input
                  type="text"
                  value={newTarget}
                  onChange={e => setNewTarget(e.target.value)}
                  placeholder="@my_store_2"
                  onKeyDown={e => e.key === 'Enter' && addTargetChannel()}
                  style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
                />
                <button onClick={addTargetChannel} style={{ background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', color: '#10b981', borderRadius: 12, padding: '0 16px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={16} /> Канал
                </button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {targetChannels.map((t, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '10px 14px', fontSize: 14 }}>
                  <span style={{ color: '#10b981', fontWeight: 700 }}>Канал #{idx + 1}: {t}</span>
                  {targetChannels.length > 1 && (
                    <button onClick={() => removeTargetChannel(idx)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* AI Prompt */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={18} color="#f4a623" /> Промт для AI-рерайта товара
            </h3>
            <textarea
              rows={4}
              value={promptRules}
              onChange={e => setPromptRules(e.target.value)}
              placeholder="Задайте стиль описания товара..."
              style={{ width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 14, color: '#fff', fontSize: 13, outline: 'none', lineHeight: 1.5, resize: 'vertical' }}
            />
          </div>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Pricing Markups */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <DollarSign size={18} color="#f4a623" /> Настройка наценки и цен
              </h3>
              <span style={{ fontSize: 12, color: '#f4a623', fontWeight: 700, background: 'rgba(244,166,35,0.12)', padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(244,166,35,0.3)' }}>
                {priceMode === 'single' ? `+${singleMarkupPct}% к рознице` : 'Прайс-лист'}
              </span>
            </div>

            {/* Mode Switcher */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, background: 'rgba(0,0,0,0.4)', padding: 4, borderRadius: 12, marginBottom: 16 }}>
              <button
                type="button"
                onClick={() => {
                  setPriceMode('single');
                  saveUserSavedConfig({ priceMode: 'single' });
                }}
                style={{
                  background: priceMode === 'single' ? '#f4a623' : 'transparent',
                  color: priceMode === 'single' ? '#000' : 'rgba(255,255,255,0.7)',
                  fontWeight: priceMode === 'single' ? 800 : 500,
                  fontSize: 12, padding: '8px 6px', borderRadius: 8, border: 'none', cursor: 'pointer', transition: 'all 0.15s'
                }}
              >
                💰 Единая цена
              </button>
              <button
                type="button"
                onClick={() => {
                  setPriceMode('opt_retail');
                  saveUserSavedConfig({ priceMode: 'opt_retail' });
                }}
                style={{
                  background: priceMode === 'opt_retail' ? '#f4a623' : 'transparent',
                  color: priceMode === 'opt_retail' ? '#000' : 'rgba(255,255,255,0.7)',
                  fontWeight: priceMode === 'opt_retail' ? 800 : 500,
                  fontSize: 12, padding: '8px 6px', borderRadius: 8, border: 'none', cursor: 'pointer', transition: 'all 0.15s'
                }}
              >
                🏷️ Опт + Розница
              </button>
              <button
                type="button"
                onClick={() => {
                  setPriceMode('three_tier');
                  saveUserSavedConfig({ priceMode: 'three_tier' });
                }}
                style={{
                  background: priceMode === 'three_tier' ? '#f4a623' : 'transparent',
                  color: priceMode === 'three_tier' ? '#000' : 'rgba(255,255,255,0.7)',
                  fontWeight: priceMode === 'three_tier' ? 800 : 500,
                  fontSize: 12, padding: '8px 6px', borderRadius: 8, border: 'none', cursor: 'pointer', transition: 'all 0.15s'
                }}
              >
                📊 3 уровня цен
              </button>
            </div>

            {/* SINGLE PRICE MODE (Рекомендуемый для обычного розничного магазина) */}
            {priceMode === 'single' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>
                      📈 Наценка к основной (рыночной) цене товара:
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="number" min={0} max={500}
                        value={singleMarkupPct}
                        onChange={e => {
                          const v = Number(e.target.value);
                          setSingleMarkupPct(v);
                          saveUserSavedConfig({ singleMarkupPct: v });
                        }}
                        style={{
                          width: 60, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(244,166,35,0.4)',
                          borderRadius: 8, padding: '4px 6px', color: '#f4a623', fontSize: 13, fontWeight: 800, textAlign: 'center', outline: 'none'
                        }}
                      />
                      <span style={{ color: '#f4a623', fontWeight: 700, fontSize: 13 }}>%</span>
                    </div>
                  </div>
                  <input
                    type="range" min="0" max="200" value={singleMarkupPct}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setSingleMarkupPct(v);
                      saveUserSavedConfig({ singleMarkupPct: v });
                    }}
                    style={{ width: '100%', accentColor: '#f4a623' }}
                  />
                  {/* Preset buttons */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {[0, 10, 20, 30, 40, 50, 70, 100].map(pct => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => {
                          setSingleMarkupPct(pct);
                          saveUserSavedConfig({ singleMarkupPct: pct });
                        }}
                        style={{
                          background: singleMarkupPct === pct ? 'rgba(244,166,35,0.25)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${singleMarkupPct === pct ? '#f4a623' : 'rgba(255,255,255,0.08)'}`,
                          color: singleMarkupPct === pct ? '#fff' : 'rgba(255,255,255,0.6)',
                          fontSize: 11, fontWeight: singleMarkupPct === pct ? 700 : 500,
                          padding: '3px 8px', borderRadius: 6, cursor: 'pointer'
                        }}
                      >
                        +{pct}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live Preview Calculation */}
                <div style={{ background: 'rgba(244,166,35,0.08)', border: '1px solid rgba(244,166,35,0.25)', borderRadius: 12, padding: 12, fontSize: 12 }}>
                  <div style={{ color: '#f4a623', fontWeight: 700, marginBottom: 4 }}>💡 Наглядный пример расчета:</div>
                  <div style={{ color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
                    Цена в канале-доноре: <b>2 400 ₽</b><br/>
                    Итоговая цена в вашем посте: <b style={{ color: '#10b981', fontSize: 14 }}>{Math.round(2400 * (1 + singleMarkupPct / 100))} ₽</b> (наценка +{singleMarkupPct}%)
                  </div>
                </div>
              </div>
            )}

            {/* OPT + RETAIL MODE */}
            {priceMode === 'opt_retail' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>📦 Наценка Опт (+{wholesalePct}%)</label>
                    <span style={{ color: '#f4a623', fontWeight: 700 }}>+{wholesalePct}%</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={wholesalePct}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setWholesalePct(v);
                      saveUserSavedConfig({ wholesalePct: v });
                    }}
                    style={{ width: '100%', accentColor: '#f4a623' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>🏷️ Наценка Розница (+{retailPct}%)</label>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>+{retailPct}%</span>
                  </div>
                  <input
                    type="range" min="0" max="200" value={retailPct}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setRetailPct(v);
                      saveUserSavedConfig({ retailPct: v });
                    }}
                    style={{ width: '100%', accentColor: '#10b981' }}
                  />
                </div>

                {/* Live Preview */}
                <div style={{ background: 'rgba(244,166,35,0.08)', border: '1px solid rgba(244,166,35,0.25)', borderRadius: 12, padding: 12, fontSize: 12 }}>
                  <div style={{ color: '#f4a623', fontWeight: 700, marginBottom: 4 }}>💡 Наглядный пример:</div>
                  <div style={{ color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
                    📦 Оптом (от 2 200 ₽): <b>{Math.round(2200 * (1 + wholesalePct / 100))} ₽</b> (+{wholesalePct}%)<br/>
                    🏷️ В розницу (от 2 400 ₽): <b style={{ color: '#10b981' }}>{Math.round(2400 * (1 + retailPct / 100))} ₽</b> (+{retailPct}%)
                  </div>
                </div>
              </div>
            )}

            {/* THREE TIER MODE */}
            {priceMode === 'three_tier' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>📦 Наценка Опт (+{wholesalePct}%)</label>
                    <span style={{ color: '#f4a623', fontWeight: 700 }}>+{wholesalePct}%</span>
                  </div>
                  <input
                    type="range" min="0" max="100" value={wholesalePct}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setWholesalePct(v);
                      saveUserSavedConfig({ wholesalePct: v });
                    }}
                    style={{ width: '100%', accentColor: '#f4a623' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>🤝 Наценка Дроп (+{dropPct}%)</label>
                    <span style={{ color: '#3b82f6', fontWeight: 700 }}>+{dropPct}%</span>
                  </div>
                  <input
                    type="range" min="0" max="150" value={dropPct}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setDropPct(v);
                      saveUserSavedConfig({ dropPct: v });
                    }}
                    style={{ width: '100%', accentColor: '#3b82f6' }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>🏷️ Наценка Розница (+{retailPct}%)</label>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>+{retailPct}%</span>
                  </div>
                  <input
                    type="range" min="0" max="300" value={retailPct}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setRetailPct(v);
                      saveUserSavedConfig({ retailPct: v });
                    }}
                    style={{ width: '100%', accentColor: '#10b981' }}
                  />
                </div>

                {/* Live Preview */}
                <div style={{ background: 'rgba(244,166,35,0.08)', border: '1px solid rgba(244,166,35,0.25)', borderRadius: 12, padding: 12, fontSize: 12 }}>
                  <div style={{ color: '#f4a623', fontWeight: 700, marginBottom: 4 }}>💡 Наглядный расчет от исходной цены донора 1 500 ₽:</div>
                  <div style={{ color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}>
                    📦 Опт (+{wholesalePct}%): <b style={{ color: '#f4a623' }}>{Math.round(1500 * (1 + wholesalePct / 100))} ₽</b><br/>
                    🤝 Дроп (+{dropPct}%): <b style={{ color: '#3b82f6' }}>{Math.round(1500 * (1 + dropPct / 100))} ₽</b><br/>
                    🏷️ Розница (+{retailPct}%): <b style={{ color: '#10b981' }}>{Math.round(1500 * (1 + retailPct / 100))} ₽</b>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Copy Count & Interval */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={18} color="#f4a623" /> Параметры переноса и интервал
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  📦 Сколько постов скопировать
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
                accentColor="#f4a623"
              />
            </div>

            {/* HYBRID MODE CHECKBOX */}
            <div style={{
              background: 'rgba(244,166,35,0.08)', border: '1px solid rgba(244,166,35,0.25)',
              borderRadius: 14, padding: 14
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={enableLiveMonitoringAfterBatch}
                  onChange={e => setEnableLiveMonitoringAfterBatch(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#f4a623' }}
                />
                <span>🔴 После публикации {copyCount} постов переключиться в режим ЖИВОГО МОНИТОРИНГА НОВЫХ ПОСТОВ</span>
              </label>
            </div>
          </div>

          {/* Toggles */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
              🛡️ Дополнительные фильтры
            </h3>

            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
              <span>Игнорировать рекламные посты (AI авто-фильтр)</span>
              <input type="checkbox" checked={filterAds} onChange={e => setFilterAds(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#f4a623' }} />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
              <span>Скачивать и прикреплять фото товаров</span>
              <input type="checkbox" checked={downloadPhotos} onChange={e => setDownloadPhotos(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#f4a623' }} />
            </label>

            {/* MINI APP SYNC TOGGLE */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(230,57,70,0.12), rgba(124,58,237,0.12))',
              border: '1px solid rgba(230,57,70,0.3)', borderRadius: 14, padding: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Smartphone size={16} color="#e63946" /> Дублировать в Telegram Mini App
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                  Посты и товары с наценкой сразу появятся на витрине Mini App
                </div>
              </div>
              <input
                type="checkbox"
                checked={syncToMiniApp}
                onChange={e => setSyncToMiniApp(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: '#e63946', cursor: 'pointer' }}
              />
            </div>

            {/* ARTICLE CREATION TOGGLE */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(244,166,35,0.1), rgba(244,166,35,0.05))',
              border: '1px solid rgba(244,166,35,0.3)', borderRadius: 14, padding: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Smartphone size={16} color="#f4a623" /> 🏷️ Создавать артикул каждому товару
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                  Автоматически генерирует уникальный артикул (напр. ART-0001) и сохраняет в Склад & Заказы
                </div>
                {createArticles && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>Префикс:</span>
                    <input
                      value={articlePrefix}
                      onChange={e => setArticlePrefix(e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 10))}
                      placeholder="ART"
                      style={{
                        width: 80, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(244,166,35,0.3)',
                        borderRadius: 8, padding: '5px 10px', color: '#f4a623', fontSize: 13, fontWeight: 800,
                        outline: 'none', textAlign: 'center'
                      }}
                    />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>→ {articlePrefix || 'ART'}-0001, {articlePrefix || 'ART'}-0002...</span>
                  </div>
                )}
              </div>
              <input
                type="checkbox"
                checked={createArticles}
                onChange={e => setCreateArticles(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: '#f4a623', cursor: 'pointer', flexShrink: 0 }}
              />
            </div>

            {/* BUTTON TO OPEN MINI APP SHOWCASE */}
            <button
              onClick={() => setIsMiniAppModalOpen(true)}
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(230,57,70,0.2))',
                border: '1px solid rgba(124,58,237,0.4)', borderRadius: 12, padding: '10px 14px',
                color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4
              }}
            >
              <Smartphone size={16} color="#a78bfa" /> 📱 Открыть витрину Telegram Mini App
            </button>
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
                onClick={handleStartStore}
                style={{
                  width: '100%', padding: 14, borderRadius: 12,
                  background: 'linear-gradient(135deg, #f4a623, #d97706)',
                  color: '#000', fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer',
                  boxShadow: '0 0 30px rgba(244,166,35,0.3)',
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
          <div style={{ fontSize: 15, fontWeight: 700, color: taskState.isLiveMonitoring ? '#10b981' : '#f4a623', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            {taskState.isProcessing && !taskState.isLiveMonitoring && <Loader2 className="animate-spin" size={18} />}
            {taskState.isLiveMonitoring && <Radio className="animate-pulse" size={18} color="#10b981" />}
            {taskState.statusMessage}
          </div>

          {/* LIVE COUNTDOWN TIMER BADGE */}
          {taskState.countdownSec > 0 && (
            <div style={{
              background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: 14, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 16
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#10b981', fontWeight: 700, fontSize: 14 }}>
                <Clock className="animate-spin" size={18} />
                <span>Ожидание следующей публикации в каналы...</span>
              </div>
              <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: 20, fontWeight: 800, color: '#10b981' }}>
                ⏳ {formatCountdown(taskState.countdownSec)}
              </div>
            </div>
          )}

          {taskState.total > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', background: '#f4a623', width: `${(taskState.current / taskState.total) * 100}%`, transition: 'width 0.3s' }} />
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
                <div key={i} style={{ background: 'rgba(255,255,255,0.03)', padding: 14, borderRadius: 12, fontSize: 13, borderLeft: log.status === 'published' ? '4px solid #10b981' : '4px solid #e63946' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#fff', fontWeight: 700 }}>{log.title}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{log.time}</span>
                  </div>
                  {log.mediaCount > 0 && (
                    <div style={{ color: '#f4a623', fontSize: 11, fontWeight: 600, marginTop: 4 }}>
                      🖼️ Прикреплено {log.mediaCount} {log.mediaCount === 1 ? 'фото/видео' : 'фото в галерее-альбоме'}
                    </div>
                  )}
                  {log.processed && (
                    <div style={{ color: 'rgba(255,255,255,0.7)', whiteSpace: 'pre-wrap', lineHeight: 1.5, marginTop: 4 }}>
                      {log.processed}
                    </div>
                  )}
                  {log.status === 'skipped_ad' && (
                    <div style={{ color: '#f4a623', fontSize: 12 }}>⚠️ Пропущен (содержит рекламу)</div>
                  )}
                  {log.status === 'skipped_duplicate' && (
                    <div style={{ color: '#e63946', fontSize: 12 }}>🛡️ Пропущен (дубликат: {log.detail})</div>
                  )}

                  {/* Ссылка на пост в доноре */}
                  {log.id && donors[0] && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a
                        href={`https://t.me/${donors[0].replace('@', '')}/${log.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          background: 'rgba(244,166,35,0.12)', border: '1px solid rgba(244,166,35,0.3)',
                          borderRadius: 6, padding: '3px 8px', color: '#f4a623', fontSize: 11, fontWeight: 700,
                          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4
                        }}
                      >
                        <ExternalLink size={11} /> Пост в канале-доноре ({donors[0]})
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TELEGRAM MINI APP SHOWCASE MODAL */}
      <MiniAppShowcaseModal
        isOpen={isMiniAppModalOpen}
        onClose={() => setIsMiniAppModalOpen(false)}
      />

      {/* PERSISTENT ACTION HISTORY PANEL */}
      <ActionHistoryPanel />
    </div>
  );
};
