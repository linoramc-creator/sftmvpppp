import {test} from 'node:test';import assert from 'node:assert/strict';
import {sectorReference,sectorFundamentalsContext} from '../supabase/functions/analyze-ticker/sector-fundamentals.ts';
test('sector reference selects a specific real fund or declines unknown and incompatible regional themes',()=>{assert.equal(sectorReference('Semiconductores'),'SOXX');assert.equal(sectorReference('bancos'),'KBE');for(const sector of ['banca europea','Banca española','Bancos de España','Banca italiana','Bancos de Canadá'])assert.equal(sectorReference(sector),null);assert.equal(sectorReference('desconocido'),null);});
test('sector context preserves currencies, real holdings and dates without inventing flows',async()=>{
 const summary=async(symbol:string):Promise<any>=>symbol==='SOXX'?{quoteType:{quoteType:'ETF',longName:'Reference'},topHoldings:{holdings:[{symbol:'A',holdingPercent:.1},{symbol:'B',holdingPercent:.08}]}}:symbol==='A'?{quoteType:{quoteType:'EQUITY',longName:'Issuer'},price:{currency:'EUR'},financialData:{financialCurrency:'USD',returnOnEquity:.15},eodhd:{updatedAt:'2026-10-20'}}:null;
 const context=await sectorFundamentalsContext('Semiconductores',{summary,quote:async()=>({currency:'USD',close:100,timestamp:1})});
 assert.match(context,/"currency":"EUR"/);assert.match(context,/"reportingCurrency":"USD"/);assert.match(context,/"quote":null/);assert.match(context,/no son flujos institucionales/);assert.doesNotMatch(context,/"ticker":"B"/);
 assert.equal(await sectorFundamentalsContext('unknown',{summary,quote:async()=>null}),'');
});
