import { useState } from 'react';
import type { MarketData } from '@/lib/analyze';

export function WatchlistCard({stocks,data,onChange}:{stocks:string[];data:MarketData|null;onChange:(stocks:string[])=>void}) {
  const [input,setInput]=useState('');
  const [error,setError]=useState('');
  function add() {
    const symbol=input.trim().toUpperCase();
    if (!/^[A-Z0-9.^-]{1,10}$/.test(symbol)) {setError('Introduce un ticker válido.');return;}
    if(stocks.includes(symbol)){setError('Ese activo ya está en tu lista.');return;}
    if(stocks.length>=6){setError('Puedes seguir hasta 6 activos.');return;}
    onChange([...stocks,symbol]);setInput('');setError('');
  }
  return <div className="space-y-3"><form className="flex gap-2" onSubmit={e=>{e.preventDefault();add();}}><input aria-label="Ticker para la watchlist" placeholder="AAPL, QQQ…" value={input} onChange={e=>setInput(e.target.value)} maxLength={10} className="min-w-0 flex-1 bg-background border border-border px-2 py-2 text-xs"/><button className="text-xs text-primary border border-primary px-3" type="submit">Añadir</button></form>{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}{stocks.length===0&&<p className="text-xs text-muted-foreground">Añade los activos que quieres seguir.</p>}{stocks.map(symbol=>{const quote=data?.stocks.find(q=>q.symbol===symbol);return <div key={symbol} className="flex items-center gap-2 border-b border-border/70 pb-2"><span className="text-sm flex-1">{symbol}</span><div className="text-right text-sm tabular-nums">{quote?.price==null?'Sin cotización':quote.price.toLocaleString('es-ES',{maximumFractionDigits:2})}<p className={`text-xs ${(quote?.change1d??0)>=0?'text-emerald-400':'text-red-400'}`}>{quote?.change1d==null?'—':`${quote.change1d>0?'+':''}${quote.change1d.toFixed(2)}%`}</p></div><button aria-label={`Quitar ${symbol}`} onClick={()=>onChange(stocks.filter(s=>s!==symbol))} className="text-muted-foreground px-2 hover:text-destructive">×</button></div>;})}<p className="text-[10px] text-muted-foreground">Precios en la moneda de cotización · Lista guardada en este navegador.</p></div>;
}
