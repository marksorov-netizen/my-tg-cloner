import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Loader2, AlertCircle, ArrowLeft, HelpCircle } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const navigate = useNavigate();

  const [step, setStep] = useState<'CREDENTIALS' | 'CODE'>('CREDENTIALS');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState(''); // 2FA optional
  const [phoneCodeHash, setPhoneCodeHash] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Helper fetch with credentials
  const apiCall = async (endpoint: string, body: object) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(data.detail || `Ошибка ${res.status}`);
    return data;
  };

  // Step 1: Request Telegram code
  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!apiId.trim() || !apiHash.trim() || !phone.trim()) {
      setError('Заполните все поля: API ID, API Hash и Номер телефона');
      return;
    }

    setLoading(true);
    try {
      const res = await apiCall('/auth/request_code', {
        api_id: apiId.trim(),
        api_hash: apiHash.trim(),
        phone: phone.trim(),
      });

      if (res.phone_code_hash) {
        setPhoneCodeHash(res.phone_code_hash);
      }
      setStep('CODE');
    } catch (err: any) {
      setError(err.message || 'Ошибка запроса кода');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Sign in with code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!code.trim()) {
      setError('Введите код из сообщения Telegram');
      return;
    }

    setLoading(true);
    try {
      const res = await apiCall('/auth/login', {
        phone: phone.trim(),
        code: code.trim(),
        password: password.trim() || undefined,
        phone_code_hash: phoneCodeHash || undefined,
      });

      if (res.status === 'authenticated') {
        if (onLoginSuccess) onLoginSuccess();
        navigate('/dashboard');
      } else {
        throw new Error('Не удалось войти');
      }
    } catch (err: any) {
      setError(err.message || 'Неверный код или пароль 2FA');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#090909',
      color: '#f5f5f5',
      fontFamily: "'Inter', sans-serif",
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background orbs */}
      <div style={{
        position: 'absolute', width: 600, height: 600, borderRadius: '50%',
        background: '#e63946', filter: 'blur(140px)', opacity: 0.1,
        top: -150, left: -150, pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', width: 500, height: 500, borderRadius: '50%',
        background: '#f4a623', filter: 'blur(140px)', opacity: 0.08,
        bottom: -150, right: -150, pointerEvents: 'none'
      }} />

      {/* Grid */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
        backgroundSize: '40px 40px'
      }} />

      <div style={{ maxWidth: 480, width: '100%', position: 'relative', zIndex: 1 }}>
        {/* Back to landing link */}
        <Link to="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: 'rgba(255,255,255,0.4)', textDecoration: 'none',
          fontSize: 14, marginBottom: 24, transition: 'color 0.2s'
        }}>
          <ArrowLeft size={16} /> На главную
        </Link>

        {/* Header / Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 800,
            marginBottom: 8
          }}>
            <div style={{
              width: 42, height: 42, background: 'linear-gradient(135deg, #e63946, #c0392b)',
              borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, boxShadow: '0 0 24px rgba(230,57,70,0.4)'
            }}>👻</div>
            Ghost<span style={{ color: '#e63946' }}>Post</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>
            {step === 'CREDENTIALS' ? 'Вход через Telegram API' : `Ввод кода подтверждения для ${phone}`}
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 24, padding: 32,
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(20px)'
        }}>
          {error && (
            <div style={{
              background: 'rgba(230,57,70,0.1)',
              border: '1px solid rgba(230,57,70,0.3)',
              borderRadius: 12, padding: '12px 16px', marginBottom: 24,
              display: 'flex', alignItems: 'center', gap: 10,
              color: '#e63946', fontSize: 13
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <div>{error}</div>
            </div>
          )}

          {step === 'CREDENTIALS' ? (
            <form onSubmit={handleRequestCode} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>
                  Telegram API ID
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={apiId}
                    onChange={e => setApiId(e.target.value)}
                    placeholder="Например: 1234567"
                    required
                    style={{
                      width: '100%', background: 'rgba(0,0,0,0.4)',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
                      padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>
                  Telegram API Hash
                </label>
                <input
                  type="password"
                  value={apiHash}
                  onChange={e => setApiHash(e.target.value)}
                  placeholder="32-символьный хэш"
                  required
                  style={{
                    width: '100%', background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
                    padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>
                  Номер телефона (в международном формате)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+79001234567"
                  required
                  style={{
                    width: '100%', background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
                    padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none'
                  }}
                />
              </div>

              <button
                type="button"
                onClick={() => setShowGuide(!showGuide)}
                style={{
                  background: 'none', border: 'none', color: '#f4a623',
                  fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  textAlign: 'left', padding: 0
                }}
              >
                <HelpCircle size={14} /> Как получить API ID и API Hash?
              </button>

              {showGuide && (
                <div style={{
                  background: 'rgba(244,166,35,0.08)',
                  border: '1px solid rgba(244,166,35,0.2)',
                  borderRadius: 12, padding: 14, fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6
                }}>
                  1. Перейдите на <b>my.telegram.org</b><br />
                  2. Введите свой номер и код из Telegram<br />
                  3. Откройте «API development tools»<br />
                  4. Скопируйте App api_id и App api_hash
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '14px', borderRadius: 12,
                  background: 'linear-gradient(135deg, #e63946, #c0392b)',
                  color: '#fff', fontWeight: 700, fontSize: 15, border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 0 24px rgba(230,57,70,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  marginTop: 8
                }}
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <>Запросить код <ArrowRight size={18} /></>}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>
                  Код подтверждения из Telegram
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="Код (например 12345)"
                  required
                  autoFocus
                  style={{
                    width: '100%', background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
                    padding: '14px 16px', color: '#fff', fontSize: 18,
                    letterSpacing: 4, textAlign: 'center', outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                  Облачный пароль 2FA (если включён)
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Пароль 2FA (необязательно)"
                  style={{
                    width: '100%', background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
                    padding: '12px 16px', color: '#fff', fontSize: 14, outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setStep('CREDENTIALS')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12,
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.7)', fontWeight: 600, fontSize: 14, cursor: 'pointer'
                  }}
                >
                  Назад
                </button>

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    flex: 2, padding: '12px', borderRadius: 12,
                    background: 'linear-gradient(135deg, #e63946, #c0392b)',
                    color: '#fff', fontWeight: 700, fontSize: 14, border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 0 24px rgba(230,57,70,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                  }}
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : 'Войти в систему'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer info */}
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
          <ShieldCheck size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Все ключи зашифрованы Fernet (AES-256) и хранятся безопасно.
        </div>
      </div>
    </div>
  );
};
