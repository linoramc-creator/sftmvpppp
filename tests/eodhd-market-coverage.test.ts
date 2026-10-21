import test from 'node:test';
import assert from 'node:assert/strict';
import {eodhdChart,eodhdQuote,normalizeEodhdIntraday} from '../supabase/functions/analyze-ticker/eodhd-market.ts';
const now=Date.parse('2026-10-21T17:00:00Z'),timestamp=now/1000-1200;
const exchange={Timezone:'Europe/London',Currency:'GBP',TradingHours:{Open:'08:00:00',Close:'16:30:00',WorkingDays:'Mon, Tue, Wed, Thu, Fri'}};
const general={General:{Code:'VOD',Type:'Common Stock',CurrencyCode:'GBX',Name:'Vodafone',CountryName:'UK'}};
const history=[{date:'2026-10-19',open:120,high:123,low:119,close:122,adjusted_close:122,volume:1000},{date:'2026-10-20',open:119,high:120,low:118,close:119.4,adjusted_close:119.4,volume:2000}];
const deps=(patch:any={})=>({now,fundamentals:async()=>general,request:async(path:string)=>path.startsWith('exchange-details/')?exchange:path.startsWith('eod/')?history:path.startsWith('real-time/')?{code:'VOD.LSE',close:118.6,previousClose:119.4,timestamp,open:119.1,high:120,low:118,volume:3000}:null,...patch} as any);

test('British GBX prices and quoted session metrics retain their real units and full values',async()=>{
 const raw=await eodhdChart('VOD.L','1mo','1d',false,deps()),meta=raw?.chart.result[0].meta;
 assert.equal(meta.currency,'GBX');assert.equal(meta.regularMarketPrice,118.6);assert.equal(meta.chartPreviousClose,119.4);assert.equal(meta.regularMarketVolume,3000);assert.equal(meta.regularMarketDayHigh,120);assert.equal(meta.regularMarketDayLow,118);assert.deepEqual(raw?.chart.result[0].indicators.quote[0].close,[122,119.4]);
});
test('unknown quote currency cannot use exchange GBP to relabel pence, and financial reporting currency is never substituted',async()=>{
 assert.equal(await eodhdQuote('VOD.L',deps({fundamentals:async()=>null})),null);
 assert.equal(await eodhdChart('VOD.L','1mo','1d',false,deps({fundamentals:async()=>({General:{Code:'VOD',Type:'Common Stock'},Financials:{Income_Statement:{currency_symbol:'GBP'}}})})),null);
});
test('intraday bars exclude closing quote markers, extended hours, weekends and impossible OHLC',()=>{
 const row=(at:string)=>({timestamp:Date.parse(at)/1000,open:120,high:121,low:119,close:120.5,volume:null});
 const rows=normalizeEodhdIntraday([row('2026-10-21T07:00:00Z'),row('2026-10-21T15:00:00Z'),row('2026-10-21T15:30:00Z'),row('2026-10-21T16:00:00Z'),row('2026-10-18T10:00:00Z'),{...row('2026-10-21T12:00:00Z'),high:100}],exchange,false,now);
 assert.deepEqual(rows.map(row=>row.time),['2026-10-21T07:00:00Z','2026-10-21T15:00:00Z'].map(at=>Date.parse(at)/1000));
});
test('incomplete equity adjustments trigger a coherent source fallback instead of raw/adjusted mixing',async()=>{
 const raw=await eodhdChart('VOD.L','1mo','1d',false,deps({request:async(path:string)=>path.startsWith('exchange-details/')?exchange:path.startsWith('eod/')?[...history.map((row,i)=>({...row,adjusted_close:i?null:row.adjusted_close}))]:null}));assert.equal(raw,null);
});
test('unsupported intervals and extended sessions fail closed rather than relabelling bars',async()=>{
 let calls=0;const options=deps({request:async()=>{calls++;return null;}});assert.equal(await eodhdChart('VOD.L','1mo','15m',false,options),null);assert.equal(await eodhdChart('VOD.L','1mo','5m',true,options),null);assert.equal(calls,0);
});
