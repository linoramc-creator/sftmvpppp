export type TreasuryPoint={years:number;yield:number|null;date:string|null;changeBp:number|null};
export const TREASURY_MATURITIES=[{years:.5,series:'DGS6MO'},{years:1,series:'DGS1'},{years:2,series:'DGS2'},{years:5,series:'DGS5'},{years:10,series:'DGS10'},{years:20,series:'DGS20'}] as const;
export const treasuryLabel=(years:number)=>years===.5?'6 meses':years===1?'1 año':`${years} años`;
export function commonTreasuryDate(points:TreasuryPoint[]):string|null{
  return points.length>=2&&points.every(p=>p.yield!==null&&p.date)&&new Set(points.map(p=>p.date)).size===1?points[0].date:null;
}
