import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import ResearchSummaryView from '../components/research/ResearchSummaryView';
afterEach(cleanup);
it('organizes the executive reading, metrics, risks, catalysts and monitoring without flattening the evidence',()=>{
 render(<ResearchSummaryView text={'## Lectura ejecutiva\n- Negocio recurrente.\n\n## Métricas clave\n- Margen operativo: **-3,25 % TTM · 2026-09-30**.\n\n## Riesgos\n- Presión de costes.\n\n## Catalizadores\n- Publicación de resultados.\n\n## Seguimiento\n- Verificar la rentabilidad.'}/>);
 for(const name of ['Lectura ejecutiva','Métricas clave','Riesgos','Catalizadores','Seguimiento'])expect(screen.getByRole('heading',{name})).toBeVisible();expect(screen.getByText('-3,25 % TTM · 2026-09-30')).toBeVisible();expect(screen.getByText('Presión de costes.')).toBeVisible();
});
it('preserves unstructured legacy summaries and keeps hostile text inert',()=>{render(<ResearchSummaryView text={'Texto conservado <img src=x onerror=alert(1)>'}/>);expect(screen.getByText('Texto conservado <img src=x onerror=alert(1)>')).toBeVisible();expect(document.querySelector('img')).toBeNull();});
