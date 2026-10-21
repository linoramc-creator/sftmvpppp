import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {ttStyle,chartCursor} from '@/components/options/theme';
import {formatChartMoney} from '@/lib/financial-chart-data';

const C = {
  bg:          '#0b131f',
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

const fmtPctAxis = (v: number | null): string =>
  v == null ? '' : `${v.toFixed(0)}%`;

const moneyFmt = (currency?:string)=>(v:number|null,name:string):[string,string]=>[formatChartMoney(v,currency),name];

const pctFmt = (v: number | null, name: string): [string, string] =>
  [v == null ? 'N/D' : `${v.toFixed(1)}%`, name];

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    width: '100%',
    height: 320,
    backgroundColor: C.bg,
    padding: '12px 8px',
    border: '1px solid #1e293b',
    borderRadius: 12,
  }}>
    <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
  </div>
);

const Grid = <CartesianGrid strokeDasharray="2 5" vertical={false} stroke="#243142" />;
const XA   = <XAxis dataKey="period" stroke="#8190a6" axisLine={false} tickLine={false} style={{ fontSize: '10px' }} />;
const MoneyY = (currency?:string)=><YAxis stroke="#8190a6" axisLine={false} tickLine={false} tickFormatter={value=>formatChartMoney(value,currency,true)} style={{ fontSize: '10px' }} width={82} />;
const PctY   = <YAxis stroke="#8190a6" axisLine={false} tickLine={false} tickFormatter={fmtPctAxis} style={{ fontSize: '10px' }} width={42} />;
const Leg  = <Legend verticalAlign="top" height={26} iconType="circle" wrapperStyle={{ fontSize: '10px', letterSpacing: '0.04em' }} />;
const Zero = <ReferenceLine y={0} stroke="#334155" strokeWidth={1} />;

const dot  = (color: string) => ({ r: 3, fill: color, strokeWidth: 0 });
const adot = { r: 5 };

const L = (key: string, name: string, color: string, extra: object = {}) => (
  <Line
    key={key}
    type="linear"
    dataKey={key}
    name={name}
    stroke={color}
    strokeWidth={2}
    dot={dot(color)}
    activeDot={adot}
    connectNulls={false}
    isAnimationActive={false}
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
export const IncomeChart = ({ data,currency='USD' }: { data: IncomeData[];currency?:string }) => (
  <Frame>
    <LineChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA}{MoneyY(currency)}
      <Tooltip contentStyle={ttStyle} formatter={moneyFmt(currency)} cursor={chartCursor} />
      {Leg}
      {L('revenue',   'Ingresos',    C.revenue)}
      {L('ebitda',    'EBITDA',     C.ebitda)}
      {L('netIncome', 'Resultado neto', C.netIncome)}
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
export const CashFlowChart = ({ data,currency='USD' }: { data: CashFlowData[];currency?:string }) => (
  <Frame>
    <LineChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA}{MoneyY(currency)}{Zero}
      <Tooltip contentStyle={ttStyle} formatter={moneyFmt(currency)} cursor={chartCursor} />
      {Leg}
      {L('operating', 'Flujo operativo',   C.opCF)}
      {L('capex',     'CapEx',          C.capex)}
      {L('fcf',       'Flujo de caja libre', C.fcf)}
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
export const BalanceChart = ({ data,currency='USD' }: { data: BalanceData[];currency?:string }) => (
  <Frame>
    <LineChart data={data} margin={{ top: 14, right: 10, left: 0, bottom: 4 }}>
      {Grid}{XA}{MoneyY(currency)}
      <Tooltip contentStyle={ttStyle} formatter={moneyFmt(currency)} cursor={chartCursor} />
      {Leg}
      {L('totalAssets', 'Activos totales', C.totalAssets)}
      {L('cash',        'Efectivo',         C.cash)}
      {L('totalDebt',   'Deuda total',   C.totalDebt)}
      {L('equity',      'Patrimonio',       C.equity)}
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
      <Tooltip contentStyle={ttStyle} formatter={pctFmt} cursor={chartCursor} />
      {Leg}
      {L('grossMargin', 'Margen bruto', C.grossMargin)}
      {L('netMargin',   'Margen neto',   C.netMargin)}
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
      <Tooltip contentStyle={ttStyle} formatter={pctFmt} cursor={chartCursor} />
      {Leg}
      {L('revenueGrowth', 'Ingresos · variación interanual (%)', C.growth, { type: 'linear', connectNulls: false })}
    </LineChart>
  </Frame>
);
