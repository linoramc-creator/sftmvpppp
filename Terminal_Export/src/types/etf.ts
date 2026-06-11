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
