import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {CreditChart,CurveComparison} from '../components/BondsCreditCharts';
import {creditPeriodLabel,fallbackCurveSnapshot,proxyBase100} from '../lib/bonds-credit-view';
afterEach(cleanup);
it('allows selecting historical lines while keeping at least one series visible',()=>{
 render(<CreditChart label="Prueba" series={[{id:'A',label:'Serie A',unit:'%',source:'',points:[{date:'2026-10-20',value:1}]},{id:'B',label:'Serie B',unit:'%',source:'',points:[{date:'2026-10-20',value:2}]}]}/>);
 const a=screen.getByRole('button',{name:/Serie A/}),b=screen.getByRole('button',{name:/Serie B/});
 fireEvent.click(a);expect(a).toHaveAttribute('aria-pressed','false');
 fireEvent.click(b);expect(b).toHaveAttribute('aria-pressed','true');
 fireEvent.click(a);expect(a).toHaveAttribute('aria-pressed','true');
});
it('preserves the actual snapshot dates when toggling historical curves',()=>{
 render(<CurveComparison snapshots={['current','monthAgo'].map((key,i)=>({key:key as 'current'|'monthAgo',label:i?'Hace un mes':'Última curva',date:i?'2026-09-18':'2026-10-20',points:[{id:'DGS2',label:'2 años',maturityYears:2,value:3+i},{id:'DGS10',label:'10 años',maturityYears:10,value:4+i}]}))}/>);
 const previous=screen.getByRole('button',{name:/Hace un mes.*18 sept 2026/});
 fireEvent.click(previous);expect(previous).toHaveAttribute('aria-pressed','false');
 expect(screen.getByRole('button',{name:/Última curva.*20 oct 2026/})).toHaveAttribute('aria-pressed','true');
});
it('does not create a curve from inconsistent observation dates or normalize zero proxy prices',()=>{
 expect(fallbackCurveSnapshot(['DGS2','DGS10','DGS30'].map((id,i)=>({id,label:id,unit:'%',source:'',points:[{date:`2026-10-${20+i}`,value:i+1}]})))).toEqual([]);
 expect(creditPeriodLabel('2026-02-30')).toBe('Sin fecha');
 expect(proxyBase100([{symbol:'A',label:'A',price:null,date:null,returnsDate:null,return21:null,return63:null,currency:'USD',points:[{date:'2026-10-20',value:0}]}])).toEqual([]);
});
