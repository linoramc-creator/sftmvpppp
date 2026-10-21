import {IndexSparkline} from '@/components/charts/IndexCharts';
import type {MarketData} from '@/lib/analyze';
import {SIDEBAR_MARKET_REFERENCES} from '../../../supabase/functions/analyze-ticker/market-references';

export default function IndexChartsPanel({marketData}:{marketData:MarketData|null}) {
  return <aside aria-label="Mercados de referencia" className="lg:sticky lg:top-4">
    <div className="mb-2 flex items-center gap-2 px-1">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_6px_#3b82f6]"/>
      <span className="text-[10px] font-semibold tracking-[.15em] text-slate-400">MERCADOS DE REFERENCIA</span>
      <span className="ml-auto text-[8px] tracking-[.1em] text-slate-600">MERCADO</span>
    </div>
    {SIDEBAR_MARKET_REFERENCES.map(({symbol,label,unit})=>{
      const quote=marketData?.indices.find(item=>item.symbol===symbol);
      return <IndexSparkline key={symbol} symbol={symbol} label={label} unit={unit}
        currency={quote?.currency} price={quote?.price??null} change1d={quote?.change1d??null}
        change1m={quote?.change1m??null} candle={marketData?.candles?.[symbol]??null}/>;
    })}
  </aside>;
}
