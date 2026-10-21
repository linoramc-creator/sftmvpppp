import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBrief,chartSvg,CHART_COLORS,type ChartSpec} from '../supabase/functions/daily-brief/render.ts';
import {prepareBriefMail} from '../supabase/functions/daily-brief/email.ts';
import {normalizeAsset,type BriefData} from '../supabase/functions/daily-brief/data.ts';

function edition():BriefData{return {date:'2026-10-21',previousDay:'2026-10-20',cutoff:'2026-10-21T05:00:00Z',generatedAt:'2026-10-21T04:58:00Z',preview:true,assets:[],watchlist:[],treasury:[],news:[],politics:[],lead:'Resumen de la sesión previa.',takeaways:[],ai:false,asia:{cutoff:'2026-10-21T05:00:00Z',summary:'La negociación de Asia continúa al corte.',markets:[]}};}

test('Morning Brief has centered institutional branding, native sections and intentional initial state',()=>{
 const html=renderBrief(edition());
 assert.match(html,/<header class="masthead"[^>]+text-align:center/);
 assert.match(html,/<div class="brand"[^>]*>MensorTerminal<\/div><h1[^>]*>Morning Brief<\/h1>/);
 assert.equal((html.match(/<details class="brief-section" data-brief-section/g)??[]).length,8);
 assert.equal((html.match(/data-brief-section open/g)??[]).length,2);
 for(const id of ['asia','resumen'])assert.match(html,new RegExp(`<details class="brief-section" data-brief-section open><summary>[\\s\\S]*?<h2 id="${id}">`));
 for(const id of ['asia','resumen','watchlist','mercados','macro','noticias','politica','entorno'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))??[]).length,1);
 assert.ok(html.includes('data-brief-expand="all"')&&html.includes('data-brief-expand="none"'));
 assert.ok(html.includes('Helvetica Neue')&&!html.includes('Georgia'));
 for(const green of ['#10be78','#09774a','#176448'])assert.ok(!html.includes(green));
 assert.ok(html.includes('::details-content')&&html.includes('content-visibility:visible!important'));
});

test('each interactive document authorizes only its own script and keeps all prose inert',()=>{
 const data=edition();data.lead='<script>alert(1)</script><img src=x onerror=alert(2)>';data.takeaways=[{title:'<svg onload="bad()">',text:'A & B',evidence:[]}];
 const first=renderBrief(data),second=renderBrief(data),nonce=first.match(/<script nonce="([a-f0-9]{32})">/)?.[1];
 assert.ok(nonce);assert.ok(first.includes('nonce-'+nonce));assert.ok(!second.includes('nonce-'+nonce));
 assert.match(first,/http-equiv="Content-Security-Policy"/);assert.ok(first.includes('connect-src &#39;none&#39;'));assert.ok(first.includes('script-src-attr &#39;none&#39;'));assert.ok(first.includes('base-uri &#39;none&#39;'));
 assert.ok(first.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(first.includes('&lt;img src=x onerror=alert(2)&gt;'));assert.ok(first.includes('&lt;svg onload=&quot;bad()&quot;&gt;'));assert.ok(!first.includes('<script>'));
 assert.equal((first.match(/<script\b/g)??[]).length,1);
});

test('static renderer preserves all sections and CID charts without controls, script or collapsed content',()=>{
 const data=edition(),asset={...normalizeAsset('SPY','SPY','ETF',null,0),currency:'USD',date:'2026-10-20',points:[{date:'2026-10-19',value:100},{date:'2026-10-20',value:101}]};
 data.assets=[asset];data.watchlist=[{...asset,group:'Watchlist',volatility:[{date:'2026-10-19',value:12},{date:'2026-10-20',value:13}]}];data.treasury=[{years:2,yield:4,date:'2026-10-20',changeBp:-3},{years:10,yield:4.2,date:'2026-10-20',changeBp:2}];
 const charts:ChartSpec[]=[],html=renderBrief(data,c=>{charts.push(c);return `<img src="cid:${c.id}@terminal" alt="chart"/>`;},{interactive:false});
 assert.ok(!html.includes('<details')&&!html.includes('<script')&&!html.includes('data-brief-expand=')&&!html.includes('data-brief-chart='));
 for(const id of ['asia','resumen','watchlist','mercados','macro','noticias','politica','entorno'])assert.ok(html.includes(`id="${id}"`));
 assert.ok(html.includes('cid:price-market-0@terminal'));assert.ok(html.includes('cid:macro-treasury-change@terminal'));
 assert.equal(charts.find(c=>c.id==='price-market-0')?.unit,'USD');assert.equal(charts.find(c=>c.id==='vol-0')?.unit,'%');assert.equal(charts.find(c=>c.id==='treasury')?.unit,'%');
 assert.equal(charts.find(c=>c.id==='macro-treasury-change')?.kind,'bar');assert.equal(charts.find(c=>c.id==='macro-treasury-change')?.unit,'pb');
 assert.ok(html.includes('data-market-page="1"')&&html.includes('data-market-page="2"'));
});

test('interactive plot captions follow the selected observations rather than fixed full-history extrema',()=>{
 const data=edition();data.assets=[{...normalizeAsset('SPY','SPY','ETF',null,0),points:[{date:'2026-10-19',value:100},{date:'2026-10-20',value:101}]}];
 const html=renderBrief(data);assert.ok(html.includes('data-brief-chart='));assert.ok(!html.includes('class="chart-caption"'));
});

test('email uses the same branding and fully readable static sections',async()=>{
 const mail=await prepareBriefMail(edition());
 assert.equal(mail.subject,'Prueba · MensorTerminal · Morning Brief · 2026-10-21');assert.ok(mail.text.startsWith('MensorTerminal · Morning Brief'));
 assert.ok(mail.html.includes('MensorTerminal')&&mail.html.includes('Morning Brief'));assert.ok(mail.html.includes('style="background:#090b0f;color:#ffffff;text-align:center'));
 assert.ok(!mail.html.includes('<details')&&!mail.html.includes('<script')&&!mail.html.includes('data-brief-chart='));assert.equal(mail.attachments.length,0);
});

test('static macro bars include zero and remain separated for clustered Treasury maturities',()=>{
 const svg=chartSvg({id:'changes',title:'Cambios diarios',points:[{date:'6 meses',value:-2},{date:'1 año',value:3},{date:'2 años',value:1},{date:'20 años',value:-1}],x:[.5,1,2,20],kind:'bar',unit:'pb',color:CHART_COLORS.price});
 const positions=[...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill=/g)].map(match=>({x:Number(match[1]),y:Number(match[2]),width:Number(match[3]),height:Number(match[4])}));
 assert.equal(positions.length,4);assert.ok(positions.every(p=>p.height>0&&Number.isFinite(p.y)));
 for(let i=1;i<positions.length;i++)assert.ok(positions[i].x>positions[i-1].x+positions[i-1].width);
 assert.ok(!svg.includes('NaN')&&!svg.includes('Infinity'));
});
