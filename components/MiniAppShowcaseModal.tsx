import React, { useState, useEffect } from 'react';
import { Smartphone, RefreshCw, Trash2, ExternalLink, ShoppingBag, CheckCircle, Sparkles, X, Share2 } from 'lucide-react';

interface MiniAppPostItem {
  id: string;
  title: string;
  text: string;
  price?: string;
  original_price?: string;
  media_urls?: string[];
  source_channel?: string;
  target_channel?: string;
  category?: string;
  views_count?: number;
  published_at?: string;
}

interface MiniAppShowcaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MiniAppShowcaseModal: React.FC<MiniAppShowcaseModalProps> = ({ isOpen, onClose }) => {
  const [feed, setFeed] = useState<MiniAppPostItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const fetchFeed = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/miniapp/feed');
      if (res.ok) {
        const data = await res.json();
        setFeed(data.feed || []);
      }
    } catch (e) {
      console.error('Failed to fetch miniapp feed:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchFeed();
    }
  }, [isOpen]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/miniapp/feed/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setFeed(prev => prev.filter(item => item.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete miniapp post:', e);
    }
  };

  const copyMiniAppLink = () => {
    navigator.clipboard.writeText('https://t.me/GhostPostBot/shop');
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        background: '#0f0f12', border: '1px solid rgba(230,57,70,0.3)',
        borderRadius: 28, width: '100%', maxWidth: 440, maxHeight: '90vh',
        boxShadow: '0 25px 60px rgba(0,0,0,0.9), 0 0 50px rgba(230,57,70,0.25)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        position: 'relative'
      }}>

        {/* Telegram Mini App Header */}
        <div style={{
          background: 'linear-gradient(135deg, #18181f, #111116)',
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: 'linear-gradient(135deg, #e63946, #7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
            }}>
              <Smartphone size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                GhostPost Mini App <Sparkles size={12} color="#f4a623" />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                Витрина магазина в Telegram
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={fetchFeed}
              disabled={isLoading}
              style={{
                background: 'rgba(255,255,255,0.06)', border: 'none', color: '#fff',
                width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.06)', border: 'none', color: '#fff',
                width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Share Link Banner */}
        <div style={{
          padding: '10px 16px', background: 'rgba(230,57,70,0.1)', borderBottom: '1px solid rgba(230,57,70,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
            🔗 t.me/GhostPostBot/shop
          </span>
          <button
            onClick={copyMiniAppLink}
            style={{
              padding: '4px 10px', borderRadius: 100,
              background: copiedLink ? '#10b981' : 'linear-gradient(135deg, #e63946, #c0392b)',
              color: '#fff', border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4
            }}
          >
            {copiedLink ? <CheckCircle size={12} /> : <Share2 size={12} />}
            {copiedLink ? 'Скопировано!' : 'Скопировать'}
          </button>
        </div>

        {/* Category Filters */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          {['all', 'Store', 'General'].map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '5px 12px', borderRadius: 100, fontSize: 11, fontWeight: 700,
                border: 'none', cursor: 'pointer',
                background: activeCategory === cat ? '#e63946' : 'rgba(255,255,255,0.06)',
                color: activeCategory === cat ? '#fff' : 'rgba(255,255,255,0.5)'
              }}
            >
              {cat === 'all' ? 'Все посты' : cat === 'Store' ? '🛒 Магазин' : '📰 Контент'}
            </button>
          ))}
        </div>

        {/* Mini App Feed Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isLoading && feed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              Загрузка витрины Mini App...
            </div>
          ) : feed.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255,255,255,0.4)' }}>
              <ShoppingBag size={40} color="#e63946" style={{ margin: '0 auto 12px', opacity: 0.7 }} />
              <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 6 }}>
                Витрина Mini App пуста
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                Включите тумблер <b>«Дублировать в Telegram Mini App»</b> при запуске парсера или магазина, и посты автоматически появятся здесь!
              </div>
            </div>
          ) : (
            feed
              .filter(item => activeCategory === 'all' || item.category === activeCategory)
              .map(item => (
                <div
                  key={item.id}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 18, padding: 14,
                    display: 'flex', flexDirection: 'column', gap: 10,
                    position: 'relative'
                  }}
                >
                  <button
                    onClick={() => handleDelete(item.id)}
                    title="Удалить из Mini App"
                    style={{
                      position: 'absolute', top: 10, right: 10,
                      background: 'rgba(230,57,70,0.15)', border: 'none', color: '#e63946',
                      width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                  >
                    <Trash2 size={13} />
                  </button>

                  <div style={{ paddingRight: 30 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.text}
                    </div>
                  </div>

                  {item.price && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        color: '#fff', fontSize: 13, fontWeight: 800,
                        padding: '4px 10px', borderRadius: 8
                      }}>
                        {item.price}
                      </span>
                      {item.original_price && (
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textDecoration: 'line-through' }}>
                          {item.original_price}
                        </span>
                      )}
                    </div>
                  )}

                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 11, color: 'rgba(255,255,255,0.4)'
                  }}>
                    <span>Канал: {item.target_channel || '@my_channel'}</span>
                    <span style={{ color: '#e63946', fontWeight: 700 }}>Mini App Live</span>
                  </div>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
};
