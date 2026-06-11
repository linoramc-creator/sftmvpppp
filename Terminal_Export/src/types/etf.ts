// TypeScript mirrors of the ETF deep-analysis payload computed by the
// analyze-ticker edge function (handleEtf). Exposure weights come from
// Yahoo/FMP; the geopolitical layer is a fixed heuristic table crossed with
// those weights in backend code — never produced by an LLM.

export interface EtfAllocation {
  label: string; // Acciones / Bonos / Efectivo...
  pct: number;   // 0–100
}

export interface EtfSector {
  sector: string;
  pct: number;
}

export interface EtfCountry {
  country: string;
  pct: number;
}

export interface EtfHolding {
  symbol: string;
  name: string;
  pct: number;
}

export interface EtfGeoRisk {
  factor: string;
  kind: "sector" | "país";
  exposurePct: number;
  score: number;        // 0–100 fixed heuristic
  contribution: number; // exposurePct × score / 100
  note: string;
}

export interface EtfNewsItem {
  title: string;
  url: string;
  source: string;
  datetime: string;
}

// Point-in-time fundamentals for the Valoración table. All values come from
// Yahoo quoteSummary modules (summaryDetail / defaultKeyStatistics / price);
// any metric Yahoo doesn't publish for a fund arrives as null → rendered "—".
export interface EtfFundamentals {
  price: number | null;
  marketCap: number | null;
  totalAssets: number | null;   // AUM
  expenseRatio: number | null;  // fraction (0.0009 = 0.09%)
  navPrice: number | null;
  peTtm: number | null;
  pb: number | null;
  psTtm: number | null;
  epsTtm: number | null;
  dividendYield: number | null; // fraction
  beta: number | null;
  high52: number | null;
  low52: number | null;
  return52w: number | null;     // fraction
  ytdReturn: number | null;     // fraction
  avgVolume10d: number | null;
}

// Which provider in the fallback chain actually delivered each block.
export type EtfSectorsSource = "yahoo" | "fmp" | null;
export type EtfCountriesSource = "fmp" | "yahoo-approx" | null;
export type EtfNewsSource = "finnhub" | "yahoo" | "fmp" | null;

export interface EtfResponse {
  ticker: string;
  found: boolean;
  name?: string;
  family?: string | null;
  category?: string | null;
  fundamentals?: EtfFundamentals;
  assetAllocation?: EtfAllocation[];
  sectors?: EtfSector[];
  sectorsSource?: EtfSectorsSource;
  countries?: EtfCountry[] | null;
  countriesSource?: EtfCountriesSource;
  holdings?: EtfHolding[];
  geoRisks?: EtfGeoRisk[];
  news?: EtfNewsItem[];
  newsSource?: EtfNewsSource;
  fetchedAt: string;
}
