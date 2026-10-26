import {FeedQuoteStamp} from './FeedCards';
import type {FeedQuote} from '../../../supabase/functions/analyze-ticker/panels';
import {useId,useState} from 'react';
import {Plus,X} from 'lucide-react';
import type {MarketData} from '@/lib/analyze';
import {feedTicker,feedTickerContext} from '@/lib/feed-identifiers';

const MAX_ASSETS=7;
const QUICK_ADD=[
  {label:'Acciones',items:[['AAPL','Apple'],['MSFT','Microsoft'],['NVDA','NVIDIA'],['GOOGL','Alphabet']]},
  {label:'ETF',items:[['SPY','SPDR S&P 500'],['QQQ','Invesco QQQ'],['URTH','iShares MSCI World'],['TLT','iShares 20+ Year Treasury']]},
];
const SYMBOL=/^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/;

export function WatchlistCard({stocks,data,liveQuotes,onChange,onSelect}:{stocks:string[];data:MarketData|null;liveQuotes?:FeedQuote[];onChange:(stocks:string[])=>void;onSelect:(symbol:string)=>void}){
  const [input,setInput]=useState(''),[error,setError]=useState('');
  const id=useId(),full=stocks.length>=MAX_ASSETS;
  const has=(symbol:string)=>stocks.some(item=>item.toUpperCase()===symbol);
  function add(value=input){
    const symbol=value.trim().toUpperCase();
    if(!SYMBOL.test(symbol)){setError('Introduce un ticker válido.');return;}
    if(has(symbol)){setError('Ese activo ya está en tu lista.');return;}
    if(full){setError('Puedes seguir hasta 7 activos.');return;}
    onChange([...stocks,symbol]);setInput('');setError('');
  }
  return <div className="space-y-3 font-body">
    <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500"><span>Tu selección</span><span id={`${id}-count`} className="tabular-nums">{stocks.length}/{MAX_ASSETS}</span></div>
    <form className="flex gap-2" onSubmit={event=>{event.preventDefault();add();}}>
      <input aria-label="Ticker para la watchlist" aria-describedby={error?`${id}-error`:`${id}-count`} aria-invalid={Boolean(error)} placeholder="Escribe un ticker" value={input} onChange={event=>{setInput(event.target.value);setError('');}} maxLength={15} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={full} className="min-w-0 flex-1 rounded-md border border-slate-700/70 bg-slate-950/50 px-3 py-2 text-xs text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-blue-400/70 disabled:opacity-50"/>
      <button className="rounded-md border border-blue-500/40 px-3 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-400/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={full} type="submit">Añadir</button>
    </form>
    {error&&<p id={`${id}-error`} role="alert" className="text-xs text-rose-300">{error}</p>}
    {stocks.length===0&&<p className="py-2 text-xs text-slate-500">Añade los activos que quieres seguir.</p>}
    <div className="divide-y divide-slate-800/80">{stocks.map(symbol=>{
      const live=liveQuotes?.find(quote=>quote.symbol===symbol),stored=data?.stocks.find(quote=>quote.symbol===symbol),quote=live?{price:live.price,change1d:live.change}:stored;
      return <div key={symbol} className="flex items-center gap-2 py-2.5 first:pt-0">
        <button type="button" onClick={()=>onSelect(symbol)} className="min-w-0 flex-1 rounded text-left text-sm font-medium text-slate-200 transition-colors hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70" aria-label={`Abrir ficha de ${symbol}`}><span>{feedTicker(live??symbol)}</span><span aria-hidden="true" className="ml-1.5 text-[11px] text-slate-500">↗</span>{feedTickerContext(live??symbol)&&<span className="mt-0.5 block text-[10px] font-normal text-slate-500">{feedTickerContext(live??symbol)}</span>}{live&&<FeedQuoteStamp quote={live}/>}</button>
        <div className="shrink-0 text-right text-sm tabular-nums text-slate-200">{quote?.price==null?'Sin cotización':quote.price.toLocaleString('es-ES',{maximumFractionDigits:2})}<p className={`mt-0.5 text-xs ${quote?.change1d==null?'text-slate-500':quote.change1d>=0?'text-emerald-400':'text-red-400'}`}>{quote?.change1d==null?'—':`${quote.change1d>0?'+':''}${quote.change1d.toFixed(2)}%`}</p></div>
        <button type="button" aria-label={`Quitar ${symbol}`} onClick={()=>{onChange(stocks.filter(item=>item!==symbol));setError('');}} className="rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-800 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"><X size={13} aria-hidden="true"/></button>
      </div>;
    })}</div>
    {!full&&<div aria-label="Añadir activos habituales" className="space-y-2 border-t border-slate-800/80 pt-3">{QUICK_ADD.map(group=>{
      const items=group.items.filter(([symbol])=>!has(symbol));
      return items.length>0?<div key={group.label} className="flex items-start gap-2"><span className="w-12 shrink-0 pt-1.5 text-[10px] text-slate-500">{group.label}</span><div className="flex flex-wrap gap-1.5">{items.map(([symbol,name])=><button type="button" key={symbol} title={name} aria-label={`Añadir ${symbol} a la watchlist`} onClick={()=>add(symbol)} className="inline-flex items-center gap-1 rounded border border-slate-700/60 px-2 py-1 text-[10px] text-slate-400 transition-colors hover:border-blue-400/60 hover:bg-blue-400/5 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70"><Plus size={10} aria-hidden="true"/>{symbol}</button>)}</div></div>:null;
    })}</div>}
    <p className="text-[10px] leading-relaxed text-slate-500">Precios en la moneda de cotización.</p>
  </div>;
}
