/** A personal access credential with 128 random bits, never a short numeric PIN. */
export function normalizeAccessCode(value:unknown):string|null{
 if(typeof value!=='string'||value.length>100)return null;
 const compact=value.trim().toUpperCase().replace(/[\s-]/g,'');
 return /^MNSR[A-F0-9]{32}$/.test(compact)&&new Set(compact.slice(4)).size>=8?compact:null;
}
export function generateAccessCode():string{
 for(;;){const raw='MNSR'+[...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();if(normalizeAccessCode(raw))return 'MNSR-'+raw.slice(4).match(/.{4}/g)!.join('-');}
}
