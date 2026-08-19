import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, Layers, ShoppingBag, Wand2, ChevronRight, LogOut, Menu, X, User, Package } from 'lucide-react';

import { ProfileModal } from './ProfileModal';
import { AppConfig } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  isUserAuthenticated: boolean;
  config?: AppConfig;
}

export const Layout: React.FC<LayoutProps> = ({ children, isUserAuthenticated, config }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isMobileScreen, setIsMobileScreen] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const navItems = [
    { path: '/dashboard', label: 'Обзор', shortLabel: 'Обзор', icon: LayoutDashboard },
    { path: '/dashboard/parser', label: '📰 1. Парсер ТГ каналов', shortLabel: 'Парсер', icon: Layers },
    { path: '/dashboard/store', label: '🛒 2. Интернет магазин', shortLabel: 'Магазин', icon: ShoppingBag },
    { path: '/dashboard/orders', label: '📦 3. Склад & Заказы', shortLabel: 'Склад', icon: Package },
    { path: '/dashboard/prompt', label: '✍️ 4. Промт-инжиниринг', shortLabel: 'Промты', icon: Wand2 },
  ];

  const handleLogout = async () => {
    localStorage.removeItem('ghostpost_auth');
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {}
    navigate('/login');
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    setIsMobileDrawerOpen(false);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: isMobileScreen ? 'column' : 'row', height: '100vh',
      background: '#090909', color: '#f5f5f5',
      fontFamily: "'Plus Jakarta Sans', sans-serif", overflow: 'hidden', position: 'relative'
    }}>
      {/* Mobile Drawer Overlay Backdrop */}
      {isMobileScreen && isMobileDrawerOpen && (
        <div
          onClick={() => setIsMobileDrawerOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(8px)', zIndex: 90
          }}
        />
      )}

      {/* Sidebar (Desktop Persistent & Mobile Glassmorphism Drawer) */}
      <aside style={{
        width: isMobileScreen ? 280 : 280,
        background: '#0f0f0f',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', flexDirection: 'column', zIndex: 100,
        position: isMobileScreen ? 'fixed' : 'relative',
        top: 0, bottom: 0, left: 0,
        transform: isMobileScreen ? (isMobileDrawerOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
        transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: isMobileScreen ? '10px 0 30px rgba(0,0,0,0.5)' : 'none'
      }}>
        {/* Logo Header */}
        <div style={{ padding: '24px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div style={{
              width: 38, height: 38, background: 'linear-gradient(135deg, #e63946, #c0392b)',
              borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, boxShadow: '0 0 20px rgba(230,57,70,0.4)'
            }}>👻</div>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 800, color: '#fff' }}>
                Ghost<span style={{ color: '#e63946' }}>Post</span>
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1.2 }}>
                SaaS AI Platform v3.0
              </div>
            </div>
          </Link>
          {isMobileScreen && (
            <button onClick={() => setIsMobileDrawerOpen(false)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 6, color: '#fff', cursor: 'pointer' }}>
              <X size={20} />
            </button>
          )}
        </div>

        {/* Navigation items */}
        <nav style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, padding: '0 12px 6px' }}>
            Разделы системы
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => handleNavClick(item.path)}
                style={{
                  display: 'flex', alignItems: 'center', width: '100%', padding: '13px 16px',
                  borderRadius: 14, border: 'none', cursor: 'pointer', textAlign: 'left',
                  background: isActive ? 'linear-gradient(135deg, rgba(230,57,70,0.18), rgba(192,57,43,0.1))' : 'transparent',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
                  fontWeight: isActive ? 700 : 500, fontSize: 14,
                  borderLeft: isActive ? '3px solid #e63946' : '3px solid transparent',
                  transition: 'all 0.2s ease'
                }}
              >
                <Icon size={18} style={{ marginRight: 12, color: isActive ? '#e63946' : 'rgba(255,255,255,0.4)' }} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {isActive && <ChevronRight size={14} style={{ color: '#e63946' }} />}
              </button>
            );
          })}
        </nav>

        {/* Auth Status & Logout */}
        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14, padding: 14, marginBottom: 12
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Статус Telegram
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: isUserAuthenticated ? '#10b981' : '#f4a623', boxShadow: isUserAuthenticated ? '0 0 10px #10b981' : 'none' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: isUserAuthenticated ? '#10b981' : '#f4a623' }}>
                {isUserAuthenticated ? 'Подключён' : 'Ожидание входа'}
              </span>
            </div>
          </div>

          {!isUserAuthenticated ? (
            <button
              onClick={() => { navigate('/login'); setIsMobileDrawerOpen(false); }}
              style={{
                width: '100%', padding: '12px', borderRadius: 12,
                background: 'rgba(230,57,70,0.18)', border: '1px solid rgba(230,57,70,0.35)',
                color: '#e63946', fontWeight: 700, fontSize: 13, cursor: 'pointer'
              }}
            >
              Подключить Telegram
            </button>
          ) : (
            <button
              onClick={handleLogout}
              style={{
                width: '100%', padding: '12px', borderRadius: 12,
                background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.5)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
              }}
            >
              <LogOut size={14} /> Выйти
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* Top App Bar Header */}
        <header style={{
          height: isMobileScreen ? 56 : 64,
          padding: isMobileScreen ? '0 16px' : '0 32px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(9,9,9,0.95)', backdropFilter: 'blur(12px)',
          zIndex: 30
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {isMobileScreen && (
              <button
                onClick={() => setIsMobileDrawerOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, padding: 8, color: '#fff', cursor: 'pointer'
                }}
              >
                <Menu size={20} />
              </button>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: isMobileScreen ? 13 : 14, color: 'rgba(255,255,255,0.6)' }}>
              <span style={{ color: '#e63946', fontWeight: 700 }}>GhostPost</span>
              <span>/</span>
              <span style={{ color: '#fff', fontWeight: 600 }}>{isMobileScreen ? 'Панель' : 'Дашборд управления'}</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setIsProfileModalOpen(true)}
              style={{
                padding: '6px 14px', borderRadius: 100,
                background: 'linear-gradient(135deg, rgba(230,57,70,0.2), rgba(124,58,237,0.2))',
                border: '1px solid rgba(230,57,70,0.4)',
                color: '#fff', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                cursor: 'pointer', boxShadow: '0 0 15px rgba(230,57,70,0.2)'
              }}
            >
              <User size={14} color="#e63946" /> Pro Профиль
            </button>
          </div>
        </header>

        {/* PROFILE MODAL DIALOG */}
        <ProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
          config={config || {
            destinationChannel: '@my_channel',
            sourceUrl: '',
            useAI: true,
            removeLinks: true,
            pricing: { wholesalePercent: 10, dropPercent: 30, retailPercent: 50, currencySymbol: '₽' },
            isSimulationMode: false,
            telegramAuth: { step: isUserAuthenticated ? 'AUTHENTICATED' : 'IDLE', apiId: '28472910', apiHash: 'e89a7f3c1b4d092e6f51c82a39' }
          }}
        />

        {/* Scrollable Main Content Container */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: isMobileScreen ? 16 : 32,
          paddingBottom: isMobileScreen ? 80 : 32 // Extra bottom padding for mobile navigation bar
        }}>
          <div style={{ maxWidth: 1160, margin: '0 auto' }}>
            {children}
          </div>
        </div>

        {/* MOBILE BOTTOM NAVIGATION BAR (FOR SMARTPHONES) */}
        {isMobileScreen && (
          <nav style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, height: 62,
            background: 'rgba(15,15,15,0.96)', backdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-around',
            zIndex: 80, padding: '0 8px'
          }}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 3, background: 'none', border: 'none', color: isActive ? '#e63946' : 'rgba(255,255,255,0.45)',
                    padding: '6px 12px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s ease'
                  }}
                >
                  <Icon size={20} color={isActive ? '#e63946' : 'rgba(255,255,255,0.45)'} />
                  <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500 }}>
                    {item.shortLabel}
                  </span>
                </button>
              );
            })}
          </nav>
        )}
      </main>
    </div>
  );
};
