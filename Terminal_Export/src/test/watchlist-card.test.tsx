import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WatchlistCard} from '../components/WatchlistCard';

afterEach(cleanup);
const six=['AAPL','MSFT','NVDA','SPY','QQQ','URTH'];
function Controlled({initial=six}:{initial?:string[]}){
 const [stocks,setStocks]=useState(initial);
 return <WatchlistCard stocks={stocks} data={null} onChange={setStocks} onSelect={()=>{}}/>;
}
it('adds a seventh class-share ticker without replacing the existing selection and blocks an eighth',()=>{
 render(<Controlled/>);
 fireEvent.change(screen.getByRole('textbox',{name:'Ticker para la watchlist'}),{target:{value:' brk-b '}});
 fireEvent.click(screen.getByRole('button',{name:'Añadir'}));
 for(const symbol of [...six,'BRK-B'])expect(screen.getByRole('button',{name:`Abrir ficha de ${symbol}`})).toBeVisible();
 expect(screen.getByText('7/7')).toBeVisible();expect(screen.getByRole('textbox')).toBeDisabled();expect(screen.getByRole('button',{name:'Añadir'})).toBeDisabled();
 expect(screen.queryByLabelText('Añadir activos habituales')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Quitar BRK-B'}));
 expect(screen.getByRole('textbox')).toBeEnabled();expect(screen.getByText('6/7')).toBeVisible();
 for(const symbol of six)expect(screen.getByRole('button',{name:`Abrir ficha de ${symbol}`})).toBeVisible();
});
it('offers one-click stock and ETF additions while keeping selected symbols out of the shortcuts',()=>{
 const onChange=vi.fn();render(<WatchlistCard stocks={['AAPL']} data={null} onChange={onChange} onSelect={()=>{}}/>);
 expect(screen.queryByRole('button',{name:'Añadir AAPL a la watchlist'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Añadir GOOGL a la watchlist'}));expect(onChange).toHaveBeenLastCalledWith(['AAPL','GOOGL']);
 fireEvent.click(screen.getByRole('button',{name:'Añadir QQQ a la watchlist'}));expect(onChange).toHaveBeenLastCalledWith(['AAPL','QQQ']);
});
it('rejects duplicates and malformed symbols without changing the saved selection',()=>{
 const onChange=vi.fn();render(<WatchlistCard stocks={['AAPL']} data={null} onChange={onChange} onSelect={()=>{}}/>);
 const input=screen.getByRole('textbox');
 fireEvent.change(input,{target:{value:' aapl '}});fireEvent.click(screen.getByRole('button',{name:'Añadir'}));
 expect(screen.getByRole('alert')).toHaveTextContent('Ese activo ya está en tu lista.');
 fireEvent.change(input,{target:{value:'BRK/B'}});fireEvent.click(screen.getByRole('button',{name:'Añadir'}));
 expect(screen.getByRole('alert')).toHaveTextContent('Introduce un ticker válido.');expect(onChange).not.toHaveBeenCalled();
});
