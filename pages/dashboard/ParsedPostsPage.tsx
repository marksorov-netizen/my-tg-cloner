import React, { useState, useEffect, useCallback } from 'react';
import { Newspaper, ExternalLink, Trash2, RefreshCw, Search, Layers, Radio, Image as ImageIcon, CheckCircle, AlertCircle, ArrowUpRight, Copy, Check, Filter } from 'lucide-react';
import { apiService } from '../../services/apiService';

interface ParsedPost {
  id: string;
  title: string;
  original_text?: string;
  processed_text?: string;
  source_channel?: string;
  source_msg_id?: number;
  target_channel?: string;
  target_msg_id?: number;
  donor_post_url?: string;
  telegram_post_url?: string;
  media_count: number;
  status: string;
  created_at?: string;
}

export const ParsedPostsPage: React.FC = () => {
  const [posts, setPosts] = useState<ParsedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDonor, setSelectedDonor] = useState<string>('all');
  const [selectedTarget, setSelectedTarget] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiService.getParsedPosts(200);
      if (res && res.status === 'ok') {
        setPosts(res.posts || []);
        setTotalCount(res.total || res.posts?.length || 0);
      }
    } catch (e) {
      console.error('Failed to load parsed posts:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить этот пост из истории архива?')) return;
    try {
      await apiService.deleteParsedPost(id);
      setPosts(prev => prev.filter(p => p.id !== id));
      setTotalCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      alert('Ошибка при удалении поста');
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Вы уверены, что хотите полностью очистить весь архив запарсенных постов?')) return;
    try {
      await apiService.clearParsedPosts();
      setPosts([]);
      setTotalCount(0);
    } catch (e) {
      alert('Ошибка при очистке архива');
    }
  };

  const copyText = (id: string, text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Get unique donor channels for filters
  const donorList = Array.from(new Set(posts.map(p => p.source_channel).filter(Boolean))) as string[];
  const targetList = Array.from(new Set(posts.map(p => p.target_channel).filter(Boolean))) as string[];

  // Filter posts
  const filteredPosts = posts.filter(p => {
    const matchSearch =
      (p.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.processed_text || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.original_text || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.source_channel || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchDonor = selectedDonor === 'all' || p.source_channel === selectedDonor;
    const matchTarget = selectedTarget === 'all' || p.target_channel === selectedTarget;

    return matchSearch && matchDonor && matchTarget;
  });

  const totalMedia = posts.reduce((sum, p) => sum + (p.media_count || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(230,57,70,0.15), rgba(15,15,15,0.95))',
        border: '1px solid rgba(230,57,70,0.3)',
        borderRadius: 24, padding: 32,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16,
              background: 'rgba(230,57,70,0.25)', border: '1px solid rgba(230,57,70,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28
            }}>
              📰
            </div>
            <div>
              <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>
                Архив запарсенных постов & Новостей
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 4, marginBottom: 0 }}>
                История всех перенесённых постов с прямыми ссылками на первоисточник донора и целевой канал
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={fetchPosts}
              disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', borderRadius: 12, padding: '10px 18px', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              Обновить
            </button>

            {posts.length > 0 && (
              <button
                onClick={handleClearAll}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(230,57,70,0.12)', border: '1px solid rgba(230,57,70,0.3)',
                  color: '#e63946', borderRadius: 12, padding: '10px 18px', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                <Trash2 size={15} />
                Очистить архив
              </button>
            )}
          </div>
        </div>

        {/* Metrics Bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 24 }}>
          <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '14px 18px' }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Всего постов в архиве</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginTop: 4 }}>{totalCount}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '14px 18px' }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Каналов-доноров</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#e63946', marginTop: 4 }}>{donorList.length}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '14px 18px' }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Целевых каналов</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#3b82f6', marginTop: 4 }}>{targetList.length}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '14px 18px' }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Фото и медиа перенесено</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981', marginTop: 4 }}>{totalMedia} шт.</div>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div style={{
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 18, padding: 18,
        display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center'
      }}>
        {/* Search */}
        <div style={{ flex: '1 1 240px', position: 'relative' }}>
          <Search size={16} color="rgba(255,255,255,0.4)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Поиск по заголовку, тексту или каналу..."
            style={{
              width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12, padding: '10px 14px 10px 38px', color: '#fff', fontSize: 14, outline: 'none'
            }}
          />
        </div>

        {/* Donor filter */}
        {donorList.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={15} color="rgba(255,255,255,0.4)" />
            <select
              value={selectedDonor}
              onChange={e => setSelectedDonor(e.target.value)}
              style={{
                background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 13, outline: 'none'
              }}
            >
              <option value="all">Все каналы-доноры</option>
              {donorList.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}

        {/* Target filter */}
        {targetList.length > 0 && (
          <select
            value={selectedTarget}
            onChange={e => setSelectedTarget(e.target.value)}
            style={{
              background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12, padding: '10px 14px', color: '#fff', fontSize: 13, outline: 'none'
            }}
          >
            <option value="all">Все целевые каналы</option>
            {targetList.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {/* Posts List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.4)' }}>
          <RefreshCw className="animate-spin" size={32} style={{ margin: '0 auto 16px' }} />
          <div>Загрузка архива постов...</div>
        </div>
      ) : filteredPosts.length === 0 ? (
        <div style={{
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 20, padding: 60, textAlign: 'center', color: 'rgba(255,255,255,0.4)'
        }}>
          <Newspaper size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
          <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 6 }}>Пока нет запарсенных постов</h3>
          <p style={{ fontSize: 14 }}>Запустите копирование в разделе «Парсер ТГ каналов», и здесь появятся все публикации со ссылками на посты-доноры.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filteredPosts.map((post, idx) => {
            const isExpanded = expandedId === post.id;
            return (
              <div
                key={post.id || idx}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 20, padding: 22,
                  transition: 'all 0.2s',
                  position: 'relative'
                }}
              >
                {/* Top Row: Title, Date, Badges */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
                        color: '#10b981', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                        display: 'flex', alignItems: 'center', gap: 4
                      }}>
                        <CheckCircle size={12} /> Опубликован
                      </span>

                      {post.media_count > 0 ? (
                        <span style={{
                          background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
                          color: '#3b82f6', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                          display: 'flex', alignItems: 'center', gap: 4
                        }}>
                          <ImageIcon size={12} /> {post.media_count} {post.media_count === 1 ? 'медиа' : 'медиафайлов (альбом)'}
                        </span>
                      ) : (
                        <span style={{
                          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                          color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20
                        }}>
                          📄 Текстовый пост
                        </span>
                      )}

                      {post.created_at && (
                        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                          {new Date(post.created_at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>

                    <h4 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: '0 0 10px 0', lineHeight: 1.4 }}>
                      {post.title || 'Новость без названия'}
                    </h4>
                  </div>

                  {/* Right: Direct Telegram links & Delete */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Direct link to donor post */}
                    {post.donor_post_url && (
                      <a
                        href={post.donor_post_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          background: 'rgba(230,57,70,0.12)', border: '1px solid rgba(230,57,70,0.3)',
                          color: '#e63946', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700,
                          textDecoration: 'none', transition: 'all 0.2s'
                        }}
                      >
                        <span>🔗 Пост донора</span>
                        <ArrowUpRight size={14} />
                      </a>
                    )}

                    {/* Direct link to our channel post */}
                    {post.telegram_post_url && (
                      <a
                        href={post.telegram_post_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
                          color: '#10b981', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700,
                          textDecoration: 'none', transition: 'all 0.2s'
                        }}
                      >
                        <span>📢 В канале</span>
                        <ArrowUpRight size={14} />
                      </a>
                    )}

                    <button
                      onClick={() => handleDelete(post.id)}
                      title="Удалить из архива"
                      style={{
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(255,255,255,0.4)', borderRadius: 10, padding: 8, cursor: 'pointer'
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Channel Route Info */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, marginTop: 10,
                  fontSize: 12, color: 'rgba(255,255,255,0.5)',
                  background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: 8, width: 'fit-content'
                }}>
                  <span style={{ color: '#e63946', fontWeight: 600 }}>Донор: {post.source_channel || 'Не указан'}</span>
                  <span>➔</span>
                  <span style={{ color: '#10b981', fontWeight: 600 }}>Канал: {post.target_channel || 'Не указан'}</span>
                </div>

                {/* Content Preview / Expanded */}
                <div style={{ marginTop: 14 }}>
                  <div style={{
                    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: 12, padding: 14, fontSize: 13, color: 'rgba(255,255,255,0.85)',
                    lineHeight: 1.6, whiteSpace: 'pre-wrap',
                    maxHeight: isExpanded ? 'none' : 100, overflow: 'hidden',
                    position: 'relative'
                  }}>
                    {post.processed_text || post.original_text || 'Нет текста'}
                    {!isExpanded && (post.processed_text?.length || 0) > 180 && (
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0, height: 40,
                        background: 'linear-gradient(transparent, rgba(0,0,0,0.8))'
                      }} />
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : post.id)}
                      style={{
                        background: 'none', border: 'none', color: '#e63946',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0
                      }}
                    >
                      {isExpanded ? '▲ Свернуть текст' : '▼ Показать текст полностью'}
                    </button>

                    <button
                      onClick={() => copyText(post.id, post.processed_text || post.original_text)}
                      style={{
                        background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                        fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
                      }}
                    >
                      {copiedId === post.id ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                      {copiedId === post.id ? 'Скопировано!' : 'Скопировать'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
