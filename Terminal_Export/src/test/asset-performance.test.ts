import {it,expect} from 'vitest';
import {assetPerformance} from '../lib/asset-performance';
it('aligns common sessions, normalizes at same origin and excludes foreign currency',()=>{
 const series=[{symbol:'A',currency:'USD',dates:['2026-10-01','2026-10-02','2026-10-03'],closes:[50,100,110],raw:[],volumes:[]},{symbol:'SPY',currency:'USD',dates:['2026-10-02','2026-10-03'],closes:[200,210],raw:[],volumes:[]},{symbol:'EUR',currency:'EUR',dates:[],closes:[],raw:[],volumes:[]}];
 const result=assetPerformance(series,'A',30);expect(result.rows).toHaveLength(2);expect(result.rows[0].A).toBe(0);expect(result.rows[1].A).toBeCloseTo(10);expect(result.rows[1].SPY).toBeCloseTo(5);expect(result.excluded).toEqual(['EUR']);
});
