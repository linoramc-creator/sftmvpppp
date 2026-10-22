import {expect,it} from 'vitest';
import {feedTicker,feedTickerContext} from '../lib/feed-identifiers';
import {treasuryIdentifier} from '../../../supabase/functions/analyze-ticker/treasury-curve';

it('shows the priced identifiers without turning indices into ETFs or reversing FX pairs',()=>{
 for(const symbol of ['BZ=F','GC=F','CL=F','^GSPC','^KS11','NQ=F','QQQ','EURUSD=X','JPY=X','CHF=X','BTC-USD'])expect(feedTicker({symbol})).toBe(symbol);
 expect(feedTickerContext({symbol:'BZ=F'})).toBeNull();
});
it('distinguishes the SGX product and actual settlement month from a fictitious continuous contract',()=>{
 expect(feedTicker({symbol:'SGX-IODEX'})).toBe('FEF');
 expect(feedTickerContext({symbol:'SGX-IODEX',contractLabel:'Nov-26'})).toBe('SGX · Nov-26');
 expect(feedTickerContext({symbol:'SGX-IODEX'})).toBe('SGX');
 expect(feedTicker({symbol:'BZ=F',displaySymbol:'Petróleo Brent'})).toBe('BZ=F');
});
it('uses the actual yield-series identifier instead of fabricating a tradable sovereign ticker',()=>{
 expect([.5,1,2,5,10,20].map(treasuryIdentifier)).toEqual(['DGS6MO','DGS1','DGS2','DGS5','DGS10','DGS20']);
 expect(treasuryIdentifier(4)).toBeNull();
});
