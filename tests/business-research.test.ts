import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBreakdowns} from '../supabase/functions/analyze-ticker/business-research.ts';
const text='Year ended December 31, 2025. Revenue in thousands of USD. Products | 900 Services | 100 Total | 1,000';
const docs=[{url:'https://issuer.example/report',title:'Annual report',text}];
const table={date:'2025-12-31',period:'annual',currency:'USD',scale:1000,total:1000,url:docs[0].url,periodEvidence:'Year ended December 31, 2025. Revenue in thousands of USD.',segments:[{name:'Productos',amount:900,evidence:'Products | 900'},{name:'Servicios',amount:100,evidence:'Services | 100'}]};
test('extracts documented amounts with scale and period',()=>{const result=validateBreakdowns([table],docs);assert.equal(result.length,1);assert.equal(result[0].segments[0].value,900000);assert.equal(result[0].period,'annual');});
test('rejects invented numbers, evidence, mismatched totals and unrecognized sources',()=>{
 for(const bad of [{...table,total:2000},{...table,url:'https://other.example/report'},{...table,periodEvidence:'Invented period and currency statement'},{...table,segments:[{...table.segments[0],amount:901},table.segments[1]]},{...table,segments:[table.segments[0],{...table.segments[1],evidence:'Services | 100 invented'}]}])assert.equal(validateBreakdowns([bad],docs).length,0);
});
test('preserves published geographic percentages without inventing monetary amounts',()=>{
 const excerpt='For the year ended December 31, 2025, revenue in the U.S. was 81% of total revenue.';
 const pct={...table,currency:'%',scale:1,total:100,periodEvidence:excerpt,segments:[{name:'Estados Unidos',amount:81,evidence:excerpt}]};
 const result=validateBreakdowns([pct],[{...docs[0],text:excerpt}]);
 assert.equal(result[0].currency,'%');assert.deepEqual(result[0].segments.map(s=>s.value),[81,19]);
 assert.equal(validateBreakdowns([{...pct,scale:1000}],[{...docs[0],text:excerpt}]).length,0);
});
