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
 const dialog=screen.getByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Quitar ^GSPC'}));fireEvent.change(within(dialog).getByLabelText('Símbolo del activo'),{target:{value:'^FTSE'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir'}));
 await within(dialog).findByRole('button',{name:'Quitar ^FTSE'});expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'indices',symbol:'^FTSE'});
 fireEvent.click(within(dialog).getByRole('button',{name:'Subir ^FTSE'}));
 fireEvent.click(within(dialog).getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
 const saved=save.mock.calls[0][0] as FeedPreferences;expect(saved.indices).toEqual(['^IXIC','NQ=F','^DJI','^KS11','^N225','^FTSE','^VIX']);expect(saved.etfs).toEqual(defaultFeedPreferences().etfs);
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('keeps a failed verification out of the saved list and keeps failed saves open for retry',async()=>{
 api.mockRejectedValue(new Error('El símbolo no está disponible.'));const save=vi.fn().mockRejectedValue(new Error('No se pudo sincronizar.'));
 render(<FeedGroupEditor group="etfs" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Personalizar etf principales'}));
 fireEvent.click(screen.getByRole('button',{name:'Quitar TLT'}));
 fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'NOTETF'}});fireEvent.click(screen.getByRole('button',{name:'Añadir'}));
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
it('keeps ticker search and suggestions available at seven, then validates a one-click addition after an explicit removal',async()=>{
 const save=vi.fn().mockResolvedValue(undefined);api.mockResolvedValue({symbol:'QQQM',label:'Nasdaq 100 ETF'});
 render(<FeedGroupEditor group="etfs" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar etf principales'}));
 const dialog=screen.getByRole('dialog'),input=within(dialog).getByLabelText('Símbolo del activo');expect(input).toBeEnabled();expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
 fireEvent.change(input,{target:{value:'QQQM'}});expect(within(dialog).getByRole('button',{name:'Añadir QQQM'})).toBeDisabled();expect(within(dialog).getByText('Quita un activo para añadir otro.')).toBeVisible();expect(api).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Quitar SPY'}));fireEvent.click(within(dialog).getByRole('button',{name:'Añadir QQQM'}));
 await within(dialog).findByRole('button',{name:'Quitar QQQM'});expect(api).toHaveBeenCalledTimes(1);expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'etfs',symbol:'QQQM'});
 expect(within(dialog).getByLabelText('Activos seleccionados')).toHaveTextContent('7 / 7');fireEvent.click(within(dialog).getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(save.mock.calls[0][0].etfs).toEqual([...defaultFeedPreferences().etfs.slice(1),'QQQM']);
});
it('normalizes typed currency pairs and rejects alias duplicates without provider calls',async()=>{
 const value={...defaultFeedPreferences(),currencies:['EURUSD=X','BTC-USD']};api.mockResolvedValue({symbol:'JPY=X',label:'USD/JPY'});
 render(<FeedGroupEditor group="currencies" preferences={value} labels={{}} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar divisas y activos digitales'}));
 fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'EUR/USD'}});fireEvent.click(screen.getByRole('button',{name:'Añadir'}));expect(screen.getByRole('alert')).toHaveTextContent('ya está');expect(api).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'USDJPY'}});fireEvent.click(screen.getByRole('button',{name:'Añadir'}));await screen.findByRole('button',{name:'Quitar JPY=X'});expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'currencies',symbol:'JPY=X'});
});
it('presents SGX iron as FEF and uses its internal settlement identifier only in the verified request',async()=>{
 const value={...defaultFeedPreferences(),commodities:['GC=F','CL=F']},save=vi.fn().mockResolvedValue(undefined);api.mockResolvedValue({symbol:'SGX-IODEX',label:'Hierro · Nov-26'});
 render(<FeedGroupEditor group="commodities" preferences={value} labels={{}} onSave={save}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar materias primas'}));
 fireEvent.click(screen.getByRole('button',{name:'Añadir FEF'}));await screen.findByRole('button',{name:'Quitar FEF'});expect(screen.queryByText('SGX-IODEX')).toBeNull();expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'commodities',symbol:'SGX-IODEX'});
 fireEvent.click(screen.getByRole('button',{name:'Guardar'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(save.mock.calls[0][0].commodities).toEqual(['GC=F','CL=F','SGX-IODEX']);
});
it('cannot add a response for another ticker or revive an addition after the editor was closed',async()=>{
 let resolve:(value:any)=>void=()=>{};api.mockImplementation(()=>new Promise(done=>resolve=done));const value={...defaultFeedPreferences(),indices:['^GSPC']};
 render(<FeedGroupEditor group="indices" preferences={value} labels={{}} onSave={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));
 fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'FTSE'}});fireEvent.click(screen.getByRole('button',{name:'Añadir'}));fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));fireEvent.click(screen.getByRole('button',{name:'Personalizar índices'}));
 await act(async()=>resolve({symbol:'^FTSE',label:'FTSE 100'}));expect(screen.queryByRole('button',{name:'Quitar ^FTSE'})).toBeNull();
 api.mockResolvedValue({symbol:'^DJI',label:'Wrong asset'});fireEvent.change(screen.getByLabelText('Símbolo del activo'),{target:{value:'FTSE'}});fireEvent.click(screen.getByRole('button',{name:'Añadir'}));await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Quitar ^DJI'})).toBeNull();
});
function FullPreferencesProbe(){const state=useFeedPreferences('legacy-reader');return <p>{state.ready?JSON.stringify(state.groups):'loading'}</p>;}
it('reads old three-group settings without losing the chosen order or custom assets',async()=>{
 const legacy={indices:['^FTSE','^N225'],etfs:['VTI','QQQ','SPY','IWM','GLD','TLT','EFA','HYG'],currencies:['EUR=X','BTC-USD']};api.mockResolvedValue({groups:legacy});
 render(<FullPreferencesProbe/>);const expected={...legacy,etfs:legacy.etfs.slice(0,7),commodities:defaultFeedPreferences().commodities};expect(await screen.findByText(JSON.stringify(expected))).toBeVisible();expect(api).toHaveBeenCalledTimes(1);expect(api).not.toHaveBeenCalledWith('saveFeedPreferences',expect.anything());
});
