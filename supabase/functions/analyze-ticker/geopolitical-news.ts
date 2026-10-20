import type {Article} from './panels.ts';

const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const conflict=/\b(war|ceasefire|missiles?|drones?|attacks?|airstrikes?|invasion|military|blockade|bombing|peace talks|troops|guerra|alto el fuego|misil\w*|ataque\w*|bloqueo|bombarde\w*|tropas|negociaciones de paz)\b/;
const actors=/\b(president\w*|prime minister|minister|government|white house|kremlin|trump|putin|zelensky\w*|netanyahu|macron|congress|nato|presidente|ministro|gobierno|casa blanca|otan|eu commission)\b/;
const regions=/\b(russia|ukraine|iran|israel|gaza|lebanon|taiwan|china|beijing|moscow|washington|middle east|red sea|strait of hormuz|saudi arabia|north korea|european union|european commission|brussels|united states|france|germany|britain|united kingdom|japan|india|canada|mexico|rusia|ucrania|oriente medio|mar rojo|estrecho de ormuz|arabia saudi|estados unidos|union europea|francia|alemania|reino unido|japon)\b/;
const decision=/\b(says?|said|claims?|pledges?|vows?|orders?|approv\w*|reject\w*|signs?|impos\w*|lift\w*|threaten\w*|announc\w*|declar\w*|warn\w*|anunci\w*|advierte|afirma|asegura|dice|impone|aprueba|decreta|amenaza|negocia)\b/;
const tradePolicy=/\b(tariff\w*|arancel\w*|export (?:ban|controls?|restrictions?)|import ban|trade (?:deal|talks|restrictions?|agreement)|restricciones? (?:a|de) (?:las? )?exportaciones?|prohib\w* (?:la )?exportacion|prohib\w* (?:las? )?importaciones?|acuerdo comercial|tasa a los barcos)\b/;
const sanctions=/\b(sanctions?|embargo|sancion\w*|sanciones)\b/;
const politicalShock=/\b(elections?|government (?:collaps\w*|falls)|political crisis|confidence vote|government shutdown|debt ceiling|fiscal (?:plan|crisis|policy)|budget|default|elecciones|caida del gobierno|crisis politica|mocion de censura|cierre del gobierno|techo de deuda|presupuest\w*|plan fiscal|impago)\b/;
const commercialWar=/\b(price war|streaming war|console war|guerra de precios)\b/;
const background=/\b(anniversary|history of|historical|book review|opinion|what happened in|aniversario|historia de|resena)\b/;

// Keep topic detection separate from eligibility so rejected general-interest
// conflict stories cannot spill back into the main financial headlines.
export function isGeopoliticalTopic(a:Article):boolean{
 const title=normalize(a.title);
 if(commercialWar.test(title))return false;
 if(/\b(earnings|profits?|revenue|beneficios?|resultados)\b/.test(title)&&!conflict.test(title)&&!tradePolicy.test(title)&&!sanctions.test(title))return false;
 if(/trump media|truth social/.test(title)&&!tradePolicy.test(title)&&!sanctions.test(title)&&!conflict.test(title))return false;
 const stateActor=actors.test(title)||regions.test(title)||/\bUS\b|\bU\.S\.|\bEU\b|\bUK\b|EE\.?\s?UU\.?/.test(a.title);
 return conflict.test(title)||stateActor&&(decision.test(title)||tradePolicy.test(title)||sanctions.test(title)||politicalShock.test(title));
}
function marketEvidence(text:string):boolean{
 // Avoid physical stocks and other non-financial meanings of shares/bonds.
 const clean=text.replace(/\b(?:ammunition|weapons|food|medical|blood) stocks?\b|\bstocks? of (?:ammunition|weapons|food|medical supplies)\b|\bshares? (?:a |an |the )?(?:videos?|photos?|images?|stories|story|thoughts?|messages?|warnings?|concerns?|updates?)\b|\bacciones (?:militares|belicas|de combate)\b|\bfamily bonds?\b/g,'');
 const instruments=/\b(financial markets?|capital markets?|stock markets?|stock prices?|stock futures?|equities|wall street|s&p\s*500|nasdaq|ibex|stoxx|ftse|dax|nikkei|hang seng|kospi|msci|treasuries|bond (?:yields?|prices?|markets?)|credit spreads?|credit default swaps?|sovereign (?:debt|bonds?|risk)|government bonds?|debt restructur\w*|gilt yields?|bund yields?|oat yields?|oat[ -]bund spread|renta fija|renta variable|mercados? financieros?|mercados? de capitales|deuda (?:soberana|publica)|bonos? (?:soberanos?|corporativos?|franceses|alemanes|britanicos|del tesoro)|prima de riesgo|diferenciales? de credito|rendimientos? de (?:los )?bonos|rentabilidad de (?:los )?bonos|riesgo pais)\b/;
 const assets=/\b(stocks?|shares?|bonds?|gilts?|bunds?|bolsas?|acciones|bonos?)\b/;
 const moves=/\b(rise|rises|rising|rose|fall|falls|falling|fell|slide|slides|sliding|rallies|rallied|sell[ -]?off|tumbled?|surge\w*|jump\w*|drop\w*|higher|lower|yields?|under pressure|slump\w*|cae\w*|caida\w*|sube|suben|subio|subieron|subida|subidas|subir|subiendo|repunt\w*|desplom\w*|rentabilidad|rendimientos?|cotiz\w*)\b/;
 return instruments.test(clean)||assets.test(clean)&&moves.test(clean);
}
export function isGeopolitical(a:Article):boolean{
 const title=normalize(a.title),text=normalize(`${a.title} ${a.excerpt??''}`);
 if(!isGeopoliticalTopic(a)||background.test(title))return false;
 if(marketEvidence(text))return true;
 // State trade measures have an economic transmission channel before prices
 // react. A country name, a war or sanctions alone do not establish impact.
 if(tradePolicy.test(title))return true;
 const channel=/\b(oil|crude|petroleum|natural gas|lng|gas prices?|gas supply|oil supply|energy (?:prices?|supply|exports?)|refiner\w*|pipelines?|shipping|tankers?|container\w*|freight|cargo|supply chains?|trade routes?|export\w*|imports?|semiconduct\w*|chips?|defen[cs]e (?:spending|budget)|inflation|petroleo|crudo|gas natural|precio\w* del gas|suministro de gas|suministro de energia|oleoduct\w*|gasoduct\w*|transporte maritimo|rutas comerciales|buques mercantes|portacontenedores|cadenas? de suministro|importaciones|gasto (?:militar|en defensa)|inflacion)\b/;
 const material=/\b(disrupt\w*|halt\w*|block\w*|clos\w*|suspend\w*|ban\w*|cut\w*|reduc\w*|restrict\w*|shortage\w*|sinks?|supply fears|supply risk|rise|rises|rising|rose|fall\w*|fell|surge\w*|jump\w*|spik\w*|lift\w*|interrump\w*|interrup\w*|paraliz\w*|cerr\w*|cierra\w*|bloque\w*|suspend\w*|prohib\w*|recort\w*|reduc\w*|restric\w*|escasez|hunde|riesgo\w* de suministro|sub\w*|cae\w*|encarec\w*|dispar\w*|alza\w*|aument\w*)\b/;
 return channel.test(text)&&(material.test(text)||sanctions.test(title));
}
export function geopoliticalNews(rows:Article[],now=Date.now(),maxAge=2*86400000):Article[]{
 return rows.filter(a=>{const time=Date.parse(a.publishedAt??a.date);return Number.isFinite(time)&&time>=now-maxAge&&time<=now+60000&&isGeopolitical(a);}).sort((a,b)=>Date.parse(b.publishedAt??b.date)-Date.parse(a.publishedAt??a.date));
}
