import type {Article} from './panels.ts';
export function isGeopolitical(a:Article):boolean{
 const title=a.title,text=`${title} ${a.excerpt??''}`;
 const conflict=/\b(war|ceasefire|missile|drone|attacks?|airstrikes?|invasion|military|blockade|bombing|peace talks|troops|guerra|alto el fuego|misil\w*|ataque\w*|bloqueo|bombarde\w*|tropas|negociaciones de paz)\b/i;
 const commercial=/\b(price war|streaming war|console war|guerra de precios)\b/i;
 const actors=/\b(president\w*|prime minister|minister|government|white house|kremlin|trump|putin|zelensky\w*|netanyahu|macron|congress|nato|presidente|ministro|gobierno|casa blanca|otan|eu commission)\b/i;
 const region=/\b(russia|ukraine|iran|israel|gaza|lebanon|taiwan|china|beijing|moscow|washington|middle east|red sea|strait of hormuz|saudi arabia|north korea|european union|european commission|brussels|united states|rusia|ucrania|ir[aá]n|oriente medio|mar rojo|estrecho de ormuz|arabia saud[ií]|estados unidos|uni[oó]n europea)\b/i;
 const decision=/\b(says?|said|claims?|pledges?|vows?|orders?|approv\w*|reject\w*|signs?|impos\w*|lift\w*|sanctions?|tariffs?|embargo|export (?:ban|controls?)|import ban|trade (?:deal|talks|restrictions?)|threaten\w*|announc\w*|declar\w*|warn\w*|agreement|arancel\w*|sanci[oó]n\w*|anunci\w*|advierte|restricci[oó]n\w*|acuerdo|afirma|asegura|dice|impone|aprueba|decreta|amenaza|negocia)\b/i;
 const market=/\b(oil|gas|crude|energy|shipping|tankers?|supply|defen[cs]e|stocks?|markets?|equities|bonds?|gold|currency|dollar|trade|export\w*|tariff\w*|sanction\w*|inflation|semiconduct\w*|chip\w*|petr[oó]leo|energ[ií]a|mercados?|bolsas?|acciones|defensa|suministro|transporte|oro|divisas?|arancel\w*|sanci[oó]n\w*|comercio)\b/i;
 const policy=/\b(tariff\w*|sanction\w*|embargo|export (?:ban|controls?|restrictions?)|trade (?:deal|talks|restrictions?)|arancel\w*|sanci[oó]n\w*|restricci[oó]n\w*)\b/i;
 if(/\b(earnings|profits?|revenue|beneficios?|resultados)\b/i.test(title)&&!conflict.test(title)&&!policy.test(title))return false;
 if(commercial.test(title)||/\b(anniversary|history of|historical|book review|opinion|what happened in|aniversario|historia de|rese[nñ]a)\b/i.test(title))return false;
 if(/Trump Media|Truth Social/i.test(title)&&!/(tariff|sanction|war|government|white house)/i.test(title))return false;
 return conflict.test(title)&&(market.test(text)||region.test(title))||decision.test(title)&&(actors.test(title)||region.test(title)||/\bUS\b|EE\.?\s?UU\.?/.test(title))&&market.test(text);
}
export function geopoliticalNews(rows:Article[],now=Date.now(),maxAge=2*86400000):Article[]{return rows.filter(a=>{const time=Date.parse(a.publishedAt??a.date);return Number.isFinite(time)&&time>=now-maxAge&&time<=now+60000&&isGeopolitical(a);}).sort((a,b)=>Date.parse(b.publishedAt??b.date)-Date.parse(a.publishedAt??a.date));}
