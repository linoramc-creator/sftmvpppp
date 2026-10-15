import {fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {NewsCards} from '../components/FeedCards';
import {FeedView,NewsView} from '../components/MarketPanels';
import type {Article} from '../../../supabase/functions/analyze-ticker/panels';

const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
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

it('gives compact news full-width text on a narrow screen and a side thumbnail from sm',()=>{
 const {container}=render(<NewsCards articles={[story]} compact/>);
 const card=container.querySelector('article')!,cover=card.querySelector('img')!;
 expect(card).not.toHaveClass('flex');
 expect(card).toHaveClass('sm:flex');
 expect(cover).toHaveClass('w-full','h-24','sm:w-36');
 expect(screen.getByRole('list',{name:'Puntos clave'})).toBeVisible();
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
 api.mockResolvedValue({ok:true,json:async()=>({articles:[story],sectorArticles:[{...story,title:'La industria anuncia inversiones',url:story.url+'/sector'}],sectorName:'Industria',fetchedAt:'2026-10-15T10:00:00Z'})});
 const {container}=render(<NewsView subject="NEWS-TEST"/>);
 await screen.findByRole('heading',{name:'La empresa amplía su capacidad'});
 expect(screen.getByRole('heading',{name:'La industria anuncia inversiones'})).toBeVisible();
 expect(screen.getAllByRole('list',{name:'Puntos clave'})).toHaveLength(2);
 expect(container.querySelector('a')).toBeNull();
});
