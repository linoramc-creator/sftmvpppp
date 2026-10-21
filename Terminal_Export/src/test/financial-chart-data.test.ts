import {describe,expect,it} from 'vitest';
import {chartDateLabel,formatChartMoney,normalizeSparkline,percentageBarWidth,sparklineSummary,visibleDatedRows,visibleSparkline} from '../lib/financial-chart-data';
import {fmtPrice,fmtPctFrac} from '../components/options/theme';
describe('honest financial chart data',()=>{
 it('aligns and orders timestamps while preserving real zeroes and unavailable observations',()=>{
  const result=normalizeSparkline({t:[200,100,300,400,500,NaN],c:[20,0,null,Infinity,'50',60]});
  expect(result).toEqual([{t:100,v:0},{t:200,v:20},{t:300,v:null},{t:400,v:null},{t:500,v:null}]);
  expect(sparklineSummary(result)).toMatchObject({low:0,high:20,change:null});
  expect(normalizeSparkline({t:[1700000000000],c:[5]})).toEqual([{t:1700000000,v:5}]);
 });
 it('anchors controls to the last available session instead of the wall clock and keeps gaps inside the visible period',()=>{
  const rows=[{t:100000,v:10},{t:200000,v:null},{t:300000,v:20}];
  expect(visibleSparkline(rows,2)).toEqual(rows.slice(1));
  expect(visibleSparkline(rows,null)).toBe(rows);
  expect(visibleDatedRows([{date:'2020-01-01',v:1},{date:'2020-12-01',v:null},{date:'2020-12-31',v:3}],30)).toEqual([{date:'2020-12-01',v:null},{date:'2020-12-31',v:3}]);
 });
 it('does not draw nonzero allocations for zero holdings or invalid denominators',()=>{
  expect(percentageBarWidth(0)).toBe(0);expect(percentageBarWidth(10,20)).toBe(50);
  expect(percentageBarWidth(5,0)).toBe(0);expect(percentageBarWidth(-5)).toBe(0);expect(percentageBarWidth(150)).toBe(100);
 });
});
describe('dates, units and precision',()=>{
 it('formats actual reporting currency without assuming dollars when currency is unknown',()=>{
  expect(formatChartMoney(1234.5,'EUR')).toBe('1234,50 EUR');
  expect(formatChartMoney(-1000000,'GBP',true)).toBe('-1 M GBP');
  expect(formatChartMoney(0,'JPY')).toBe('0,00 JPY');
  expect(formatChartMoney(12.25)).toBe('12,25');
  expect(formatChartMoney(null,'USD')).toBe('—');expect(fmtPrice(Infinity)).toBe('—');
  expect(fmtPctFrac(0)).toBe('0.0%');
 });
 it('keeps complete hover dates in UTC, even near the start of a month',()=>{
  expect(chartDateLabel('2026-01-01',true)).toMatch(/01 ene 2026/);
  expect(chartDateLabel('unavailable',true)).toBe('unavailable');
 });
});
