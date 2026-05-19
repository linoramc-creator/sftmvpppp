import React from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';

const formatCurrency = (value: number, currency: string) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
};
const formatPercent = (value: number) => `${value.toFixed(1)}%`;

export interface CashFlowData { period: string; operating: number; investing: number; financing: number; fcf: number; }
interface CashFlowChartProps { data: CashFlowData[]; currency?: string; }

export const CashFlowChart = ({ data, currency = 'USD' }: CashFlowChartProps) => {
  return (
    <div style={{ width: '100%', height: 400, backgroundColor: '#0f172a', padding: '20px', borderRadius: '12px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 20, right: 5, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
          <XAxis dataKey="period" stroke="#64748b" tickLine={false} style={{ fontSize: '12px' }} />
          <YAxis stroke="#64748b" tickLine={false} orientation="right" tickFormatter={(v) => formatCurrency(v, currency)} style={{ fontSize: '12px' }} />
          <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', borderRadius: '8px', color: '#fff' }} formatter={(value: number) => [formatCurrency(value, currency)]} />
          <Legend verticalAlign="top" height={45} wrapperStyle={{ fontSize: '12px' }} />
          <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.5} />
          <Bar dataKey="operating" name="Caja Operativa (CFO)" fill="#22c55e" barSize={18} />
          <Bar dataKey="investing" name="Caja de Inversión (CFI)" fill="#ef4444" barSize={18} />
          <Bar dataKey="financing" name="Caja de Financiación (CFF)" fill="#3b82f6" barSize={18} />
          <Line type="monotone" dataKey="fcf" name="Free Cash Flow (FCF)" stroke="#eab308" strokeWidth={3} dot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export interface FundamentalsData { period: string; revenue: number; netIncome: number; totalDebt: number; grossMargin: number; netMargin: number; }
interface FundamentalsChartProps { data: FundamentalsData[]; currency?: string; }

export const FundamentalsChart = ({ data, currency = 'USD' }: FundamentalsChartProps) => {
  return (
    <div style={{ width: '100%', height: 420, backgroundColor: '#0f172a', padding: '20px', borderRadius: '12px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 20, right: -10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
          <XAxis dataKey="period" stroke="#64748b" tickLine={false} style={{ fontSize: '12px' }} />
          <YAxis yAxisId="left" orientation="left" stroke="#64748b" tickLine={false} tickFormatter={(v) => formatCurrency(v, currency)} style={{ fontSize: '11px' }} />
          <YAxis yAxisId="right" orientation="right" stroke="#a855f7" tickLine={false} domain={[0, 100]} tickFormatter={formatPercent} style={{ fontSize: '11px' }} />
          <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', borderRadius: '8px', color: '#fff' }} formatter={(value: number, name: string) => name.includes('Margen') ? [formatPercent(value), name] : [formatCurrency(value, currency), name]} />
          <Legend verticalAlign="top" height={45} wrapperStyle={{ fontSize: '12px' }} />
          <ReferenceLine yAxisId="left" y={0} stroke="#475569" />
          <Bar yAxisId="left" dataKey="revenue" name="Ingresos (Revenue)" fill="#10b981" barSize={20} />
          <Bar yAxisId="left" dataKey="netIncome" name="Ingreso Neto" fill="#3b82f6" barSize={20} />
          <Bar yAxisId="left" dataKey="totalDebt" name="Deuda Total" fill="#f97316" barSize={20} />
          <Line yAxisId="right" type="monotone" dataKey="grossMargin" name="Margen Bruto (%)" stroke="#a855f7" strokeWidth={2.5} dot={{ r: 3 }} />
          <Line yAxisId="right" type="monotone" dataKey="netMargin" name="Margen Neto (%)" stroke="#ec4899" strokeWidth={2.5} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};
