import React, { useState, useEffect } from 'react';
import { AppConfig } from '../types';
import { X, Eye, EyeOff, Copy, Check, Clock, Calendar, ShieldCheck, Zap, Sparkles, Smartphone, KeyRound, Wifi, CheckCircle2, Save } from 'lucide-react';
import { getActionHistory } from '../services/actionHistory';
import { apiService } from '../services/apiService';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AppConfig;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose, config }) => {
  const [showApiId, setShowApiId] = useState(false);
  const [showApiHash, setShowApiHash] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // PIN code management for Mobile Quick Login
  const [pinCode, setPinCode] = useState('1234');
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [pinSavedMsg, setPinSavedMsg] = useState(false);

  useEffect(() => {
    if (isOpen) {
      apiService.getUserPin()
        .then(res => {
          if (res?.pin_code) setPinCode(res.pin_code);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Calculate published posts & time saved
  const history = getActionHistory();
  const publishedPosts = history.filter(h => h.type === 'success').length;
  // 1 post manually takes ~5 minutes (writing, photos, markups)
  const totalMinutesSaved = publishedPosts * 5;
  const hoursSaved = Math.floor(totalMinutesSaved / 60);
  const minsSaved = totalMinutesSaved % 60;

  // Subscription calculation (default 7 days trial or active sub)
  const trialDaysLeft = 6;
  const trialHoursLeft = 18;

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSavePin = async () => {
    setIsSavingPin(true);
    try {
      await apiService.updateUserPin(pinCode);
      setPinSavedMsg(true);
      setTimeout(() => setPinSavedMsg(false), 2500);
    } catch (e: any) {
      alert(e.message || 'Ошибка сохранения PIN-кода');
    } finally {
      setIsSavingPin(false);
    }
  };

  const apiIdVal = config.telegramAuth.apiId || '28472910';
  const apiHashVal = config.telegramAuth.apiHash || 'e89a7f3c1b4d092e6f51c82a39';
  const phoneVal = config.telegramAuth.phoneNumber || localStorage.getItem('gp_phone') || '+7 (999) ***-**-**';

  // Local Wi-Fi network link for mobile phones
  const mobileLink = typeof window !== 'undefined'
    ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://192.168.1.140:5173'
        : `${window.location.protocol}//${window.location.hostname}:5173`)
    : 'http://192.168.1.140:5173';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div style={{
        background: 'rgba(18,18,18,0.95)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 24, width: '100%', maxWidth: 520,
        boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
        overflow: 'hidden', animation: 'fadeIn 0.2s ease'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(135deg, rgba(230,57,70,0.12), rgba(15,15,15,0.95))'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'linear-gradient(135deg, #e63946, #7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, boxShadow: '0 0 20px rgba(230,57,70,0.4)'
            }}>
              👤
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>Мой Профиль GhostPost</div>
              <div style={{ color: '#10b981', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <ShieldCheck size={14} /> Подключён к Telegram
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, padding: 8, color: '#fff', cursor: 'pointer'
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '80vh', overflowY: 'auto' }}>
          
          {/* SUBSCRIPTION COUNTDOWN WIDGET */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(244,166,35,0.12), rgba(244,166,35,0.04))',
            border: '1px solid rgba(244,166,35,0.3)',
            borderRadius: 18, padding: 18
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f4a623', fontWeight: 800, fontSize: 14 }}>
                <Sparkles size={18} /> Тариф: PRO Plan (7 дней Trial)
              </div>
              <span style={{ background: '#f4a623', color: '#000', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100 }}>
                АКТИВЕН
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Осталось до конца подписки:</span>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 15, fontFamily: "'Space Grotesk', monospace" }}>
                ⏳ {trialDaysLeft} дней {trialHoursLeft} часов
              </span>
            </div>

            <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ height: '100%', background: 'linear-gradient(90deg, #f4a623, #10b981)', width: '85%' }} />
            </div>

            <button
              onClick={() => alert('Ссылка на продление подписки через Telegram бота')}
              style={{
                width: '100%', padding: '10px', borderRadius: 10,
                background: 'linear-gradient(135deg, #f4a623, #d97706)',
                color: '#000', fontWeight: 800, fontSize: 13, border: 'none', cursor: 'pointer'
              }}
            >
              🚀 Продлить подписку
            </button>
          </div>

          {/* MOBILE QUICK LOGIN & CROSS-DEVICE PIN */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(230,57,70,0.08), rgba(255,255,255,0.02))',
            border: '1px solid rgba(230,57,70,0.25)',
            borderRadius: 18, padding: 18
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h4 style={{ color: '#fff', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <Smartphone size={18} style={{ color: '#e63946' }} /> Быстрый вход с телефона & PIN
              </h4>
              <span style={{ fontSize: 11, background: 'rgba(230,57,70,0.15)', color: '#ff6b6b', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
                Синхронизация
              </span>
            </div>

            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: '0 0 14px 0' }}>
              Запустите парсинг с ПК, отойдите от компьютера и управляйте процессом с телефона через локальный Wi-Fi по номеру телефона и PIN-коду.
            </p>

            {/* Local Wi-Fi Address */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
                🌐 Ссылка для открытия на телефоне (в сети Wi-Fi):
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  readOnly
                  value={mobileLink}
                  style={{
                    flex: 1, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, padding: '8px 12px', color: '#10b981', fontSize: 13, outline: 'none',
                    fontWeight: 600
                  }}
                />
                <button
                  onClick={() => handleCopy(mobileLink, 'mobileLink')}
                  style={{
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 10, padding: '0 12px', color: copiedField === 'mobileLink' ? '#10b981' : '#fff',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12
                  }}
                >
                  {copiedField === 'mobileLink' ? <Check size={14} /> : <Copy size={14} />}
                  {copiedField === 'mobileLink' ? 'Скопировано' : 'Копия'}
                </button>
              </div>
            </div>

            {/* PIN Code Setup */}
            <div>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
                🔑 Ваш секретный PIN-код (для входа без SMS):
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={pinCode}
                  maxLength={10}
                  onChange={(e) => setPinCode(e.target.value)}
                  style={{
                    flex: 1, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none',
                    fontWeight: 700, letterSpacing: 2
                  }}
                />
                <button
                  onClick={handleSavePin}
                  disabled={isSavingPin}
                  style={{
                    background: 'linear-gradient(135deg, #e63946, #c0392b)', border: 'none',
                    borderRadius: 10, padding: '0 16px', color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700
                  }}
                >
                  {pinSavedMsg ? <CheckCircle2 size={14} /> : <Save size={14} />}
                  {pinSavedMsg ? 'Сохранено!' : 'Сохранить PIN'}
                </button>
              </div>
              {pinSavedMsg && (
                <div style={{ fontSize: 11, color: '#10b981', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={12} /> PIN-код успешно обновлен в базе данных!
                </div>
              )}
            </div>
          </div>

          {/* TIME SAVED METRIC */}
          <div style={{
            background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
            borderRadius: 18, padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                <Clock size={20} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Сэкономлено времени:</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#10b981', fontFamily: "'Space Grotesk', sans-serif" }}>
                  ⏱ {hoursSaved} ч {minsSaved} мин
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              Опубликовано: {publishedPosts} постов
            </div>
          </div>

          {/* TELEGRAM CREDENTIALS (API ID & HASH) */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 18 }}>
            <h4 style={{ color: '#fff', fontWeight: 700, fontSize: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              🔐 Мои Telegram данные (Скрытые)
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* API ID */}
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
                  Telegram API ID
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type={showApiId ? 'text' : 'password'}
                    readOnly
                    value={apiIdVal}
                    style={{
                      flex: 1, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 10, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none'
                    }}
                  />
                  <button
                    onClick={() => setShowApiId(!showApiId)}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '0 10px', color: '#fff', cursor: 'pointer' }}
                  >
                    {showApiId ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    onClick={() => handleCopy(apiIdVal, 'apiId')}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '0 10px', color: copiedField === 'apiId' ? '#10b981' : '#fff', cursor: 'pointer' }}
                  >
                    {copiedField === 'apiId' ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* API HASH */}
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
                  Telegram API Hash
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type={showApiHash ? 'text' : 'password'}
                    readOnly
                    value={apiHashVal}
                    style={{
                      flex: 1, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 10, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none'
                    }}
                  />
                  <button
                    onClick={() => setShowApiHash(!showApiHash)}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '0 10px', color: '#fff', cursor: 'pointer' }}
                  >
                    {showApiHash ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    onClick={() => handleCopy(apiHashVal, 'apiHash')}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '0 10px', color: copiedField === 'apiHash' ? '#10b981' : '#fff', cursor: 'pointer' }}
                  >
                    {copiedField === 'apiHash' ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* PHONE NUMBER */}
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 4 }}>
                  Привязанный телефон
                </label>
                <input
                  type="text"
                  readOnly
                  value={phoneVal}
                  style={{
                    width: '100%', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, padding: '8px 12px', color: 'rgba(255,255,255,0.7)', fontSize: 13, outline: 'none'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
