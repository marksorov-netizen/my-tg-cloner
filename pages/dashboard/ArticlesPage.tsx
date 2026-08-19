import React, { useState, useEffect, useCallback } from 'react';
import { Package, ShoppingCart, Bot, Plus, Trash2, RefreshCw, ChevronDown, ChevronUp, ToggleLeft, ToggleRight, Copy, CheckCircle, ExternalLink, AlertCircle, Loader2, Play, Square, Bell, Search, Image as ImageIcon, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
interface ArticleItem {
  id: string;
  article_code: string;
  title: string;
  description?: string;
  price?: string;
  wholesale_price?: string;
  drop_price?: string;
  currency: string;
  source_channel?: string;
  source_msg_id?: number;
  target_channel?: string;
  target_msg_id?: number;
  donor_post_url?: string;
  telegram_post_url?: string;
  stock: Record<string, number>;
  category: string;
  product_type?: string;
  is_active: boolean;
  orders_count: number;
  media_urls: string[];
  created_at?: string;
}

interface OrderItem {
  id: string;
  article_code: string;
  customer_name?: string;
  customer_phone?: string;
  customer_username?: string;
  selected_size?: string;
  foot_size_cm?: string;
  height_weight?: string;
  supplier_message?: string;
  quantity: number;
  price_at_order?: string;
  comment?: string;
  status: string;
  created_at?: string;
}

interface BotConfig {
  id?: string;
  bot_username?: string;
  manager_chat_id?: string;
  manager_username?: string;
  welcome_message?: string;
  article_prefix?: string;
  is_active?: boolean;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: '🆕 Новый', color: '#3b82f6' },
  confirmed: { label: '✅ Подтверждён', color: '#10b981' },
  shipped: { label: '🚚 Отправлен', color: '#f4a623' },
  done: { label: '✔️ Выполнен', color: '#6b7280' },
  cancelled: { label: '❌ Отменён', color: '#e63946' },
};

// ─── Stock Editor ─────────────────────────────────────────────
const StockEditor: React.FC<{ article: ArticleItem; onSave: (id: string, stock: Record<string, number>) => void }> = ({ article, onSave }) => {
  const [stock, setStock] = useState<Record<string, number>>(article.stock || {});
  const [newSize, setNewSize] = useState('');
  const [newQty, setNewQty] = useState(10);
  const [saving, setSaving] = useState(false);

  const addSize = () => {
    if (!newSize.trim()) return;
    setStock(prev => ({ ...prev, [newSize.trim()]: newQty }));
    setNewSize('');
    setNewQty(10);
  };

  const removeSize = (key: string) => {
    setStock(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(article.id, stock);
    setSaving(false);
  };

  return (
    <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 14, padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
        📦 Остатки по размерам
      </div>

      {/* Existing sizes */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {Object.entries(stock).map(([size, qty]) => (
          <div key={size} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: qty > 0 ? 'rgba(16,185,129,0.12)' : 'rgba(230,57,70,0.12)',
            border: `1px solid ${qty > 0 ? 'rgba(16,185,129,0.3)' : 'rgba(230,57,70,0.3)'}`,
            borderRadius: 10, padding: '6px 10px', fontSize: 13
          }}>
            <span style={{ color: '#fff', fontWeight: 700 }}>{size}</span>
            <input
              type="number" min={0}
              value={qty}
              onChange={e => setStock(prev => ({ ...prev, [size]: Number(e.target.value) }))}
              style={{ width: 48, background: 'transparent', border: 'none', color: qty > 0 ? '#10b981' : '#e63946', fontWeight: 800, fontSize: 13, textAlign: 'center', outline: 'none' }}
            />
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>шт</span>
            <button onClick={() => removeSize(size)} style={{ background: 'none', border: 'none', color: '#e63946', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {Object.keys(stock).length === 0 && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>Нет ни одного размера — добавьте ниже</div>
        )}
      </div>

      {/* Add new size */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="text" placeholder="Размер (41, M, XL, one_size...)"
          value={newSize}
          onChange={e => setNewSize(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addSize()}
          style={{ flex: 1, minWidth: 120, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
        />
        <input
          type="number" min={0} value={newQty}
          onChange={e => setNewQty(Number(e.target.value))}
          style={{ width: 70, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '8px 10px', color: '#fff', fontSize: 13, outline: 'none', textAlign: 'center' }}
        />
        <button onClick={addSize} style={{
          background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)',
          color: '#10b981', borderRadius: 10, padding: '0 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6
        }}>
          <Plus size={14} /> Добавить
        </button>
      </div>

      <button onClick={handleSave} disabled={saving} style={{
        background: 'linear-gradient(135deg, #10b981, #059669)',
        border: 'none', color: '#fff', borderRadius: 10, padding: '8px 18px',
        fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
      }}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
        Сохранить остатки
      </button>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────
export const ArticlesPage: React.FC = () => {
  const [tab, setTab] = useState<'articles' | 'orders' | 'bot'>('articles');

  // Articles
  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticleModal, setSelectedArticleModal] = useState<ArticleItem | null>(null);

  // Orders
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Bot
  const [botConfig, setBotConfig] = useState<BotConfig>({});
  const [botToken, setBotToken] = useState('');
  const [managerChatId, setManagerChatId] = useState('');
  const [managerUsername, setManagerUsername] = useState('');
  const [articlePrefix, setArticlePrefix] = useState('ART');
  const [welcomeMsg, setWelcomeMsg] = useState('Привет! Введите артикул товара для заказа (например: ART-0001)');
  const [botStatus, setBotStatus] = useState<'idle' | 'running' | 'saving'>('idle');
  const [botSaveMsg, setBotSaveMsg] = useState('');

  const fetchArticles = useCallback(async () => {
    setLoadingArticles(true);
    try {
      const res = await fetch('/api/articles');
      if (res.ok) { const d = await res.json(); setArticles(d.articles || []); }
    } finally { setLoadingArticles(false); }
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const res = await fetch('/api/orders');
      if (res.ok) { const d = await res.json(); setOrders(d.orders || []); }
    } finally { setLoadingOrders(false); }
  }, []);

  const fetchBotConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/orderbot/config');
      if (res.ok) {
        const d = await res.json();
        if (d.config) {
          setBotConfig(d.config);
          setManagerChatId(d.config.manager_chat_id || '');
          setManagerUsername(d.config.manager_username || '');
          setArticlePrefix(d.config.article_prefix || 'ART');
          setWelcomeMsg(d.config.welcome_message || '');
          setBotStatus(d.config.is_active ? 'running' : 'idle');
        }
      }
    } catch (e) {}
  }, []);

  useEffect(() => { fetchArticles(); fetchOrders(); fetchBotConfig(); }, []);

  const handleStockSave = async (id: string, stock: Record<string, number>) => {
    const res = await fetch(`/api/articles/${id}/stock`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock })
    });
    if (res.ok) fetchArticles();
  };

  const handleToggleArticle = async (id: string) => {
    await fetch(`/api/articles/${id}/toggle`, { method: 'PUT' });
    fetchArticles();
  };

  const handleDeleteArticle = async (id: string) => {
    if (!confirm('Удалить товар и все связанные заказы?')) return;
    await fetch(`/api/articles/${id}`, { method: 'DELETE' });
    fetchArticles();
  };

  const handleOrderStatus = async (orderId: string, status: string) => {
    await fetch(`/api/orders/${orderId}/status`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    fetchOrders();
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const saveBotConfig = async () => {
    if (!botToken.trim()) { alert('Введите токен бота!'); return; }
    setBotStatus('saving');
    const res = await fetch('/api/orderbot/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bot_token: botToken,
        manager_chat_id: managerChatId || null,
        manager_username: managerUsername || null,
        welcome_message: welcomeMsg,
        article_prefix: articlePrefix
      })
    });
    if (res.ok) { setBotSaveMsg('✅ Конфигурация сохранена!'); fetchBotConfig(); }
    else { setBotSaveMsg('❌ Ошибка сохранения'); }
    setBotStatus('idle');
    setTimeout(() => setBotSaveMsg(''), 3000);
  };

  const toggleBot = async () => {
    const endpoint = botStatus === 'running' ? '/api/orderbot/stop' : '/api/orderbot/start';
    const res = await fetch(endpoint, { method: 'POST' });
    if (res.ok) { setBotStatus(botStatus === 'running' ? 'idle' : 'running'); }
  };

  // ─── UI Helpers ───────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 20, padding: 20
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none',
    fontFamily: 'inherit'
  };

  const totalStock = (stock: Record<string, number>) => Object.values(stock).reduce((a, b) => a + b, 0);
  const newOrdersCount = orders.filter(o => o.status === 'new').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Package size={28} color="#f4a623" /> Склад & Заказы
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '6px 0 0' }}>
          Управление артикулами товаров, остатками и заказами через Telegram-бот
        </p>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
        {[
          { label: 'Товаров в каталоге', value: articles.length, icon: '📦', color: '#f4a623' },
          { label: 'Активных позиций', value: articles.filter(a => a.is_active).length, icon: '✅', color: '#10b981' },
          { label: 'Новых заказов', value: newOrdersCount, icon: '🛒', color: newOrdersCount > 0 ? '#e63946' : '#6b7280' },
          { label: 'Всего заказов', value: orders.length, icon: '📋', color: '#7c3aed' },
        ].map(s => (
          <div key={s.label} style={{ ...cardStyle, textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 6, width: 'fit-content' }}>
        {([
          { key: 'articles', label: '📦 Каталог артикулов', badge: articles.length },
          { key: 'orders', label: '🛒 Заказы', badge: newOrdersCount || undefined },
          { key: 'bot', label: '🤖 Бот Заказов' },
        ] as Array<{ key: 'articles' | 'orders' | 'bot'; label: string; badge?: number }>).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13,
            fontWeight: tab === t.key ? 700 : 500,
            background: tab === t.key ? 'linear-gradient(135deg, #e63946, #c0392b)' : 'transparent',
            color: tab === t.key ? '#fff' : 'rgba(255,255,255,0.5)',
            display: 'flex', alignItems: 'center', gap: 6, position: 'relative'
          }}>
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span style={{ background: '#e63946', color: '#fff', borderRadius: 100, padding: '1px 7px', fontSize: 10, fontWeight: 800 }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── ARTICLES TAB ─────────────────────────────────────── */}
      {tab === 'articles' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Top Bar: Search & Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{
              flex: 1, minWidth: 260, display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12, padding: '8px 14px'
            }}>
              <Search size={16} color="rgba(255,255,255,0.4)" />
              <input
                type="text"
                placeholder="🔍 Поиск по артикулу или названию (например ART-0001)..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: '#fff', outline: 'none', width: '100%', fontSize: 13 }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', display: 'flex' }}>
                  <X size={14} />
                </button>
              )}
            </div>

            <button onClick={fetchArticles} disabled={loadingArticles} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600
            }}>
              <RefreshCw size={14} /> Обновить
            </button>
          </div>

          {loadingArticles ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.4)' }}>
              <Loader2 size={30} style={{ margin: '0 auto 12px' }} /> Загрузка...
            </div>
          ) : articles.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: 'center', padding: '40px 20px' }}>
              <Package size={48} color="#f4a623" style={{ margin: '0 auto 12px', opacity: 0.5 }} />
              <div style={{ fontWeight: 700, color: '#fff', marginBottom: 8 }}>Каталог пуст</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
                Перейдите в <b>🛒 Интернет Магазин</b>, включите тумблер<br/>
                <b style={{ color: '#f4a623' }}>«Создавать артикулы»</b> и запустите копирование
              </div>
            </div>
          ) : (
            articles
              .filter(a => {
                if (!searchQuery.trim()) return true;
                const q = searchQuery.toLowerCase().trim();
                return (
                  a.article_code.toLowerCase().includes(q) ||
                  a.title.toLowerCase().includes(q) ||
                  (a.source_channel && a.source_channel.toLowerCase().includes(q))
                );
              })
              .map(article => (
              <div key={article.id} style={{
                ...cardStyle,
                borderColor: article.is_active ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.07)',
                opacity: article.is_active ? 1 : 0.65
              }}>
                {/* Article Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  {/* Product Image Thumbnail */}
                  <div
                    onClick={() => setSelectedArticleModal(article)}
                    title="Нажмите для просмотра фото"
                    style={{
                      width: 68,
                      height: 68,
                      borderRadius: 12,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      overflow: 'hidden',
                      flexShrink: 0,
                      cursor: 'pointer',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'transform 0.15s ease'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                    onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    <img
                      src={`/api/articles/${article.id}/image`}
                      alt={article.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={e => {
                        (e.target as HTMLElement).style.display = 'none';
                        const parent = (e.target as HTMLElement).parentElement;
                        if (parent) {
                          const fb = parent.querySelector('.img-fallback') as HTMLElement;
                          if (fb) fb.style.display = 'flex';
                        }
                      }}
                    />
                    <div className="img-fallback" style={{ display: 'none', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 24 }}>
                      📦
                    </div>
                  </div>

                  {/* Article Code Badge */}
                  <div style={{
                    background: 'linear-gradient(135deg, #f4a623, #d97706)',
                    color: '#000', fontWeight: 900, fontSize: 13, borderRadius: 10,
                    padding: '6px 12px', whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0
                  }} onClick={() => copyCode(article.article_code)}>
                    {copiedCode === article.article_code ? <span>✅ Скопирован</span> : <span>🏷️ {article.article_code}</span>}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: 15, marginBottom: 4, wordBreak: 'break-word' }}>
                      {article.title}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
                      {article.price && <span style={{ color: '#10b981', fontWeight: 700 }}>💰 {article.price} {article.currency}</span>}
                      {article.wholesale_price && <span style={{ color: '#f4a623' }}>Опт: {article.wholesale_price}</span>}
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>📦 В наличии: {totalStock(article.stock)} шт</span>
                      {article.orders_count > 0 && <span style={{ color: '#7c3aed', fontWeight: 700 }}>🛒 {article.orders_count} заказов</span>}
                    </div>
                  </div>

                  {/* Controls */}
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                    <button onClick={() => setSelectedArticleModal(article)} style={{
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 8, padding: '6px 10px', color: '#fff', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
                    }}>
                      <ImageIcon size={13} /> Фото
                    </button>
                    {/* Ссылка на пост в канале-доноре */}
                    {article.donor_post_url ? (
                      <a
                        href={article.donor_post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Открыть оригинальный пост товара в канале-доноре"
                        style={{
                          background: 'rgba(244,166,35,0.15)', border: '1px solid rgba(244,166,35,0.35)',
                          borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 5,
                          color: '#f4a623', fontSize: 12, fontWeight: 600, textDecoration: 'none'
                        }}
                      >
                        <ExternalLink size={12} /> Донор
                      </a>
                    ) : article.source_channel ? (
                      <a
                        href={`https://t.me/${article.source_channel.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Открыть канал-донор"
                        style={{
                          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 5,
                          color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600, textDecoration: 'none'
                        }}
                      >
                        <ExternalLink size={12} /> Донор
                      </a>
                    ) : null}

                    {/* Ссылка на пост в нашем канале */}
                    {article.telegram_post_url && (
                      <a
                        href={article.telegram_post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Открыть опубликованный пост в нашем канале"
                        style={{
                          background: 'rgba(55,136,216,0.2)', border: '1px solid rgba(55,136,216,0.4)',
                          borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 5,
                          color: '#37a3f0', fontSize: 12, fontWeight: 600, textDecoration: 'none'
                        }}
                      >
                        <ExternalLink size={12} /> Наш пост
                      </a>
                    )}
                    <button onClick={() => handleToggleArticle(article.id)} style={{
                      background: article.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${article.is_active ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 8, padding: '6px 10px', color: article.is_active ? '#10b981' : 'rgba(255,255,255,0.4)',
                      cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4
                    }}>
                      {article.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      {article.is_active ? 'Активен' : 'Снят'}
                    </button>
                    <button onClick={() => setExpandedArticle(expandedArticle === article.id ? null : article.id)} style={{
                      background: 'rgba(244,166,35,0.1)', border: '1px solid rgba(244,166,35,0.3)',
                      borderRadius: 8, padding: '6px 10px', color: '#f4a623', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600
                    }}>
                      <Package size={13} />
                      {expandedArticle === article.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <button onClick={() => handleDeleteArticle(article.id)} style={{
                      background: 'rgba(230,57,70,0.1)', border: '1px solid rgba(230,57,70,0.3)',
                      borderRadius: 8, padding: '6px 8px', color: '#e63946', cursor: 'pointer', display: 'flex'
                    }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Expanded stock editor */}
                {expandedArticle === article.id && (
                  <StockEditor article={article} onSave={handleStockSave} />
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── IMAGE MODAL LIGHTBOX ──────────────────────────────── */}
      {selectedArticleModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }} onClick={() => setSelectedArticleModal(null)}>
          <div style={{
            background: '#18181b', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 20, padding: 24, maxWidth: 520, width: '100%',
            boxShadow: '0 25px 60px rgba(0,0,0,0.9)', position: 'relative'
          }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedArticleModal(null)} style={{
              position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.1)',
              border: 'none', borderRadius: '50%', width: 32, height: 32, color: '#fff',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <X size={18} />
            </button>

            <div style={{
              width: '100%', height: 340, borderRadius: 14, overflow: 'hidden',
              background: '#09090b', marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <img
                src={`/api/articles/${selectedArticleModal.id}/image`}
                alt={selectedArticleModal.title}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={e => {
                  (e.target as HTMLElement).style.display = 'none';
                  const parent = (e.target as HTMLElement).parentElement;
                  if (parent) {
                    const msg = document.createElement('div');
                    msg.innerText = '📷 Фото отсутствует или еще не загружено';
                    msg.style.color = 'rgba(255,255,255,0.4)';
                    msg.style.fontSize = '14px';
                    parent.appendChild(msg);
                  }
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{
                background: 'linear-gradient(135deg, #f4a623, #d97706)',
                color: '#000', fontWeight: 900, fontSize: 13, borderRadius: 8, padding: '4px 10px'
              }}>
                🏷️ {selectedArticleModal.article_code}
              </span>
              {selectedArticleModal.price && (
                <span style={{ color: '#10b981', fontWeight: 700, fontSize: 16 }}>
                  💰 {selectedArticleModal.price} {selectedArticleModal.currency}
                </span>
              )}
            </div>

            <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              {selectedArticleModal.title}
            </div>

            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <span>Канал: <b>{selectedArticleModal.source_channel || 'Не указан'}</b></span>
              <span>В наличии: <b>{totalStock(selectedArticleModal.stock)} шт</b></span>
              {selectedArticleModal.orders_count > 0 && <span>Заказов: <b>{selectedArticleModal.orders_count}</b></span>}
            </div>

            {/* Direct Links to Donor Post and Target Channel Post */}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              {selectedArticleModal.donor_post_url ? (
                <a
                  href={selectedArticleModal.donor_post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1, minWidth: 160, background: 'rgba(244,166,35,0.15)', border: '1px solid rgba(244,166,35,0.4)',
                    borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    color: '#f4a623', fontSize: 13, fontWeight: 700, textDecoration: 'none'
                  }}
                >
                  <ExternalLink size={14} /> Открыть пост в доноре
                </a>
              ) : selectedArticleModal.source_channel ? (
                <a
                  href={`https://t.me/${selectedArticleModal.source_channel.replace('@', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1, minWidth: 160, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 700, textDecoration: 'none'
                  }}
                >
                  <ExternalLink size={14} /> Открыть канал донора
                </a>
              ) : null}

              {selectedArticleModal.telegram_post_url && (
                <a
                  href={selectedArticleModal.telegram_post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1, minWidth: 160, background: 'rgba(55,136,216,0.2)', border: '1px solid rgba(55,136,216,0.5)',
                    borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    color: '#37a3f0', fontSize: 13, fontWeight: 700, textDecoration: 'none'
                  }}
                >
                  <ExternalLink size={14} /> Открыть наш пост
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ORDERS TAB ───────────────────────────────────────── */}
      {tab === 'orders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            {newOrdersCount > 0 && (
              <div style={{
                background: 'rgba(230,57,70,0.12)', border: '1px solid rgba(230,57,70,0.3)',
                borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14
              }}>
                <Bell size={16} color="#e63946" />
                <span style={{ color: '#fff', fontWeight: 700 }}>
                  {newOrdersCount} новых {newOrdersCount === 1 ? 'заказ' : 'заказа'} ожидают обработки!
                </span>
              </div>
            )}
            <button onClick={fetchOrders} disabled={loadingOrders} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff', borderRadius: 10, padding: '8px 14px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, marginLeft: 'auto'
            }}>
              <RefreshCw size={14} /> Обновить
            </button>
          </div>

          {loadingOrders ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.4)' }}>Загрузка заказов...</div>
          ) : orders.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: 'center', padding: '40px 20px' }}>
              <ShoppingCart size={48} color="#7c3aed" style={{ margin: '0 auto 12px', opacity: 0.5 }} />
              <div style={{ fontWeight: 700, color: '#fff', marginBottom: 8 }}>Заказов пока нет</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
                Настройте бота заказов во вкладке <b>🤖 Бот Заказов</b> и клиенты смогут оформлять заказы через Telegram
              </div>
            </div>
          ) : (
            orders.map(order => {
              const s = STATUS_LABELS[order.status] || STATUS_LABELS.new;
              return (
                <div key={order.id} style={{
                  ...cardStyle,
                  borderLeft: `4px solid ${s.color}`,
                  borderColor: `${s.color}44`
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                        <span style={{ background: 'rgba(244,166,35,0.2)', color: '#f4a623', fontWeight: 800, borderRadius: 8, padding: '3px 10px', fontSize: 13 }}>
                          🏷️ {order.article_code}
                        </span>
                        <span style={{ color: s.color, fontSize: 12, fontWeight: 700 }}>{s.label}</span>
                        {order.selected_size && <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>Размер: <b>{order.selected_size}</b></span>}
                        {order.foot_size_cm && <span style={{ color: '#38bdf8', fontSize: 13, fontWeight: 700 }}>👣 Стопа: <b>{order.foot_size_cm}</b></span>}
                        {order.height_weight && <span style={{ color: '#a78bfa', fontSize: 13, fontWeight: 700 }}>⚖️ Рост/вес: <b>{order.height_weight}</b></span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
                        {order.customer_name && <span>👤 {order.customer_name}</span>}
                        {order.customer_phone && <span>📱 {order.customer_phone}</span>}
                        {order.customer_username && <span>🔗 @{order.customer_username.replace('@', '')}</span>}
                        {order.price_at_order && <span style={{ color: '#10b981', fontWeight: 700 }}>💰 {order.price_at_order}</span>}
                      </div>
                      {order.supplier_message && (
                        <div style={{
                          marginTop: 10, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 10, padding: 10
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>📋 Текст для поставщика:</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(order.supplier_message || '');
                                alert('Текст для поставщика скопирован!');
                              }}
                              style={{
                                background: 'rgba(56,189,248,0.2)', border: '1px solid rgba(56,189,248,0.4)',
                                color: '#38bdf8', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              📋 Скопировать
                            </button>
                          </div>
                          <div style={{ fontSize: 12, color: '#e2e8f0', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                            {order.supplier_message}
                          </div>
                        </div>
                      )}
                      {order.created_at && (
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>
                          {new Date(order.created_at).toLocaleString('ru-RU')}
                        </div>
                      )}
                    </div>

                    {/* Status Selector */}
                    <select
                      value={order.status}
                      onChange={e => handleOrderStatus(order.id, e.target.value)}
                      style={{
                        background: 'rgba(0,0,0,0.5)', border: `1px solid ${s.color}66`,
                        borderRadius: 10, padding: '8px 12px', color: s.color,
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none'
                      }}
                    >
                      {Object.entries(STATUS_LABELS).map(([key, val]) => (
                        <option key={key} value={key} style={{ color: '#fff', background: '#111' }}>{val.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── BOT CONFIG TAB ───────────────────────────────────── */}
      {tab === 'bot' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
          {/* Bot Status Badge */}
          <div style={{
            ...cardStyle,
            background: botStatus === 'running'
              ? 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(5,150,105,0.05))'
              : 'rgba(255,255,255,0.03)',
            borderColor: botStatus === 'running' ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 14,
                background: botStatus === 'running' ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Bot size={22} color={botStatus === 'running' ? '#fff' : 'rgba(255,255,255,0.4)'} />
              </div>
              <div>
                <div style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>
                  Бот Заказов {botConfig.bot_username ? `(@${botConfig.bot_username})` : ''}
                </div>
                <div style={{ fontSize: 12, color: botStatus === 'running' ? '#10b981' : 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
                  {botStatus === 'running' ? '🟢 Запущен — принимает заказы' : '⚫ Остановлен'}
                </div>
              </div>
            </div>
            {botConfig.id && (
              <button onClick={toggleBot} style={{
                padding: '10px 18px', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                border: 'none', display: 'flex', alignItems: 'center', gap: 8,
                background: botStatus === 'running'
                  ? 'rgba(230,57,70,0.2)' : 'linear-gradient(135deg, #10b981, #059669)',
                color: botStatus === 'running' ? '#e63946' : '#fff'
              }}>
                {botStatus === 'running' ? <><Square size={16} /> Остановить</> : <><Play size={16} /> Запустить</>}
              </button>
            )}
          </div>

          {/* Instructions */}
          <div style={{
            background: 'rgba(244,166,35,0.08)', border: '1px solid rgba(244,166,35,0.2)',
            borderRadius: 16, padding: 18, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.7
          }}>
            <div style={{ fontWeight: 800, color: '#f4a623', marginBottom: 10, fontSize: 14 }}>
              📖 Как получить Bot Token за 1 минуту:
            </div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>Открой Telegram → найди <b>@BotFather</b></li>
              <li>Напиши <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 6px', borderRadius: 4 }}>/newbot</code></li>
              <li>Придумай имя и username для бота (например: <b>MyShopOrderBot</b>)</li>
              <li>Скопируй токен вида <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 6px', borderRadius: 4 }}>7234567890:ABC...</code></li>
              <li>Вставь его ниже и нажми <b>Сохранить</b></li>
            </ol>
          </div>

          {/* Form */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bot size={18} color="#e63946" /> Настройки бота
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                  🔑 Токен бота (от @BotFather) *
                </label>
                <input
                  type="password" value={botToken}
                  onChange={e => setBotToken(e.target.value)}
                  placeholder="7234567890:ABCDEFG_токен_бота..."
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                    📲 Chat ID менеджера
                  </label>
                  <input
                    value={managerChatId}
                    onChange={e => setManagerChatId(e.target.value)}
                    placeholder="123456789"
                    style={inputStyle}
                  />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                    Узнай через @userinfobot
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                    🏷️ Префикс артикулов
                  </label>
                  <input
                    value={articlePrefix}
                    onChange={e => setArticlePrefix(e.target.value.toUpperCase().replace(/\s/g, ''))}
                    placeholder="ART"
                    maxLength={10}
                    style={inputStyle}
                  />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                    Пример: SHOE → SHOE-0001
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                  💬 Приветственное сообщение бота
                </label>
                <textarea
                  value={welcomeMsg}
                  onChange={e => setWelcomeMsg(e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>

              <button onClick={saveBotConfig} disabled={botStatus === 'saving'} style={{
                background: 'linear-gradient(135deg, #e63946, #c0392b)',
                border: 'none', color: '#fff', borderRadius: 14, padding: '13px',
                fontWeight: 800, fontSize: 15, cursor: 'pointer',
                boxShadow: '0 0 30px rgba(230,57,70,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
              }}>
                {botStatus === 'saving' ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                Сохранить конфигурацию бота
              </button>

              {botSaveMsg && (
                <div style={{ textAlign: 'center', color: botSaveMsg.startsWith('✅') ? '#10b981' : '#e63946', fontWeight: 700, fontSize: 14 }}>
                  {botSaveMsg}
                </div>
              )}
            </div>
          </div>

          {/* How bot works */}
          <div style={{ ...cardStyle, padding: 20 }}>
            <div style={{ fontWeight: 700, color: '#fff', marginBottom: 14, fontSize: 15 }}>
              ⚡ Как это работает для покупателей
            </div>
            {[
              ['1', 'Пост публикуется в твой канал с кнопкой «🛒 Заказать (ART-0001)»', '#e63946'],
              ['2', 'Покупатель нажимает кнопку и попадает в твоего бота', '#f4a623'],
              ['3', 'Бот показывает: фото товара, цены, доступные размеры и остатки', '#10b981'],
              ['4', 'Покупатель выбирает размер, вводит имя и телефон', '#7c3aed'],
              ['5', 'Ты получаешь уведомление с заказом прямо в Telegram!', '#3b82f6'],
            ].map(([num, text, color]) => (
              <div key={num} style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  background: `${color}22`, border: `1px solid ${color}55`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color, fontSize: 11, fontWeight: 800
                }}>
                  {num}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
