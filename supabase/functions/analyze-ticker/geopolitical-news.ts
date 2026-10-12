import type {Article} from './panels.ts';
export function geopoliticalNews(rows:Article[],now=Date.now(),maxAge=86400000):Article[]{
 const conflict=/\b(war|ceasefire|missile|drone|airstrikes?|invasion|military|blockade|bombing|peace talks|troops|guerra|alto el fuego|misil\w*|ataque\w*|bloqueo|bombarde\w*|tropas|negociaciones de paz)\b/i;
 const commercialWar=/\b(price war|streaming war|console war|guerra de precios)\b/i;
 const politics=/\b(president|minister|government|white house|kremlin|beijing|trump|congress|nato|presidente|ministro|gobierno|casa blanca|otan|eu commission)\b/i;
 const decision=/\b(sanctions?|tariffs?|embargo|export (?:ban|controls?)|trade (?:deal|talks|restrictions?)|threaten\w*|announc\w*|declar\w*|warn\w*|agreement|arancel\w*|sanci[oó]n\w*|anunci\w*|advierte|restricci[oó]n\w*|acuerdo)\b/i;
 const market=/\b(oil|gas|crude|energy|shipping|tankers?|supply|defen[cs]e|stocks?|markets?|equities|bonds?|gold|currency|dollar|trade|export\w*|tariff\w*|sanction\w*|inflation|semiconduct\w*|chip\w*|petr[oó]leo|energ[ií]a|mercados?|bolsas?|acciones|defensa|suministro|transporte|oro|divisas?|arancel\w*|sanci[oó]n\w*|comercio)\b/i;
 const retrospective=/\b(anniversary|history of|historical|book review|opinion|what happened in|aniversario|historia de|rese[nñ]a)\b/i;
 return rows.filter(a=>{const published=a.publishedAt?Date.parse(a.publishedAt):Date.parse(a.date);if(!Number.isFinite(published)||published<now-maxAge||published>now+60000||retrospective.test(a.title))return false;
  const text=`${a.title} ${a.excerpt??''}`;
  return market.test(text)&&((conflict.test(a.title)&&!commercialWar.test(a.title))||(politics.test(text)&&decision.test(a.title)));
 }).sort((a,b)=>Date.parse(b.publishedAt??b.date)-Date.parse(a.publishedAt??a.date));
}
