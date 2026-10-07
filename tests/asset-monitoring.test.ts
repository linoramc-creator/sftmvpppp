import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isTriggered} from '../supabase/functions/analyze-ticker/asset-alerts.ts';
import {upcomingEvents} from '../supabase/functions/analyze-ticker/asset-context.ts';
import {classify} from '../supabase/functions/analyze-ticker/beta-security.ts';
test('alerts require actual data and interpret downside and volume correctly',()=>{
 const q={price:100,change:-3,relativeVolume:2,at:null,currency:'USD'};
 assert.equal(isTriggered('price_above',100,q),true);assert.equal(isTriggered('price_below',99,q),false);
 assert.equal(isTriggered('daily_down',2,q),true);assert.equal(isTriggered('daily_up',2,q),false);
 assert.equal(isTriggered('volume',2,q),true);assert.equal(isTriggered('volume',2,{...q,relativeVolume:null}),false);
});
test('calendar excludes past and unrelated events and separates payment from ex-date',()=>{
 const events=upcomingEvents('AAPL',[{symbol:'MSFT',date:'2026-10-15'},{symbol:'AAPL',date:'2026-10-20',hour:'amc'},{symbol:'AAPL',date:'2026-09-01'}],[{symbol:'AAPL',date:'2026-10-12',paymentDate:'2026-10-30',dividend:0.25}],{},new Date('2026-10-07'));
 assert.deepEqual(events.map(e=>e.kind),['ex_dividend','earnings','payment']);assert.equal(events[1].session,'Después del cierre');
});
test('context only accepts validated assets and sector references',()=>{
 assert.equal(classify({panel:'assetContext',subject:'AAPL',benchmark:'XLK'}).request_class,'data');
 assert.throws(()=>classify({panel:'assetContext',subject:'../../x'}));assert.throws(()=>classify({panel:'assetContext',subject:'AAPL',benchmark:'https://evil.example'}));
});
