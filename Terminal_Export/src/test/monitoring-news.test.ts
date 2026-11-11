import {expect,it} from 'vitest';
import {portfolioNewsGroups,visibleMonitoringNotices} from '../lib/monitoring-news';
import type {MonitorNews,MonitorNotice,MonitorOverview,MonitorSnapshot} from '../../../supabase/functions/analyze-ticker/monitoring-types';

const at='2026-11-11T09:00:00Z';
const news=(id:string,title:string,url='https://example.test/'+id):MonitorNews=>({id,title,url,source:'Documento publicado',date:at,excerpt:'Resumen con información publicada.'});
const snapshot=(symbol:string,items:MonitorNews[]):MonitorSnapshot=>({schema:1,symbol,name:symbol+' empresa',kind:'stock',currency:'USD',collectedAt:at,metrics:{},news:items,calendar:[],holdings:null,coverage:[],fundamentalsAt:null});
const notice=(item:MonitorNews):MonitorNotice=>({id:'notice-'+item.id,key:item.id,symbol:'AAPL',kind:'news',title:item.title,detail:item.excerpt,occurredAt:item.date,createdAt:at,readAt:null,source:item.source,url:item.url,importance:'high',analysisKey:item.analysisKey});
function overview():MonitorOverview{return {baseline:null,visitAt:at,unread:0,notices:[],alerts:[],agenda:[],lastCollectedAt:at,hasMore:false,context:{watchlist:['MSFT'],symbols:['AAPL','MSFT'],positions:[{portfolioId:'p1',portfolioName:'Cartera existente',symbol:'AAPL',quantity:10,marketValue:null,currency:'USD',quoteAt:null,equity:null}],snapshots:[],coverage:[]}};}

it('shows collected news before any last-visit change and separates holdings from watchlist without valuation dependencies',()=>{
 const data=overview();data.context.snapshots=[snapshot('AAPL',[news('a','Noticia de Apple')]),snapshot('MSFT',[news('m','Noticia de Microsoft')])];
 expect(portfolioNewsGroups(data,'positions').map(group=>[group.symbol,group.items[0].title])).toEqual([['AAPL','Noticia de Apple']]);
 expect(portfolioNewsGroups(data,'watchlist').map(group=>[group.symbol,group.items[0].title])).toEqual([['MSFT','Noticia de Microsoft']]);
 expect(data.context.positions[0].marketValue).toBeNull();
});

it('deduplicates source links and normalized headlines while keeping the real saved read state',()=>{
 const data=overview(),first=news('a','Contrato de Apple','https://example.test/article?utm_source=mail');
 data.context.snapshots=[snapshot('AAPL',[first,news('b','Contrato de Apple','https://example.test/article?utm_source=feed'),news('c','CONTRATO DE APPLE','https://another.test/story')])];
 data.notices=[{...notice(first),readAt:at}];
 const items=portfolioNewsGroups(data,'positions')[0].items;
 expect(items).toHaveLength(1);expect(items[0]).toMatchObject({noticeId:'notice-a',readAt:at,date:at,source:'Documento publicado'});
});

it('never assigns an unrelated notice or an invented read identity to historical snapshot news',()=>{
 const data=overview();data.context.snapshots=[snapshot('AAPL',[news('a','Información publicada')])];
 data.notices=[notice(news('b','Otra información'))];
 const items=portfolioNewsGroups(data,'positions')[0].items;
 expect(items.find(item=>item.id==='a')).toMatchObject({noticeId:null,readAt:null});
 expect(items.find(item=>item.id==='b')).toMatchObject({noticeId:'notice-b'});
});

it('keeps unavailable news explicit per asset and excludes closed positions and removed alerts',()=>{
 const data=overview();data.context.positions.push({...data.context.positions[0],symbol:'CLOSED',quantity:0});
 expect(portfolioNewsGroups(data,'positions')).toEqual([{symbol:'AAPL',name:'AAPL',collectedAt:null,items:[]}]);
 const story=notice(news('a','Fuente real'));expect(visibleMonitoringNotices([story,{...story,id:'old-alert',kind:'alert'}])).toEqual([story]);
});

it('limits and sorts each asset news by actual publication date without changing the input',()=>{
 const data=overview();data.context.snapshots=[snapshot('AAPL',Array.from({length:8},(_,index)=>({...news(String(index),'Noticia '+index),date:`2026-11-${String(index+1).padStart(2,'0')}`})))];
 const original=JSON.stringify(data),items=portfolioNewsGroups(data,'positions')[0].items;
 expect(items).toHaveLength(6);expect(items[0].date).toBe('2026-11-08');expect(items.at(-1)?.date).toBe('2026-11-03');expect(JSON.stringify(data)).toBe(original);
});
