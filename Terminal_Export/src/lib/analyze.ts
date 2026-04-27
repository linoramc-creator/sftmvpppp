const ANALYZE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-ticker`;

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
  // Balance
  cash: string;
  totalDebt: string;
  netDebt: string;
  equity: string;
  totalAssets: string;
}

export async function streamAnalysis({
  ticker,
  onDelta,
  onDone,
  onError,
  onQuarterlyData,
  signal,
}: {
  ticker: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onQuarterlyData?: (data: QuarterlyPeriod[]) => void;
  signal?: AbortSignal;
}) {
  const resp = await fetch(ANALYZE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ ticker }),
    signal,
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: "Error de conexión" }));
    onError(data.error || `Error ${resp.status}`);
    return;
  }

  if (!resp.body) {
    onError("Sin respuesta del servidor");
    return;
  }

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

      // Our custom quarterly data event
      if (parsed.__quarterly && onQuarterlyData) {
        onQuarterlyData(parsed.__quarterly as QuarterlyPeriod[]);
        return;
      }

      // Groq streaming delta
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

  // Flush remaining buffer
  for (let raw of textBuffer.split("\n")) {
    if (!raw || raw.startsWith(":")) continue;
    if (raw.endsWith("\r")) raw = raw.slice(0, -1);
    parseLine(raw);
  }

  onDone();
}
