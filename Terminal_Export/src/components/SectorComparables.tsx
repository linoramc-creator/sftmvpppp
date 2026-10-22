import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {RefreshCw} from 'lucide-react';
import {authenticatedFetch} from '@/lib/beta-api';
import {useProfile} from './AuthGate';
import {usePanelActive} from './KeepPanel';
import {extractSectorActivityPeers} from '@/lib/sector-peers';
import type {ComparableCompany,SectorComparables as Comparison} from '../../../supabase/functions/analyze-ticker/sector-comparables';

const memory=new Map<string,{at:number;data:Comparison}>(),pending=new Map<string,Promise<Comparison>>();
const format=(n:number)=>n.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2});
type Metric='price'|'marketCap'|'pe'|'forwardPe'|'pb'|'evEbitda'|'roe'|'netMargin'|'revenueGrowth'|'beta';
const columns:{key:Metric;label:string;kind:'price'|'cap'|'multiple'|'percent';extra?:boolean}[]=[{key:'price',label:'Precio',kind:'price'},{key:'marketCap',label:'Capitalización',kind:'cap'},{key:'pe',label:'PER · TTM',kind:'multiple'},{key:'evEbitda',label:'EV / EBITDA',kind:'multiple'},{key:'netMargin',label:'Margen neto · TTM',kind:'percent'},{key:'revenueGrowth',label:'Ingresos · interanual',kind:'percent'},{key:'forwardPe',label:'PER previsto',kind:'multiple',extra:true},{key:'pb',label:'Precio / patrimonio',kind:'multiple',extra:true},{key:'roe',label:'ROE · TTM',kind:'percent',extra:true},{key:'beta',label:'Beta',kind:'multiple',extra:true}];
export function stripComparisonTable(content:string){
 const lines=content.split('\n'),out:string[]=[],cells=(line:string)=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(cell=>cell.replace(/[*`_]/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase());
 for(let i=0;i<lines.length;i++){
  const head=cells(lines[i]),separator=cells(lines[i+1]??'');
  const comparison=head.length>=2&&head.some(cell=>/^(empresa|compania|company|nombre|ticker|symbol|simbolo)$/.test(cell))&&separator.length>=2&&separator.every(cell=>/^:?-{2,}:?$/.test(cell));
  if(comparison){while(out.length&&!out.at(-1)!.trim())out.pop();if(/^###\s+.*(?:tabla|comparativ|empresas l[ií]deres)/i.test(out.at(-1)??''))out.pop();i++;while(i+1<lines.length&&lines[i+1].includes('|'))i++;continue;}
  out.push(lines[i]);
 }
 return out.join('\n').trim();
}
export function comparisonActivityReport(rows:ComparableCompany[]){return '## Empresas Líderes\n| Empresa | Ticker |\n| --- | --- |\n'+rows.map(row=>`| ${row.name.replace(/[|\r\n]/g,' ')} | ${row.symbol} |`).join('\n');}
function display(row:ComparableCompany,column:typeof columns[number]){
 const value=row[column.key];if(value===null||!Number.isFinite(value))return '—';
 if(column.kind==='price')return `${format(value)} ${row.currency??''}`;
 if(column.kind==='cap')return `${value.toLocaleString('es-ES',{notation:'compact',maximumFractionDigits:2})} ${row.capitalCurrency??''}`;
 return format(value)+(column.kind==='percent'?' %':column.key==='beta'?'':'×');
}
export default function SectorComparables({subject,sector=false,report='',isLoading=false,children}:{subject:string;sector?:boolean;report?:string;isLoading?:boolean;children?:(verified:boolean,companies:ComparableCompany[])=>ReactNode}){
 const active=usePanelActive(),account=useProfile()?.id??'preview',hints=useMemo(()=>sector?extractSectorActivityPeers(report).slice(0,8):[],[sector,report]),key=JSON.stringify({account,subject,sector,hints});
 const[storedData,setData]=useState<Comparison|null>(null),[loadedKey,setLoadedKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[expanded,setExpanded]=useState(false),data=loadedKey===key?storedData:null;
 useEffect(()=>{
  if(!active||isLoading)return;let live=true;setError('');const hit=memory.get(key);setData(hit&&Date.now()-hit.at<300000?hit.data:null);setLoadedKey(key);
  if(hit&&Date.now()-hit.at<300000){setBusy(false);return;}setBusy(true);
  let task=pending.get(key);
  if(!task){task=authenticatedFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({panel:'sectorComparables',subject,sector,peers:hints}),signal:AbortSignal.timeout(65000)}).then(async response=>{if(!response.ok)throw Error();const value:Comparison=await response.json();if(value.subject!==subject||!Array.isArray(value.companies))throw Error();if(memory.size>=30)memory.delete(memory.keys().next().value!);memory.set(key,{at:Date.now(),data:value});return value;}).finally(()=>pending.delete(key));pending.set(key,task);}
  task.then(value=>{if(live)setData(value);}).catch(()=>{if(live)setError('No se ha podido actualizar la comparación sectorial.');}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};
 },[key,active,isLoading,retry]);
 const rows=data?.companies??[],visible=columns.filter(column=>rows.filter(row=>row[column.key]!==null).length>=(expanded?1:Math.max(1,Math.ceil(rows.length/2)))&&(expanded||!column.extra));
 const refresh=()=>{memory.delete(key);setRetry(n=>n+1);};
 return <>
  <section aria-label="Comparación sectorial verificada" className="my-5 rounded-xl border border-slate-700/50 bg-[#0b121c] p-4 font-body sm:p-5">
   <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="!m-0 !border-0 !p-0 !text-base !font-semibold !normal-case !tracking-tight !text-slate-100">Comparación sectorial</h3><p className="!mb-0 !mt-1.5 !text-xs !text-slate-500">{rows.length?`${rows.length} empresas · ${data?.reference?`muestra de ${data.reference.symbol}`:data?.basis==='industry'?'misma industria':'negocios relacionados'}`:'Cotizaciones y fundamentales por empresa'}</p></div><div className="flex gap-2"><button type="button" aria-pressed={expanded} onClick={()=>setExpanded(value=>!value)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300">{expanded?'Vista principal':'Más métricas'}</button><button type="button" aria-label="Actualizar comparación sectorial" disabled={busy||isLoading} onClick={refresh} className="rounded-lg border border-slate-700 p-2 text-slate-400 disabled:opacity-40"><RefreshCw size={15} className={busy?'motion-safe:animate-spin':''}/></button></div></div>
   {(busy||isLoading)&&!data&&<div role="status" className="rounded-lg bg-slate-800/30 p-6 text-xs text-slate-400">{isLoading?'La comparación se preparará al completar el informe.':'Preparando las empresas comparables…'}</div>}
   {loadedKey===key&&error&&<p role="alert" className="!text-xs !text-amber-200">{error}<button onClick={refresh} className="ml-2 underline">Reintentar</button></p>}
   {data&&!rows.length&&<p className="!text-sm !text-slate-400">No hay empresas con identidad y fundamentales verificables para esta selección.</p>}
   {!!rows.length&&<><div className="overflow-x-auto"><table className="!mb-0 min-w-[700px] w-full text-left text-xs"><thead><tr><th className="!px-3 !py-3 !text-[10px] !text-slate-500">Empresa</th>{visible.map(column=><th key={column.key} className="!px-3 !py-3 !text-right !text-[10px] !text-slate-500">{column.label}</th>)}<th className="!px-3 !py-3 !text-[10px] !text-slate-500">Fecha de los datos</th></tr></thead><tbody>{rows.map(row=><tr key={row.symbol} className={row.subject?'bg-blue-400/5':''}><td className="!px-3 !py-3"><span className="whitespace-nowrap font-semibold text-slate-100">{row.symbol}{row.subject?' · activo analizado':''}</span><span className="mt-1 block max-w-56 truncate text-slate-400" title={row.name}>{row.name}</span><span className="mt-1 block max-w-56 truncate text-[10px] text-slate-500">{[row.country,row.industry].filter(Boolean).join(' · ')}</span></td>{visible.map(column=><td key={column.key} className="!px-3 !py-3 text-right tabular-nums text-slate-200" title={row[column.key]===null?'No publicado o no verificable':undefined}>{display(row,column)}</td>)}<td className="!px-3 !py-3 text-[10px] text-slate-500"><span className="block whitespace-nowrap">Cotización {row.quoteAt?new Date(row.quoteAt).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—'}</span><span className="mt-1 block whitespace-nowrap">Fundamentales {row.recordDate??'—'}</span></td></tr>)}</tbody></table></div><p className="!mb-0 !mt-4 border-t border-slate-700/50 pt-3 !text-[11px] !leading-5 !text-slate-500">{data?.note} Cada importe conserva su moneda; no se suman ni convierten capitalizaciones. Las cifras ausentes no se estiman.</p></>}
  </section>
  {loadedKey===key&&children?.(rows.length>0,rows)}
 </>;
}
