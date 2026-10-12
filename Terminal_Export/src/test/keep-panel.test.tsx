import {fireEvent,render,screen} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {useEffect,useState} from 'react';
import KeepPanel,{usePanelActive} from '../components/KeepPanel';
it('mounts on first visit and retains searches and results while switching sections',()=>{
 const mount=vi.fn(),unmount=vi.fn();
 function Search(){const [value,setValue]=useState(''),[result,setResult]=useState('');useEffect(()=>{mount();return unmount;},[]);return <><input aria-label="Activo" value={value} onChange={e=>setValue(e.target.value)}/><button onClick={()=>setResult(value)}>Buscar</button><p>{result}</p></>;}
 const {rerender}=render(<KeepPanel active={false}><Search/></KeepPanel>);expect(mount).not.toHaveBeenCalled();
 rerender(<KeepPanel active><Search/></KeepPanel>);fireEvent.change(screen.getByLabelText('Activo'),{target:{value:'AAPL'}});fireEvent.click(screen.getByText('Buscar'));
 rerender(<KeepPanel active={false}><Search/></KeepPanel>);expect(screen.getByText('AAPL')).not.toBeVisible();expect(unmount).not.toHaveBeenCalled();
 rerender(<KeepPanel active><Search/></KeepPanel>);expect(screen.getByLabelText('Activo')).toHaveValue('AAPL');expect(screen.getByText('AAPL')).toBeVisible();expect(mount).toHaveBeenCalledTimes(1);
});
it('pauses nested panels when their containing route is hidden',()=>{
 function Activity(){return <span>{usePanelActive()?'activo':'pausado'}</span>;}
 const {rerender}=render(<KeepPanel active><KeepPanel active><Activity/></KeepPanel></KeepPanel>);
 expect(screen.getByText('activo')).toBeVisible();
 rerender(<KeepPanel active={false}><KeepPanel active><Activity/></KeepPanel></KeepPanel>);
 expect(screen.getByText('pausado')).not.toBeVisible();
 rerender(<KeepPanel active><KeepPanel active><Activity/></KeepPanel></KeepPanel>);
 expect(screen.getByText('activo')).toBeVisible();
});
