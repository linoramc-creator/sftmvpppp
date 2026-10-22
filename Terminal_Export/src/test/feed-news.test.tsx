import {fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {NewsCards,articleSource} from '../components/FeedCards';
import {FeedView,NewsView} from '../components/MarketPanels';
import type {Article} from '../../../supabase/functions/analyze-ticker/panels';

const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api,accountApi:async()=>({groups:(await import('../../../supabase/functions/analyze-ticker/feed-preferences')).defaultFeedPreferences()})}));
vi.mock('@/components/AuthGate',()=>({useProfile:()=>({id:'feed-news-user'})}));
const story:Article={title:'La empresa amplía su capacidad - Reuters',url:'https://www.reuters.com/business/example',source:'Reuters',date:'2026-10-15',image:'https://images.example.test/economy-factory.jpg',excerpt:'La empresa anunció una nueva fábrica. La inversión asciende a 100 millones.',keyPoints:['La empresa anunció una nueva fábrica.','La inversión asciende a 100 millones.']};

it('presents a cover and key points with one publisher link only at the end of each article',()=>{
 const {container}=render(<NewsCards articles={[story]}/>);
 expect(screen.getByRole('heading',{name:'La empresa amplía su capacidad'})).toBeVisible();
 const points=screen.getByRole('list',{name:'Puntos clave'});
 expect(within(points).getAllByRole('listitem')).toHaveLength(2);
 expect(within(points).getByText('La inversión asciende a 100 millones.')).toBeVisible();
 const link=screen.getByRole('link',{name:'Abrir artículo en Reuters'});
 expect(link).toHaveAttribute('href',story.url);expect(link).toHaveAttribute('target','_blank');expect(link).toHaveAttribute('rel','noopener noreferrer');
 expect(container.querySelectorAll('a')).toHaveLength(1);expect(link.closest('footer')).toBe(container.querySelector('article')!.lastElementChild);
 expect(screen.getByRole('heading',{name:'La empresa amplía su capacidad'}).closest('a')).toBeNull();expect(container.querySelector('img')?.closest('a')).toBeNull();
 expect(container.textContent).not.toContain(story.url);
});

it('keeps a cached article readable when there is no AI summary or usable photo',()=>{
 const cached={...story,keyPoints:undefined,image:'https://images.example.test/company-logo.png'};
 const {container}=render(<NewsCards articles={[cached]} compact/>);
 expect(screen.getByText('La empresa anunció una nueva fábrica.')).toBeVisible();
 expect(container.querySelector('img')).toBeNull();
 expect(screen.getByRole('link',{name:'Abrir artículo en Reuters'})).toBeVisible();
});

it('hides a failed cover while retaining the factual summary',()=>{
 const {container}=render(<NewsCards articles={[story]} compact/>);
 fireEvent.error(container.querySelector('img')!);
 expect(container.querySelector('img')).toBeNull();
 expect(screen.getByText('La inversión asciende a 100 millones.')).toBeVisible();
});

it('uses responsive article cards with a full-width cover and no forced card heights',()=>{
 const {container}=render(<NewsCards articles={[story]} compact/>);
 const card=container.querySelector('article')!,cover=card.querySelector('img')!;
 expect(card).not.toHaveClass('flex');
 expect(card.parentElement).toHaveClass('grid','items-start','grid-cols-1','sm:grid-cols-2');
 expect(cover).toHaveClass('w-full','aspect-[16/9]');
 expect(card).not.toHaveClass('h-full');
 expect(screen.getByRole('list',{name:'Puntos clave'})).toBeVisible();
});

it('avoids duplicate or empty cards and keeps all key points visible without a disclosure',()=>{
 const more={...story,keyPoints:[...story.keyPoints!,'La compañía prevé completar el proyecto durante el próximo ejercicio.']};
 const {container}=render(<NewsCards articles={[more,{...story,url:story.url+'/copy'},{...story,title:'<p></p>',url:story.url+'/empty'}]}/>);
 expect(container.querySelectorAll('article')).toHaveLength(1);
 expect(container.querySelector('article')!.parentElement).toHaveClass('grid','items-start','md:grid-cols-2','xl:grid-cols-3');
 expect(within(screen.getByRole('list',{name:'Puntos clave'})).getAllByRole('listitem')).toHaveLength(3);
 expect(container.querySelector('details')).toBeNull();
 expect(screen.getByText('La compañía prevé completar el proyecto durante el próximo ejercicio.')).toBeVisible();
 expect(container.querySelector('time')).toHaveAttribute('datetime','2026-10-15');
 expect(container.querySelectorAll('a')).toHaveLength(1);
});

it('links to the real publisher without naming the upstream data API',()=>{
 const{container}=render(<NewsCards articles={[{...story,source:'EODHD'},{...story,title:'El mercado analiza la nueva inversión',url:'https://www.cnbc.com/2026/10/15/story.html',source:'FMP'}]}/>);
 expect(screen.getByRole('link',{name:'Abrir artículo en Reuters'})).toHaveAttribute('href',story.url);
 expect(screen.getByRole('link',{name:'Abrir artículo en CNBC'})).toHaveAttribute('href','https://www.cnbc.com/2026/10/15/story.html');
 expect(container.textContent).not.toMatch(/EODHD|FMP/);expect(container.querySelectorAll('a')).toHaveLength(2);
 expect(articleSource({...story,url:'http://safe-news.example/story',source:'Safe News'})).toEqual({url:'http://safe-news.example/story',label:'Safe News'});
 expect(articleSource({...story,source:''})?.label).toBe('Reuters');expect(articleSource({...story,source:story.url})?.label).toBe('Reuters');
 expect(articleSource({...story,url:'https://journal.example/economy',source:'EODHD'})?.label).toBe('journal.example');
});

it.each(['javascript:alert(1)','data:text/html,<script>bad()</script>','file:///private/news.html','https://secret:password@www.reuters.com/story','https://www.reuters.com/story?api_key=private','https://www.reuters.com/story?key=private','https://www.reuters.com/story#token=private','https://api.eodhd.com/api/news','https://query1.finance.yahoo.com/v8/finance/chart/AAPL','https://news.example/api/data','http://localhost:3000/private','http://127.0.0.1/private','https://internal.local/story'])('does not create an unsafe or credential-bearing source link: %s',url=>{
 const{container}=render(<NewsCards articles={[{...story,url}]}/>);
 expect(container.querySelector('a')).toBeNull();expect(screen.getByRole('heading',{name:'La empresa amplía su capacidad'})).toBeVisible();
});

it('opens an earnings asset through the same selection handler as the watchlist',async()=>{
 api.mockImplementation(async(_url:string,init:RequestInit)=>{
  const panel=JSON.parse(init.body as string).panel;
  return {ok:true,json:async()=>panel==='feedMarkets'?{groups:[],treasury:[],earnings:[{symbol:'MSFT',date:'2026-10-20',session:'Después del cierre',eps:3.1}],fetchedAt:'2026-10-15T10:00:00Z'}:{headlines:[],geopolitics:[],fetchedAt:'2026-10-15T10:00:00Z'}};
 });
 const select=vi.fn();
 render(<FeedView stocks={['AAPL']} data={null} onChange={vi.fn()} onSelect={select}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Abrir ficha de MSFT · resultados 2026-10-20'}));
 expect(select).toHaveBeenLastCalledWith('MSFT');
 fireEvent.click(screen.getByRole('button',{name:'Abrir ficha de AAPL'}));
 expect(select).toHaveBeenLastCalledWith('AAPL');
});

it('uses the same article cards and a single source footer for ticker and sector report news',async()=>{
 api.mockResolvedValue({ok:true,json:async()=>({articles:[story],sectorArticles:[{...story,title:'La industria anuncia inversiones',url:story.url+'/sector'}],sectorName:'Industria',articleWindowDays:14,sectorWindowDays:30,fetchedAt:'2026-10-15T10:00:00Z'})});
 const {container}=render(<NewsView subject="NEWS-TEST"/>);
 await screen.findByRole('heading',{name:'La empresa amplía su capacidad'});
 expect(screen.getByRole('tab',{name:'Activo · NEWS-TEST 1'})).toHaveAttribute('aria-selected','true');
 expect(screen.getByText('Últimos 14 días')).toBeVisible();
 expect(screen.queryByRole('heading',{name:'La industria anuncia inversiones'})).toBeNull();
 const active=screen.getByRole('tab',{name:'Activo · NEWS-TEST 1'});active.focus();fireEvent.keyDown(active,{key:'ArrowRight'});
 expect(screen.getByRole('heading',{name:'La industria anuncia inversiones'})).toBeVisible();
 expect(screen.getByRole('tab',{name:'Sector · Industria 1'})).toHaveAttribute('aria-selected','true');
 expect(screen.getByRole('tab',{name:'Sector · Industria 1'})).toHaveFocus();
 expect(screen.getByText('Últimos 30 días')).toBeVisible();
 expect(screen.getAllByRole('list',{name:'Puntos clave'})).toHaveLength(1);
 expect(screen.getByRole('link',{name:'Abrir artículo en Reuters'})).toHaveAttribute('href',story.url+'/sector');expect(container.querySelectorAll('a')).toHaveLength(1);
});

it('opens the category with results and resets the selected scope when the ticker changes',async()=>{
 api.mockImplementation(async(_url:string,init:RequestInit)=>{
  const subject=JSON.parse(init.body as string).subject;
  return{ok:true,json:async()=>({articles:subject==='NEWS-EMPTY'?[]:[{...story,title:'La nueva empresa anuncia crecimiento'}],sectorArticles:[{...story,title:'El sector amplía sus inversiones',url:story.url+'/sector'}],sectorName:'Industria',fetchedAt:'2026-10-15T10:00:00Z'})};
 });
 const{rerender}=render(<NewsView subject="NEWS-EMPTY"/>);
 await screen.findByRole('heading',{name:'El sector amplía sus inversiones'});
 expect(screen.getByRole('heading',{name:'Noticias del sector · Industria'})).toBeVisible();
 expect(screen.queryByRole('tablist')).toBeNull();
 expect(screen.queryByRole('tab',{name:'Activo · NEWS-EMPTY 0'})).toBeNull();
 rerender(<NewsView subject="NEWS-NEW"/>);
 await screen.findByRole('heading',{name:'La nueva empresa anuncia crecimiento'});
 expect(screen.getByRole('tab',{name:'Activo · NEWS-NEW 1'})).toHaveAttribute('aria-selected','true');
 fireEvent.click(screen.getByRole('tab',{name:'Sector · Industria 1'}));
 rerender(<NewsView subject="NEWS-THIRD"/>);
 await screen.findByRole('tab',{name:'Activo · NEWS-THIRD 1'});
 expect(screen.getByRole('tab',{name:'Activo · NEWS-THIRD 1'})).toHaveAttribute('aria-selected','true');
 expect(screen.getByText(/^Actualizado:/)).toBeVisible();
});

it('keeps a no-results panel short and omits malformed dates',async()=>{
 api.mockResolvedValue({ok:true,json:async()=>({articles:[],sectorArticles:[],sectorName:'Industria',fetchedAt:'Invalid'})});
 const{container}=render(<NewsView subject="NEWS-NONE"/>);
 await screen.findByText('No hay noticias relevantes verificadas para este período.');
 expect(screen.queryByRole('tablist')).toBeNull();
 expect(container.querySelector('article')).toBeNull();
 expect(container.textContent).not.toContain('Invalid Date');
});
