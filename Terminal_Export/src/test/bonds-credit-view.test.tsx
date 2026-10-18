import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import BondsCreditView,{creditPeriodLabel,proxyBase100} from '../components/BondsCreditView';
import type {BondsCreditPanel,CreditSeries,CreditProxy} from '../../../supabase/functions/analyze-ticker/bonds-credit';
const api=vi.hoisted(()=>vi.fn());vi.mock('@/lib/beta-api',()=>({authenticatedFetch:api}));
const make=(id:string,label:string,value:number):CreditSeries=>({id,label,unit:'%',frequency:'quarterly',currency:'USD',scope:'private-funds',source:'',points:[{date:'2026-01-01',value:value*.99},{date:'2026-04-01',value}]});
function fixture():BondsCreditPanel{
 const countries=[['US','Estados Unidos','USD'],['FR','Francia','EUR'],['DE','Alemania','EUR'],['GB','Reino Unido','GBP']] as const;
 return {fetchedAt:new Date().toISOString(),base:{fetchedAt:new Date().toISOString(),series:[{id:'DGS10',label:'10 años',unit:'%',source:'',points:[{date:'2026-10-15',value:5}]}],etfs:['BND','AGG','SHY','IEF','TLT','TIP','LQD','HYG'].map(symbol=>({symbol,label:'Exposición '+symbol,currency:'USD',price:90,change:1,date:'2026-10-16',points:[],distributionYield:null,expenseRatio:null,assets:null}))},sovereigns:countries.map(([code,name,currency],i)=>({code,name,currency,monthChangeBp:10,yearChangeBp:20,series:{id:code,label:name+' · 10 años',unit:'%',frequency:'monthly',currency,scope:'sovereign',source:'',points:[{date:'2026-08-01',value:3+i},{date:'2026-09-01',value:3.1+i}]}})),sovereignCommonDate:'2026-09-01',sovereignSpreads:countries.map(([code],i)=>({code,value:(i-2)*100})),credit:[make('BOGZ1FL444090000Q','Activos de fondos de deuda privada',935.009),make('BOGZ1FL443067205Q','Préstamos privados · coste',554.107),make('BOGZ1LM443067215Q','Préstamos privados · valor razonable',542.617),make('BOGZ1FL444190005Q','Pasivos de fondos de deuda privada',423.654),make('DRTSCILM','Estándares de crédito',0),make('DRBLACBS','Morosidad bancaria',1.27),make('DRSDCILM','Demanda de préstamos',16.1),{...make('NFCI','Condiciones financieras',-.499),frequency:'weekly'}],privateValuation:make('PRIVATE_FV_COST','Valor razonable frente a coste',-2.07),privateLiabilities:make('PRIVATE_LIABILITIES_ASSETS','Pasivos / activos',45.31),privateGrowth:make('PRIVATE_LOANS_YOY','Crecimiento de préstamos privados',11.4),proxies:[]};
}
it('selects four sovereign countries with an explicit monthly ten-year reference and retains the US daily curve separately',async()=>{
 api.mockResolvedValue({ok:true,json:async()=>fixture()});render(<BondsCreditView/>);
 const select=await screen.findByRole('combobox',{name:'País de deuda soberana'});expect(select.querySelectorAll('option')).toHaveLength(4);
 expect(screen.getByRole('heading',{name:'Curva del Tesoro · Estados Unidos'})).toBeVisible();
 fireEvent.change(select,{target:{value:'FR'}});
 expect(screen.getByRole('heading',{name:'Rendimiento soberano · Francia'})).toBeVisible();expect(screen.getByText('Referencia a 10 años · Media mensual · EUR')).toBeVisible();expect(screen.queryByRole('heading',{name:'Curva del Tesoro · Estados Unidos'})).toBeNull();
 expect(JSON.parse(api.mock.calls.at(-1)![1].body)).toEqual({panel:'bondsCredit'});
});
it('separates real quarterly private-fund figures from banking proxies and preserves all existing bond ETFs',async()=>{
 render(<BondsCreditView/>);await screen.findByRole('combobox',{name:'País de deuda soberana'});
 fireEvent.click(screen.getByRole('button',{name:'Crédito privado'}));
 expect(screen.getByText('Datos reales · Trimestrales')).toBeVisible();expect(screen.getByText('554,1')).toBeVisible();expect(screen.getAllByText(/T2 2026/).length).toBeGreaterThan(0);
 expect(screen.getByLabelText(/no es una tasa de impago/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Condiciones de crédito'}));expect(screen.getByRole('heading',{name:'Morosidad de préstamos empresariales'})).toBeVisible();expect(screen.getByLabelText(/no es una tasa de impago del crédito privado no bancario/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'ETF de renta fija'}));for(const symbol of ['BND','AGG','SHY','IEF','TLT','TIP','LQD','HYG'])expect(screen.getByRole('cell',{name:symbol})).toBeVisible();
});
it('formats quarterly observation dates as quarters and normalizes both proxies at their shared visible base',()=>{
 expect(creditPeriodLabel('2026-04-01','quarterly')).toBe('T2 2026');expect(creditPeriodLabel('2026-07-01','quarterly')).toBe('T3 2026');
 const p=(symbol:string,points:{date:string;value:number}[]):CreditProxy=>({symbol,label:symbol,currency:'USD',price:null,date:null,returnsDate:null,return21:null,return63:null,points});
 const result=proxyBase100([p('BIZD',[{date:'2024-01-01',value:5},{date:'2026-01-01',value:10},{date:'2026-02-01',value:11}]),p('BKLN',[{date:'2026-01-01',value:20},{date:'2026-02-01',value:21}])].map(p=>({...p,points:p.points.filter(v=>v.date>='2025-01-01')})));
 expect(result[0].points[0]).toEqual({date:'2026-01-01',value:100});expect(result[1].points[0]).toEqual({date:'2026-01-01',value:100});expect(result[0].points[1].value).toBeCloseTo(110,10);
});
it('keeps previously loaded data visible when a refresh fails and offers retry',async()=>{
 render(<BondsCreditView/>);await screen.findByRole('combobox',{name:'País de deuda soberana'});api.mockResolvedValue({ok:false});
 fireEvent.click(screen.getByRole('button',{name:'Actualizar bonos y créditos'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('No se han podido actualizar los bonos y el crédito.'));
 expect(screen.getByRole('combobox',{name:'País de deuda soberana'})).toBeVisible();expect(screen.getByRole('button',{name:'Reintentar'})).toBeVisible();
});
