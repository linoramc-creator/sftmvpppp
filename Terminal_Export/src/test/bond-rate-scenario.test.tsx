import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import BondRateScenario from '../components/BondRateScenario';
import {bondRateEstimate,bondRateScenario} from '../lib/bond-rate-scenario';

it('uses modified duration and basis-point conversion without implying a live bond price',()=>{
 expect(bondRateEstimate(5,100)).toBe(-5);expect(bondRateEstimate(5,-50)).toBe(2.5);expect(bondRateEstimate(0,200)).toBe(0);
 for(const [d,bp] of [[NaN,25],[5,Infinity],[-1,50],[31,50],[5,201]])expect(bondRateEstimate(d,bp)).toBeNull();
 const points=bondRateScenario(5,75);expect(points.find(p=>p.shock===75)?.change).toBe(-3.75);expect(points.find(p=>p.shock===0)?.change).toBe(0);
});
it('updates the scenario and leaves an empty input unavailable instead of silently treating it as zero',()=>{
 render(<BondRateScenario/>);expect(screen.getByLabelText('Resultado del escenario de tipos')).toHaveTextContent('-2,50 %');
 fireEvent.change(screen.getByLabelText('Cambio del rendimiento en puntos básicos'),{target:{value:'-100'}});expect(screen.getByLabelText('Resultado del escenario de tipos')).toHaveTextContent('+5,00 %');
 fireEvent.change(screen.getByLabelText('Duración modificada en años'),{target:{value:''}});expect(screen.getByRole('alert')).toBeVisible();expect(screen.getByLabelText('Resultado del escenario de tipos')).toHaveTextContent('—');
});
