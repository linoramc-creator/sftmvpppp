// TypeScript mirrors of the macro economic calendar payload computed by the
// analyze-ticker edge function (handleMacroCalendar). Events come verbatim
// from FMP (Finnhub fallback) — never from an LLM.

export interface MacroEvent {
  event: string;
  date: string; // "YYYY-MM-DD HH:mm"
  country: string;
  impact: "High" | "Medium" | "Low" | null;
  actual: number | null;
  previous: number | null;
  estimate: number | null;
  unit: string | null;
}

export interface MacroCalendarResponse {
  events: MacroEvent[];
  source: "fmp" | "finnhub" | null;
  from: string;
  to: string;
  fetchedAt: string;
}
