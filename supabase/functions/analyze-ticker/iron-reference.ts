import type { SessionQuote } from './feed-quotes.ts';

/** SGX IODEX was rebased to 61% Fe for expiries from January 2026. */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const clean = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
const positive = (value: string) => /^\d[\d,]*(?:\.\d+)?$/.test(value) && Number(value.replace(/,/g, '')) > 0 ? Number(value.replace(/,/g, '')) : null;
const unavailable = (): SessionQuote => ({symbol:'SGX-IODEX',label:'Hierro · IODEX',price:null,change:null,date:null,currency:'USD',unit:'USD/t seca',session:'closed',at:null,delaySeconds:null,priceKind:'quote',reference:null,timezone:'Asia/Singapore'});

export function parseIronSettlement(html: string, expectedDate: string, now = Date.now()): SessionQuote | null {
  if (html.length > 1000000 || !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) return null;
  const stamp = clean(html.slice(0, 6000)).match(/DSPs as at \w+, (\w+) (\d{1,2}), (\d{4})/i);
  if (!stamp) return null;
  const month = MONTHS.findIndex(m => stamp[1].startsWith(m));
  const date = `${stamp[3]}-${String(month + 1).padStart(2,'0')}-${stamp[2].padStart(2,'0')}`;
  const at = Date.UTC(+stamp[3], month, +stamp[2], 9, 30); // Official 17:30 SGT daily settlement.
  if (month < 0 || date !== expectedDate || at > now || now - at > 10 * 86400000) return null;
  const start = html.indexOf('SGX IRON ORE (IODEX) DERIVATIVES');
  if (start < 0 || +stamp[3] < 2026) return null;
  const section = html.slice(start).split(/SGX MB IRON ORE 65% DERIVATIVES|SGX IRON ORE \(MB 65%\) DERIVATIVES/i)[0];
  const candidates = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(row => {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => clean(cell[1]));
    const contract = cells[0]?.match(/^([A-Z][a-z]{2})-(\d{2})$/);
    if (!contract || cells.length < 9) return [];
    const contractMonth = MONTHS.indexOf(contract[1]), year = 2000 + +contract[2];
    if (contractMonth < 0 || year * 12 + contractMonth < +stamp[3] * 12 + month || year * 12 + contractMonth > +stamp[3] * 12 + month + 60) return [];
    const price = positive(cells[1]), previous = positive(cells[2]), volume = positive(cells[7]);
    // Volume is the exchange's total FUTURES contracts column, never options or NLT alone.
    return price && previous && volume ? [{contract:cells[0], price, previous, volume}] : [];
  }).sort((a,b) => b.volume - a.volume);
  const selected = candidates[0];
  if (!selected) return null;
  return {...unavailable(),label:`Hierro · IODEX · ${selected.contract}`,price:selected.price,change:(selected.price / selected.previous - 1) * 100,date,reference:'previous-close'};
}

export async function ironReferenceQuote(now = Date.now()): Promise<SessionQuote> {
  // Reports are public, bounded and server-side. Weekends/holidays roll back to a
  // dated settlement; a broken schema never becomes an invented quote.
  const local = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  for (let back = 0; back < 6; back++) {
    const date = new Date(`${local}T00:00:00Z`);date.setUTCDate(date.getUTCDate()-back);
    if ([0,6].includes(date.getUTCDay())) continue;
    const day = date.toISOString().slice(0,10);
    const name = `${date.getUTCDate()}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
    const url = `https://api2.sgx.com/sites/default/files/reports/settlement-prices/${day.slice(0,4)}/${day.slice(5,7)}/wcm%40sgx_en%40iron_dsp%40${name}%40Iron_Ore_DSP_%28T_Volume_Only%29.html`;
    try {
      const response = await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});
      if (!response.ok || Number(response.headers.get('content-length')) > 1000000) continue;
      const quote = parseIronSettlement(await response.text(),day,now);
      if (quote) return quote;
    } catch { /* Try only the next bounded official report date. */ }
  }
  return unavailable();
}
