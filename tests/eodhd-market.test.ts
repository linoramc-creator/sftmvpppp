import {test} from 'node:test';import assert from 'node:assert/strict';
import {eodhdTradingPeriod,normalizeEodhdDaily} from '../supabase/functions/analyze-ticker/eodhd-market.ts';
const exchange={Timezone:'America/New_York',TradingHours:{Open:'09:30:00',Close:'16:00:00',WorkingDays:'Mon,Tue,Wed,Thu,Fri'},ExchangeHolidays:{0:{Date:'2026-11-26'}},ExchangeEarlyCloseDays:{0:{Date:'2026-11-27',EarlyClose:'13:00'}}};
test('exchange-supplied holidays, early closes and DST define real sessions rather than weekday guesses',()=>{
 assert.equal(eodhdTradingPeriod(exchange,Date.parse('2026-11-26T16:00Z')),null);
 assert.equal(eodhdTradingPeriod(exchange,Date.parse('2026-11-28T16:00Z')),null);
 assert.equal(eodhdTradingPeriod(exchange,Date.parse('2026-11-27T16:00Z'))?.regular.end,Date.parse('2026-11-27T18:00Z')/1000);
 assert.equal(eodhdTradingPeriod(exchange,Date.parse('2026-10-21T16:00Z'))?.regular.start,Date.parse('2026-10-21T13:30Z')/1000);
 assert.equal(eodhdTradingPeriod(exchange,Date.parse('2026-12-01T16:00Z'))?.regular.start,Date.parse('2026-12-01T14:30Z')/1000);
 assert.equal(eodhdTradingPeriod(null),null);
});
test('daily bars preserve actual adjusted/raw values and missing volume without filling gaps or accepting malformed OHLC',()=>{
 const row={date:'2026-10-20',open:10,high:12,low:9,close:11,adjusted_close:10.8,volume:0};
 const r=normalizeEodhdDaily([row,{...row,date:'2026-10-19',volume:null,adjusted_close:null},{...row,date:'2026-10-22'},{...row,date:'2026-10-18',high:9},{...row,date:'2026-02-30'}],Date.parse('2026-10-21T12:00Z'));
 assert.equal(r.length,2);assert.equal(r[0].volume,null);assert.equal(r[0].adjusted,null);assert.equal(r[1].volume,0);assert.equal(r[1].adjusted,10.8);assert.equal(r[1].close,11);
});
