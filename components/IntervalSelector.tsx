import React from 'react';
import { Clock, Zap } from 'lucide-react';

interface IntervalSelectorProps {
  value: number; // in minutes
  onChange: (val: number) => void;
  accentColor?: string; // e.g. '#f4a623' or '#e63946'
}

export const formatIntervalDescription = (mins: number): string => {
  if (mins <= 0) return '⚡ Мгновенно (без задержки между постами)';
  if (mins === 1) return '⏱️ Каждую 1 минуту (60 сек пауза между постами)';
  if (mins < 60) return `⏱️ Каждые ${mins} минут паузы между постами`;
  
  const h = Math.floor(mins / 60);
  const remM = mins % 60;
  
  const getHourWord = (num: number) => {
    if (num % 10 === 1 && num % 100 !== 11) return 'час';
    if ([2, 3, 4].includes(num % 10) && ![12, 13, 14].includes(num % 100)) return 'часа';
    return 'часов';
  };

  if (remM === 0) {
    return `⏱️ Каждые ${h} ${getHourWord(h)} (${mins} мин паузы)`;
  }
  return `⏱️ Каждые ${h} ч ${remM} мин (${mins} мин паузы)`;
};

export const IntervalSelector: React.FC<IntervalSelectorProps> = ({
  value,
  onChange,
  accentColor = '#f4a623'
}) => {
  const presets = [
    { label: '⚡ 0 мин (Сразу)', val: 0 },
    { label: '1 мин', val: 1 },
    { label: '2 мин', val: 2 },
    { label: '5 мин', val: 5 },
    { label: '15 мин', val: 15 },
    { label: '30 мин', val: 30 },
    { label: '1 час (60 мин)', val: 60 },
    { label: '2 часа (120 мин)', val: 120 },
    { label: '3 часа (180 мин)', val: 180 },
    { label: '6 часов (360 мин)', val: 360 },
    { label: '12 часов (720 мин)', val: 720 },
    { label: '24 часа (1440 мин)', val: 1440 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={15} color={accentColor} /> Интервал публикации
        </label>
        <span style={{ fontSize: 12, color: accentColor, fontWeight: 700, background: `${accentColor}18`, padding: '3px 8px', borderRadius: 6, border: `1px solid ${accentColor}40` }}>
          {formatIntervalDescription(value)}
        </span>
      </div>

      {/* Manual Input Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="number"
            min={0}
            max={10080}
            value={value === 0 ? '' : value}
            onChange={e => {
              const num = parseInt(e.target.value, 10);
              onChange(isNaN(num) || num < 0 ? 0 : num);
            }}
            placeholder="0 (без задержки)"
            style={{
              width: '100%',
              background: 'rgba(0,0,0,0.5)',
              border: `1px solid ${value > 0 ? accentColor : 'rgba(255,255,255,0.15)'}`,
              borderRadius: 10,
              padding: '10px 14px',
              paddingRight: 60,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              outline: 'none'
            }}
          />
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', fontSize: 12, pointerEvents: 'none' }}>
            минут
          </span>
        </div>

        {value > 0 && (
          <button
            type="button"
            onClick={() => onChange(0)}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.7)',
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
            title="Сбросить интервал и постить сразу"
          >
            <Zap size={13} /> Без паузы
          </button>
        )}
      </div>

      {/* Quick Presets Grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
        {presets.map(p => {
          const isSelected = value === p.val;
          return (
            <button
              key={p.val}
              type="button"
              onClick={() => onChange(p.val)}
              style={{
                background: isSelected ? `${accentColor}25` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isSelected ? accentColor : 'rgba(255,255,255,0.08)'}`,
                color: isSelected ? '#fff' : 'rgba(255,255,255,0.65)',
                fontWeight: isSelected ? 700 : 500,
                fontSize: 11,
                padding: '5px 9px',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
