import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {IndexSparkline} from '../components/charts/IndexCharts';
afterEach(cleanup);
it('changes the visible historical range and its summary locally while preserving the quoted session metrics',()=>{
 const start=Date.parse('2026-01-01T12:00Z')/1000,candle={t:Array.from({length:100},(_,i)=>start+i*86400),c:Array.from({length:100},(_,i)=>200+i)};
 const request=vi.spyOn(globalThis,'fetch');
 render(<IndexSparkline label="Índice de prueba" symbol="TEST" price={299} change1d={.5} change1m={7} candle={candle}/>);
 fireEvent.click(screen.getByRole('button',{name:'1M'}));
 expect(screen.getByRole('button',{name:'1M'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByText('269,00')).toBeVisible();
 expect(screen.getByText('+7,00%')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Todo'}));
 expect(screen.getByText('200,00')).toBeVisible();
 expect(request).not.toHaveBeenCalled();request.mockRestore();
});
it('does not turn a missing closing price into a false market minimum',()=>{
 render(<IndexSparkline label="Divisa" symbol="EURUSD=X" price={1.08421} change1d={null} change1m={null} candle={{t:[1700000000,1700086400,1700172800],c:[1.08,null,1.08421]}}/>);
 expect(screen.getByText('1,08000')).toBeVisible();
 expect(screen.queryByText('0,00000')).toBeNull();
});
