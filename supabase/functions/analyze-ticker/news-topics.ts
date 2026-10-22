const aliases:Record<string,string[]>={GOOG:['Google','YouTube','Waymo'],GOOGL:['Google','YouTube','Waymo'],META:['Facebook','Instagram','WhatsApp'],MSFT:['Microsoft','Azure'],AMZN:['Amazon','AWS'],VRT:['Vertiv']};
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function expandNewsSubject(subject:string):string{
 const words=new Set(subject.toUpperCase().match(/[A-Z0-9.-]+/g)??[]),brands=Object.entries(aliases).filter(([symbol])=>words.has(symbol)).flatMap(([,values])=>values);
 if(/\balphabet\b/i.test(subject))brands.push(...aliases.GOOGL);
 return [subject,...new Set(brands)].join(' ');
}
export function companyNewsPattern(ticker:string,company:string):RegExp{
 const words=company.replace(/^the\s+/i,'').replace(/\b(?:incorporated|corporation|corp|inc|ltd|plc|holdings|holding|class [a-z]|co)\b\.?/gi,'').trim().split(/\s+/);
 const brand=words.slice(0,(words[0]?.length??0)>=5?1:2).join(' '),terms=[brand,...(aliases[ticker.toUpperCase()]??[])].filter(Boolean);
 if(ticker.length>=3&&!/^(?:ALL|ARE|CAN|FOR|YOU|THE)$/.test(ticker))terms.push(ticker);
 return new RegExp(terms.length?terms.map(term=>`${['YouTube','Waymo'].includes(term)?'^':'\\b'}${escape(term)}\\b`).join('|'):`\\(${escape(ticker)}\\)`,'i');
}
// Provider tags are broad categories. Human industry descriptions such as
// "Electrical Equipment & Parts industry" are not valid discovery tags.
export function sectorNewsTag(subject:string):string{
 const text=subject.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+industry$/,'');
 if(/semiconduct|memory|chips?\b/.test(text))return 'semiconductors';
 if(/communication services|internet content|interactive media|artificial intelligence|inteligencia artificial|technology|tecnologia|software|cloud|data center/.test(text))return 'technology';
 if(/industrial|electrical equipment|electrical components|aerospace|manufactur/.test(text))return 'industrials';
 if(/utilities|energy|energia|oil|gas|renewable|power generation/.test(text))return 'energy';
 if(/health|salud|pharma|biotech/.test(text))return 'healthcare';
 if(/bank|banco|financial|finanzas|insurance/.test(text))return 'banking';
 if(/defen[cs]|defensa/.test(text))return 'defense';
 if(/consumer|consumo|retail/.test(text))return 'consumer';
 if(/real estate|inmobiliario|reit/.test(text))return 'real estate';
 if(/materials|materiales|mining|metals|chemicals/.test(text))return 'materials';
 return text;
}
