import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFedPrivateCredit,FED_PRIVATE_URL} from '../supabase/functions/analyze-ticker/fed-private-credit.ts';
import {bondsCreditPanel} from '../supabase/functions/analyze-ticker/bonds-credit.ts';
const columns='<th id="t1">2025</th><th id="t2">2025:Q2</th><th id="t3">2026:Q2</th><th id="t4">2099:Q1</th>';
const values:Record<string,[number,number]>={FL444090000:[863.1,935],FL443067205:[497.4,554.1],LM443067215:[493.6,542.6],FL444190005:[342.7,423.7],FL442000093:[259,345.2]};
const html='<table id="s1248s" title="Private debt funds"><thead><tr>'+columns+'</tr></thead><tbody>'+Object.entries(values).map(([code,[before,last]])=>`<tr><th><a>${code}</a></th><td headers="t1">9999</td><td headers="t2">${before}</td><td headers="t3">${last}</td><td headers="t4">999999</td></tr>`).join('')+'</tbody></table>';
test('official private debt table accepts only exact quarterly columns, preserves published USD billions and rejects maintenance pages',()=>{
 const rows=parseFedPrivateCredit(html,Date.parse('2026-10-21'));
 assert.equal(Object.keys(rows).length,5);
 assert.deepEqual(rows.BOGZ1FL443067205Q,[{date:'2025-04-01',value:497.4},{date:'2026-04-01',value:554.1}]);
 assert.equal(rows.BOGZ1LM443067215Q.at(-1)?.value,542.6);
 assert.deepEqual(parseFedPrivateCredit('<html>Site Maintenance</html>'),{});
 assert.deepEqual(parseFedPrivateCredit(html.replace('s1248s','other-table')),{});
});
test('FRED maintenance falls back to one shared official table and restores real private ratios with correctly scaled amounts',async()=>{
 const original=globalThis.fetch;let fedCalls=0;
 globalThis.fetch=async input=>{
  const url=String(input);
  if(url===FED_PRIVATE_URL){fedCalls++;return new Response(html);}
  if(url.startsWith('https://fred.stlouisfed.org/'))return new Response('<html>Site Maintenance</html>');
  return new Response('',{status:503});
 };
 try{
  const data=await bondsCreditPanel({FRED_KEY:''});
  assert.equal(fedCalls,1,'five private series share one official fallback request');
  const loans=data.credit.find(s=>s.id==='BOGZ1FL443067205Q')!;
  assert.equal(loans.points.at(-1)?.value,554.1);assert.equal(loans.source,FED_PRIVATE_URL);
  assert.ok(Math.abs(data.privateValuation.points.at(-1)!.value-(542.6/554.1-1)*100)<1e-10);
  assert.ok(Math.abs(data.privateGrowth.points.at(-1)!.value-(554.1/497.4-1)*100)<1e-10);
  assert.ok(data.credit.filter(s=>s.scope==='banking').every(s=>s.points.length===0),'uncovered banking data must remain missing, rather than borrowed from private funds');
 }finally{globalThis.fetch=original;}
});
