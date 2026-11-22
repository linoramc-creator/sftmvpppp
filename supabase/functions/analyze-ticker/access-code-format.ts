/** Chosen PINs stay strings so that leading zeroes are preserved. */
export function normalizeAccessCode(value:unknown):string|null{
 return typeof value==='string'&&/^\d{5}$/.test(value.trim())?value.trim():null;
}
/** Old random credentials are accepted solely to migrate to the chosen PIN. */
export function normalizeLegacyAccessCode(value:unknown):string|null{
 if(typeof value!=='string'||value.length>100)return null;
 const compact=value.trim().toUpperCase().replace(/[\s-]/g,'');
 return /^MNSR[A-F0-9]{32}$/.test(compact)&&new Set(compact.slice(4)).size>=8?compact:null;
}
export function generateAccessCode():string{
 for(;;){const raw='MNSR'+[...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();if(normalizeLegacyAccessCode(raw))return 'MNSR-'+raw.slice(4).match(/.{4}/g)!.join('-');}
}
