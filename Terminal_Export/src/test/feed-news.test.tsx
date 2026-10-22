import {fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {NewsCards} from '../components/FeedCards';
import {FeedView,NewsView} from '../components/MarketPanels';
import type {Article} from '../../../supabase/functions/analyze-ticker/panels';

const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api,accountApi:async()=>({groups:(await import('../../../supabase/functions/analyze-ticker/feed-preferences')).defaultFeedPreferences()})}));
vi.mock('@/components/AuthGate',()=>({useProfile:()=>({id:'feed-news-user'})}));
const story:Article={title:'La empresa amplía su capacidad - Reuters',url:'https://www.reuters.com/business/example',source:'Reuters',date:'2026-10-15',image:'https://images.example.test/economy-factory.jpg',excerpt:'La empresa anunció una nueva fábrica. La inversión asciende a 100 millones.',keyPoints:['La empresa anunció una nueva fábrica.','La inversión asciende a 100 millones.']};

it('presents article key points without outgoing article links or provider labels',()=>{
 const {container}=render(<NewsCards articles={[story]}/>);
 expect(screen.getByRole('heading',{name:'La empresa amplía su capacidad'})).toBeVisible();
 const points=screen.getByRole('list',{name:'Puntos clave'});
 expect(within(points).getAllByRole('listitem')).toHaveLength(2);
 expect(within(points).getByText('La inversión asciende a 100 millones.')).toBeVisible();
 expect(container.querySelector('a')).toBeNull();
 expect(container.textContent).not.toContain('Reuters');
 expect(container.textContent).not.toContain(story.url);
});

it('keeps a cached article readable when there is no AI summary or usable photo',()=>{
 const cached={...story,keyPoints:undefined,image:'https://images.example.test/company-logo.png'};
 const {container}=render(<NewsCards articles={[cached]} compact/>);
 expect(screen.getByText('La empresa anunció una nueva fábrica.')).toBeVisible();
 expect(container.querySelector('img')).toBeNull();
 expect(container.querySelector('a')).toBeNull();
});

it('hides a failed cover while retaining the factual summary',()=>{
 const {container}=render(<NewsCards articles={[story]} compact/>);
 fireEvent.error(container.querySelector('img')!);
 expect(container.querySelector('img')).toBeNull();
 expect(screen.getByText('La inversión asciende a 100 millones.')).toBeVisible();
});

it('uses natural-height editorial rows and small side thumbnails without reserving empty image space',()=>{
 const {container}=render(<NewsCards articles={[story]} compact/>);
 const card=container.querySelector('article')!,cover=card.querySelector('img')!;
 expect(card).toHaveClass('flex','items-start');
 expect(card.parentElement).toHaveClass('space-y-3');
 expect(cover).toHaveClass('w-24','h-20','sm:w-36');
 expect(card).not.toHaveClass('h-full');
 expect(screen.getByRole('list',{name:'Puntos clave'})).toBeVisible();
});

it('avoids duplicate or empty cards and shows long summaries through an optional disclosure',()=>{
 const more={...story,keyPoints:[...story.keyPoints!,'La compañía prevé completar el proyecto durante el próximo ejercicio.']};
 const {container}=render(<NewsCards articles={[more,{...story,url:story.url+'/copy'},{...story,title:'<p></p>',url:story.url+'/empty'}]}/>);
 expect(container.querySelectorAll('article')).toHaveLength(1);
 expect(container.querySelector('article')!.parentElement).toHaveClass('columns-1','md:columns-2');
 expect(container.querySelector('article')).toHaveClass('break-inside-avoid');
 expect(within(screen.getByRole('list',{name:'Puntos clave'})).getAllByRole('listitem')).toHaveLength(2);
 const details=container.querySelector('details')!;
 expect(details).not.toHaveAttribute('open');
 fireEvent.click(screen.getByText('Más contexto'));
 expect(details).toHaveAttribute('open');
 expect(screen.getByText('La compañía prevé completar el proyecto durante el próximo ejercicio.')).toBeVisible();
 expect(container.querySelector('time')).toHaveAttribute('datetime','2026-10-15');
 expect(container.querySelector('a')).toBeNull();
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

it('uses the same nonclickable summaries for ticker and sector report news',async()=>{
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
 expect(container.querySelector('a')).toBeNull();
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
