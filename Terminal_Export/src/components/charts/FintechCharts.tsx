import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const fmtAxis = (v: number | null): string => {
  if (v == null) return '';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const fmtTooltipValue = (v: number | null): string => {
  if (v == null) return 'N/D';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(2)}`;
};

const tooltipStyle = {
  backgroundColor: '#0f172a',
  borderColor: '#334155',
  borderRadius: '4px',
  color: '#f1f5f9',
  fontFamily: 'monospace',
  fontSize: '12px',
};

const tooltipFormatter = (value: number | null, name: string): [string, string] =>
  [fmtTooltipValue(value), name];

const ChartFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    width: '100%',
    height: 360,
    backgroundColor: '#0a0f1a',
    padding: '12px 8px',
    border: '1px solid #1e293b',
    borderRadius: 0,
  }}>
    <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
  </div>
);

// ── Income Statement ──────────────────────────────────────────────────
export interface IncomeData { period: string; revenue: number | null; netIncome: number | null; }
export const IncomeChart = ({ data }: { data: IncomeData[] }) => (
  <ChartFrame>
    <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
      <XAxis dataKey="period" stroke="#64748b" tickLine={false} style={{ fontSize: '11px' }} />
      <YAxis stroke="#64748b" tickLine={false} tickFormatter={fmtAxis} style={{ fontSize: '11px' }} width={64} />
      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} cursor={{ fill: 'rgba(34,197,94,0.05)' }} />
      <Legend verticalAlign="top" height={28} iconType="square" wrapperStyle={{ fontSize: '11px', letterSpacing: '0.05em' }} />
      <Bar dataKey="revenue" name="Revenue" fill="#22c55e" radius={[2, 2, 0, 0]} />
      <Bar dataKey="netIncome" name="Net Income" fill="#94a3b8" radius={[2, 2, 0, 0]} />
    </BarChart>
  </ChartFrame>
);

// ── Cash Flow ─────────────────────────────────────────────────────────
export interface CashFlowData { period: string; operating: number | null; fcf: number | null; }
export const CashFlowChart = ({ data }: { data: CashFlowData[] }) => (
  <ChartFrame>
    <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
      <XAxis dataKey="period" stroke="#64748b" tickLine={false} style={{ fontSize: '11px' }} />
      <YAxis stroke="#64748b" tickLine={false} tickFormatter={fmtAxis} style={{ fontSize: '11px' }} width={64} />
      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} cursor={{ fill: 'rgba(34,197,94,0.05)' }} />
      <Legend verticalAlign="top" height={28} iconType="square" wrapperStyle={{ fontSize: '11px', letterSpacing: '0.05em' }} />
      <Bar dataKey="operating" name="Operating CF" fill="#22c55e" radius={[2, 2, 0, 0]} />
      <Bar dataKey="fcf" name="Free Cash Flow" fill="#94a3b8" radius={[2, 2, 0, 0]} />
    </BarChart>
  </ChartFrame>
);

// ── Balance Sheet ─────────────────────────────────────────────────────
export interface BalanceData { period: string; cash: number | null; totalDebt: number | null; equity: number | null; }
export const BalanceChart = ({ data }: { data: BalanceData[] }) => (
  <ChartFrame>
    <BarChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
      <XAxis dataKey="period" stroke="#64748b" tickLine={false} style={{ fontSize: '11px' }} />
      <YAxis stroke="#64748b" tickLine={false} tickFormatter={fmtAxis} style={{ fontSize: '11px' }} width={64} />
      <Tooltip contentStyle={tooltipStyle} formatter={tooltipFormatter} cursor={{ fill: 'rgba(34,197,94,0.05)' }} />
      <Legend verticalAlign="top" height={28} iconType="square" wrapperStyle={{ fontSize: '11px', letterSpacing: '0.05em' }} />
      <Bar dataKey="cash" name="Cash" fill="#22c55e" radius={[2, 2, 0, 0]} />
      <Bar dataKey="totalDebt" name="Total Debt" fill="#ef4444" radius={[2, 2, 0, 0]} />
      <Bar dataKey="equity" name="Equity" fill="#94a3b8" radius={[2, 2, 0, 0]} />
    </BarChart>
  </ChartFrame>
);
