// These are dated physical spot references, not listed futures or CFD quotes.
// Keep the internal identifiers distinct from CL=F/BZ=F outside feed preferences.
const OILS={
 'WTI-SPOT':{code:'WTI',name:'Petróleo WTI · Contado',series:'DCOILWTICO',eiaSeries:'RWTC',eiaProduct:'EPCWTI',history:'RWTCD.htm',title:'Cushing, OK WTI Spot Price FOB',location:'Cushing, Oklahoma'},
 'BRENT-SPOT':{code:'BRENT',name:'Petróleo Brent · Contado',series:'DCOILBRENTEU',eiaSeries:'RBRTE',eiaProduct:'EPCBRENT',history:'RBRTEd.htm',title:'Europe Brent Spot Price FOB',location:'Europa'},
} as const;
export function spotOil(symbol:string){return Object.hasOwn(OILS,symbol)?OILS[symbol as keyof typeof OILS]:null;}
