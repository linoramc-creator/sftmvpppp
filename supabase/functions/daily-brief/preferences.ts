import {PRIMARY_REPORT_MODEL} from '../analyze-ticker/report-models.ts';
export const BRIEF_MODEL=PRIMARY_REPORT_MODEL;
export const BRIEF_OUTPUT_TOKENS=10000;
export const BRIEF_ZONE='Europe/Madrid';
export function deliveryTime(value:unknown):string|null{return typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)?value:null;}
export function briefId(value:unknown):value is string{return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}
export function editionDate(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00Z'))&&new Date(value+'T12:00Z').toISOString().slice(0,10)===value;}
