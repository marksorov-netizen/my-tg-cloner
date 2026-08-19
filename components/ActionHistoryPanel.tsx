import React, { useState, useEffect } from 'react';
import { getActionHistory, fetchCombinedActionHistory, clearActionHistory, ActionLogItem } from '../services/actionHistory';
import { History, Trash2, CheckCircle2, AlertTriangle, XCircle, Square, RefreshCw } from 'lucide-react';

export const ActionHistoryPanel: React.FC = () => {
  const [history, setHistory] = useState<ActionLogItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const refreshHistory = async () => {
    // 1. Показываем мгновенно локальный кэш
    const local = getActionHistory();
    if (local.length > 0) {
      setHistory(local);
    }
    // 2. Подтягиваем объединенную историю из базы данных
    try {
      const combined = await fetchCombinedActionHistory();
      if (combined && combined.length > 0) {
        setHistory(combined);
      }
    } catch {}
  };

  useEffect(() => {
    refreshHistory();
    // Опрашиваем каждые 3 секунды для актуальности
    const interval = setInterval(refreshHistory, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRefresh = async () => {
    setIsLoading(true);
    await refreshHistory();
    setTimeout(() => setIsLoading(false), 500);
  };

  const handleClear = () => {
    if (confirm('Вы уверены, что хотите очистить локальную историю действий?')) {
      setHistory(clearActionHistory());
    }
  };

  const getTypeStyle = (type: ActionLogItem['type']) => {
    switch (type) {
      case 'success':
        return { border: '1px solid rgba(16,185,129,0.3)', bg: 'rgba(16,185,129,0.06)', color: '#10b981', icon: <CheckCircle2 size={16} color="#10b981" /> };
      case 'warning':
        return { border: '1px solid rgba(244,166,35,0.3)', bg: 'rgba(244,166,35,0.06)', color: '#f4a623', icon: <AlertTriangle size={16} color="#f4a623" /> };
      case 'error':
        return { border: '1px solid rgba(230,57,70,0.3)', bg: 'rgba(230,57,70,0.06)', color: '#e63946', icon: <XCircle size={16} color="#e63946" /> };
      case 'stopped':
        return { border: '1px solid rgba(255,255,255,0.15)', bg: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', icon: <Square size={16} color="rgba(255,255,255,0.6)" fill="currentColor" /> };
    }
  };

  return (
    <div style={{
      background: 'rgba(15,15,15,0.9)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 20, padding: 24, marginTop: 12
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(244,166,35,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <History size={18} color="#f4a623" />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
              📜 История всех действий аккаунта
            </h3>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
              Сохраняется автоматически ({history.length} записей)
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleManualRefresh}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
            }}
          >
            <RefreshCw size={13} style={{ animation: isLoading ? 'ringPulse 1s ease-in-out infinite' : 'none' }} /> Обновить
          </button>
          {history.length > 0 && (
            <button
              onClick={handleClear}
              style={{
                background: 'rgba(230,57,70,0.1)', border: '1px solid rgba(230,57,70,0.3)',
                color: '#e63946', padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
              }}
            >
              <Trash2 size={14} /> Очистить
            </button>
          )}
        </div>
      </div>

      {history.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          История пока пуста. Выполните запуск парсинга или переноса постов.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
          {history.map((item) => {
            const style = getTypeStyle(item.type);
            return (
              <div
                key={item.id}
                style={{
                  background: style.bg,
                  border: style.border,
                  borderRadius: 12,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 200 }}>
                  {style.icon}
                  <div>
                    <span style={{ color: '#fff', fontWeight: 600, fontSize: 13, marginRight: 8 }}>
                      {item.action}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, wordBreak: 'break-word' }}>
                      {item.details}
                    </span>
                  </div>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                  {item.date} {item.time}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
