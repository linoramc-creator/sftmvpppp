import type {AnalyticsQuery,AnalyticsResult,AnalyticsSource} from './analytics-types.ts';

/** Bounded, declarative studies. No expressions, generated code or order commands. */
export type LabStudy={id:string;name:string;kind:'comparison'|'scenario'|'analytics';query:AnalyticsQuery;benchmark?:string;weights?:{symbol:string;weight:number}[];cashWeight?:number};
export type LabDefinition={version:1;studies:LabStudy[]};
export type LabAssetMetrics={symbol:string;observations:number;returns:number;from:string|null;to:string|null;priceChange:number|null;volatility:number|null;drawdown:number|null;beta:number|null;correlation:number|null;relativeStrength:number|null;status:'available'|'partial'|'unavailable';notes:string[]};
export type LabScenario={weights:{symbol:string;weight:number;covered:boolean}[];cashWeight:number;coveredWeight:number;concentration:number;effectiveHoldings:number|null;largestWeight:number;annualizedVolatility:number|null;weightedIndividualVolatility:number|null;diversificationBenefit:number|null;observations:number;from:string|null;to:string|null;status:'available'|'partial'|'unavailable';notes:string[]};
export type LabStudyResult={id:string;name:string;kind:LabStudy['kind'];analytics:AnalyticsResult;benchmark:string|null;metrics:LabAssetMetrics[];correlations:{symbols:string[];values:(number|null)[][];observations:number};scenario?:LabScenario;sample:{from:string|null;to:string|null;observations:number;returns:number;annualization:number;minimumRiskReturns:number};methodology:string[];warnings:string[]};
export type LabRun={runId:string;definition:LabDefinition;generatedAt:string;organizedAt?:string;results:LabStudyResult[];status:'complete'|'partial'|'unavailable';warnings:string[]};
export type LabSnapshot={id:string;created_at:string;run:LabRun};
export type LabProjectSummary={id:string;name:string;revision:number;created_at:string;updated_at:string;study_count:number;snapshot_count:number};
export type LabProject=LabProjectSummary&{definition:LabDefinition;snapshots:LabSnapshot[]};
export type LabRunDependencies={now?:number;prices?:import('./analytics-types.ts').AnalyticsDependencies['prices'];fundamentals?:import('./analytics-types.ts').AnalyticsDependencies['fundamentals'];valuation?:import('./analytics-types.ts').AnalyticsDependencies['valuation'];fx?:import('./analytics-types.ts').AnalyticsDependencies['fx'];execute?:(query:AnalyticsQuery,deps:import('./analytics-types.ts').AnalyticsDependencies)=>Promise<AnalyticsResult>};
export type LabSources=AnalyticsSource[];
