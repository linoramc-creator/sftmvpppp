import React from 'react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';

interface CandleSeries { t: number[]; c: number[] }

interface IndexSparklineProps {
  label: string;
  symbol: string;
  price: number | null;
  change1d: number | null;
  change1m: number | null;
  candle: CandleSeries | null | undefined;
}

export function IndexSparkline({ label, symbol, price, change1d, change1m, candle }: IndexSparklineProps) {
  const data = candle && candle.c.length > 1
    ? candle.c.map((c) => ({ v: c }))
    : [];
  const isPos = (change1d ?? 0) >= 0;
  const color = isPos ? '#22c55e' : '#ef4444';
  const fmtPrice = (p: number | null) => p != null ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const fmtPct = (p: number | null) => p != null ? `${p >= 0 ? '+' : ''}${p.toFixed(2)}%` : '—';

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div>
          <span style={{ fontSize: 10, letterSpacing: '0.1em', color: '#64748b', textTransform: 'uppercase' }}>{label}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', fontFamily: 'monospace' }}>{fmtPrice(price)}</span>
            <span style={{ fontSize: 11, color, fontFamily: 'monospace' }}>{fmtPct(change1d)}</span>
          </div>
        </div>
        {change1m != null && (
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 9, color: '#475569', letterSpacing: '0.05em' }}>1M</span>
            <div style={{ fontSize: 11, color: (change1m >= 0 ? '#22c55e' : '#ef4444'), fontFamily: 'monospace' }}>{fmtPct(change1m)}</div>
          </div>
        )}
      </div>
      {data.length > 1 ? (
        <ResponsiveContainer width="100%" height={40}>
          <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={['dataMin', 'dataMax']} hide />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#grad-${symbol})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 2px', gap: 6 }}>
          <div style={{ flex: 1, height: 3, borderRadius: 2, background: '#1e293b', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, Math.max(8, 50 + (change1d ?? 0) * 8))}%`,
              height: '100%',
              background: color,
              borderRadius: 2,
            }} />
          </div>
          <span style={{ fontSize: 9, color: '#334155', letterSpacing: '0.05em', flexShrink: 0 }}>30D</span>
        </div>
      )}
    </div>
  );
}
