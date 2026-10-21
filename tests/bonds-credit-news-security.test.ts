import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,BetaError} from '../supabase/functions/analyze-ticker/beta-security.ts';

test('bond and private credit news accept only bounded markets and retain provider request budgets',()=>{
 for(const subject of ['US','FR','DE','GB','private'])assert.deepEqual(classify({panel:'bondsCreditNews',subject}),{request_class:'expensive'});
 for(const subject of [undefined,null,'','ES','us','PRIVATE','https://evil.test','US?api_key=x',{},['US'],1])assert.throws(()=>classify({panel:'bondsCreditNews',subject}),e=>e instanceof BetaError&&e.status===400);
 for(const extra of [{marketData:true},{accountAction:'profile'},{macroCalendar:true},{optionsAction:'chain',ticker:'SPY'},{fundamentals:true,ticker:'SPY'}])assert.throws(()=>classify({panel:'bondsCreditNews',subject:'US',...extra}),BetaError);
});
