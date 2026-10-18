import {expect,it} from 'vitest';
import {marketRiskSummary} from '../lib/market-risk';
import type {RiskPoint} from '../../../supabase/functions/analyze-ticker/asset-risk';
const point=(date:string,vol20:number|null,drawdown=0):RiskPoint=>({date,vol20,vol60:null,drawdown,belowPeak:0,atr:null,atrPercent:null,volumeRatio:null});
it('compares trading observations across weekends and reports percentage points, not relative percentage changes',()=>{
 const data=[point('2026-10-08',10,-8),point('2026-10-09',12,-2),point('2026-10-12',11,-5),point('2026-10-13',14,-4),point('2026-10-14',15,-3),point('2026-10-15',13,-1),point('2026-10-16',16,-2)];
 const result=marketRiskSummary(data,3);
 expect(result.change1).toBe(3);expect(result.change5).toBe(4);expect(result.worst).toBe(-3);expect(result.points.map(p=>p.date)).toEqual(['2026-10-14','2026-10-15','2026-10-16']);
});
it('does not skip missing warm-up volatility or invent longer observation changes',()=>{
 const result=marketRiskSummary([point('2026-10-12',12),point('2026-10-13',null),point('2026-10-14',14)],63);
 expect(result.change1).toBeNull();expect(result.change5).toBeNull();expect(marketRiskSummary([],21).worst).toBeNull();
});
