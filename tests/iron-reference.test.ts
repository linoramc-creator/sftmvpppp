import assert from 'node:assert/strict';
import test from 'node:test';
import {parseIronSettlement,ironReferenceQuote} from '../supabase/functions/analyze-ticker/iron-reference.ts';

const row=(month:string,price:string,previous:string,volume:string,option='999999')=>`<tr>${[month,price,previous,'1.00','1.1%','93','89',volume,'123',option,'0'].map(x=>`<td>${x}</td>`).join('')}</tr>`;
const report=(rows:string)=>`DSPs as at Friday, October 16, 2026, 3.00pm (Rebar), 5.30pm (Iron Ore)<table><tr><td>SGX IRON ORE (IODEX) DERIVATIVES</td></tr>${rows}</table><table>SGX MB IRON ORE 65% DERIVATIVES${row('Nov-26','105','104','999999999')}</table>`;
const now=Date.parse('2026-10-17T10:00:00Z');
test('selects most traded SGX IODEX futures contract and preserves its actual dated settlement',()=>{
  const result=parseIronSettlement(report(row('Oct-26','90.97','90.30','20,136')+row('Nov-26','91.23','89.85','146,126')+row('Dec-26','91.29','89.95','112,606')),'2026-10-16',now);
  assert.equal(result?.label,'Hierro · IODEX · Nov-26');assert.equal(result?.price,91.23);
  assert.equal(result?.symbol,'SGX-IODEX');assert.equal(result?.displaySymbol,'FEF');assert.equal(result?.contractLabel,'Nov-26');
  assert.equal(result?.change,(91.23/89.85-1)*100);assert.equal(result?.currency,'USD');
  assert.equal(result?.unit,'USD/t seca');assert.equal(result?.date,'2026-10-16');assert.equal(result?.at,null);
});
test('rejects wrong date, old schema, absent volume and future settlement',()=>{
 const html=report(row('Nov-26','91.23','89.85','0'));
 assert.equal(parseIronSettlement(html,'2026-10-16',now),null);
 assert.equal(parseIronSettlement(report(row('Nov-26','91','90','100')),'2026-10-15',now),null);
 assert.equal(parseIronSettlement(report(row('Nov-26','91','90','100')),'2026-10-16',Date.parse('2026-10-16T00:00:00Z')),null);
 assert.equal(parseIronSettlement(report(row('Sep-26','91','90','100')),'2026-10-16',now),null);
 assert.equal(parseIronSettlement(report(row('Nov-26','91','90','100')).replaceAll('IODEX','TSI 62%'),'2026-10-16',now),null);
});
test('rolls back weekend to a verified official report and never falls back to stale Yahoo prices',async()=>{
 const original=globalThis.fetch;const calls:string[]=[];
 globalThis.fetch=async input=>{calls.push(String(input));return new Response(report(row('Nov-26','91.23','89.85','146,126')));};
 try{const result=await ironReferenceQuote(now);assert.equal(result.date,'2026-10-16');assert.equal(calls.length,1);assert.ok(calls[0].startsWith('https://api2.sgx.com/'));}
 finally{globalThis.fetch=original;}
});
