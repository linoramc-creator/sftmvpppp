import {expect,it} from 'vitest';
import {feedTicker,feedTickerContext,treasuryDisplayTicker} from '../lib/feed-identifiers';
import {treasuryIdentifier} from '../../../supabase/functions/analyze-ticker/treasury-curve';

it('shows conventional research symbols without changing the instrument or reversing native FX pairs',()=>{
 const aliases:Record<string,string>={'^GSPC':'SPX','^IXIC':'IXIC','^DJI':'DJI','^VIX':'VIX','^KS11':'KOSPI','^N225':'NKY','^NDX':'NDX','BZ=F':'BZ','GC=F':'GC','SI=F':'SI','CL=F':'CL','HG=F':'HG','NG=F':'NG','NQ=F':'NQ','EURUSD=X':'EURUSD','JPY=X':'USDJPY','CHF=X':'USDCHF','EUR=X':'USDEUR','GBP=X':'USDGBP','AUD=X':'USDAUD','BTC-USD':'BTCUSD','ETH-USD':'ETHUSD','XAUUSD=X':'XAUUSD','XAGUSD=X':'XAGUSD'};
 for(const [symbol,display] of Object.entries(aliases)){expect(feedTicker({symbol})).toBe(display);expect(feedTicker(symbol)).toBe(display);}
 for(const symbol of ['QQQ','SAP.DE','VWCE.DE','BRK.B','BRK-B','^UNKNOWN'])expect(feedTicker(symbol)).toBe(symbol);
 expect(feedTicker({symbol:'GC=F',displaySymbol:'XAUUSD'})).toBe('GC');
 expect(feedTicker({symbol:'QQQ',displaySymbol:'SPY'})).toBe('QQQ');
 for(const symbol of ['GC=F','CL=F','BZ=F','NQ=F'])expect(feedTickerContext(symbol)).toBe('Futuros');
 for(const symbol of ['XAUUSD=X','XAGUSD=X'])expect(feedTickerContext(symbol)).toBe('Contado');
 expect(feedTickerContext('EURUSD=X')).toBeNull();
});
it('distinguishes the SGX product and actual settlement month from a fictitious continuous contract',()=>{
 expect(feedTicker({symbol:'SGX-IODEX'})).toBe('FEF');
 expect(feedTickerContext({symbol:'SGX-IODEX',contractLabel:'Nov-26'})).toBe('SGX · Nov-26');
 expect(feedTickerContext({symbol:'SGX-IODEX'})).toBe('SGX');
 expect(feedTicker({symbol:'BZ=F',displaySymbol:'Petróleo Brent'})).toBe('BZ');
});
it('keeps actual yield-series IDs separate from the maturity aliases used for research',()=>{
 expect([.25,.5,1,2,5,10,20].map(treasuryIdentifier)).toEqual(['DGS3MO','DGS6MO','DGS1','DGS2','DGS5','DGS10','DGS20']);
 expect([.25,.5,1,2,5,10,20].map(treasuryDisplayTicker)).toEqual(['US03MY','US06MY','US01Y','US02Y','US05Y','US10Y','US20Y']);
 expect(treasuryDisplayTicker(4)).toBeNull();
 expect(treasuryIdentifier(4)).toBeNull();
});
