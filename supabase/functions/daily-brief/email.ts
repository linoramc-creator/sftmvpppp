import {renderBrief,type ChartSpec} from './render.ts';
import type {BriefData} from './data.ts';
import {Buffer} from 'node:buffer';
const env=(key:string)=>Deno.env.get(key)??'';
export function mailReady(){return !!((env('BRIEF_RESEND_API_KEY')&&env('BRIEF_FROM'))||(env('BRIEF_SMTP_HOST')&&env('BRIEF_SMTP_USER')&&env('BRIEF_SMTP_PASS')&&env('BRIEF_FROM')));}
// Raster charts are embedded as CID attachments. No private watchlist data is
// sent to an external chart-rendering service or placed in public image URLs.
async function rasterChart(chart:ChartSpec):Promise<Uint8Array>{
 const {PNG}=await import('npm:pngjs@7.0.0'),width=760,height=200,padding=12;
 const png=new PNG({width,height,colorType:2});
 const pixel=(x:number,y:number,r:number,g:number,b:number)=>{if(x<0||y<0||x>=width||y>=height)return;const i=(y*width+x)*4;png.data[i]=r;png.data[i+1]=g;png.data[i+2]=b;png.data[i+3]=255;};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixel(x,y,248,250,252);
 for(const y of [50,100,150])for(let x=padding;x<width-padding;x++)if(x%8<3)pixel(x,y,226,232,240);
 const min=Math.min(...chart.points.map(p=>p.value)),max=Math.max(...chart.points.map(p=>p.value)),span=max-min||Math.max(Math.abs(max)*.01,1),left=chart.x?.[0]??0,right=chart.x?.at(-1)??chart.points.length-1;
 const pos=chart.points.map((p,i)=>({x:padding+((chart.x?.[i]??i)-left)/Math.max(right-left,1)*(width-2*padding),y:height-padding-(p.value-min)/span*(height-2*padding)}));
 const color=chart.color.match(/[a-f0-9]{2}/gi)!.map(v=>parseInt(v,16));
 for(let i=1;i<pos.length;i++){const a=pos[i-1],b=pos[i],steps=Math.ceil(Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y))*2);for(let j=0;j<=steps;j++){const x=Math.round(a.x+(b.x-a.x)*j/steps),y=Math.round(a.y+(b.y-a.y)*j/steps);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)pixel(x+dx,y+dy,color[0],color[1],color[2]);}}
 return PNG.sync.write(png,{colorType:2});
}
export async function prepareBriefMail(data:BriefData){
 const charts:ChartSpec[]=[],html=renderBrief(data,chart=>{charts.push(chart);return `<img src="cid:${chart.id}@terminal" alt="${chart.title.replace(/[&<>"']/g,'')}" width="760" style="display:block;width:100%;height:auto"/>`;});
 const attachments=await Promise.all(charts.map(async chart=>({filename:chart.id+'.png',content:await rasterChart(chart),contentType:'image/png',cid:chart.id+'@terminal'})));
 const subject=`${data.preview?'Prueba · ':''}Brief de mercados · ${data.date}`;
 const text=`Brief de mercados · ${data.date}\n\n${data.lead}\n\n${data.takeaways.map(t=>t.title+'\n'+t.text).join('\n\n')}\n\n${data.watchlist.map(a=>a.symbol+'\n'+a.note).join('\n\n')}\n\nAbre la terminal para ver los gráficos y el informe completo: https://sftmvpppp.vercel.app/`;
 return {subject,html,text,attachments};
}
export async function sendBrief(to:string,id:string,data:BriefData):Promise<string>{
 if(!mailReady())throw new Error('MAIL_NOT_CONFIGURED');
 if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(to))throw new Error('MAIL_RECIPIENT_INVALID');
 const {subject,html,text,attachments}=await prepareBriefMail(data),from=env('BRIEF_FROM');
 if(env('BRIEF_RESEND_API_KEY')){
  const base64=(bytes:Uint8Array)=>{let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);};
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env('BRIEF_RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':'brief/'+id},body:JSON.stringify({from,to:[to],subject,html,text,attachments:attachments.map(a=>({filename:a.filename,content:base64(a.content),content_type:a.contentType,content_id:a.cid}))}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error('MAIL_PROVIDER_REJECTED');const body=await r.json();if(typeof body.id!=='string')throw new Error('MAIL_PROVIDER_INVALID');return body.id;
 }
 const {default:nodemailer}=await import('npm:nodemailer@10.1.0'),port=Number(env('BRIEF_SMTP_PORT')||465);
 if(![465,587].includes(port))throw new Error('MAIL_TLS_REQUIRED');
 const transport=nodemailer.createTransport({host:env('BRIEF_SMTP_HOST'),port,secure:port===465,requireTLS:true,auth:{user:env('BRIEF_SMTP_USER'),pass:env('BRIEF_SMTP_PASS')},tls:{rejectUnauthorized:true},connectionTimeout:15000,greetingTimeout:10000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
 try{const result=await transport.sendMail({from,to,subject,html,text,messageId:`<brief-${id}@terminal.local>`,attachments:attachments.map(a=>({...a,content:Buffer.from(a.content)}))});if(!result.accepted?.length)throw new Error('MAIL_PROVIDER_REJECTED');return result.messageId;}finally{transport.close();}
}
