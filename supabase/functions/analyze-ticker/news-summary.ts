// Presentation helpers shared by the browser, report previews and Edge Functions.
// This module deliberately has no environment, network or runtime dependencies.
export type NewsSummaryArticle = { title: string; excerpt?: string; keyPoints?: string[]; url?: string };
const publishers = /(?:Reuters|Associated Press|AP News|Bloomberg|CNBC|Yahoo(?: Finance)?|Financial Times|MarketWatch|Barron.s|FMP|Finnhub|Tavily|elEconomista(?:\.es)?)/i;
export function cleanNewsPoint(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/^.{0,70}\((?:Reuters|AP|Bloomberg)\)\s*[-—–]\s*/i, '')
    .replace(/^(?:Reuters|AP News|Associated Press|Bloomberg|CNBC|Yahoo(?: Finance)?|BBC(?: News)?|elEconomista(?:\.es)?|The Guardian|Al Jazeera|RTVE|Expansi[oó]n)\s*[:—–-]\s*/i, '')
    .replace(/(?:\s*[-–|]\s*(?:Reuters|Yahoo Finance|CNBC|Bloomberg|MarketWatch|Barron.s|Financial Times|AP News|Associated Press|BBC(?: News)?|elEconomista(?:\.es)?|The Guardian|Al Jazeera|RTVE|Expansi[oó]n))+\s*$/i, '')
    .replace(/Takeaways by Bloomberg AI[^.!?]*(?:[.!?]|$)/gi, '').replace(/Choose CNBC as your preferred source[^.!?]*(?:[.!?]|$)/gi, '')
    .replace(/,?\s*opens new tab/gi, '').replace(/\[\+\d+ chars?\]/gi, '')
    .replace(/^\s*(?:[•*\-]\s+|\d+[.)]\s+)?/, '').replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim();
}
const shorten = (text: string, limit = 220) => text.length <= limit ? text : text.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
function points(values: unknown[]): string[] {
  const seen = new Set<string>();
  return values.flatMap(value => {
    if (typeof value !== 'string') return [];
    const text = cleanNewsPoint(value), key = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (text.length < 12 || !key || seen.has(key) || /FacebookXLinkedIn|Confidential tip|flagship morning TV|political heavyweights|\b(?:sign up for|subscribe to) (?:our|the) (?:newsletter|updates)|\b(?:credit cards?|APR)\b.*\b(?:best|apply|offers?|rewards?)\b/i.test(text)) return [];
    seen.add(key); return [shorten(text)];
  }).slice(0, 3);
}
export function newsKeyPoints(article: NewsSummaryArticle): string[] {
  const saved = points(Array.isArray(article.keyPoints) ? article.keyPoints : []);
  if (saved.length) return saved;
  const excerpt = cleanNewsPoint(article.excerpt ?? '');
  const sentences = excerpt.split(/(?<=[.!?])\s+(?=[\p{Lu}\d¿¡])/u);
  const extracted = points(sentences);
  return extracted.length ? extracted : points([article.title]);
}
// Accept only a small, plain-text editorial result. Numbers must already occur
// in the supplied title/excerpt, so the model cannot invent prices or percentages.
export function validatedNewsKeyPoints(article: NewsSummaryArticle, values: unknown): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 3) return [];
  const evidence = `${article.title} ${article.excerpt ?? ''}`;
  const numbers = new Set((evidence.match(/\d+(?:[.,]\d+)*/g) ?? []).map(n => n.replace(/,/g, '.')));
  const accepted = values.filter((value): value is string => typeof value === 'string' && value.length >= 12 && value.length <= 280
    && !/https?:|www\.|<[^>]*>|\b(?:system prompt|ignore previous|ignora las instrucciones|api[_ -]?key|contrase[nñ]a|buy now|compra ahora|vende ahora)\b/i.test(value)
    && !publishers.test(value)
    && (value.match(/\d+(?:[.,]\d+)*/g) ?? []).every(n => numbers.has(n.replace(/,/g, '.'))));
  // A malformed point invalidates the whole item rather than silently accepting
  // a partly unsupported summary. The original evidence remains the fallback.
  return accepted.length === values.length ? points(accepted) : [];
}
