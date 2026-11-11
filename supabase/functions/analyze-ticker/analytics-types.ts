/** Versioned, serializable Analytics contract. No expressions, SQL or code. */
export type AnalyticsMetric = 'price'|'revenue'|'netIncome'|'grossProfit'|'operatingCashFlow'|'freeCashFlow'|'capex'|'capexAI'|'cash'|'totalDebt'|'equity'|'totalAssets'|'portfolioExposure';
export type AnalyticsOperation = 'level'|'base100'|'growth_yoy'|'growth_qoq'|'ratio';
export type AnalyticsFrequency = 'daily'|'weekly'|'monthly'|'quarterly'|'annual';
export type AnalyticsQuery = {
  version: 1;
  assets: string[];
  metric: AnalyticsMetric;
  operation: AnalyticsOperation;
  denominator?: AnalyticsMetric;
  period: { range: '1y'|'2y'|'5y'|'custom'; from?: string; to?: string };
  frequency: AnalyticsFrequency;
  currency: 'original'|'USD'|'EUR'|'GBP';
  chart: 'line'|'bar'|'scatter';
  dataKind: 'reported';
  portfolioId?: string;
};
export type AnalyticsSource = { id:string; name:string; url:string; fetchedAt:string; dataThrough:string|null; exportAllowed:boolean; exportNote:string };
export type AnalyticsPoint = { date:string; value:number|null; originalValue?:number|null; currency:string|null; fiscalPeriod?:string; filingDate?:string|null; periodType?:'3M'|'12M'|'instant'|'price'; status:'available'|'missing'|'incompatible'; sourceId:string; sourceIds?:string[]; detail?:string };
export type AnalyticsSeries = { id:string; symbol:string; label:string; unit:string; currency:string|null; points:AnalyticsPoint[]; status:'complete'|'partial'|'unavailable'; sourceIds:string[]; notes:string[] };
export type AnalyticsResult = {
  version:1;
  query:AnalyticsQuery;
  generatedAt:string;
  from:string;
  to:string;
  title:string;
  status:'complete'|'partial'|'unavailable';
  series:AnalyticsSeries[];
  table: { date:string; values:Record<string,number|null> }[];
  sources:AnalyticsSource[];
  methodology:string[];
  warnings:string[];
  alternatives:{label:string;reason:string;query:AnalyticsQuery}[];
  export:{chart:boolean;table:boolean;reason:string};
};
export type AnalyticsInterpretation = { query:AnalyticsQuery; defaults:string[]; notices:string[]; interpretedBy:'rules'|'model'; model:string|null };
export type AnalyticsPriceInput = {symbol:string;currency:string|null;points:{date:string;value:number}[];source:AnalyticsSource;adjustment:'split-adjusted-price'|'unadjusted-price';notes?:string[]};
export type AnalyticsFundamentalInput = {symbol:string;rows:{date:string;currency:string|null;filingDate:string|null;periodType:'3M'|'YTD'|'12M'|'instant';values:Partial<Record<AnalyticsMetric,number|null>>;valueSourceIds?:Partial<Record<AnalyticsMetric,string>>}[];source:AnalyticsSource;sources?:AnalyticsSource[];notes?:string[]};
export type AnalyticsPortfolioInput = {id:string;currency:string;asOf:string;positions:{symbol:string;marketValue:number|null;currency:string;quantity:number;priceAt:string|null}[];equity:number|null;cash:number|null;notes:string[]};
export type AnalyticsDependencies = {
  now?:number;
  prices?:(symbol:string,from:string,to:string)=>Promise<AnalyticsPriceInput|null>;
  fundamentals?:(symbol:string,from:string,to:string)=>Promise<AnalyticsFundamentalInput|null>;
  fx?:(fromCurrency:string,toCurrency:string,dates:string[])=>Promise<{date:string;rate:number;source?:AnalyticsSource}[]>;
  portfolio?:(portfolioId?:string)=>Promise<AnalyticsPortfolioInput|null>;
};
