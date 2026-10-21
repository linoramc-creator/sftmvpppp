import test from 'node:test';import assert from 'node:assert/strict';import{annualRevenueXbrl}from'../supabase/functions/analyze-ticker/revenue-xbrl.ts';
const url='https://www.sec.gov/Archives/issuer/annual.htm',cik='1234';
const context=(id:string,axis='',member='',start='2025-01-01',end='2025-12-31',entity=cik)=>`<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier>${entity}</xbrli:identifier>${axis?`<xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember>`:''}</xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`;
const fact=(id:string,value:number,extra='',label='')=>`<tr><td>${label}</td><td><ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" contextRef="${id}" unitRef="usd" scale="6" ${extra}>${value}</ix:nonFraction></td></tr>`;
const unit='<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>';
const products=context('all')+context('p','srt:ProductOrServiceAxis','us-gaap:ProductMember')+context('s','srt:ProductOrServiceAxis','us-gaap:ServiceMember')+fact('all',1000)+fact('p',900,'','Productos')+fact('s',100,'','Servicios');
const geo=context('us','srt:StatementGeographicalAxis','country:US')+context('eu','srt:StatementGeographicalAxis','srt:EuropeMember')+context('other','srt:StatementGeographicalAxis','issuer:RestOfWorldMember')+fact('us',700)+fact('eu',200)+fact('other',100);
test('recovers annual product and geography revenue from mixed standard and issuer dimensions',()=>{
 const result=annualRevenueXbrl(unit+products+geo,url,cik);
 assert.deepEqual(result.products[0].segments,[{name:'Productos',value:900000000},{name:'Servicios',value:100000000}]);
 assert.deepEqual(result.geography[0].segments.map(s=>s.value),[700000000,200000000,100000000]);assert.equal(result.geography[0].segments[0].name,'Estados Unidos');assert.equal(result.products[0].documentUrl,url);assert.equal(result.products[0].date,'2025-12-31');
});
test('keeps alternative product presentations separate rather than double counting',()=>{
 const alt=context('p2','srt:ProductOrServiceAxis','issuer:DevicesMember')+context('s2','srt:ProductOrServiceAxis','issuer:SupportMember')+fact('p2',850)+fact('s2',150);
 const result=annualRevenueXbrl(unit+products+alt,url,cik);assert.equal(result.products[0].segments.length,2);assert.equal(result.products[0].segments[0].name,'Productos');
});
test('requires a complete dimension set, a consolidated total and matching entity and currency',()=>{
 assert.equal(annualRevenueXbrl(unit+products.replace(fact('all',1000),''),url,cik).products.length,0);
 assert.equal(annualRevenueXbrl(unit+products.replace(fact('s',100,'','Servicios'),fact('s',102,'','Servicios')),url,cik).products.length,0);
 assert.equal(annualRevenueXbrl(unit+products,url,'999').products.length,0);
 assert.equal(annualRevenueXbrl(unit.replace('iso4217:USD','xbrli:shares')+products,url,cik).products.length,0);
});
test('rejects quarter, future periods, unsupported transformations and inconsistent duplicate facts',()=>{
 assert.equal(annualRevenueXbrl(unit+products.replaceAll('2025-01-01','2025-10-01'),url,cik).products.length,0);
 assert.equal(annualRevenueXbrl(unit+products.replaceAll('2025','2099'),url,cik).products.length,0);
 assert.equal(annualRevenueXbrl(unit+products.replace('scale="6"','scale="6" format="ixt:num-comma-decimal"'),url,cik).products.length,0);
 assert.equal(annualRevenueXbrl(unit+products+fact('p',899),url,cik).products.length,0);
 assert.equal(annualRevenueXbrl(unit+products+fact('p',900),url,cik).products.length,1);
});
test('does not mix cross-dimensional subtotals or synthesize missing segments',()=>{
 const crossed=products.replace(context('p','srt:ProductOrServiceAxis','us-gaap:ProductMember'),context('p','srt:ProductOrServiceAxis','us-gaap:ProductMember').replace('</xbrli:entity>','<xbrldi:explicitMember dimension="srt:StatementGeographicalAxis">country:US</xbrldi:explicitMember></xbrli:entity>'));
 assert.equal(annualRevenueXbrl(unit+crossed,url,cik).products.length,0);
 assert.equal(annualRevenueXbrl(unit+products+context('extra','srt:ProductOrServiceAxis','us-gaap:ExtraMember')+fact('extra',70),url,cik).products[0].segments.length,2);
});
test('preserves signed eliminations only when the whole declared presentation reconciles',()=>{
 const content=context('all')+context('a','us-gaap:StatementBusinessSegmentsAxis','issuer:HardwareMember')+context('b','us-gaap:StatementBusinessSegmentsAxis','issuer:ServicesMember')+context('e','us-gaap:StatementBusinessSegmentsAxis','issuer:EliminationsMember')+fact('all',1000)+fact('a',900)+fact('b',200)+fact('e',100,'sign="-"');
 assert.deepEqual(annualRevenueXbrl(unit+content,url,cik).products[0].segments.map(s=>s.value),[900000000,200000000,-100000000]);
 assert.equal(annualRevenueXbrl(unit+content.replace(fact('e',100,'sign="-"'),fact('e',-100,'sign="-"')),url,cik).products.length,0);
});

test('uses explicit member names when a column-oriented table repeats its Net sales row label',()=>{
 const content=products.replaceAll('Productos','Net sales').replaceAll('Servicios','Net sales');
 assert.deepEqual(annualRevenueXbrl(unit+content,url,cik).products[0].segments.map(s=>s.name),['Productos','Servicios']);
});
