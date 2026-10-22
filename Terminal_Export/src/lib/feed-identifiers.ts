import type {FeedQuote} from '../../../supabase/functions/analyze-ticker/panels';

/** Keep the instrument that was actually priced. SGX's product code and dated
 * settlement are not interchangeable with a provider's continuous future. */
export function feedTicker(quote:Pick<FeedQuote,'symbol'|'displaySymbol'>):string{
 if(quote.symbol==='SGX-IODEX')return 'FEF';
 return quote.displaySymbol&&/^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/.test(quote.displaySymbol)?quote.displaySymbol:quote.symbol;
}
export function feedTickerContext(quote:Pick<FeedQuote,'symbol'|'contractLabel'>):string|null{
 return quote.symbol==='SGX-IODEX'?['SGX',quote.contractLabel].filter(Boolean).join(' · '):null;
}
