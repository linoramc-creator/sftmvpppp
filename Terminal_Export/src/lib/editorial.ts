const providers = /\b(?:Yahoo(?: Finance)?|FMP|Financial Modeling Prep|Finnhub|Tavily|Twelve Data|Supabase)\b/gi;
// Clean report presentation, including previously saved reports. Financial dates,
// estimates and institution names remain intact.
export function cleanReportText(text: string): string {
  let omittedLevel = 0;
  return text.split('\n').filter(line => {
    const heading = line.match(/^\s*(#{1,6})\s+/);
    if (heading && omittedLevel && heading[1].length <= omittedLevel) omittedLevel = 0;
    const sourceHeading = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:fuentes?(?: consultadas)?|metodolog[ií]a|proceso de investigaci[oó]n|c[oó]mo se (?:elabor[oó]|realiz[oó]))\s*(?:[:(]|\*\*|$)/i.test(line);
    if (sourceHeading && heading) omittedLevel = heading[1].length;
    return !omittedLevel && !sourceHeading;
  })
    .map(line => line
      .replace(/\[(?:fuente[^\]]*|\d+)\]\([^)]*\)/gi, '')
      .replace(/\[([^\]]+)\]\(https?:\/\/[^)]*\)/g, '$1')
      .replace(/\([^)]*(?:Yahoo|FMP|Finnhub|Tavily|Twelve Data|Gemini|fuente:)[^)]*\)/gi, '')
      .replace(/\b(?:seg[uú]n|v[ií]a|datos de|obtenid[oa]s? de|publicad[oa]s? por)\s+(?:Yahoo(?: Finance)?|FMP|Finnhub|Tavily|Twelve Data|Gemini)\s*[,;:]?/gi, '')
      .replace(providers, '')
      .replace(/\s*\[(?:fuente|URL)[^\]]*\]/gi, '')
      .replace(/\s+([.,;:])/g, '$1').replace(/ {2,}/g, ' ').trimEnd())
    .filter(line => !/c[aá]lculo determinista|no generad[oa] por IA|consultamos|hemos consultado|hemos (?:utilizado|analizado).*fuentes|b[uú]squeda (?:web|Tavily)|datos del backend|fallback|redeploy/i.test(line))
    .join('\n');
}
export function cleanHeadline(text: string): string {
  return text.replace(/(?:\s*[-–|]\s*(?:Reuters|Yahoo Finance|finance\.yahoo\.com|CNBC|Bloomberg|MarketWatch(?:\.com)?|Barron.s|Financial Times))+\s*$/i, '').replace(/^EXCLUSIVE:\s*/i, '');
}
export function cleanNewsExcerpt(text: string): string {
  return cleanReportText(text).replace(/^.{0,70}\((?:Reuters|AP|Bloomberg)\)\s*[-—–]\s*/i, '').replace(/,?\s*opens new tab/gi, '').trim();
}
