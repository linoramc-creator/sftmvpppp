import type {MonitorContext,MonitorMetric} from './monitoring-api';
export function monitoringMetricFreshness(metric:MonitorMetric|undefined,now=Date.now()):'fresh'|'missing'|'stale'{
 if(!metric||!Number.isFinite(metric.value)||metric.value===null||!metric.source||!metric.unit||!Number.isFinite(metric.maxAgeHours)||metric.maxAgeHours<=0)return 'missing';
 const at=Date.parse(metric.asOf??'');if(!Number.isFinite(at)||at>now)return 'missing';
 return now-at>metric.maxAgeHours*3600000?'stale':'fresh';
}
/** Observed watchlist diagnostics, not a portfolio exposure or a predicted risk score. */
export function monitoringRiskRows(context:MonitorContext,now=Date.now()){
 return context.watchlist.map(symbol=>{
  const snapshot=context.snapshots.find(item=>item.symbol===symbol),change=snapshot?.metrics.changePct,price=snapshot?.metrics.price;
  const events=(snapshot?.calendar??[]).filter(item=>item.date&&Number.isFinite(Date.parse(item.date))&&Date.parse(item.date.length===10?item.date+'T23:59:59Z':item.date)>=now).sort((a,b)=>a.date.localeCompare(b.date));
  const nextEvent=events[0]??null,holdings=snapshot?.holdings,weights=(holdings?.items??[]).map(item=>item.weightPct).filter(value=>Number.isFinite(value)&&value>=0&&value<=100);
  return {symbol,name:snapshot?.name??symbol,change:change?.value??null,changeStatus:monitoringMetricFreshness(change,now),changeAsOf:change?.asOf??null,source:change?.source??price?.source??'',url:change?.url??price?.url??'',priceStatus:monitoringMetricFreshness(price,now),priceAsOf:price?.asOf??null,nextEvent,kind:snapshot?.kind??null,topHoldingWeight:weights.length?Math.max(...weights):null,holdingsAsOf:holdings?.asOf??null,holdingsCoverage:holdings?.coveragePct??null,holdingsSource:holdings?.source??'',holdingsUrl:holdings?.url??''};
 });
}
