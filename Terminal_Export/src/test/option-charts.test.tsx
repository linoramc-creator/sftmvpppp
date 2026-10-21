import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {StrikeBarsChart} from '../components/options/StrikeBarsChart';
import type {ChainResponse,OptionContract} from '../types/options';
afterEach(cleanup);
it('keeps the strike-window controls usable when a narrow range has no observations',()=>{
 const data={ticker:'TEST',expiry:'2026-12-18',spot:100,calls:[{strike:120,volume:5,openInterest:10} as OptionContract],puts:[]} as ChainResponse;
 const request=vi.spyOn(globalThis,'fetch');
 render(<StrikeBarsChart data={data} metric="volume"/>);
 fireEvent.click(screen.getByRole('button',{name:'±10%'}));
 expect(screen.getByText(/Sin datos de volumen/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'±25%'}));
 expect(screen.queryByText(/Sin datos de volumen/)).toBeNull();
 expect(screen.getByRole('button',{name:'±25%'})).toHaveAttribute('aria-pressed','true');
 expect(request).not.toHaveBeenCalled();request.mockRestore();
});
