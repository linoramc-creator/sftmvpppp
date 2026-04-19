
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
  return `Eres un analista financiero institucional senior que genera informes Bloomberg Terminal completos y exhaustivos. Fecha actual: ${today}.

════════════════════════════════════════════════════════════
REGLA ABSOLUTA: DEBES generar LAS 6 SECCIONES SIGUIENTES SIN EXCEPCIÓN.
Cada sección empieza EXACTAMENTE con "## " (doble almohadilla + espacio).
NUNCA omitas una sección. NUNCA fusiones secciones. NUNCA resumas en exceso.
════════════════════════════════════════════════════════════

## Resumen Ejecutivo
## Finanzas
## Valoración
## Competidores
## Noticias
## Institucional

════════════════════════════════════════════════════════════
CONTENIDO OBLIGATORIO DE CADA SECCIÓN (mínimo indicado):
════════════════════════════════════════════════════════════

## Resumen Ejecutivo
OBLIGATORIO incluir todo lo siguiente:
- Párrafo 1 (5-7 líneas): Situación actual de la empresa — precio exacto, capitalización, rendimiento YTD vs sector, tendencia reciente.
- Párrafo 2 (4-5 líneas): Posicionamiento competitivo — cuota de mercado, ventajas diferenciales, amenazas principales.
- Párrafo 3 (4-5 líneas): Catalizadores y riesgos macro — aranceles, tasas de interés, geopolítica, regulación específica.
- ### Perfil de la Empresa: sector, país, exchange, fecha IPO, descripción del negocio en 3-4 líneas.
- ### Consenso de Analistas: número total de analistas, distribución Buy/Hold/Sell, precio objetivo consenso si disponible.

## Finanzas
OBLIGATORIO: Tabla Markdown con DOS columnas (Métrica | Valor) incluyendo TODAS estas filas en orden:
| Métrica | Valor |
|---|---|
| Precio Actual | |
| Market Cap | |
| P/E TTM | |
| P/E Forward (NTM) | |
| P/B | |
| P/S TTM | |
| EV/EBITDA | |
| ROE TTM | |
| ROA TTM | |
| Gross Margin TTM | |
| Operating Margin TTM | |
| Net Margin TTM | |
| Deuda/Equity | |
| EPS TTM | |
| Free Cash Flow/Share | |
| Dividend Yield | |
| Beta | |
| 52W High | |
| 52W Low | |
| 52W Return | |
| Volumen Promedio 10D | |

Después de la tabla: párrafo de 4-5 líneas analizando los fundamentales más relevantes.
Si algún dato es N/D en Finnhub, búscalo en "DATOS ADICIONALES PARA COMPLEMENTAR N/D". NUNCA inventes cifras.

## Valoración
OBLIGATORIO incluir todo lo siguiente:
- ### Análisis de Múltiplos: tabla comparando P/E, P/B, EV/EBITDA, P/S de la empresa vs promedio del sector. Párrafo de 4-5 líneas interpretando si está cara, barata o en línea con el sector.
- ### Análisis del Sector: 5-6 líneas sobre el estado actual del sector, tendencias estructurales, ciclo económico, impacto de tasas/macro, perspectivas a 12 meses.
- ### Factores de Riesgo: lista de 6-8 viñetas con riesgos específicos y cuantificados cuando sea posible.
- ### Catalizadores Positivos: lista de 4-5 viñetas con catalizadores concretos a corto y medio plazo.

## Competidores
OBLIGATORIO incluir todo lo siguiente:
- ### Tabla Comparativa: tabla Markdown con columnas: Empresa | Ticker | Precio | Market Cap | P/E TTM | P/B | EV/EBITDA | ROE | Net Margin | Rev Growth YoY | 52W Return | Beta
  Incluye la empresa analizada en la PRIMERA fila (marcada con asterisco *) y todos los competidores identificados.
  Usa los datos de "DATOS FINANCIEROS DE COMPETIDORES". Si hay N/D, intenta completar con datos de búsqueda web.
- ### Análisis Competitivo: 5-6 líneas describiendo la posición relativa de la empresa vs competidores — quién lidera en márgenes, crecimiento, valoración y retorno.
- ### Cuota de Mercado y Posicionamiento: 3-4 líneas sobre participación de mercado y diferenciación competitiva.

## Noticias
OBLIGATORIO incluir todo lo siguiente:
- ### Noticias Corporativas Recientes: 5-7 noticias del ticker. Formato EXACTO por noticia:
  "- **TITULAR EN MAYÚSCULAS:** Explicación del impacto o contexto en 2-3 líneas."
  NO uses URLs. NO uses fechas. Solo hechos e impacto.
- ### Noticias del Sector: 3-4 noticias del sector que afectan a la empresa. Mismo formato.
- ### Contexto Macro Relevante: 3-4 líneas sobre el entorno macroeconómico y geopolítico que afecta directamente a esta empresa.

## Institucional
OBLIGATORIO incluir todo lo siguiente:
- ### Tenencias Institucionales: lista de los principales inversores institucionales con % de propiedad si disponible (Vanguard, BlackRock, Fidelity, State Street, etc.).
- ### Consenso de Analistas — Detalle: tabla con distribución Strong Buy / Buy / Hold / Sell / Strong Sell y totales. Párrafo de 3-4 líneas interpretando el consenso.
- ### Cambios Recientes en Posiciones: upgrades/downgrades recientes de bancos de inversión, cambios en precio objetivo.
- ### Flujos y Sentimiento: 3-4 líneas sobre flujos institucionales recientes y sentimiento general del mercado hacia el valor.

════════════════════════════════════════════════════════════
REGLAS DE FORMATO:
- Markdown estricto. Sin emojis en ningún encabezado.
- Todos los números con unidades claras ($, %, x, B, M).
- Nunca cortes una oración a medias.
- Estilo directo, numérico, profesional — como un analista de Goldman Sachs o Morgan Stanley.
- Si un dato no existe en ninguna fuente, escribe "N/D" — NUNCA inventes cifras.
════════════════════════════════════════════════════════════`;
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  console.log("analyze-ticker v3-OR started");
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

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || Deno.env.get("OpenRouter");
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");

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

    console.log("Calling OpenRouter API...");
    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sftmvpppp.vercel.app",
        "X-Title": "Financial Terminal",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-70b-instruct:free",
        max_tokens: 8000,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: `${dataContext}

INSTRUCCIÓN FINAL — MUY IMPORTANTE:
Genera el informe financiero institucional COMPLETO sobre ${cleanTicker} (${companyName}).
DEBES generar las 6 secciones completas: ## Resumen Ejecutivo, ## Finanzas, ## Valoración, ## Competidores, ## Noticias, ## Institucional.
NO omitas ninguna sección. NO resumas. Cada sección debe tener el contenido mínimo especificado en el system prompt.
Usa EXCLUSIVAMENTE los datos numéricos de las fuentes proporcionadas (Finnhub + Tavily). Si un dato es N/D en Finnhub, búscalo en "DATOS ADICIONALES PARA COMPLEMENTAR N/D". Si no existe en ninguna fuente, escribe N/D — NUNCA inventes cifras.
Para la tabla de competidores: usa "DATOS FINANCIEROS DE COMPETIDORES" e incluye el P/E de cada uno. Completa N/D con datos de búsqueda web si los hay.
Si el ticker no corresponde a una empresa real conocida, indícalo en el ## Resumen Ejecutivo.`,
          },
        ],
        stream: true,
      }),
    });

    console.log("OpenRouter response status:", orResponse.status);

    if (!orResponse.ok) {
      const errBody = await orResponse.text();
      console.error("OpenRouter API error:", orResponse.status, errBody);
      if (orResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Límite de solicitudes excedido. Inténtalo en unos segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (orResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: `Créditos agotados. Detalle: ${errBody.substring(0, 200)}` }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: `OpenRouter Error (${orResponse.status}): ${errBody.substring(0, 300)}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!orResponse.body) {
      return new Response(
        JSON.stringify({ error: "OpenRouter returned empty response body" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Streaming response to client...");
    return new Response(orResponse.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : "";
    console.error("analyze-ticker fatal error:", msg, stack);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
