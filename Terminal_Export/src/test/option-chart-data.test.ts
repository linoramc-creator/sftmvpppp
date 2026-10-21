import {expect,it} from 'vitest';
import {strikeMetricRows} from '../lib/option-chart-data';
import type {OptionContract} from '../types/options';
const contract=(strike:number,volume:number|null,openInterest=100)=>({strike,volume,openInterest} as OptionContract);
it('keeps a known zero distinct from an unavailable side when aggregating strikes',()=>{
 expect(strikeMetricRows([contract(100,0),contract(105,10),contract(105,20)],[contract(100,null),contract(105,5)],100,'volume')).toEqual([{strike:100,calls:0,puts:null},{strike:105,calls:30,puts:5}]);
});
it('filters by the selected strike window without changing volume into open interest',()=>{
 const calls=[contract(100,4,400),contract(120,12,1200),contract(140,14,1400)];
 expect(strikeMetricRows(calls,[],100,'openInterest',.1)).toEqual([{strike:100,calls:400,puts:null}]);
 expect(strikeMetricRows(calls,[],100,'volume',.5)).toHaveLength(3);
 expect(strikeMetricRows([contract(100,null),contract(101,-1),contract(102,Infinity)],[],100,'volume')).toEqual([]);
 expect(strikeMetricRows(calls,[],0,'volume')).toEqual([]);
});
