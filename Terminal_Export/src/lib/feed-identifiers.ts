type FeedIdentifier={symbol:string;displaySymbol?:string;contractLabel?:string};
type IdentifierInput=string|FeedIdentifier;
const rawSymbol=(value:IdentifierInput)=>typeof value==='string'?value:value.symbol;
const INDEX_TICKERS:Record<string,string>={'^GSPC':'SPX','^IXIC':'IXIC','^DJI':'DJI','^VIX':'VIX','^KS11':'KOSPI','^N225':'NKY','^NDX':'NDX','^RUT':'RUT','^FTSE':'FTSE','^GDAXI':'DAX','^FCHI':'CAC40','^STOXX50E':'STOXX50E','^HSI':'HSI'};
const TREASURY_TICKERS:Record<string,string>={'0.25':'US03MY','0.5':'US06MY','1':'US01Y','2':'US02Y','5':'US05Y','10':'US10Y','20':'US20Y'};

/** Keep the instrument that was actually priced. SGX's product code and dated
 * settlement are not interchangeable with a provider's continuous future. */
export function feedTicker(value:IdentifierInput):string{
 const symbol=rawSymbol(value);
 if(symbol==='SGX-IODEX')return 'FEF';
 if(INDEX_TICKERS[symbol])return INDEX_TICKERS[symbol];
 if(/^[A-Z]{6}=X$/.test(symbol))return symbol.slice(0,-2);
 if(/^[A-Z]{3}=X$/.test(symbol))return 'USD'+symbol.slice(0,3);
 if(/^(?:BTC|ETH|SOL|XRP|ADA|DOGE|LTC|BCH|BNB|DOT|AVAX)-(?:USD|EUR|GBP|JPY|USDT|USDC)$/.test(symbol))return symbol.replace('-','');
 if(/^[A-Z0-9]+(?:\.CME)?=F$/.test(symbol))return symbol.replace(/(?:\.CME)?=F$/,'');
 // A display override must never relabel a priced future as a spot instrument
 // or a different ETF. Unknown identifiers retain their verified raw symbol.
 return symbol;
}
export function feedTickerContext(value:IdentifierInput):string|null{
 const symbol=rawSymbol(value);
 if(symbol==='SGX-IODEX')return ['SGX',typeof value==='string'?null:value.contractLabel].filter(Boolean).join(' · ');
 if(/^(?:XAU|XAG)USD(?:=X)?$/.test(symbol))return 'Contado';
 if(/^[A-Z0-9]+(?:\.CME)?=F$/.test(symbol))return symbol.includes('.CME')?'Futuros · CME':'Futuros';
 return null;
}
/** Research aliases identify a maturity, not a specific security or a data feed. */
export function treasuryDisplayTicker(years:number):string|null{return TREASURY_TICKERS[String(years)]??null;}
