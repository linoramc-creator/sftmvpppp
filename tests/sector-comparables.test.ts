import test from 'node:test';import assert from 'node:assert/strict';
import {comparableCompany,discoverTickerPeers,loadComparableCompanies,loadSectorComparables,peerRowsForReport} from '../supabase/functions/analyze-ticker/sector-comparables.ts';
import {classify,BetaError} from '../supabase/functions/analyze-ticker/beta-security.ts';
const now=Date.parse('2026-10-22T10:00:00Z'),at=Date.parse('2026-10-21T20:00:00Z')/1000;
function summary(symbol:string,currency='USD',cik=symbol):any{return{quoteType:{symbol,quoteType:'EQUITY',longName:symbol+' Company'},price:{currency,marketCap:1250000000},assetProfile:{sector:'Industrials',industry:'Electrical Equipment & Parts',country:'USA'},summaryDetail:{trailingPE:25,forwardPE:20},defaultKeyStatistics:{priceToBook:3,enterpriseToEbitda:14,beta:1.1},financialData:{financialCurrency:'USD',returnOnEquity:.12,profitMargins:.08,revenueGrowth:.2},eodhd:{cik,updatedAt:'2026-10-21'}};}
const price=(currency='USD')=>({currency,close:100,timestamp:at});
test('a complete EOD issuer profile still discovers peers with one bounded liquid-industry screen, without research generation',async()=>{
 let requests=0,related=0;
 const result=await discoverTickerPeers('VRT',summary('VRT'),{}, {request:async(path,query)=>{requests++;assert.equal(path,'screener');assert.equal(query?.limit,8);assert.deepEqual(JSON.parse(String(query?.filters)),[['exchange','=','us'],['industry','=','Electrical Equipment & Parts'],['avgvol_200d','>',100000]]);return{data:['VRT','AAA','BBB','CCC','AAA'].map(code=>({code,exchange:'US',industry:'Electrical Equipment & Parts'}))} as any;},related:async()=>{related++;return[];}});
 assert.deepEqual(result,{symbols:['AAA','BBB','CCC'],basis:'industry'});assert.equal(requests,1);assert.equal(related,0);
});
test('a denied or empty industry screen falls back to verified related symbol candidates without URL injection',async()=>{
 const result=await discoverTickerPeers('VRT',summary('VRT'),{}, {request:async()=>null,related:async()=>['VRT','BRK.B','SAP.XETRA','../key','AAA','AAA']});
 assert.deepEqual(result,{symbols:['BRK-B','SAP.DE','AAA'],basis:'related'});
});
test('one quote outage does not erase reported financials or insert a fabricated current price',async()=>{
 const rows=await loadComparableCompanies(['VRT','PEER'],'VRT',{summary:async symbol=>summary(symbol),quote:async()=>{throw Error('Quote unavailable');},now});
 assert.equal(rows.length,2);assert.equal(rows[0].subject,true);assert.equal(rows[0].price,null);assert.equal(rows[0].quoteAt,null);assert.equal(rows[0].pe,25);assert.equal(rows[0].netMargin,8);assert.equal(rows[0].recordDate,'2026-10-21');
 assert.equal(peerRowsForReport(rows)[0].price,'—');assert.equal(peerRowsForReport(rows)[0].weekReturn52,'—');
});
test('listing prices, financial ratios and capitalisation retain their distinct currency and percentage scales',()=>{
 const mixed=comparableCompany('SAP.DE',summary('SAP.DE','EUR'),price('USD'),false,now)!;
 assert.equal(mixed.price,null);assert.equal(mixed.currency,'EUR');assert.equal(mixed.financialCurrency,'USD');assert.equal(mixed.roe,12);assert.equal(mixed.revenueGrowth,20);
 const british=comparableCompany('VOD.L',summary('VOD.L','GBp'),price('GBX'),false,now)!;
 assert.equal(british.price,100);assert.equal(british.currency,'GBX');assert.equal(british.capitalCurrency,'GBP');assert.equal(british.marketCap,1250000000);assert.match(peerRowsForReport([british])[0].marketCap,/GBP$/);
});
test('duplicate share classes and wrong instruments cannot crowd out distinct companies or the analysed subject',async()=>{
 const rows=await loadComparableCompanies(['GOOGL','GOOG','META','FUND'],'GOOGL',{summary:async symbol=>symbol==='FUND'?{...summary(symbol),quoteType:{symbol,quoteType:'ETF',longName:'Fund'}}:summary(symbol,'USD',symbol.startsWith('GOOG')?'same-issuer':symbol),quote:async()=>price(),now});
 assert.deepEqual(rows.map(r=>r.symbol),['GOOGL','META']);assert.equal(rows[0].subject,true);
 assert.equal(comparableCompany('AAA',summary('BBB'),price(),false,now),null);
 const unverified=summary('AAA');delete unverified.quoteType.symbol;assert.equal(comparableCompany('AAA',unverified,price(),false,now),null);
});
test('zero margins and negative growth are observations, while a future-dated quote remains absent',()=>{
 const raw=summary('AAA');raw.financialData.profitMargins=0;raw.financialData.revenueGrowth=-.12;
 const row=comparableCompany('AAA',raw,{...price(),timestamp:now/1000+3600},false,now)!;
 assert.equal(row.netMargin,0);assert.equal(row.revenueGrowth,-12);assert.equal(row.price,null);assert.equal(row.quoteAt,null);
});
test('a customised European sector verifies report candidates instead of silently selecting a US sector ETF',async()=>{
 const visited:string[]=[];
 const result=await loadSectorComparables('Software empresarial europeo','sector',{}, {summary:async symbol=>{visited.push(symbol);return summary(symbol,'EUR');},quote:async()=>price('EUR'),hints:[{symbol:'SAP.DE',name:'SAP SE'},{symbol:'ASML.AS',name:'ASML Holding'}],now});
 assert.deepEqual(visited,['SAP.DE','ASML.AS']);assert.deepEqual(result.companies.map(row=>row.symbol),['SAP.DE','ASML.AS']);assert.equal(result.basis,'related');assert.equal(result.reference,null);
});
test('sector fund constituents remain an identified sample, never alleged institutional purchases or a sector census',async()=>{
 const result=await loadSectorComparables('Semiconductores','sector',{}, {summary:async symbol=>symbol==='SOXX'?{quoteType:{quoteType:'ETF',longName:'Semiconductor Fund'},topHoldings:{holdings:[{symbol:'AAA',holdingPercent:.12},{symbol:'BBB',holdingPercent:.1}]},eodhd:{updatedAt:'2026-10-20'}}:summary(symbol),quote:async()=>price(),now});
 assert.equal(result.basis,'fund-sample');assert.equal(result.reference?.symbol,'SOXX');assert.equal(result.companies.length,2);assert.match(result.note,/no representa todo el sector/);assert.match(result.note,/no son flujos/);
});
test('the data endpoint remains bounded and cannot accept malformed sector flags, names or candidate lists',()=>{
 assert.equal(classify({panel:'sectorComparables',subject:'VRT'}).request_class,'data');
 assert.equal(classify({panel:'sectorComparables',subject:'Software europeo',sector:true,peers:[{symbol:'SAP.DE',name:'SAP SE'}]}).request_class,'data');
 for(const invalid of [{subject:'VRT',sector:'yes'},{subject:'../private'},{subject:'Software europeo',sector:true,peers:Array(9).fill({symbol:'AAA',name:'A'})},{subject:'Software europeo',sector:true,peers:[{symbol:'AAA',name:'<script>'}]}])assert.throws(()=>classify({panel:'sectorComparables',...invalid}),BetaError);
});
test('listing aliases verify the same instrument while preserving the requested subject and analysed row',async()=>{
 assert.equal(comparableCompany('BRK.B',summary('BRK-B'),price(),true,now)?.symbol,'BRK-B');
 assert.equal(comparableCompany('SAP.XETRA',summary('SAP.DE','EUR'),price('EUR'),true,now)?.symbol,'SAP.DE');
 const visited:string[]=[];
 const result=await loadSectorComparables('SAP.XETRA','ticker',{}, {summary:async symbol=>{visited.push(symbol);return summary(symbol,'EUR');},quote:async()=>price('EUR'),request:async()=>null,related:async()=>[],now});
 assert.equal(result.subject,'SAP.XETRA');assert.equal(result.companies[0].symbol,'SAP.DE');assert.equal(result.companies[0].subject,true);assert.ok(visited.every(symbol=>symbol==='SAP.DE'));
});
test('Spanish banking honours the requested country and report candidates, never a US banking sample',async()=>{
 const visited:string[]=[];
 const result=await loadSectorComparables('Banca española','sector',{}, {summary:async symbol=>{visited.push(symbol);return summary(symbol,'EUR');},quote:async()=>price('EUR'),hints:[{symbol:'SAN.MC',name:'Banco Santander'},{symbol:'BBVA.MC',name:'BBVA'}],now});
 assert.deepEqual(visited,['SAN.MC','BBVA.MC']);assert.equal(result.reference,null);assert.equal(result.companies.length,2);
});
