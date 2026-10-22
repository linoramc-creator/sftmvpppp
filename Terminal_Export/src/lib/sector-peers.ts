import type {SectorPeer} from '../../../supabase/functions/analyze-ticker/sector-activity';
const plain=(value:string)=>value.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*`]/g,'').trim();
const heading=(value:string)=>plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function extractSectorActivityPeers(report:string):SectorPeer[]{
 const section=report.match(/^##\s+Empresas L[ií]deres[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im)?.[1]??'';
 const rows=section.split('\n').filter(line=>line.includes('|')).map(line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(plain));
 const companyHeading=(value:string)=>/^(empresa|compania|company|nombre)$/.test(heading(value)),tickerHeading=(value:string)=>/^(ticker|symbol|simbolo)$/.test(heading(value));
 const header=rows.findIndex(cells=>cells.some(companyHeading)&&cells.some(tickerHeading));if(header<0)return [];
 const company=rows[header].findIndex(companyHeading),ticker=rows[header].findIndex(tickerHeading),seen=new Set<string>();
 return rows.slice(header+1).flatMap(cells=>{
  const name=cells[company]??'',text=(cells[ticker]??'').toUpperCase().trim(),symbol=text.match(/^(?:[A-Z]+\s*:\s*)?([A-Z0-9][A-Z0-9.-]{0,14})(?:\s+\([A-Z][^)]*\))?$/)?.[1];
  if(!symbol||!name||name.length>120||/[<>\p{Cc}\p{Cf}]/u.test(name)||seen.has(symbol))return [];
  seen.add(symbol);return[{symbol,name}];
 }).slice(0,10);
}
