const KEY = import.meta.env.VITE_FINNHUB_KEY as string;
const BASE = "https://finnhub.io/api/v1";

async function get(url: string) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

export async function fetchTickerData(ticker: string) {
  const t = encodeURIComponent(ticker);
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  try {
    const [quote, profile, metrics, recs, news] = await Promise.all([
      get(`${BASE}/quote?symbol=${t}&token=${KEY}`),
      get(`${BASE}/stock/profile2?symbol=${t}&token=${KEY}`),
      get(`${BASE}/stock/metric?symbol=${t}&metric=all&token=${KEY}`),
      get(`${BASE}/stock/recommendation?symbol=${t}&token=${KEY}`),
      get(`${BASE}/company-news?symbol=${t}&from=${from}&to=${today}&token=${KEY}`),
    ]);

    return {
      quote: quote ?? null,
      profile: profile ?? null,
      metrics: metrics?.metric ?? null,
      recommendations: Array.isArray(recs) && recs.length > 0 ? recs[0] : null,
      news: Array.isArray(news)
        ? news.slice(0, 5).map((n: any) => ({
            headline: n.headline,
            source: n.source,
            date: new Date(n.datetime * 1000).toLocaleDateString("es-ES"),
          }))
        : [],
    };
  } catch {
    return null;
  }
}
