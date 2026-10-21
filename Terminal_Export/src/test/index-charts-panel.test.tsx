import {cleanup,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import IndexChartsPanel from '../components/IndexChartsPanel';
import type {MarketData} from '../lib/analyze';
import {MARKET_REFERENCES} from '../../../supabase/functions/analyze-ticker/market-references';

afterEach(cleanup);
// The market endpoint returns authentic index symbols, not their fund proxies.
// These values and 72/73 historical observations reproduce the production
// response whose SPY/VIXY sidebar lookup previously hid both healthy series.
function fixture():MarketData {
 const prices:Record<string,number>={'^GSPC':7757.1699,'^NDX':29822.5176,'^DJI':52856.0898,'^VIX':16.68,IWM:276.48,GLD:378.95,TLT:80.24};
 const indices=MARKET_REFERENCES.map(({symbol,label,unit})=>({symbol,label,unit,currency:'USD',price:prices[symbol],change1d:.25,change1m:-3.19}));
 const candles=Object.fromEntries(indices.map(({symbol,price})=>[symbol,{t:Array.from({length:symbol==='^VIX'?73:72},(_,i)=>Date.parse('2026-07-13T13:30Z')/1000+i*86400),c:Array.from({length:symbol==='^VIX'?73:72},(_,i)=>price+i/100)}]));
 return{indices,candles,stocks:[],yield10y:null,yield2y:null,spread:null,ts:Date.parse('2026-10-21T20:00Z')};
}
it('renders authentic S&P 500 and VIX series from the same reference contract as the endpoint',()=>{
 const data=fixture();
 // Deliberate proxy traps: these values must never replace the authentic indices.
 data.indices.push({symbol:'SPY',label:'SPY',price:999999,change1d:0,change1m:0},{symbol:'VIXY',label:'VIXY',price:888888,change1d:0,change1m:0});
 render(<IndexChartsPanel marketData={data}/>);
 const sp=screen.getByRole('region',{name:'Evolución de S&P 500'}),vix=screen.getByRole('region',{name:'Evolución de VIX · VOLATILIDAD'});
 expect(within(sp).getByText('7757,17',{selector:'span'})).toBeVisible();expect(within(vix).getByText('16,68',{selector:'span'})).toBeVisible();
 for(const region of [sp,vix]){expect(within(region).queryByText(/Sin histórico/)).toBeNull();expect(within(region).getByText('pts')).toBeVisible();expect(within(region).queryByText('USD')).toBeNull();}
 expect(screen.getByRole('region',{name:'Evolución de RUSSELL 2000 · IWM'})).toBeVisible();
 expect(screen.getByRole('region',{name:'Evolución de ORO · GLD'})).toBeVisible();expect(screen.queryByText('999.999,00')).toBeNull();expect(screen.queryByText('888.888,00')).toBeNull();
});
it('keeps unavailable data absent rather than substituting a different instrument',()=>{
 const data=fixture();data.indices=data.indices.filter(q=>q.symbol!=='^VIX');delete data.candles!['^VIX'];
 data.indices.push({symbol:'VIXY',label:'VIXY',currency:'USD',price:35,change1d:1,change1m:2});
 render(<IndexChartsPanel marketData={data}/>);
 const vix=screen.getByRole('region',{name:'Evolución de VIX · VOLATILIDAD'});
 expect(within(vix).getByText(/Sin histórico/)).toBeVisible();expect(within(vix).queryByText('35,00')).toBeNull();
 expect(within(screen.getByRole('region',{name:'Evolución de S&P 500'})).queryByText(/Sin histórico/)).toBeNull();
});
