// Single unified Supabase function — dispatches by body shape ({ticker} | {sector} | {marketData})
const ANALYZE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`;

export interface MarketQuote {
  symbol: string;
  label: string;
  price: number | null;
  change1d: number | null;
  change1m: number | null;
}

export interface MarketData {
  indices: MarketQuote[];
  yield10y: number | null;
  yield2y: number | null;
  spread: number | null;
  stocks: MarketQuote[];
  ts: number;
}

export async function fetchMarketData(symbols: string[]): Promise<MarketData | null> {
  try {
    const resp = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ marketData: true, symbols }),
    });
    if (!resp.ok) {
      console.warn("[fetchMarketData] HTTP", resp.status, await resp.text().catch(() => ""));
      return null;
    }
    return resp.json();
  } catch (e) {
    console.warn("[fetchMarketData] network error:", e);
    return null;
  }
}

export interface QuarterlyPeriod {
  period: string;
  // P&L
  revenue: string;
  revenueGrowth: string;
  grossMargin: string;
  ebitda: string;
  netIncome: string;
  netMargin: string;
  eps: string;
  // Cash flow
  operatingCF: string;
  freeCashFlow: string;
  capex: string;
  investingCF?: string;
  financingCF?: string;
  // Balance
  cash: string;
  totalDebt: string;
  netDebt: string;
  equity: string;
  totalAssets: string;
}

async function streamSSE({
  url,
  body,
  onDelta,
  onDone,
  onError,
  onEvent,
  signal,
}: {
  url: string;
  body: object;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onEvent?: (parsed: any) => void;
  signal?: AbortSignal;
}) {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") return;
    const msg = e instanceof Error ? e.message : "Error de red desconocido";
    onError(`Sin conexión con el servidor: ${msg}`);
    return;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    let msg = `Error ${resp.status}`;
    try { const j = JSON.parse(text); msg = j.error || j.message || msg; } catch { if (text) msg = `${msg}: ${text.slice(0, 120)}`; }
    onError(msg);
    return;
  }

  if (!resp.body) { onError("Sin respuesta del servidor"); return; }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";
  let streamDone = false;

  const parseLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    const jsonStr = line.slice(6).trim();
    if (jsonStr === "[DONE]") { streamDone = true; return; }
    try {
      const parsed = JSON.parse(jsonStr);
      if (onEvent) onEvent(parsed);
      const content = parsed.choices?.[0]?.delta?.content as string | undefined;
      if (content) onDelta(content);
    } catch { /* ignore partial chunks */ }
  };

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
      let line = textBuffer.slice(0, newlineIndex);
      textBuffer = textBuffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.trim() === "" || line.startsWith(":")) continue;
      parseLine(line);
      if (streamDone) break;
    }
  }

  for (let raw of textBuffer.split("\n")) {
    if (!raw || raw.startsWith(":")) continue;
    if (raw.endsWith("\r")) raw = raw.slice(0, -1);
    parseLine(raw);
  }

  onDone();
}

export interface QuarterlyDebug {
  hasFinnhub:     boolean;
  hasFmp:         boolean;
  hasTwelveData?: boolean;
  hasTavily?:     boolean;
  finnhubRows:    number;
  fmpRows:        number;
  twelveDataRows?: number;
  aiFallbackRows?: number;
  mergedRows:     number;
}

export interface CatalystCalendar {
  earnings: { date: string; epsEstimate: string | null; revenueEstimate: string | null }[];
  dividends: { exDate: string; amount: string; frequency: string }[];
}

export async function streamAnalysis({
  ticker,
  onDelta,
  onDone,
  onError,
  onQuarterlyData,
  onQuarterlyDebug,
  onCatalystCalendar,
  signal,
}: {
  ticker: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onQuarterlyData?: (data: QuarterlyPeriod[]) => void;
  onQuarterlyDebug?: (debug: QuarterlyDebug) => void;
  onCatalystCalendar?: (data: CatalystCalendar) => void;
  signal?: AbortSignal;
}) {
  await streamSSE({
    url: ANALYZE_URL,
    body: { ticker },
    onDelta,
    onDone,
    onError,
    signal,
    onEvent: (parsed) => {
      if (parsed.__quarterly && onQuarterlyData) {
        onQuarterlyData(parsed.__quarterly as QuarterlyPeriod[]);
      }
      if (parsed.__quarterlyDebug && onQuarterlyDebug) {
        onQuarterlyDebug(parsed.__quarterlyDebug as QuarterlyDebug);
      }
      if (parsed.__catalystCalendar && onCatalystCalendar) {
        onCatalystCalendar(parsed.__catalystCalendar as CatalystCalendar);
      }
    },
  });
}

export async function streamSectorAnalysis({
  sector,
  onDelta,
  onDone,
  onError,
  signal,
}: {
  sector: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  signal?: AbortSignal;
}) {
  await streamSSE({
    url: ANALYZE_URL,
    body: { sector },
    onDelta,
    onDone,
    onError,
    signal,
  });
}
