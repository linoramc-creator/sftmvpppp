// Shared by the market endpoint and the sidebar. A fund proxy must never be
// silently substituted for the index it tracks (particularly VIX futures ETFs).
export const MARKET_REFERENCES = [
  {symbol:'^GSPC',label:'S&P 500',unit:'points',sidebar:0},
  {symbol:'^NDX',label:'NASDAQ 100',unit:'points',sidebar:null},
  {symbol:'^DJI',label:'DOW JONES',unit:'points',sidebar:null},
  {symbol:'IWM',label:'RUSSELL 2000 · IWM',unit:'currency',sidebar:2},
  {symbol:'^VIX',label:'VIX · VOLATILIDAD',unit:'points',sidebar:1},
  {symbol:'GLD',label:'ORO · GLD',unit:'currency',sidebar:3},
  {symbol:'TLT',label:'BONOS 20Y+ · TLT',unit:'currency',sidebar:null},
] as const;

export const SIDEBAR_MARKET_REFERENCES = MARKET_REFERENCES
  .filter(reference=>reference.sidebar!==null)
  .sort((a,b)=>(a.sidebar??0)-(b.sidebar??0));
