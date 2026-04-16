import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Finnhub helpers ───────────────────────────────────────────────────

async function finnhubGet(path: string, key: string) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1${path}&token=${key}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function fetchFinnhubData(ticker: string, key: string) {
  const t = encodeURIComponent(ticker);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [quote, profile, metrics, recs, news, peers] = await Promise.all([
    finnhubGet(`/quote?symbol=${t}`, key),
    finnhubGet(`/stock/profile2?symbol=${t}`, key),
    finnhubGet(`/stock/metric?symbol=${t}&metric=all`, key),
    finnhubGet(`/stock/recommendation?symbol=${t}`, key),
    finnhubGet(`/company-news?symbol=${t}&from=${monthAgo}&to=${today}`, key),
    finnhubGet(`/stock/peers?symbol=${t}`, key),
  ]);

  return {
    quote: quote ?? null,
    profile: profile ?? null,
    metrics: metrics?.metric ?? null,
    recommendations: Array.isArray(recs) && recs.length > 0 ? recs[0] : null,
    allRecommendations: Array.isArray(recs) ? recs.slice(0, 6) : [],
    news: Array.isArray(news)
      ? news.slice(0, 15).map((n: any) => ({
          headline: n.headline,
          source: n.source,
        }))
      : [],
    peers: Array.isArray(peers) ? peers.filter((p: string) => p !== ticker).slice(0, 5) : [],
  };
}

async function fetchPeerData(peers: string[], key: string) {
  if (!peers.length || !key) return [];

  const results = await Promise.all(
    peers.slice(0, 5).map(async (peer) => {
      const t = encodeURIComponent(peer);
      const [quote, profile, metrics] = await Promise.all([
        finnhubGet(`/quote?symbol=${t}`, key),
        finnhubGet(`/stock/profile2?symbol=${t}`, key),
        finnhubGet(`/stock/metric?symbol=${t}&metric=all`, key),
      ]);
      const m = metrics?.metric ?? null;
      const mc = profile?.marketCapitalization ?? null;

      const currentEv = m?.currentEv;
      const ebitdPerShare = m?.ebitdPerShareTTM;
      const sharesOut = profile?.shareOutstanding;
      let evEbitda: string | number = "N/D";
      if (currentEv && ebitdPerShare && sharesOut && ebitdPerShare > 0) {
        const ebitda = ebitdPerShare * sharesOut;
        if (ebitda > 0) evEbitda = (currentEv / ebitda).toFixed(1);
      }

      return {
        ticker: peer,
        name: profile?.name ?? peer,
        price: quote?.c != null ? `$${Number(quote.c).toFixed(2)}` : "N/D",
        marketCap: mc ? `$${(mc / 1000).toFixed(1)}B` : "N/D",
        pe: m?.peBasicExclExtraTTM ?? m?.peTTM ?? "N/D",
        pb: m?.pbAnnual ?? m?.pbQuarterly ?? "N/D",
        evEbitda,
        roe: m?.roeTTM != null ? `${Number(m.roeTTM).toFixed(1)}%` : "N/D",
        netMargin: m?.netProfitMarginTTM != null ? `${Number(m.netProfitMarginTTM).toFixed(1)}%` : "N/D",
        revenueGrowth: m?.revenueGrowthTTMYoy != null ? `${Number(m.revenueGrowthTTMYoy).toFixed(1)}%` : "N/D",
        weekReturn52: m?.["52WeekPriceReturnDaily"] != null ? `${Number(m["52WeekPriceReturnDaily"]).toFixed(1)}%` : "N/D",
        beta: m?.beta != null ? Number(m.beta).toFixed(2) : "N/D",
      };
    })
  );

  return results;
}

// ── Tavily helpers ────────────────────────────────────────────────────

async function fetchTavilySearch(
  query: string,
  key: string,
  maxResults = 5,
  days?: number,
  topic?: string,
) {
  try {
    const body: Record<string, unknown> = {
      api_key: key,
      query,
      search_depth: "advanced",
      max_results: maxResults,
      include_answer: true,
    };
    if (days) body.days = days;
    if (topic) body.topic = topic;

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { answer: "", results: [] };
    const data = await res.json();
    return {
      answer: data.answer ?? "",
      results: (data.results ?? []).map((r: any) => ({
        title: r.title,
        content: (r.content ?? "").slice(0, 600),
        published_date: r.published_date ?? "",
      })),
    };
  } catch { return { answer: "", results: [] }; }
}

// ── Context builder ───────────────────────────────────────────────────

function buildDataContext(
  data: any,
  peerData: any[],
  geo: any,
  sectorNews: any,
  tickerNews: any,
  analystSearch: any,
  earningsSearch: any,
  competitiveSearch: any,
  institutionalSearch: any,
  missingDataSearch: any,
): string {
  if (!data || (!data.quote && !data.profile)) {
    return "[Nota: datos en tiempo real no disponibles para este ticker]";
  }

  const q = data.quote;
  const p = data.profile;
  const m = data.metrics;
  const r = data.recommendations;
  const news = data.news ?? [];
  const peers = data.peers ?? [];
  const totalAnalysts = r
    ? (r.strongBuy ?? 0) + (r.buy ?? 0) + (r.hold ?? 0) + (r.sell ?? 0) + (r.strongSell ?? 0)
    : 0;

  // Calculate EV/EBITDA
  const currentEv = m?.currentEv;
  const ebitdPerShare = m?.ebitdPerShareTTM;
  const sharesOut = p?.shareOutstanding;
  let evEbitda: string | number = "N/D";
  if (currentEv && ebitdPerShare && sharesOut && ebitdPerShare > 0) {
    const ebitda = ebitdPerShare * sharesOut;
    if (ebitda > 0) evEbitda = (currentEv / ebitda).toFixed(1);
  }

  const lines = [
    "=== DATOS EN TIEMPO REAL (FINNHUB) ===",
    "",
    `Empresa: ${p?.name ?? "N/D"} | Ticker: ${p?.ticker ?? "N/D"}`,
    `Sector: ${p?.finnhubIndustry ?? "N/D"} | País: ${p?.country ?? "N/D"}`,
    `Exchange: ${p?.exchange ?? "N/D"} | IPO: ${p?.ipo ?? "N/D"}`,
    `Web: ${p?.weburl ?? "N/D"}`,
    "",
    "--- COTIZACIÓN ---",
    `Precio actual: $${q?.c ?? "N/D"}`,
    `Cambio hoy: ${q?.dp != null ? Number(q.dp).toFixed(2) + "%" : "N/D"} ($${q?.d != null ? Number(q.d).toFixed(2) : "N/D"})`,
    `Cierre anterior: $${q?.pc ?? "N/D"}`,
    `Máximo del día: $${q?.h ?? "N/D"} | Mínimo del día: $${q?.l ?? "N/D"}`,
    `Apertura: $${q?.o ?? "N/D"}`,
    "",
    "--- FUNDAMENTALES ---",
    `Market Cap: $${p?.marketCapitalization ? Number(p.marketCapitalization).toFixed(0) + "M" : "N/D"}`,
    `Shares Outstanding: ${p?.shareOutstanding ? Number(p.shareOutstanding).toFixed(2) + "M" : "N/D"}`,
    `P/E (TTM): ${m?.peBasicExclExtraTTM ?? m?.peTTM ?? "N/D"}`,
    `P/E NTM (Forward): ${m?.peNTM ?? "N/D"}`,
    `P/B: ${m?.pbAnnual ?? m?.pbQuarterly ?? "N/D"}`,
    `P/S (TTM): ${m?.psTTM ?? "N/D"}`,
    `EV/EBITDA: ${evEbitda}`,
    `Deuda/Equity: ${m?.totalDebtToEquityAnnual ?? m?.totalDebtToEquityQuarterly ?? "N/D"}`,
    `ROE (TTM): ${m?.roeTTM ?? "N/D"}%`,
    `ROA (TTM): ${m?.roaTTM ?? "N/D"}%`,
    `ROI (TTM): ${m?.roiTTM ?? "N/D"}%`,
    `Revenue Growth YoY: ${m?.revenueGrowthTTMYoy ?? "N/D"}%`,
    `EPS Growth YoY: ${m?.epsGrowthTTMYoy ?? "N/D"}%`,
    `EPS (TTM): ${m?.epsTTM ?? "N/D"}`,
    `Dividend Yield: ${m?.dividendYieldIndicatedAnnual ?? "N/D"}%`,
    `Current Ratio: ${m?.currentRatioAnnual ?? "N/D"}`,
    `Quick Ratio: ${m?.quickRatioAnnual ?? "N/D"}`,
    `Gross Margin (TTM): ${m?.grossMarginTTM ?? "N/D"}%`,
    `Operating Margin (TTM): ${m?.operatingMarginTTM ?? "N/D"}%`,
    `Net Margin (TTM): ${m?.netProfitMarginTTM ?? "N/D"}%`,
    `Free Cash Flow/Share (TTM): ${m?.fcfPerShareTTM ?? "N/D"}`,
    `Beta: ${m?.beta ?? "N/D"}`,
    `52W High: $${m?.["52WeekHigh"] ?? "N/D"} | 52W Low: $${m?.["52WeekLow"] ?? "N/D"}`,
    `52W Price Return: ${m?.["52WeekPriceReturnDaily"] ?? "N/D"}%`,
    `10D Avg Volume: ${m?.["10DayAverageTradingVolume"] ?? "N/D"}M`,
    "",
    `--- RECOMENDACIONES DE ANALISTAS (${totalAnalysts} analistas) ---`,
    `Strong Buy: ${r?.strongBuy ?? 0} | Buy: ${r?.buy ?? 0} | Hold: ${r?.hold ?? 0} | Sell: ${r?.sell ?? 0} | Strong Sell: ${r?.strongSell ?? 0}`,
    `Periodo: ${r?.period ?? "N/D"}`,
  ];

  if (data.allRecommendations?.length > 1) {
    lines.push("", "Tendencia histórica de recomendaciones:");
    for (const rec of data.allRecommendations) {
      lines.push(`  ${rec.period}: SB=${rec.strongBuy} B=${rec.buy} H=${rec.hold} S=${rec.sell} SS=${rec.strongSell}`);
    }
  }

  if (peers.length > 0) {
    lines.push("", `Peers/Competidores identificados: ${peers.join(", ")}`);
  }

  // Peer financial data (real data from Finnhub)
  if (peerData.length > 0) {
    lines.push("", "--- DATOS FINANCIEROS DE COMPETIDORES (FINNHUB) ---");
    lines.push("Ticker | Empresa | Precio | Market Cap | P/E | P/B | EV/EBITDA | ROE | Net Margin | Rev Growth YoY | 52W Return | Beta");
    for (const pd of peerData) {
      lines.push(`${pd.ticker} | ${pd.name} | ${pd.price} | ${pd.marketCap} | ${pd.pe} | ${pd.pb} | ${pd.evEbitda} | ${pd.roe} | ${pd.netMargin} | ${pd.revenueGrowth} | ${pd.weekReturn52} | ${pd.beta}`);
    }
  }

  // Finnhub company news (last 30 days)
  if (news.length > 0) {
    lines.push("", "--- NOTICIAS RECIENTES DEL TICKER (ÚLTIMAS 4 SEMANAS, FINNHUB) ---");
    for (const n of news) {
      lines.push(`- ${n.headline}${n.source ? ` [${n.source}]` : ""}`);
    }
  }

  // Tavily ticker news
  if (tickerNews?.results?.length > 0) {
    lines.push("", "--- NOTICIAS ADICIONALES DEL TICKER (BÚSQUEDA WEB) ---");
    if (tickerNews.answer) lines.push(`Resumen: ${tickerNews.answer}`);
    for (const result of tickerNews.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Tavily sector news
  if (sectorNews?.results?.length > 0) {
    lines.push("", "--- NOTICIAS DEL SECTOR (BÚSQUEDA WEB) ---");
    if (sectorNews.answer) lines.push(`Resumen del sector: ${sectorNews.answer}`);
    for (const result of sectorNews.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Analyst targets
  if (analystSearch?.results?.length > 0) {
    lines.push("", "--- OBJETIVOS DE PRECIO Y RATINGS DE ANALISTAS ---");
    if (analystSearch.answer) lines.push(analystSearch.answer);
    for (const result of analystSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Recent earnings
  if (earningsSearch?.results?.length > 0) {
    lines.push("", "--- RESULTADOS FINANCIEROS RECIENTES (EARNINGS) ---");
    if (earningsSearch.answer) lines.push(earningsSearch.answer);
    for (const result of earningsSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Competitive landscape
  if (competitiveSearch?.results?.length > 0) {
    lines.push("", "--- POSICIÓN COMPETITIVA Y CUOTA DE MERCADO ---");
    if (competitiveSearch.answer) lines.push(competitiveSearch.answer);
    for (const result of competitiveSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Institutional positions
  if (institutionalSearch?.results?.length > 0) {
    lines.push("", "--- POSICIONES INSTITUCIONALES (TAVILY) ---");
    if (institutionalSearch.answer) lines.push(institutionalSearch.answer);
    for (const result of institutionalSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Missing data resolution
  if (missingDataSearch?.results?.length > 0) {
    lines.push("", "--- DATOS ADICIONALES PARA COMPLEMENTAR N/D (TAVILY) ---");
    if (missingDataSearch.answer) lines.push(missingDataSearch.answer);
    for (const result of missingDataSearch.results) {
      lines.push(`- ${result.title}`);
      if (result.content) lines.push(`  ${result.content}`);
    }
  }

  // Geo/regulatory context
  if (geo?.answer) {
    lines.push("", "--- CONTEXTO GEOPOLÍTICO Y REGULATORIO ---");
    lines.push(geo.answer);
    if (geo.results?.length > 0) {
      for (const s of geo.results) lines.push(`  - ${s.title}: ${s.content?.slice(0, 250) ?? ""}`);
    }
  }

  lines.push("", "=== FIN DATOS ===");
  return lines.join("\n");
}

// ── System prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Eres un sistema de generación de informes financieros institucionales estilo Terminal. Fecha actual: ${today}.

REGLA CRÍTICA NRO. 1: Usa LOS SIGUIENTES ENCABEZADOS EXACTOS para estructurar tu respuesta. El frontend los usará para crear PESTAÑAS. 
(DEBES usar "## " antes de cada uno).

## Resumen Ejecutivo
## Finanzas
## Valoración
## Competidores
## Noticias
## Institucional

MÁS DETALLES DE CADA SECCIÓN:

## Resumen Ejecutivo
4-6 líneas sobre la situación actual: precio, valoración relativa al sector, posicionamiento competitivo y sentimiento de analistas.
Agrega sub-sección "Perfil de la Empresa" (breve).
Agrega factores específicos macroeconómicos y geopolíticos de esta empresa.

## Finanzas
Tabla Markdown con: Precio Actual, Market Cap, P/E TTM, P/E Forward, P/B, P/S, EV/EBITDA, ROE, Gross Margin, Operating Margin, Net Margin, Deuda/Equity, EPS TTM, Dividend Yield, Beta, 52W High, 52W Low, 52W Return.
Si Finnhub marca "N/D", extrae el valor real de la sección "DATOS ADICIONALES PARA COMPLEMENTAR N/D". NUNCA INVENTES DATOS. Si un competidor tiene N/D, infiérelos de la misma base.

## Valoración
Análisis de múltiplos (P/E, P/B, EV/EBITDA, P/S) con contexto sectorial. Comparación con competidores.
Lista de Factores de Riesgo (5 a 7 viñetas).

## Competidores
Tabla comparativa usando los datos de "DATOS FINANCIEROS DE COMPETIDORES" y rellenando los "N/D" con "DATOS ADICIONALES" de haberlos. Columnas: Empresa, Precio, Market Cap, P/E, P/B, EV/EBITDA, ROE, Net Margin, Crecimiento, 52W Return. Análisis breve.

## Noticias
Revisa "NOTICIAS RECIENTES DEL TICKER" y "NOTICIAS DEL SECTOR". 
Formatea las 5-8 noticias más relevantes usando listas con viñetas puras.
NO USES URLs. NO USES FECHAS.
Estructura de la noticia: "- **TITULAR:** CONTEXTO O IMPACTO DE 2 LÍNEAS MÁXIMO."

## Institucional
Revisa "POSICIONES INSTITUCIONALES (TAVILY)" y "RECOMENDACIONES DE ANALISTAS".
Indica las tenencias de grandes fondos (Vanguard, BlackRock, etc.).
Consenso de analistas con % y tabla rápida si aplica.
Solo información extraída de los datos.

FORMATO FINAL:
Usa estricto markdown. Sin emojis en encabezamientos. Nunca cortes oraciones a medias. Estilo directo, conciso, serio y numérico.`;
}

// ── Main handler ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { ticker } = await req.json();

    if (!ticker || typeof ticker !== "string" || ticker.trim().length === 0 || ticker.trim().length > 10) {
      return new Response(
        JSON.stringify({ error: "Ticker inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("Gemini");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const FINNHUB_KEY = (Deno.env.get("FINNHUB_API_KEY") || Deno.env.get("Finhub")) ?? "";
    const TAVILY_KEY = (Deno.env.get("TAVILY_API_KEY") || Deno.env.get("Tavily")) ?? "";

    const cleanTicker = ticker.trim().toUpperCase();

    // Step 1: Fetch Finnhub base data
    const finnhubData = FINNHUB_KEY ? await fetchFinnhubData(cleanTicker, FINNHUB_KEY) : null;

    const companyName = finnhubData?.profile?.name ?? cleanTicker;
    const sector = finnhubData?.profile?.finnhubIndustry ?? "";
    const peers = finnhubData?.peers ?? [];

    // Step 2: Fetch peer financial data + 8 Tavily searches in parallel
    const [
      peerData,
      geoContext,
      tickerNews,
      sectorNews,
      analystSearch,
      earningsSearch,
      competitiveSearch,
      institutionalSearch,
      missingDataSearch,
    ] = await Promise.all([
      FINNHUB_KEY ? fetchPeerData(peers, FINNHUB_KEY) : Promise.resolve([]),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} geopolitico regulatorio riesgo aranceles 2025 2026`, TAVILY_KEY, 4)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} noticias ultimos dias`, TAVILY_KEY, 7, 7, "news")
        : Promise.resolve(null),
      TAVILY_KEY && sector
        ? fetchTavilySearch(`${sector} sector noticias tendencias`, TAVILY_KEY, 6, 7, "news")
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} analyst price target rating upgrade downgrade 2025 2026`, TAVILY_KEY, 5)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} earnings results revenue quarterly 2025 2026`, TAVILY_KEY, 5)
        : Promise.resolve(null),
      TAVILY_KEY && peers.length > 0
        ? fetchTavilySearch(
            `${companyName} vs ${peers.slice(0, 3).join(" ")} market share competitive position ${sector}`,
            TAVILY_KEY,
            4,
          )
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} institutional ownership top holders vanguard blackrock recent changes 2025 2026`, TAVILY_KEY, 4)
        : Promise.resolve(null),
      TAVILY_KEY
        ? fetchTavilySearch(`${companyName} ${cleanTicker} current financial metrics P/E ratio ROE market cap EBITDA multiples 2025 2026`, TAVILY_KEY, 4)
        : Promise.resolve(null),
    ]);

    const dataContext = buildDataContext(
      finnhubData,
      peerData,
      geoContext,
      sectorNews,
      tickerNews,
      analystSearch,
      earningsSearch,
      competitiveSearch,
      institutionalSearch,
      missingDataSearch,
    );

    console.log("Data sources loaded:", {
      finnhub_quote: !!finnhubData?.quote?.c,
      finnhub_profile: !!finnhubData?.profile?.name,
      finnhub_metrics: !!finnhubData?.metrics,
      finnhub_news: finnhubData?.news?.length ?? 0,
      peer_data: peerData.length,
      tavily_geo: !!(geoContext?.answer),
      tavily_ticker_news: tickerNews?.results?.length ?? 0,
      tavily_sector_news: sectorNews?.results?.length ?? 0,
      tavily_analyst: analystSearch?.results?.length ?? 0,
      tavily_earnings: earningsSearch?.results?.length ?? 0,
      tavily_competitive: competitiveSearch?.results?.length ?? 0,
      tavily_institutional: institutionalSearch?.results?.length ?? 0,
      tavily_missing_data: missingDataSearch?.results?.length ?? 0,
    });

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-1.5-pro",
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: `${dataContext}

Genera un informe financiero institucional completo y riguroso sobre ${cleanTicker} (${companyName}).
Usa EXCLUSIVAMENTE los datos numéricos proporcionados (Finnhub y Web Search). Si un dato dice N/D en Finnhub, búscalo en "DATOS ADICIONALES (BÚSQUEDA TAVILY)" e incorpóralo. Si de plano no existe, escribe N/D.
Para la tabla de competidores, usa los datos de "DATOS FINANCIEROS DE COMPETIDORES" y complétalos con contexto web si es necesario.
Si el ticker no corresponde a una empresa conocida, indícalo claramente.`,
          },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Límite de solicitudes excedido. Inténtalo en unos segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos agotados." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: `API Error (${response.status}): ${t.substring(0, 100)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("analyze-ticker error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
