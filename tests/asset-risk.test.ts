import {test} from 'node:test';
import assert from 'node:assert/strict';
import {riskHistory,type RiskBar} from '../supabase/functions/analyze-ticker/asset-risk.ts';
const bars=(n:number):RiskBar[]=>Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),open:100,high:101,low:99,close:100,adjusted:100,volume:1000}));
test('risk uses prior volume baseline, Wilder ATR and historical percentiles excluding current',()=>{
 const input=bars(400);input[399].volume=3000;const result=riskHistory(input,'USD'),last=result.history.at(-1)!;
 assert.equal(last.vol20,0);assert.equal(last.vol60,0);assert.equal(last.atr,2);assert.equal(last.atrPercent,2);assert.equal(last.volumeRatio,3);assert.equal(last.drawdown,0);assert.equal(last.belowPeak,0);
 assert.equal(result.percentiles.volumeRatio.value,100);assert.equal(result.percentiles.vol20.value,50);assert.equal(result.percentiles.vol20.samples,252);assert.equal(result.history.length,252);
});
test('risk keeps insufficient samples missing and drawdown sign meaningful',()=>{
 const input=bars(25);input[24]={...input[24],open:90,high:91,low:89,close:90,adjusted:90};const result=riskHistory(input,'USD'),last=result.history.at(-1)!;
 assert.ok(Math.abs(last.drawdown+10)<1e-8);assert.equal(last.belowPeak,1);assert.equal(last.vol60,null);assert.equal(result.percentiles.vol20.value,null);assert.ok(last.atr!>2);assert.equal(riskHistory([],'').asOf,null);
});
