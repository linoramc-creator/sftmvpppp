import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, Cell, ReferenceLine,
} from 'recharts';

// Muted professional color palette
const C = {
  bg:          '#0d1520',
  revenue:     '#3b82f6',
  ebitda:      '#818cf8',
  netIncome:   '#64748b',
  opCF:        '#3b82f6',
  capex:       '#fb923c',
  fcf:         '#64748b',
  totalAssets: '#34d399',
  cash:        '#3b82f6',
  totalDebt:   '#f87171',
  equity:      '#64748b',
  grossMargin: '#38bdf8',
  netMargin:   '#a78bfa',
  posGrowth:   '#3b82f6',
  negGrowth:   '#f87171',
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

const XA = (dataKey = 'period') =>
  <XAxis dataKey={dataKey} stroke="#475569" tickLine={false} style={{ fontSize: '10px' }} />;
const MoneyY =
  <YAxis stroke="#475569" tickLine={false} tickFormatter={fmtAxis} style={{ fontSize: '10px' }} width={62} />;
const PctY =
  <YAxis stroke="#475569" tickLine={false} tickFormatter={fmtPctAxis} style={{ fontSize: '10px' }} width={38} />;
const Grid = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />;
const Leg = <Legend verticalAlign="top" height={26} iconType="square" wrapperStyle={{ fontSize: '10px', letterSpacing: '0.04em' }} />;
const ZeroLine = <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />;

// ── Income Statement ──────────────────────────────────────────────────
export interface IncomeData {
  period: string;
  revenue: number | null;
  ebitda: number | null;
  netIncome: number | null;
}
export const IncomeChart = ({ data }: { data: IncomeData[] }) => (
  <Frame>
    <BarChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA()}{MoneyY}
      <Tooltip contentStyle={ttStyle} formatter={moneyFmt} cursor={{ fill: 'rgba(59,130,246,0.04)' }} />
      {Leg}
      <Bar dataKey="revenue"   name="Revenue"    fill={C.revenue}   radius={[2, 2, 0, 0]} />
      <Bar dataKey="ebitda"    name="EBITDA"     fill={C.ebitda}    radius={[2, 2, 0, 0]} />
      <Bar dataKey="netIncome" name="Net Income" fill={C.netIncome} radius={[2, 2, 0, 0]} />
    </BarChart>
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
    <BarChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA()}{MoneyY}{ZeroLine}
      <Tooltip contentStyle={ttStyle} formatter={moneyFmt} cursor={{ fill: 'rgba(59,130,246,0.04)' }} />
      {Leg}
      <Bar dataKey="operating" name="Operating CF"   fill={C.opCF}  radius={[2, 2, 0, 0]} />
      <Bar dataKey="capex"     name="CapEx"          fill={C.capex} radius={[2, 2, 0, 0]} />
      <Bar dataKey="fcf"       name="Free Cash Flow" fill={C.fcf}   radius={[2, 2, 0, 0]} />
    </BarChart>
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
    <BarChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA()}{MoneyY}
      <Tooltip contentStyle={ttStyle} formatter={moneyFmt} cursor={{ fill: 'rgba(59,130,246,0.04)' }} />
      {Leg}
      <Bar dataKey="totalAssets" name="Total Assets" fill={C.totalAssets} radius={[2, 2, 0, 0]} />
      <Bar dataKey="cash"        name="Cash"         fill={C.cash}        radius={[2, 2, 0, 0]} />
      <Bar dataKey="totalDebt"   name="Total Debt"   fill={C.totalDebt}   radius={[2, 2, 0, 0]} />
      <Bar dataKey="equity"      name="Equity"       fill={C.equity}      radius={[2, 2, 0, 0]} />
    </BarChart>
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
      {Grid}{XA()}{PctY}{ZeroLine}
      <Tooltip contentStyle={ttStyle} formatter={pctFmt} cursor={{ stroke: '#334155' }} />
      {Leg}
      <Line
        type="monotone" dataKey="grossMargin" name="Gross Margin"
        stroke={C.grossMargin} strokeWidth={2}
        dot={{ r: 3, fill: C.grossMargin, strokeWidth: 0 }}
        activeDot={{ r: 4 }} connectNulls
      />
      <Line
        type="monotone" dataKey="netMargin" name="Net Margin"
        stroke={C.netMargin} strokeWidth={2}
        dot={{ r: 3, fill: C.netMargin, strokeWidth: 0 }}
        activeDot={{ r: 4 }} connectNulls
      />
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
    <BarChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA()}{PctY}{ZeroLine}
      <Tooltip contentStyle={ttStyle} formatter={pctFmt} cursor={{ fill: 'rgba(59,130,246,0.04)' }} />
      <Legend verticalAlign="top" height={26} iconType="square" wrapperStyle={{ fontSize: '10px', letterSpacing: '0.04em' }} />
      <Bar dataKey="revenueGrowth" name="Revenue Growth YoY" radius={[2, 2, 0, 0]}>
        {data.map((entry, i) => (
          <Cell key={i} fill={(entry.revenueGrowth ?? 0) >= 0 ? C.posGrowth : C.negGrowth} />
        ))}
      </Bar>
    </BarChart>
  </Frame>
);
