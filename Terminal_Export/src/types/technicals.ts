// TypeScript mirrors of the technical-series payload computed by the
// analyze-ticker edge function (handleTechnicals). SMA / RSI / MACD are
// calculated in backend code from Yahoo closes — never by an LLM.

export interface TechnicalPoint {
  date: string;
  close: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi: number | null;        // Wilder RSI(14), 0–100
  macd: number | null;       // EMA12 − EMA26
  macdSignal: number | null; // EMA9 of MACD
  macdHist: number | null;   // MACD − signal
}

export interface TechnicalsResponse {
  ticker: string;
  series: TechnicalPoint[];
  current: {
    close: number | null;
    sma50: number | null;
    sma200: number | null;
    rsi: number | null;
    macd: number | null;
    macdSignal: number | null;
  };
  fetchedAt: string;
}
