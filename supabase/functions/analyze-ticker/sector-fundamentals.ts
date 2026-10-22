import {eodhdSummary} from './eodhd-fundamentals.ts';
import {eodhdQuote} from './eodhd-market.ts';
type Row=Record<string,any>;
const references:[RegExp,string][]=[[/semiconduct|semiconductor/i,'SOXX'],[/inteligencia artificial|artificial intelligence/i,'AIQ'],[/ciberseguridad|cybersecurity/i,'CIBR'],[/fintech/i,'FINX'],[/defensa|defense|aerospace/i,'ITA'],[/banc|bank/i,'KBE'],[/inmobiliari|real estate/i,'XLRE'],[/salud|healthcare|health care/i,'XLV'],[/energ[ií]a|energy/i,'XLE'],[/tecnolog|technology/i,'XLK'],[/industrial/i,'XLI'],[/material/i,'XLB'],[/comunicaci|communication/i,'XLC'],[/consumo|consumer/i,'XLY'],[/servicios p[uú]blicos|utilities/i,'XLU'],[/financier|financial/i,'XLF']];
export function sectorReference(sector:string):string|null{if(/europ|francia|german|aleman|brit[aá]nic|reino unido|china|jap[oó]n|india|asia|espa[nñ]|spain|itali|italy|canad|m[eé]xic|brasil|brazil|austral|suiz|swiss|switz|suec|swed|n[oó]rdic|holand|pa[ií]ses bajos|netherland|b[eé]lg|portug|latinoam|global|mundial|internacion|internation/i.test(sector))return null;return references.find(([pattern])=>pattern.test(sector))?.[1]??null;}
/** Actual fund holdings provide an identified sample, never a purported census
 * of the sector. Preserve statement currencies and distinguish dated positions
 * from orders, flows, analyst recommendations and current prices. */
export async function sectorFundamentalsContext(sector:string,deps={summary:eodhdSummary,quote:eodhdQuote}):Promise<string>{
 const symbol=sectorReference(sector);if(!symbol)return '';
 const fund=await deps.summary(symbol);if(fund?.quoteType?.quoteType!=='ETF')return '';
 const holdings=(fund.topHoldings?.holdings??[]).filter((h:Row)=>typeof h.symbol==='string'&&typeof h.holdingPercent==='number'&&h.holdingPercent>0).slice(0,5);
 const companies=await Promise.all(holdings.map(async(h:Row)=>{
  const summary=await deps.summary(h.symbol);if(summary?.quoteType?.quoteType!=='EQUITY')return null;
  const quote=await deps.quote(h.symbol),f=summary.financialData??{},s=summary.summaryDetail??{},k=summary.defaultKeyStatistics??{},p=summary.price??{};
  return {ticker:h.symbol,name:summary.quoteType.longName,currency:p.currency,reportingCurrency:f.financialCurrency,updatedAt:summary.eodhd?.updatedAt,referenceWeightPct:h.holdingPercent*100,
   quote:quote?.currency===p.currency?{price:quote.close,at:quote.timestamp,changePct:quote.change_p}:null,
   marketCap:p.marketCap,pe:s.trailingPE,forwardPe:s.forwardPE,pb:k.priceToBook,evEbitda:k.enterpriseToEbitda,roe:f.returnOnEquity,operatingMargin:f.operatingMargins,revenueTTM:f.totalRevenue,revenueGrowthYoY:f.revenueGrowth,
   analystConsensus:summary.eodhd?.analystConsensus,analystCounts:summary.recommendationTrend?.trend?.[0]};
 }));
 const sample=companies.filter(Boolean);if(!sample.length)return '';
 return '\n=== DATOS FUNDAMENTALES SECTORIALES VERIFICADOS ===\n'+JSON.stringify({reference:{ticker:symbol,name:fund.quoteType.longName,updatedAt:fund.eodhd?.updatedAt,expenseRatio:fund.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio,totalAssetsUSD:fund.summaryDetail?.totalAssets},companies:sample})+'\nUsa estos datos como prioridad sobre cifras contradictorias de extractos de noticias. Son una muestra de posiciones del ETF de referencia, no todas las empresas del sector. Los pesos no son flujos institucionales. Ratios ROE, margen y crecimiento se expresan como fracciones: multiplica por 100 para porcentajes. Conserva moneda, fecha y período; no conviertas posiciones ni valoraciones en compras o recomendaciones.\n';
}
