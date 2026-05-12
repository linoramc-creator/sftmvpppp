
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchTavilySearch(
  query: string,
  key: string,
  maxResults = 5,
  days?: number,
  topic?: string,
  contentLen = 160,
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
      answer: (data.answer ?? "").slice(0, 350),
      results: (data.results ?? []).slice(0, maxResults).map((r: any) => ({
        title: r.title,
        content: (r.content ?? "").slice(0, contentLen),
        published_date: r.published_date ?? "",
        url: r.url ?? "",
      })),
    };
  } catch (_) { return { answer: "", results: [] }; }
}

async function fetchFredData(key: string): Promise<string> {
  if (!key) return "";
  try {
    const series = [
      { id: "FEDFUNDS", label: "Fed Funds Rate" },
      { id: "DGS10",    label: "10Y Treasury Yield" },
      { id: "UNRATE",   label: "Unemployment Rate" },
    ];

    const results = await Promise.all(
      series.map(async (s) => {
        const res = await fetch(
          `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}&apikey=${key}&limit=1&sort_order=desc&file_type=json`
        ).catch(() => null);
        if (!res?.ok) return null;
        const data = await res.json().catch(() => null);
        const obs = data?.observations?.[0];
        return obs ? `${s.label}: ${obs.value}% (${obs.date})` : null;
      })
    );

    const cpiRes = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&apikey=${key}&limit=14&sort_order=desc&file_type=json`
    ).catch(() => null);
    let cpiLine: string | null = null;
    if (cpiRes?.ok) {
      const cpiData = await cpiRes.json().catch(() => null);
      const obs: any[] = cpiData?.observations ?? [];
      if (obs.length >= 13) {
        const cur = parseFloat(obs[0].value);
        const prev = parseFloat(obs[12].value);
        if (!isNaN(cur) && !isNaN(prev) && prev > 0) {
          cpiLine = `CPI Inflation YoY: ${((cur - prev) / prev * 100).toFixed(2)}% (${obs[0].date})`;
        }
      }
    }

    const valid = [...results.filter(Boolean), cpiLine].filter(Boolean);
    if (!valid.length) return "";
    return ["--- INDICADORES MACRO USA (FRED) ---", ...valid].join("\n");
  } catch (_) { return ""; }
}

function buildSectorDataContext(
  sector: string,
  sectorNews: any,
  sectorTrends: any,
  topCompanies: any,
  sectorETFs: any,
  macroNews: any,
  regulatoryContext: any,
  fredContext: string,
): string {
  const lines = [`=== INVESTIGACIÓN SECTORIAL: ${sector.toUpperCase()} ===`, ""];

  if (sectorNews?.results?.length > 0) {
    lines.push("--- NOTICIAS RECIENTES DEL SECTOR (ÚLTIMOS 30 DÍAS) ---");
    if (sectorNews.answer) lines.push(`Resumen: ${sectorNews.answer}`);
    for (const r of sectorNews.results) {
      lines.push(`- [${r.published_date ?? ""}] ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (sectorTrends?.results?.length > 0) {
    lines.push("--- TENDENCIAS Y PERSPECTIVAS DEL SECTOR ---");
    if (sectorTrends.answer) lines.push(sectorTrends.answer);
    for (const r of sectorTrends.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (topCompanies?.results?.length > 0) {
    lines.push("--- PRINCIPALES EMPRESAS DEL SECTOR ---");
    if (topCompanies.answer) lines.push(topCompanies.answer);
    for (const r of topCompanies.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (sectorETFs?.results?.length > 0) {
    lines.push("--- ETFs DISPONIBLES PARA EL SECTOR ---");
    if (sectorETFs.answer) lines.push(sectorETFs.answer);
    for (const r of sectorETFs.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (macroNews?.results?.length > 0) {
    lines.push("--- CONTEXTO MACRO QUE AFECTA AL SECTOR ---");
    if (macroNews.answer) lines.push(macroNews.answer);
    for (const r of macroNews.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (regulatoryContext?.results?.length > 0) {
    lines.push("--- CONTEXTO REGULATORIO Y GEOPOLÍTICO ---");
    if (regulatoryContext.answer) lines.push(regulatoryContext.answer);
    for (const r of regulatoryContext.results) {
      lines.push(`- ${r.title}`);
      if (r.content) lines.push(`  ${r.content}`);
    }
    lines.push("");
  }

  if (fredContext) { lines.push(fredContext); lines.push(""); }

  lines.push("=== FIN DATOS ===");
  return lines.join("\n");
}

function buildSectorSystemPrompt(sector: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Eres un analista financiero institucional senior especializado en análisis sectorial. Fecha: ${today}.

Genera un informe sectorial completo y detallado sobre el sector "${sector}". Usa EXACTAMENTE estas 7 secciones iniciadas con "## ":
## Panorama del Sector
## Empresas Líderes
## Mejores ETFs
## Noticias y Tendencias
## Análisis Macro
## Perspectivas y Catalizadores
## Riesgos del Sector

== CONTENIDO POR SECCIÓN ==

## Panorama del Sector
- Párrafo 5-7 líneas: descripción del sector, tamaño de mercado (TAM), CAGR histórico y proyectado, segmentos clave, geografías dominantes, fase del ciclo.
- ### Métricas Clave: tabla Métrica | Valor con: Tamaño Mercado Global, CAGR proyectado, Número empresas cotizadas, Principales índices/benchmarks, Volatilidad relativa.
- ### Estructura del Sector: 4-5 líneas sobre cómo está organizado el sector (cadena de valor, segmentos, concentración).

## Empresas Líderes
- ### Tabla de Empresas Líderes: tabla Empresa | Ticker | País | Market Cap est. | Especialización
  Incluye 8-10 empresas. Empresa analizada en primera fila con *.
- Para cada empresa 2-3 líderes: párrafo 2-3 líneas explicando por qué son líderes, ventajas diferenciales, cuota de mercado.

## Mejores ETFs
- ### Tabla de ETFs: tabla ETF | Ticker | TER | AUM est. | Índice/Benchmark | Exposición geográfica
  Incluye 5-7 ETFs.
- Para cada ETF, 1-2 líneas sobre ventajas, liquidez, para qué tipo de inversor.

## Noticias y Tendencias
- ### Noticias Recientes: 5-7 noticias importantes (últimas 4 semanas). Formato: "- **Titular:** impacto 2-3 líneas."
- ### Tendencias Estructurales: 5-7 viñetas sobre megatendencias que definen el sector a largo plazo.
- ### Disruptores e Innovaciones: 3-4 viñetas sobre tecnologías o modelos que están transformando el sector.

## Análisis Macro
- ### Factores Macroeconómicos: 5-6 líneas sobre tipos de interés, inflación, ciclo económico, divisa, aranceles.
- Integra indicadores FRED disponibles (Fed Funds, yield 10Y, desempleo, CPI).
- ### Impacto Geopolítico: 3-4 líneas sobre geopolítica, regulación y política sectorial relevante.

## Perspectivas y Catalizadores
- ### Corto Plazo (0-6m): 3-4 catalizadores con impacto esperado y horizonte temporal.
- ### Medio Plazo (6-18m): 3-4 catalizadores de crecimiento o consolidación.
- ### Largo Plazo (+18m): 3-4 tendencias estructurales de crecimiento sostenido.
- ### Tesis de Inversión: 4-5 líneas con la tesis principal para invertir en este sector ahora.

## Riesgos del Sector
- 7-9 viñetas sobre riesgos principales. Formato: "- **Tipo de Riesgo:** descripción concreta con cifras o eventos. Nivel: **ALTO** / **MEDIO** / **BAJO**"
  Cubre: regulatorio, competencia, macro (tipos/aranceles/divisa), tecnológico, concentración, geopolítico, ESG.

REGLAS DE FORMATO:
- Markdown estricto. Sin emojis.
- Todos los números: exactamente 2 decimales donde aplique.
- Unidades siempre presentes: $, %, x, B, M.
- Niveles de riesgo en **NEGRITAS**: **ALTO**, **MEDIO**, **BAJO**.
- Tendencias/señales en **NEGRITAS**: **BULLISH**, **BEARISH**, **ALCISTA**, **BAJISTA**.
- Si no tienes un dato específico, omite esa fila — nunca escribas N/D, N/A o similar.
- No cortes frases a medias.`;
}

Deno.serve(async (req) => {
  console.log("analyze-sector v1 started");
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sector } = await req.json();

    if (!sector || typeof sector !== "string" || sector.trim().length === 0 || sector.trim().length > 80) {
      return new Response(
        JSON.stringify({ error: "Sector inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("Gemini") || Deno.env.get("GOOGLE_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const TAVILY_KEY = (Deno.env.get("TAVILY_API_KEY") || Deno.env.get("Tavily")) ?? "";
    const FRED_KEY   = Deno.env.get("Fred") ?? "";

    const cleanSector = sector.trim();

    const [
      sectorNews,
      sectorTrends,
      topCompanies,
      sectorETFs,
      macroNews,
      regulatoryContext,
      fredContext,
    ] = await Promise.all([
      TAVILY_KEY
        ? fetchTavilySearch(`${cleanSector} sector news latest 2025 2026`, TAVILY_KEY, 6, 30, "news", 180)
        : Promise.resolve({ answer: "", results: [] }),
      TAVILY_KEY
        ? fetchTavilySearch(`${cleanSector} sector outlook trends growth forecast 2025 2026`, TAVILY_KEY, 5, undefined, undefined, 180)
        : Promise.resolve({ answer: "", results: [] }),
      TAVILY_KEY
        ? fetchTavilySearch(`top companies ${cleanSector} sector leaders market cap 2025`, TAVILY_KEY, 5, undefined, undefined, 160)
        : Promise.resolve({ answer: "", results: [] }),
      TAVILY_KEY
        ? fetchTavilySearch(`best ETF ${cleanSector} sector invest 2025`, TAVILY_KEY, 4, undefined, undefined, 140)
        : Promise.resolve({ answer: "", results: [] }),
      TAVILY_KEY
        ? fetchTavilySearch(`${cleanSector} sector interest rates inflation tariffs macro impact 2025`, TAVILY_KEY, 4, 60, undefined, 160)
        : Promise.resolve({ answer: "", results: [] }),
      TAVILY_KEY
        ? fetchTavilySearch(`${cleanSector} sector regulation policy geopolitical risk 2025 2026`, TAVILY_KEY, 3, 90, undefined, 150)
        : Promise.resolve({ answer: "", results: [] }),
      fetchFredData(FRED_KEY),
    ]);

    const dataContext = buildSectorDataContext(
      cleanSector,
      sectorNews,
      sectorTrends,
      topCompanies,
      sectorETFs,
      macroNews,
      regulatoryContext,
      fredContext,
    );

    console.log("Sector data loaded:", {
      sector: cleanSector,
      tavily_news: (sectorNews as any)?.results?.length ?? 0,
      tavily_trends: (sectorTrends as any)?.results?.length ?? 0,
      tavily_companies: (topCompanies as any)?.results?.length ?? 0,
      tavily_etfs: (sectorETFs as any)?.results?.length ?? 0,
      fred_ok: !!fredContext,
    });

    const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const GEMINI_MODELS = [
      "gemini-3-pro-latest",
      "gemini-3.0-pro",
      "gemini-3-pro",
      "gemini-2.5-pro-latest",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ];

    const geminiBody = {
      messages: [
        { role: "system", content: buildSectorSystemPrompt(cleanSector) },
        {
          role: "user",
          content: `${dataContext}

INSTRUCCIÓN FINAL:
Genera el informe sectorial completo sobre "${cleanSector}" con las 7 secciones obligatorias.
- Usa todas las noticias y datos de investigación proporcionados.
- Sé específico: menciona empresas reales, tickers, cifras concretas.
- Integra los indicadores FRED en el Análisis Macro.
- Las tablas de empresas y ETFs deben tener datos reales y completos.
- Si no existe un dato, omite esa fila — nunca uses N/D.`,
        },
      ],
      stream: true,
    };

    let orResponse: Response | null = null;
    let usedModel = "";
    for (const model of GEMINI_MODELS) {
      const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...geminiBody, model }),
      });
      console.log(`Gemini [${model}] status:`, res.status);
      if (res.ok) { orResponse = res; usedModel = model; break; }

      if (res.status === 401 || res.status === 403) {
        return new Response(
          JSON.stringify({ error: "API key de Gemini inválida o sin permisos." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ error: "Límite de solicitudes Gemini. Inténtalo en unos segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errBody = await res.text();
      console.warn(`Model ${model} unavailable (${res.status}): ${errBody.substring(0, 150)}. Trying next...`);
    }

    if (!orResponse) {
      return new Response(
        JSON.stringify({ error: "Todos los modelos Gemini están saturados. Inténtalo en unos segundos." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log(`Streaming sector analysis with model: ${usedModel}`);

    if (!orResponse.body) {
      return new Response(
        JSON.stringify({ error: "Gemini returned empty response body" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
    console.error("analyze-sector fatal error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
