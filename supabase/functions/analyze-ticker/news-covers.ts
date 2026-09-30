// Only publisher pages are fetched. Redirects are checked before every request.
const publishers=['reuters.com','apnews.com','bloomberg.com','ft.com','wsj.com','cnbc.com','marketwatch.com','barrons.com','finance.yahoo.com','businesswire.com','globenewswire.com','prnewswire.com','investors.com'];
export function publisherUrl(value:string):boolean {
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&publishers.some(host=>u.hostname===host||u.hostname.endsWith('.'+host));}catch{return false;}
}
export function photoUrl(value:unknown):string|undefined {
  if(typeof value!=='string'||value.length>4000)return;
  try {const u=new URL(value.replace(/&amp;/g,'&'));if(u.protocol!=='https:'||u.username||u.password)return;
    if(/(?:^|[\/_.-])(logo|favicon|placeholder|default|brand)(?:[\/_.-]|$)/i.test(u.pathname))return;
    return u.href;
  }catch{return;}
}
export function extractCover(html:string,base:string):string|undefined {
  for(const tag of html.match(/<meta\b[^>]*>/gi)??[]) {
    const attrs:Record<string,string>={};
    for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs))attrs[m[1].toLowerCase()]=m[3];
    if(!/^(og:image(?::url)?|twitter:image(?::src)?)$/i.test(attrs.property??attrs.name??''))continue;
    try {const image=photoUrl(new URL(attrs.content,base).href);if(image)return image;}catch{/* malformed metadata */}
  }
}
export async function articleCover(articleUrl:string):Promise<string|undefined> {
  let url=articleUrl;
  const signal=AbortSignal.timeout(6500);
  try {
    for(let hop=0;hop<3;hop++) {
      if(!publisherUrl(url))return;
      const response=await fetch(url,{redirect:'manual',signal,headers:{'Accept':'text/html'}});
      if(response.status>=300&&response.status<400){const next=response.headers.get('location');await response.body?.cancel();if(!next)return;url=new URL(next,url).href;continue;}
      if(!response.ok||!response.headers.get('content-type')?.includes('text/html')){await response.body?.cancel();return;}
      const reader=response.body?.getReader();if(!reader)return;
      const decoder=new TextDecoder();let html='',bytes=0;
      try {while(bytes<512000){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;html+=decoder.decode(chunk.value,{stream:true});if(/<\/head>/i.test(html))break;}}finally{await reader.cancel();}
      return extractCover(html,url);
    }
  }catch{/* Keep the article available when its publisher blocks previews. */}
}
