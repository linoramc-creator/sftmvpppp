// Only publisher pages are fetched. Redirects are checked before every request.
const publishers=['reuters.com','apnews.com','bloomberg.com','ft.com','wsj.com','cnbc.com','marketwatch.com','barrons.com','finance.yahoo.com','news.yahoo.com','businesswire.com','globenewswire.com','prnewswire.com','investors.com','bbc.com','bbc.co.uk','theguardian.com','aljazeera.com','euronews.com','federalreserve.gov','foxnews.com','thedailystar.net','seekingalpha.com','axios.com','abcnews.go.com','politico.com','eleconomista.es','eleconomista.com.mx','expansion.com','cincodias.elpais.com','rtve.es','efe.com','dw.com','france24.com','utilitydive.com','industryweek.com'];
export function publisherUrl(value:string):boolean {
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&publishers.some(host=>u.hostname===host||u.hostname.endsWith('.'+host));}catch{return false;}
}
export function photoUrl(value:unknown):string|undefined {
  if(typeof value!=='string'||value.length>4000)return;
  try {const u=new URL(value.replace(/&amp;/g,'&'));if(u.protocol!=='https:'||u.username||u.password)return;
    // Providers often wrap the original image inside an encoded query string.
    let decoded=u.href;for(let i=0;i<3;i++){try{const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next;}catch{break;}}
    if(/logo|favicon|placeholder|default[_\/-]?(?:article|image|\d)|brand[_\/-]|apple-touch-icon|sprite|avatar|masthead|cnbc[^/]*share|social[_-](?:share|card)|profile[_\/-]?image|\/icons?\/|\.svg(?:[?#]|$)/i.test(decoded))return;
    // Yahoo's fallback wordmarks do not contain "logo" and can arrive inside
    // resized/encoded image URLs. Match the branding path/name, not all YF/CDNs.
    if(/\/rz\/stage\/p\/yahoo[^/?#]*|yahoo[_-]finance[_-][^/?#]*[_-][hv][_-]p[_-]finance/i.test(decoded))return;
    return u.href;
  }catch{return;}
}
export function extractCover(html:string,base:string):string|undefined {
  const logoMeta=/(?:property|name)=["']og:image:alt["'][^>]*content=["'][^"']*(?:logo|brand mark)|content=["'][^"']*(?:logo|brand mark)[^"']*["'][^>]*(?:property|name)=["']og:image:alt/i.test(html);
  for(const tag of html.match(/<meta\b[^>]*>/gi)??[]) {
    const attrs:Record<string,string>={};
    for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs))attrs[m[1].toLowerCase()]=m[3];
    const property=attrs.property??attrs.name??'';
    if(!/^(og:image(?::url)?|twitter:image(?::src)?)$/i.test(property)||logoMeta&&property.startsWith('og:'))continue;
    try {const image=photoUrl(new URL(attrs.content,base).href);if(image)return image;}catch{/* malformed metadata */}
  }
  for(const block of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{
      const visit=(value:any,depth=0):string|undefined=>{
        if(!value||depth>8)return;
        if(Array.isArray(value)){for(const item of value){const found=visit(item,depth+1);if(found)return found;}return;}
        if(typeof value!=='object')return;
        const types=Array.isArray(value['@type'])?value['@type']:[value['@type']];
        if(types.some((type:any)=>typeof type==='string'&&/Article|Reportage|BlogPosting/.test(type))){
          const images=Array.isArray(value.image)?value.image:[value.image];
          for(const candidate of images){const raw=typeof candidate==='string'?candidate:candidate?.url??candidate?.contentUrl;try{const found=raw&&photoUrl(new URL(raw,base).href);if(found)return found;}catch{}}
        }
        return visit(value['@graph'],depth+1);
      };
      const found=visit(JSON.parse(block[1]));if(found)return found;
    }catch{/* Other article metadata may still be available. */}
  }
}
export function extractArticleDetails(html:string,base:string):{image?:string;publishedAt?:string;title?:string;excerpt?:string}{
  const details:{image?:string;publishedAt?:string;title?:string;excerpt?:string}={image:extractCover(html,base)};
  const plain=(s:string)=>s.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  for(const tag of html.match(/<meta\b[^>]*>/gi)??[]){
    const attrs:Record<string,string>={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs))attrs[m[1].toLowerCase()]=m[3];
    const property=attrs.property??attrs.name??'';
    if(/^(article:published_time|datePublished|pubdate|publishdate|parsely-pub-date)$/i.test(property)&&Number.isFinite(Date.parse(attrs.content)))details.publishedAt=new Date(attrs.content).toISOString();
    if(property==='og:title')details.title=plain(attrs.content??'').slice(0,500);
    if(/^(description|og:description)$/i.test(property))details.excerpt=plain(attrs.content??'').slice(0,650);
  }
  if(!details.publishedAt){
    for(const block of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{
      const visit=(value:any,depth=0):string|undefined=>{if(!value||depth>8)return;if(Array.isArray(value)){for(const v of value){const found=visit(v,depth+1);if(found)return found;}return;}if(typeof value!=='object')return;
        if(/Article|Reportage|BlogPosting/.test(String(value['@type']))&&typeof value.datePublished==='string'&&Number.isFinite(Date.parse(value.datePublished)))return new Date(value.datePublished).toISOString();return visit(value['@graph'],depth+1);};
      details.publishedAt=visit(JSON.parse(block[1]));if(details.publishedAt)break;
    }catch{/* Only valid publisher metadata is accepted. */}
  }
  return details;
}
export async function articleDetails(articleUrl:string):Promise<ReturnType<typeof extractArticleDetails>|undefined> {
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
      return extractArticleDetails(html,url);
    }
  }catch{/* Keep the article available when its publisher blocks previews. */}
}
export async function articleCover(articleUrl:string):Promise<string|undefined>{return (await articleDetails(articleUrl))?.image;}
