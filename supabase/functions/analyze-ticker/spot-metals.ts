// Verified spot pairs. A metal spot quote is not the corresponding futures
// contract; the canonical =X form keeps the existing FX provider mapping.
const METALS={
 'XAUUSD=X':{code:'XAUUSD',name:'Oro · Spot',providerSymbol:'XAUUSD.FOREX',massiveTicker:'C:XAUUSD'},
 'XAGUSD=X':{code:'XAGUSD',name:'Plata · Spot',providerSymbol:'XAGUSD.FOREX',massiveTicker:'C:XAGUSD'},
} as const;
export function spotMetal(symbol:string){return Object.hasOwn(METALS,symbol)?METALS[symbol as keyof typeof METALS]:null;}
