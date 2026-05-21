import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

const C = {
  bg:          '#0d1520',
  revenue:     '#3b82f6',
  ebitda:      '#818cf8',
  netIncome:   '#94a3b8',
  opCF:        '#3b82f6',
  capex:       '#fb923c',
  fcf:         '#64748b',
  totalAssets: '#34d399',
  cash:        '#3b82f6',
  totalDebt:   '#f87171',
  equity:      '#818cf8',
  grossMargin: '#38bdf8',
  netMargin:   '#a78bfa',
  growth:      '#818cf8',
};

const fmtAxis = (v: number | null): string => {
  if (v == null) return '';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const fmtPctAxis = (v: number | null): string =>
  v == null ? '' : `${v.toFixed(0)}%`;

const fmtMoney = (v: number | null): string => {
  if (v == null) return 'N/D';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(2)}`;
};

const ttStyle = {
  backgroundColor: '#0f172a',
  borderColor: '#1e293b',
  borderRadius: '4px',
  color: '#cbd5e1',
  fontFamily: 'monospace',
  fontSize: '11px',
};

const moneyFmt = (v: number | null, name: string): [string, string] =>
  [fmtMoney(v), name];

const pctFmt = (v: number | null, name: string): [string, string] =>
  [v == null ? 'N/D' : `${v.toFixed(1)}%`, name];

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    width: '100%',
    height: 320,
    backgroundColor: C.bg,
    padding: '10px 6px',
    border: '1px solid #1e293b',
    borderRadius: 2,
  }}>
    <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
  </div>
);

const Grid = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />;
const XA   = <XAxis dataKey="period" stroke="#475569" tickLine={false} style={{ fontSize: '10px' }} />;
const MoneyY = <YAxis stroke="#475569" tickLine={false} tickFormatter={fmtAxis} style={{ fontSize: '10px' }} width={62} />;
const PctY   = <YAxis stroke="#475569" tickLine={false} tickFormatter={fmtPctAxis} style={{ fontSize: '10px' }} width={38} />;
const Leg  = <Legend verticalAlign="top" height={26} iconType="circle" wrapperStyle={{ fontSize: '10px', letterSpacing: '0.04em' }} />;
const Zero = <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />;

const dot  = (color: string) => ({ r: 3, fill: color, strokeWidth: 0 });
const adot = { r: 5 };

const L = (key: string, name: string, color: string, extra: object = {}) => (
  <Line
    key={key}
    type="monotone"
    dataKey={key}
    name={name}
    stroke={color}
    strokeWidth={2}
    dot={dot(color)}
    activeDot={adot}
    connectNulls
    {...extra}
  />
);

// ── Income Statement (P&L) ────────────────────────────────────────────
export interface IncomeData {
  period: string;
  revenue: number | null;
  ebitda: number | null;
  netIncome: number | null;
}
export const IncomeChart = ({ data }: { data: IncomeData[] }) => (
  <Frame>
    <LineChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA}{MoneyY}
      <Tooltip contentStyle={ttStyle} formatter={moneyFmt} cursor={{ stroke: '#334155' }} />
      {Leg}
      {L('revenue',   'Revenue',    C.revenue)}
      {L('ebitda',    'EBITDA',     C.ebitda)}
      {L('netIncome', 'Net Income', C.netIncome)}
    </LineChart>
  </Frame>
);

// ── Cash Flow ─────────────────────────────────────────────────────────
export interface CashFlowData {
  period: string;
  operating: number | null;
  capex: number | null;
  fcf: number | null;
}
export const CashFlowChart = ({ data }: { data: CashFlowData[] }) => (
  <Frame>
    <LineChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA}{MoneyY}{Zero}
      <Tooltip contentStyle={ttStyle} formatter={moneyFmt} cursor={{ stroke: '#334155' }} />
      {Leg}
      {L('operating', 'Operating CF',   C.opCF)}
      {L('capex',     'CapEx',          C.capex)}
      {L('fcf',       'Free Cash Flow', C.fcf)}
    </LineChart>
  </Frame>
);

// ── Balance Sheet ─────────────────────────────────────────────────────
export interface BalanceData {
  period: string;
  totalAssets: number | null;
  cash: number | null;
  totalDebt: number | null;
  equity: number | null;
}
export const BalanceChart = ({ data }: { data: BalanceData[] }) => (
  <Frame>
    <LineChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA}{MoneyY}
      <Tooltip contentStyle={ttStyle} formatter={moneyFmt} cursor={{ stroke: '#334155' }} />
      {Leg}
      {L('totalAssets', 'Total Assets', C.totalAssets)}
      {L('cash',        'Cash',         C.cash)}
      {L('totalDebt',   'Total Debt',   C.totalDebt)}
      {L('equity',      'Equity',       C.equity)}
    </LineChart>
  </Frame>
);

// ── Margins ───────────────────────────────────────────────────────────
export interface MarginsData {
  period: string;
  grossMargin: number | null;
  netMargin: number | null;
}
export const MarginsChart = ({ data }: { data: MarginsData[] }) => (
  <Frame>
    <LineChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA}{PctY}{Zero}
      <Tooltip contentStyle={ttStyle} formatter={pctFmt} cursor={{ stroke: '#334155' }} />
      {Leg}
      {L('grossMargin', 'Gross Margin', C.grossMargin)}
      {L('netMargin',   'Net Margin',   C.netMargin)}
    </LineChart>
  </Frame>
);

// ── Revenue Growth YoY ────────────────────────────────────────────────
export interface GrowthData {
  period: string;
  revenueGrowth: number | null;
}
export const GrowthChart = ({ data }: { data: GrowthData[] }) => (
  <Frame>
    <LineChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA}{PctY}{Zero}
      <Tooltip contentStyle={ttStyle} formatter={pctFmt} cursor={{ stroke: '#334155' }} />
      {Leg}
      {L('revenueGrowth', 'Revenue Growth YoY', C.growth)}
    </LineChart>
  </Frame>
);
