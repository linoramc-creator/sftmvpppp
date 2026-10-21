import type {SegmentPeriod} from './panels.ts';

type Dimension={axis:string;member:string};
type Context={start:string;end:string;dimensions:Dimension[]};
type Fact={context:Context;concept:string;currency:string;value:number;label:string};
const attributes=(value:string)=>Object.fromEntries([...value.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),m[2]??m[3]]));
const plain=(value:string)=>value.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const local=(value:string)=>value.split(':').at(-1)??'';
const isDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const axisKind=(axis:string):'products'|'geography'|null=>/^(?:ProductOrServiceAxis|StatementBusinessSegmentsAxis)$/.test(local(axis))?'products':local(axis)==='StatementGeographicalAxis'?'geography':null;
function memberLabel(member:string):string{
 const name=local(member);
 if(member.startsWith('country:')&&/^[A-Z]{2}$/.test(name)){try{return new Intl.DisplayNames(['es'],{type:'region'}).of(name)??name;}catch{/* use the published member */}}
 const known:Record<string,string>={ProductMember:'Productos',ServiceMember:'Servicios',EuropeMember:'Europa',AsiaMember:'Asia',AmericasMember:'América'};
 return known[name]??name.replace(/(?:Segment)?Member$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/([A-Z])([A-Z][a-z])/g,'$1 $2');
}

// Only reported, single-axis annual revenue facts are accepted. Each complete
// dimension set must reconcile to the same consolidated concept, entity,
// currency and period. Never find arbitrary subsets that happen to add up.
export function annualRevenueXbrl(html:string,url:string,cik:string,now=Date.now()):{products:SegmentPeriod[];geography:SegmentPeriod[]}{
 const empty={products:[],geography:[]} as {products:SegmentPeriod[];geography:SegmentPeriod[]};
 if(!/^\d{1,10}$/.test(cik)||Number(cik)<=0)return empty;
 const contexts=new Map<string,Context>();
 for(const match of html.matchAll(/<(?:\w+:)?context\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?context>/gi)){
  const id=attributes(match[1]).id,body=match[2],entity=plain(body.match(/<(?:\w+:)?identifier\b[^>]*>([\s\S]*?)<\/(?:\w+:)?identifier>/i)?.[1]??'');
  if(!id||!/^\d+$/.test(entity)||Number(entity)!==Number(cik)||/<(?:\w+:)?typedMember\b/i.test(body))continue;
  const start=plain(body.match(/<(?:\w+:)?startDate>([\s\S]*?)<\/(?:\w+:)?startDate>/i)?.[1]??''),end=plain(body.match(/<(?:\w+:)?endDate>([\s\S]*?)<\/(?:\w+:)?endDate>/i)?.[1]??'');
  const days=(Date.parse(end)-Date.parse(start))/86400000;
  if(!isDate(start)||!isDate(end)||days<330||days>380||Date.parse(end)>now)continue;
  const dimensions=[...body.matchAll(/<(?:\w+:)?explicitMember\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?explicitMember>/gi)].map(m=>({axis:attributes(m[1]).dimension??'',member:plain(m[2])}));
  if(dimensions.some(d=>!d.axis||!d.member)||dimensions.length>1)continue;
  contexts.set(id,{start,end,dimensions});
 }
 const units=new Map<string,string>();
 for(const match of html.matchAll(/<(?:\w+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?unit>/gi)){
  const id=attributes(match[1]).id,measures=[...match[2].matchAll(/<(?:\w+:)?measure>([\s\S]*?)<\/(?:\w+:)?measure>/gi)].map(m=>plain(m[1]));
  if(id&&measures.length===1&&/^iso4217:(?:USD|EUR|GBP|JPY|CAD|CHF|CNY|KRW|INR|AUD)$/.test(measures[0])&&!/<(?:\w+:)?divide\b/i.test(match[2]))units.set(id,local(measures[0]));
 }
 const facts:Fact[]=[];
 for(const match of html.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)){
  const a=attributes(match[1]),context=contexts.get(a.contextref),currency=units.get(a.unitref),concept=a.name??'';
  if(!context||!currency||!/^us-gaap:(?:RevenueFromContractWithCustomerExcludingAssessedTax|RevenueFromContractWithCustomerIncludingAssessedTax|SalesRevenueNet|Revenues)$/.test(concept)||a['xsi:nil']==='true')continue;
  if(a.format&&!/^(?:num-dot-decimal|numcommadot|numdotdecimal)$/.test(local(a.format)))continue;
  const printed=plain(match[2]),scale=Number(a.scale??0);
  if(!/^-?\d[\d,]*(?:\.\d+)?$/.test(printed)||!Number.isInteger(scale)||scale<0||scale>9||a.sign&&a.sign!=='-'||a.sign==='-'&&printed.startsWith('-'))continue;
  const value=Number(printed.replaceAll(',',''))*10**scale*(a.sign==='-'?-1:1);
  if(!Number.isFinite(value))continue;
  const rowStart=html.lastIndexOf('<tr',match.index),prefix=rowStart>=0&&match.index!-rowStart<12000?html.slice(rowStart,match.index):'';
  const label=[...prefix.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>plain(m[1])).find(s=>s.length>1&&s.length<=100&&/[A-Za-z]/.test(s)&&!/^[$€£\d(]/.test(s))??'';
  facts.push({context,concept,currency,value,label});
 }
 const totals=new Map<string,number>(),conflicts=new Set<string>(),groups=new Map<string,Map<string,Fact>>();
 const periodKey=(f:Fact)=>[f.concept,f.currency,f.context.start,f.context.end].join('|');
 for(const fact of facts){
  const key=periodKey(fact),dimension=fact.context.dimensions[0];
  if(!dimension){if(totals.has(key)&&Math.abs(totals.get(key)!-fact.value)>Math.max(1,Math.abs(fact.value)*0.0001))conflicts.add(key);else totals.set(key,fact.value);continue;}
  const kind=axisKind(dimension.axis);if(!kind)continue;
  // Standard product/service classes and an issuer's alternative product
  // taxonomy are separate complete presentations, never summed together.
  const presentation=local(dimension.axis)==='ProductOrServiceAxis'?(/^(?:ProductMember|ServiceMember)$/.test(local(dimension.member))?'standard':'issuer'):'complete';
  const groupKey=[key,dimension.axis,presentation].join('|'),group=groups.get(groupKey)??new Map<string,Fact>(),prior=group.get(dimension.member);
  if(prior&&Math.abs(prior.value-fact.value)>Math.max(1,Math.abs(fact.value)*0.0001))conflicts.add(groupKey);
  group.set(dimension.member,fact);groups.set(groupKey,group);
 }
 const candidates:{kind:'products'|'geography';axis:string;standard:boolean;period:SegmentPeriod}[]=[];
 for(const [groupKey,group] of groups){
  const entries=[...group],first=entries[0]?.[1];if(!first||entries.length<2||entries.length>40)continue;
  const key=periodKey(first),total=totals.get(key),axis=first.context.dimensions[0].axis,kind=axisKind(axis)!;
  if(!total||total<=0||conflicts.has(key)||conflicts.has(groupKey))continue;
  const sum=entries.reduce((n,[,f])=>n+f.value,0);
  if(Math.abs(sum-total)>Math.max(1,Math.abs(total)*0.001))continue;
  let segments=entries.map(([member,f])=>({name:f.label||memberLabel(member),value:f.value}));
  // In column-oriented tables each fact repeats the row label "Net sales".
  // Use its explicit dimension members instead of discarding a valid set.
  if(new Set(segments.map(s=>s.name.toLowerCase())).size!==segments.length)segments=entries.map(([member,f])=>({name:memberLabel(member),value:f.value}));
  if(new Set(segments.map(s=>s.name.toLowerCase())).size!==segments.length)continue;
  candidates.push({kind,axis,standard:groupKey.endsWith('|standard'),period:{date:first.context.end,currency:first.currency,period:'annual',documentUrl:url,segments}});
 }
 candidates.sort((a,b)=>b.period.date.localeCompare(a.period.date)||Number(b.standard)-Number(a.standard)||Number(local(b.axis)==='ProductOrServiceAxis')-Number(local(a.axis)==='ProductOrServiceAxis'));
 for(const candidate of candidates)if(!empty[candidate.kind].length)empty[candidate.kind].push(candidate.period);
 return empty;
}
