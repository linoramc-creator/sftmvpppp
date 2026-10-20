export const FEED_GROUP_LIMIT = 12;
export const FEED_GROUP_KEYS = ['indices', 'etfs', 'currencies'] as const;
export type FeedGroupKey = typeof FEED_GROUP_KEYS[number];
export type FeedPreferences = Record<FeedGroupKey, string[]>;
export const FEED_GROUP_LABELS: Record<FeedGroupKey, string> = {indices:'ÍNDICES',etfs:'ETF PRINCIPALES',currencies:'DIVISAS Y ACTIVOS DIGITALES'};
export const FEED_DEFAULT_ITEMS: Record<FeedGroupKey, [string,string][]> = {
 indices:[['^GSPC','S&P 500'],['^IXIC','Nasdaq Composite'],['NQ=F','Nasdaq 100 · Futuro'],['^DJI','Dow Jones'],['^KS11','KOSPI · Corea del Sur'],['^N225','Nikkei 225 · Japón'],['^VIX','Volatilidad']],
 etfs:[['SPY','S&P 500 · SPY'],['QQQ','Nasdaq 100 · QQQ'],['URTH','MSCI World · URTH'],['IWM','Russell 2000 · IWM'],['VEA','Desarrollados fuera de EE. UU. · VEA'],['VWO','Emergentes · VWO'],['TLT','Tesoro a largo plazo · TLT'],['GLD','Oro · GLD']],
 currencies:[['EURUSD=X','EUR/USD'],['GBPUSD=X','GBP/USD'],['JPY=X','USD/JPY'],['CHF=X','USD/CHF'],['CAD=X','USD/CAD'],['CNY=X','USD/CNY'],['BTC-USD','Bitcoin']],
};
export function defaultFeedPreferences():FeedPreferences{return Object.fromEntries(FEED_GROUP_KEYS.map(key=>[key,FEED_DEFAULT_ITEMS[key].map(([symbol])=>symbol)])) as FeedPreferences;}
export function feedSymbolAllowed(key:FeedGroupKey,symbol:string):boolean{
 if(!/^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/.test(symbol))return false;
 // Some published indices use exchange-suffixed symbols without a caret
 // (for example FTSEMIB.MI). Metadata validation decides their instrument type.
 if(key==='indices')return symbol.startsWith('^')||/^[A-Z0-9]+(?:\.CME)?=F$/.test(symbol)||!symbol.includes('=')&&!symbol.includes('-');
 if(key==='currencies')return /^(?:[A-Z]{3}|[A-Z]{6})=X$/.test(symbol)||/^[A-Z0-9]{2,10}-[A-Z]{3,4}$/.test(symbol);
 return !symbol.startsWith('^')&&!symbol.includes('=')&&!symbol.includes('-');
}
export function normalizeFeedPreferences(value:unknown):FeedPreferences|null{
 if(value===undefined||value===null)return defaultFeedPreferences();
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 if(Object.keys(value).length!==FEED_GROUP_KEYS.length||Object.keys(value).some(key=>!FEED_GROUP_KEYS.includes(key as FeedGroupKey)))return null;
 const result={} as FeedPreferences;
 for(const key of FEED_GROUP_KEYS){
  const list=(value as Record<string,unknown>)[key];
  if(!Array.isArray(list)||list.length<1||list.length>FEED_GROUP_LIMIT||list.some(symbol=>typeof symbol!=='string'))return null;
  const symbols=list.map(symbol=>(symbol as string).trim().toUpperCase());
  if(symbols.some(symbol=>!feedSymbolAllowed(key,symbol))||new Set(symbols).size!==symbols.length)return null;
  result[key]=symbols;
 }
 return result;
}
export function feedPreferenceLabel(key:FeedGroupKey,symbol:string):string{return FEED_DEFAULT_ITEMS[key].find(([item])=>item===symbol)?.[1]??symbol;}
export function feedPreferencesIdentity(preferences:FeedPreferences):string{return FEED_GROUP_KEYS.map(key=>`${key}=${preferences[key].join(',')}`).join(';');}
export async function feedPreferencesKey(symbols:string[],preferences:FeedPreferences):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${symbols.join(',')}|${feedPreferencesIdentity(preferences)}`));
 return 'feed-markets-v8:'+Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
