import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {FeedGroupEditor} from '../components/FeedGroupEditor';
import {useFeedPreferences} from '../hooks/use-feed-preferences';
import {defaultFeedPreferences,type FeedPreferences} from '../../../supabase/functions/analyze-ticker/feed-preferences';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/beta-api',()=>({accountApi:api}));
afterEach(cleanup);
beforeEach(()=>{api.mockReset();});

it('verifies additions, supports ordering and removal, then saves the whole personal selection',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);
 api.mockResolvedValue({symbol:'^FTSE',label:'FTSE 100'});
 render(<FeedGroupEditor group="indices" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));
 const dialog=screen.getByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Quitar SPX'}));fireEvent.change(within(dialog).getByLabelText('Símbolo del activo'),{target:{value:'^FTSE'}});fireEvent.click(within(dialog).getByRole('button',{name:'Elegir'}));
 await within(dialog).findByRole('button',{name:'Quitar FTSE'});expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'indices',symbol:'^FTSE'});
 fireEvent.click(within(dialog).getByRole('button',{name:'Subir FTSE'}));
 fireEvent.click(within(dialog).getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
 const saved=save.mock.calls[0][0] as FeedPreferences;expect(saved.indices).toEqual(['^IXIC','NQ=F','^DJI','^KS11','^N225','^FTSE','^VIX']);expect(saved.etfs).toEqual(defaultFeedPreferences().etfs);
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('uses research symbols in selected rows and suggestions but verifies and saves the original instrument IDs',async()=>{
 const value={...defaultFeedPreferences(),indices:['^GSPC','^N225']},save=vi.fn().mockResolvedValue(undefined);api.mockResolvedValue({symbol:'^IXIC',label:'Nasdaq Composite'});
 render(<FeedGroupEditor group="indices" preferences={value} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));
 const list=screen.getByRole('list',{name:'Activos del recuadro'});expect(within(list).getByText('SPX')).toBeVisible();expect(within(list).getByText('NKY')).toBeVisible();expect(within(list).queryByText('^N225')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Elegir IXIC'}));await screen.findByRole('button',{name:'Quitar IXIC'});expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'indices',symbol:'^IXIC'});
 fireEvent.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(save).toHaveBeenCalledWith({...value,indices:['^GSPC','^N225','^IXIC']}));
});
it('keeps a failed verification out of the saved list and keeps failed saves open for retry',async()=>{
 api.mockRejectedValue(new Error('El símbolo no está disponible.'));const save=vi.fn().mockRejectedValue(new Error('No se pudo sincronizar.'));
 render(<FeedGroupEditor group="etfs" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Personalizar etf principales'}));
 fireEvent.click(screen.getByRole('button',{name:'Quitar TLT'}));
 fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'NOTETF'}});fireEvent.click(screen.getByRole('button',{name:'Elegir'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('El símbolo no está disponible.');expect(screen.queryByRole('button',{name:'Quitar NOTETF'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('No se pudo sincronizar.'));expect(screen.getByRole('dialog')).toBeVisible();
});
it('restores only the edited group before saving and preserves changes in other groups',async()=>{
 const value={...defaultFeedPreferences(),indices:['^FTSE'],etfs:['QQQM']},save=vi.fn().mockResolvedValue(undefined);
 render(<FeedGroupEditor group="indices" preferences={value} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));fireEvent.click(screen.getByRole('button',{name:'Restablecer selección'}));fireEvent.click(screen.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith({...value,indices:defaultFeedPreferences().indices}));
});
function PreferencesProbe({owner}:{owner:string}){
 const state=useFeedPreferences(owner);return <><span>{state.ready?state.groups.indices.join(','):'loading'}</span>{state.error&&<p role="alert">{state.error}</p>}<button onClick={()=>void state.save({...state.groups,indices:['^FTSE']})}>Save personal</button><button onClick={state.retry}>Retry load</button></>;
}
it('loads and saves server preferences and clears the selection when the account changes',async()=>{
 let resolveSecond:(value:any)=>void=()=>{};const first={...defaultFeedPreferences(),indices:['^N225']};let owner='first';
 api.mockImplementation((action:string,body:any)=>action==='saveFeedPreferences'?Promise.resolve({groups:body.groups}):owner==='first'?Promise.resolve({groups:first}):new Promise(resolve=>resolveSecond=resolve));
 const view=render(<PreferencesProbe owner={owner}/>);await screen.findByText('^N225');fireEvent.click(screen.getByText('Save personal'));await screen.findByText('^FTSE');expect(api).toHaveBeenCalledWith('saveFeedPreferences',{groups:{...first,indices:['^FTSE']}});
 owner='second';view.rerender(<PreferencesProbe owner={owner}/>);expect(screen.getByText('loading')).toBeVisible();expect(screen.queryByText('^FTSE')).toBeNull();
 await act(async()=>resolveSecond({groups:{...defaultFeedPreferences(),indices:['^DJI']}}));expect(screen.getByText('^DJI')).toBeVisible();
});
it('keeps suggestions enabled at seven ETF and requires a verified explicit replacement before saving',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);api.mockResolvedValue({symbol:'QQQM',label:'Nasdaq 100 ETF'});
 render(<FeedGroupEditor group="etfs" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar etf principales'}));
 const dialog=screen.getByRole('dialog'),input=within(dialog).getByLabelText('Símbolo del activo');expect(input).toBeEnabled();expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
 fireEvent.change(input,{target:{value:'QQQM'}});expect(within(dialog).getByRole('button',{name:'Elegir QQQM'})).toBeEnabled();expect(within(dialog).getByText('Recuadro completo. Elige un activo nuevo para sustituir uno.')).toBeVisible();expect(api).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Elegir QQQM'}));const target=await within(dialog).findByRole('combobox',{name:'Activo que vas a sustituir'});
 expect(api).toHaveBeenCalledTimes(1);expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'etfs',symbol:'QQQM'});expect(within(dialog).queryByRole('button',{name:'Quitar QQQM'})).toBeNull();expect(within(dialog).getByRole('button',{name:'Guardar'})).toBeDisabled();expect(within(dialog).getByRole('button',{name:'Sustituir'})).toBeDisabled();expect(save).not.toHaveBeenCalled();
 fireEvent.change(target,{target:{value:'SPY'}});fireEvent.click(within(dialog).getByRole('button',{name:'Sustituir'}));expect(within(dialog).getByRole('button',{name:'Quitar QQQM'})).toBeVisible();expect(within(dialog).queryByRole('button',{name:'Quitar SPY'})).toBeNull();expect(save).not.toHaveBeenCalled();
 expect(within(dialog).getByLabelText('Activos seleccionados')).toHaveTextContent('7 / 7');fireEvent.click(within(dialog).getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(save.mock.calls[0][0].etfs).toEqual(['QQQM',...defaultFeedPreferences().etfs.slice(1)]);
});
it('replaces a manually entered ETF in the exact chosen slot without permitting an eighth asset',async()=>{
 const value={...defaultFeedPreferences(),etfs:defaultFeedPreferences().etfs.slice(0,7)},save=vi.fn().mockResolvedValue(undefined);api.mockResolvedValue({symbol:'GLD',label:'Oro · GLD'});
 render(<FeedGroupEditor group="etfs" preferences={value} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar etf principales'}));
 expect(screen.getByLabelText('Activos seleccionados')).toHaveTextContent('7 / 7');fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'gld'}});fireEvent.click(screen.getByRole('button',{name:'Elegir'}));
 const target=await screen.findByRole('combobox',{name:'Activo que vas a sustituir'});expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'etfs',symbol:'GLD'});fireEvent.change(target,{target:{value:'TLT'}});fireEvent.click(screen.getByRole('button',{name:'Sustituir'}));expect(screen.getByLabelText('Activos seleccionados')).toHaveTextContent('7 / 7');
 fireEvent.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(save).toHaveBeenCalledWith({...value,etfs:[...value.etfs.slice(0,6),'GLD']}));
});
it('finds IBEX by its country name and allows an explicit replacement in a full index basket',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);api.mockResolvedValue({symbol:'^IBEX',label:'IBEX 35 · España'});
 render(<FeedGroupEditor group="indices" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));
 expect(screen.getByLabelText('Activos seleccionados')).toHaveTextContent('7 / 7');fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'España'}});expect(screen.getByRole('button',{name:'Elegir IBEX35'})).toBeEnabled();expect(api).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Elegir IBEX35'}));const target=await screen.findByRole('combobox',{name:'Activo que vas a sustituir'});expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'indices',symbol:'^IBEX'});fireEvent.change(target,{target:{value:'^GSPC'}});fireEvent.click(screen.getByRole('button',{name:'Sustituir'}));fireEvent.click(screen.getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith({...defaultFeedPreferences(),indices:['^IBEX',...defaultFeedPreferences().indices.slice(1)]}));
});
it('normalizes typed currency pairs and rejects alias duplicates without provider calls',async()=>{
 const value={...defaultFeedPreferences(),currencies:['EURUSD=X','BTC-USD']};api.mockResolvedValue({symbol:'JPY=X',label:'USD/JPY'});
 render(<FeedGroupEditor group="currencies" preferences={value} labels={{}} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar divisas y activos digitales'}));
 fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'EUR/USD'}});fireEvent.click(screen.getByRole('button',{name:'Elegir'}));expect(screen.getByRole('alert')).toHaveTextContent('ya está');expect(api).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'USDJPY'}});fireEvent.click(screen.getByRole('button',{name:'Elegir'}));await screen.findByRole('button',{name:'Quitar USDJPY'});expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'currencies',symbol:'JPY=X'});
});
it('presents SGX iron as FEF and uses its internal settlement identifier only in the verified request',async()=>{
 const value={...defaultFeedPreferences(),commodities:['GC=F','CL=F']},save=vi.fn().mockResolvedValue(undefined);api.mockResolvedValue({symbol:'SGX-IODEX',label:'Hierro · Nov-26'});
 render(<FeedGroupEditor group="commodities" preferences={value} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar materias primas'}));
 fireEvent.click(screen.getByRole('button',{name:'Elegir FEF'}));await screen.findByRole('button',{name:'Quitar FEF'});expect(screen.queryByText('SGX-IODEX')).toBeNull();expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'commodities',symbol:'SGX-IODEX'});
 fireEvent.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(save.mock.calls[0][0].commodities).toEqual(['GC=F','WTI-SPOT','SGX-IODEX']);
});
it('cannot add a response for another ticker or revive an addition after the editor was closed',async()=>{
 let resolve:(value:any)=>void=()=>{};api.mockImplementation(()=>new Promise(done=>resolve=done));const value={...defaultFeedPreferences(),indices:['^GSPC']};
 render(<FeedGroupEditor group="indices" preferences={value} labels={{}} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));
 fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'FTSE'}});fireEvent.click(screen.getByRole('button',{name:'Elegir'}));fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));
 await act(async()=>resolve({symbol:'^FTSE',label:'FTSE 100'}));expect(screen.queryByRole('button',{name:'Quitar FTSE'})).toBeNull();
 api.mockResolvedValue({symbol:'^DJI',label:'Wrong asset'});fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'FTSE'}});fireEvent.click(screen.getByRole('button',{name:'Elegir'}));await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Quitar DJI'})).toBeNull();
});
function FullPreferencesProbe(){const state=useFeedPreferences('legacy-reader');return <p>{state.ready?JSON.stringify(state.groups):'loading'}</p>;}
it('reads old three-group settings preserving the first seven choices and their order without silently saving',async()=>{
 const legacy={indices:['^FTSE','^N225'],etfs:['VTI','QQQ','SPY','IWM','GLD','TLT','EFA','HYG'],currencies:['EUR=X','BTC-USD']};api.mockResolvedValue({groups:legacy});
 render(<FullPreferencesProbe/>);const expected={...legacy,etfs:legacy.etfs.slice(0,7),commodities:defaultFeedPreferences().commodities};expect(await screen.findByText(JSON.stringify(expected))).toBeVisible();expect(api).toHaveBeenCalledTimes(1);expect(api).not.toHaveBeenCalledWith('saveFeedPreferences',expect.anything());
});
it('leaves a saved seven-ETF default-shaped selection unchanged on future reads',async()=>{
 const saved={...defaultFeedPreferences(),etfs:defaultFeedPreferences().etfs.slice(0,7)};api.mockResolvedValue({groups:saved});render(<FullPreferencesProbe/>);
 expect(await screen.findByText(JSON.stringify(saved))).toBeVisible();expect(api).toHaveBeenCalledTimes(1);expect(api).not.toHaveBeenCalledWith('saveFeedPreferences',expect.anything());
});
it('cancels a verified replacement without removing any existing asset or saving',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);api.mockResolvedValue({symbol:'QQQM',label:'Nasdaq 100 · QQQM'});
 render(<FeedGroupEditor group="etfs" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar etf principales'}));fireEvent.click(screen.getByRole('button',{name:'Elegir QQQM'}));await screen.findByRole('combobox',{name:'Activo que vas a sustituir'});
 fireEvent.click(screen.getByRole('button',{name:'Cancelar sustitución'}));expect(screen.queryByRole('combobox',{name:'Activo que vas a sustituir'})).toBeNull();expect(screen.getByRole('button',{name:'Quitar SPY'})).toBeVisible();expect(screen.queryByRole('button',{name:'Quitar QQQM'})).toBeNull();expect(screen.getByLabelText('Activos seleccionados')).toHaveTextContent('7 / 7');expect(save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(save).toHaveBeenCalledWith(defaultFeedPreferences()));
});
it('discards a confirmed draft replacement when the dialog is cancelled',async()=>{
 const save=vi.fn();api.mockResolvedValue({symbol:'QQQM',label:'Nasdaq 100 · QQQM'});render(<FeedGroupEditor group="etfs" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar etf principales'}));fireEvent.click(screen.getByRole('button',{name:'Elegir QQQM'}));const target=await screen.findByRole('combobox',{name:'Activo que vas a sustituir'});fireEvent.change(target,{target:{value:'SPY'}});fireEvent.click(screen.getByRole('button',{name:'Sustituir'}));expect(screen.getByRole('button',{name:'Quitar QQQM'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));fireEvent.click(screen.getByRole('button',{name:'Personalizar etf principales'}));expect(screen.getByRole('button',{name:'Quitar SPY'})).toBeVisible();expect(screen.queryByRole('button',{name:'Quitar QQQM'})).toBeNull();expect(save).not.toHaveBeenCalled();
});
it('normalizes a full-basket FX replacement and preserves all other positions',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);api.mockResolvedValue({symbol:'EURJPY=X',label:'EUR/JPY'});render(<FeedGroupEditor group="currencies" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar divisas y activos digitales'}));fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'eur/jpy'}});fireEvent.click(screen.getByRole('button',{name:'Elegir'}));const target=await screen.findByRole('combobox',{name:'Activo que vas a sustituir'});expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'currencies',symbol:'EURJPY=X'});fireEvent.change(target,{target:{value:'CAD=X'}});fireEvent.click(screen.getByRole('button',{name:'Sustituir'}));expect(screen.getByLabelText('Activos seleccionados')).toHaveTextContent('7 / 7');fireEvent.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(save).toHaveBeenCalledWith({...defaultFeedPreferences(),currencies:defaultFeedPreferences().currencies.map(symbol=>symbol==='CAD=X'?'EURJPY=X':symbol)}));
});
it('keeps a full basket intact when verification fails and makes retry available',async()=>{
 api.mockRejectedValue(new Error('El índice no está disponible.'));const save=vi.fn();render(<FeedGroupEditor group="indices" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));fireEvent.click(screen.getByRole('button',{name:'Elegir IBEX35'}));expect(await screen.findByRole('alert')).toHaveTextContent('El índice no está disponible.');expect(screen.queryByRole('combobox',{name:'Activo que vas a sustituir'})).toBeNull();expect(screen.getByRole('button',{name:'Quitar SPX'})).toBeEnabled();expect(screen.getByLabelText('Activos seleccionados')).toHaveTextContent('7 / 7');expect(screen.getByRole('button',{name:'Elegir IBEX35'})).toBeEnabled();expect(save).not.toHaveBeenCalled();
});
it('keeps a replacement draft after a save failure and retries the same ordered selection',async()=>{
 const save=vi.fn().mockRejectedValueOnce(new Error('No se pudo guardar.')).mockResolvedValue(undefined);api.mockResolvedValue({symbol:'^IBEX',label:'IBEX 35'});render(<FeedGroupEditor group="indices" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));fireEvent.click(screen.getByRole('button',{name:'Elegir IBEX35'}));const target=await screen.findByRole('combobox',{name:'Activo que vas a sustituir'});fireEvent.change(target,{target:{value:'^VIX'}});fireEvent.click(screen.getByRole('button',{name:'Sustituir'}));fireEvent.click(screen.getByRole('button',{name:'Guardar'}));expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar.');expect(screen.getByRole('button',{name:'Quitar IBEX35'})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);expect(save.mock.calls[1][0].indices).toHaveLength(7);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('exposes European and Asian references by name without querying providers during search',()=>{
 render(<FeedGroupEditor group="indices" preferences={defaultFeedPreferences()} labels={{}} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));expect(screen.getByRole('region',{name:'Populares y de referencia'})).toBeVisible();fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'Alemania'}});expect(screen.getByRole('button',{name:'Elegir DAX'})).toBeVisible();fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'China'}});const suggestions=screen.getByRole('group',{name:'Sugerencias de activos'});expect(within(suggestions).getAllByRole('button')).toHaveLength(3);expect(within(suggestions).getByText('Shanghai Composite · China')).toBeVisible();expect(api).not.toHaveBeenCalled();
});
