import React from 'react';
import {
  AreaChart, Area, ResponsiveContainer, YAxis, XAxis, Tooltip, CartesianGrid,
} from 'recharts';

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

const fmtTickDate = (t: number): string => {
  const d = new Date(t * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export function IndexSparkline({ label, symbol, price, change1d, change1m, candle }: IndexSparklineProps) {
  const data = candle && candle.c.length > 1
    ? candle.c.map((c, i) => ({ v: c, t: candle.t[i] }))
    : [];
  const isPos = (change1d ?? 0) >= 0;
  const color = isPos ? POS : NEG;

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
      padding: '8px 10px 6px',
      marginBottom: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 9,
            letterSpacing: '0.12em',
            color: '#94a3b8',
            textTransform: 'uppercase',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontWeight: 600,
          }}>{label}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginTop: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
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

      {/* Chart — taller, with X/Y axis labels (native design, like TradingView) */}
      {data.length > 1 ? (
        <div style={{ marginTop: 6 }}>
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="2 3" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={fmtTickDate}
                stroke="#334155"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={36}
                style={{ fontSize: 8, fontFamily: 'monospace' }}
              />
              <YAxis
                domain={['dataMin', 'dataMax']}
                stroke="#334155"
                tickLine={false}
                axisLine={false}
                width={36}
                tickFormatter={(v) => fmtPrice(v)}
                style={{ fontSize: 8, fontFamily: 'monospace' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#1e293b',
                  borderRadius: 4,
                  fontFamily: 'monospace',
                  fontSize: 10,
                }}
                labelFormatter={(t) => fmtTickDate(t as number)}
                formatter={(v: number) => [fmtPrice(v), 'Precio']}
                cursor={{ stroke: '#475569', strokeWidth: 1 }}
              />
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
              color: '#475569',
              fontFamily: 'monospace',
              letterSpacing: '0.05em',
              marginTop: 2,
            }}>
              <span>L {fmtPrice(lo)}</span>
              <span>H {fmtPrice(hi)}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{
          height: 110,
          marginTop: 6,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          border: '1px dashed #1e293b',
          borderRadius: 2,
        }}>
          <span style={{
            fontSize: 9,
            color: '#475569',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>Sin histórico disponible</span>
          <span style={{ fontSize: 8, color: '#334155', letterSpacing: '0.05em', fontFamily: 'monospace' }}>
            redeploy supabase
          </span>
        </div>
      )}
    </div>
  );
}
