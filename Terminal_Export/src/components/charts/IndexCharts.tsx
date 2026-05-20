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

const POS = '#3b82f6';   // blue-500
const NEG = '#f87171';   // red-400

const fmtPrice = (p: number | null) =>
  p != null
    ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

const fmtPct = (p: number | null) =>
  p != null ? `${p >= 0 ? '+' : ''}${p.toFixed(2)}%` : '—';

export function IndexSparkline({ label, symbol, price, change1d, change1m, candle }: IndexSparklineProps) {
  const data = candle && candle.c.length > 1 ? candle.c.map((c) => ({ v: c })) : [];
  const isPos = (change1d ?? 0) >= 0;
  const color = isPos ? POS : NEG;

  // 30-day high/low from candle
  let lo: number | null = null;
  let hi: number | null = null;
  if (data.length) {
    lo = Math.min(...candle!.c);
    hi = Math.max(...candle!.c);
  }

  return (
    <div style={{
      background: '#0d1520',
      border: '1px solid #1e293b',
      borderRadius: 4,
      padding: '7px 10px 6px',
      marginBottom: 4,
    }}>
      {/* Top row: label, price, day change */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 9,
            letterSpacing: '0.12em',
            color: '#64748b',
            textTransform: 'uppercase',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>{label}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginTop: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
              {fmtPrice(price)}
            </span>
            <span style={{ fontSize: 10, color, fontFamily: 'monospace' }}>
              {fmtPct(change1d)}
            </span>
          </div>
        </div>
        {change1m != null && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 8, color: '#475569', letterSpacing: '0.1em' }}>30D</div>
            <div style={{
              fontSize: 10,
              color: change1m >= 0 ? POS : NEG,
              fontFamily: 'monospace',
              lineHeight: 1.2,
            }}>{fmtPct(change1m)}</div>
          </div>
        )}
      </div>

      {/* Sparkline */}
      {data.length > 1 ? (
        <div style={{ marginTop: 3 }}>
          <ResponsiveContainer width="100%" height={36}>
            <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <YAxis domain={['dataMin', 'dataMax']} hide />
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#grad-${symbol})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          {lo != null && hi != null && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 8,
              color: '#334155',
              fontFamily: 'monospace',
              letterSpacing: '0.05em',
              marginTop: 1,
            }}>
              <span>L {fmtPrice(lo)}</span>
              <span>H {fmtPrice(hi)}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 2px', gap: 6, marginTop: 3 }}>
          <div style={{ flex: 1, height: 3, borderRadius: 2, background: '#1e293b', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, Math.max(8, 50 + (change1d ?? 0) * 8))}%`,
              height: '100%',
              background: color,
              borderRadius: 2,
            }} />
          </div>
          <span style={{ fontSize: 8, color: '#334155', letterSpacing: '0.05em', flexShrink: 0 }}>—</span>
        </div>
      )}
    </div>
  );
}
