export const FEED_GROUP_LIMIT = 7;
export const FEED_GROUP_KEYS = ['indices', 'etfs', 'currencies', 'commodities'] as const;
export type FeedGroupKey = typeof FEED_GROUP_KEYS[number];
export type FeedPreferences = Record<FeedGroupKey, string[]>;
export const FEED_GROUP_LIMITS:Record<FeedGroupKey,number>={indices:FEED_GROUP_LIMIT,etfs:10,currencies:FEED_GROUP_LIMIT,commodities:FEED_GROUP_LIMIT};
export const FEED_GROUP_LABELS: Record<FeedGroupKey, string> = {indices:'ÍNDICES',etfs:'ETF PRINCIPALES',currencies:'DIVISAS Y ACTIVOS DIGITALES',commodities:'MATERIAS PRIMAS'};
export const FEED_DEFAULT_ITEMS: Record<FeedGroupKey, [string,string][]> = {
 indices:[['^GSPC','S&P 500'],['^IXIC','Nasdaq Composite'],['NQ=F','Nasdaq 100 · Futuro'],['^DJI','Dow Jones'],['^KS11','KOSPI · Corea del Sur'],['^N225','Nikkei 225 · Japón'],['^VIX','Volatilidad']],
 etfs:[['SPY','S&P 500 · SPY'],['QQQ','Nasdaq 100 · QQQ'],['URTH','MSCI World · URTH'],['IWM','Russell 2000 · IWM'],['VEA','Desarrollados fuera de EE. UU. · VEA'],['VWO','Emergentes · VWO'],['TLT','Tesoro a largo plazo · TLT'],['GLD','Oro · GLD'],['HYG','Crédito high yield · HYG'],['LQD','Crédito investment grade · LQD']],
 currencies:[['EURUSD=X','EUR/USD'],['GBPUSD=X','GBP/USD'],['JPY=X','USD/JPY'],['CHF=X','USD/CHF'],['CAD=X','USD/CAD'],['CNY=X','USD/CNY'],['BTC-USD','Bitcoin']],
 commodities:[['GC=F','Oro'],['SI=F','Plata'],['CL=F','Petróleo WTI'],['BZ=F','Petróleo Brent'],['HG=F','Cobre'],['NG=F','Gas natural'],['SGX-IODEX','Hierro · IODEX']],
};
// Curated identifiers are suggestions, not entitlements or verified current
// prices. Every addition still passes the server's live metadata validation.
export const FEED_SUGGESTIONS:Record<FeedGroupKey,[string,string][]>={
 indices:[...FEED_DEFAULT_ITEMS.indices,['^NDX','Nasdaq 100'],['^FTSE','FTSE 100'],['^GDAXI','DAX'],['^FCHI','CAC 40'],['^STOXX50E','Euro Stoxx 50'],['^HSI','Hang Seng'],['^RUT','Russell 2000'],['ES=F','S&P 500 · Futuro']],
 etfs:[...FEED_DEFAULT_ITEMS.etfs,['VTI','Mercado de EE. UU. · VTI'],['VT','Renta variable global · VT'],['QQQM','Nasdaq 100 · QQQM'],['DIA','Dow Jones · DIA'],['AGG','Bonos agregados · AGG'],['XLK','Tecnología · XLK'],['XLE','Energía · XLE'],['XLV','Salud · XLV']],
 currencies:[...FEED_DEFAULT_ITEMS.currencies,['EURJPY=X','EUR/JPY'],['EURGBP=X','EUR/GBP'],['GBPJPY=X','GBP/JPY'],['AUDUSD=X','AUD/USD'],['NZDUSD=X','NZD/USD'],['MXN=X','USD/MXN'],['ETH-USD','Ethereum'],['SOL-USD','Solana']],
 commodities:[...FEED_DEFAULT_ITEMS.commodities,['PL=F','Platino'],['PA=F','Paladio'],['ALI=F','Aluminio'],['KC=F','Café'],['SB=F','Azúcar'],['CC=F','Cacao'],['CT=F','Algodón']],
};
const INDEX_ALIASES:Record<string,string>={SPX:'^GSPC',SP500:'^GSPC','S&P500':'^GSPC',NDX:'^NDX',IXIC:'^IXIC',NASDAQ:'^IXIC',DJI:'^DJI',DJIA:'^DJI',VIX:'^VIX',RUT:'^RUT',KOSPI:'^KS11',KS11:'^KS11',N225:'^N225',NIKKEI:'^N225',FTSE:'^FTSE',DAX:'^GDAXI',CAC40:'^FCHI',STOXX50E:'^STOXX50E',FTSEMIB:'FTSEMIB.MI',NQ:'NQ=F',ES:'ES=F',YM:'YM=F',RTY:'RTY=F'};
const COMMODITY_ALIASES:Record<string,string>={GC:'GC=F',SI:'SI=F',CL:'CL=F',BZ:'BZ=F',HG:'HG=F',NG:'NG=F',PL:'PL=F',PA:'PA=F',ALI:'ALI=F',KC:'KC=F',SB:'SB=F',CC:'CC=F',CT:'CT=F',FEF:'SGX-IODEX',IODEX:'SGX-IODEX',IRON:'SGX-IODEX'};
const FX_CODES=new Set('USD EUR GBP JPY CHF CAD CNY CNH AUD NZD HKD SGD SEK NOK DKK MXN BRL ZAR INR KRW TRY PLN CZK HUF ILS SAR AED THB TWD'.split(' '));
export function normalizeFeedSymbol(group:FeedGroupKey,value:unknown):string|null{
 if(typeof value!=='string'||value.length>32||!FEED_GROUP_KEYS.includes(group)||/[\p{Cc}\p{Cf}]/u.test(value))return null;
 let symbol=value.trim().toUpperCase().replace(/ +/g,'');if(!symbol||!/^[A-Z0-9^][A-Z0-9.^=/&_-]{0,29}$/.test(symbol))return null;
 if(group==='indices')symbol=INDEX_ALIASES[symbol]??symbol;
 if(group==='commodities')symbol=COMMODITY_ALIASES[symbol]??symbol;
 if(group==='commodities'&&symbol==='FEF=F')return null; // Not the SGX FEF reference.
 if(group==='currencies'){
  // A native three-letter =X identifier is USD/base (EUR=X is USD/EUR).
  // Only bare human shorthand such as EUR may choose the EUR/USD convention.
  if(/^[A-Z]{3}=X$/.test(symbol))return symbol;
  const crypto=/^(BTC|ETH|SOL|XRP|ADA|DOGE)(?:[/-]?USD)?$/.exec(symbol);if(crypto)symbol=crypto[1]+'-USD';
  else{
   let pair=symbol.replace(/=X$/,'').replace(/[/-]/g,'');
   if(pair.length===3&&FX_CODES.has(pair)&&pair!=='USD')pair=['EUR','GBP','AUD','NZD'].includes(pair)?pair+'USD':'USD'+pair;
   if(pair.length===6&&FX_CODES.has(pair.slice(0,3))&&FX_CODES.has(pair.slice(3))){if(pair.slice(0,3)===pair.slice(3))return null;symbol=(pair.startsWith('USD')?pair.slice(3):pair)+'=X';}
  }
 }
 return feedSymbolAllowed(group,symbol)?symbol:null;
}
export function feedSuggestions(group:FeedGroupKey,query:string,selected:string[],limit=6):[string,string][]{
 const simplify=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''),needle=simplify(query),canonical=normalizeFeedSymbol(group,query);
 return FEED_SUGGESTIONS[group].filter(([symbol,label])=>!selected.includes(symbol)&&(!needle||symbol===canonical||simplify(symbol).includes(needle)||simplify(label).includes(needle))).slice(0,Math.max(0,Math.min(FEED_GROUP_LIMITS[group],limit)));
}
export function defaultFeedPreferences():FeedPreferences{return Object.fromEntries(FEED_GROUP_KEYS.map(key=>[key,FEED_DEFAULT_ITEMS[key].map(([symbol])=>symbol)])) as FeedPreferences;}
export function feedSymbolAllowed(key:FeedGroupKey,symbol:string):boolean{
 if(!/^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/.test(symbol))return false;
 if(key==='commodities')return symbol==='SGX-IODEX'||/^[A-Z0-9]+(?:\.CME)?=F$/.test(symbol);
 // Some published indices use exchange-suffixed symbols without a caret
 // (for example FTSEMIB.MI). Metadata validation decides their instrument type.
 if(key==='indices')return symbol.startsWith('^')||/^[A-Z0-9]+(?:\.CME)?=F$/.test(symbol)||!symbol.includes('=')&&!symbol.includes('-');
 if(key==='currencies')return /^(?:[A-Z]{3}|[A-Z]{6})=X$/.test(symbol)||/^[A-Z0-9]{2,10}-[A-Z]{3,4}$/.test(symbol);
 return !symbol.startsWith('^')&&!symbol.includes('=')&&!symbol.includes('-');
}
export function normalizeFeedPreferences(value:unknown,options:{legacy?:boolean}={}):FeedPreferences|null{
 if(value===undefined||value===null)return defaultFeedPreferences();
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const keys=Object.keys(value),legacyShape=options.legacy&&keys.length===3&&['indices','etfs','currencies'].every(key=>keys.includes(key));
 if((keys.length!==FEED_GROUP_KEYS.length&&!legacyShape)||keys.some(key=>!FEED_GROUP_KEYS.includes(key as FeedGroupKey)))return null;
 const result={} as FeedPreferences;
 for(const key of FEED_GROUP_KEYS){
  const list=legacyShape&&key==='commodities'?defaultFeedPreferences().commodities:(value as Record<string,unknown>)[key];
  if(!Array.isArray(list)||list.length<1||list.length>(options.legacy?12:FEED_GROUP_LIMITS[key])||list.some(symbol=>typeof symbol!=='string'))return null;
  const symbols=list.map(symbol=>normalizeFeedSymbol(key,symbol));if(symbols.some(symbol=>symbol===null))return null;
  const unique=[...new Set(symbols as string[])];if(!options.legacy&&unique.length!==symbols.length)return null;
  result[key]=unique.slice(0,FEED_GROUP_LIMITS[key]);
 }
 return result;
}
export function normalizeSavedFeedPreferences(value:unknown):FeedPreferences|null{return normalizeFeedPreferences(value,{legacy:true});}
export function feedPreferenceLabel(key:FeedGroupKey,symbol:string):string{return FEED_SUGGESTIONS[key].find(([item])=>item===symbol)?.[1]??symbol;}
export function feedPreferencesIdentity(preferences:FeedPreferences):string{return FEED_GROUP_KEYS.map(key=>`${key}=${preferences[key].join(',')}`).join(';');}
export async function feedPreferencesKey(symbols:string[],preferences:FeedPreferences):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${symbols.join(',')}|${feedPreferencesIdentity(preferences)}`));
 return 'feed-markets-v10:'+Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
