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
 const dialog=screen.getByRole('dialog');fireEvent.change(within(dialog).getByLabelText('Símbolo del activo'),{target:{value:'^FTSE'}});fireEvent.click(within(dialog).getByRole('button',{name:'Añadir'}));
 await within(dialog).findByText('FTSE 100');expect(api).toHaveBeenCalledWith('validateFeedAsset',{group:'indices',symbol:'^FTSE'});
 fireEvent.click(within(dialog).getByRole('button',{name:'Subir ^FTSE'}));
 fireEvent.click(within(dialog).getByRole('button',{name:'Quitar ^GSPC'}));
 fireEvent.click(within(dialog).getByRole('button',{name:'Guardar'}));
 await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
 const saved=save.mock.calls[0][0] as FeedPreferences;expect(saved.indices).toEqual(['^IXIC','NQ=F','^DJI','^KS11','^N225','^FTSE','^VIX']);expect(saved.etfs).toEqual(defaultFeedPreferences().etfs);
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('keeps a failed verification out of the saved list and keeps failed saves open for retry',async()=>{
 api.mockRejectedValue(new Error('El símbolo no está disponible.'));const save=vi.fn().mockRejectedValue(new Error('No se pudo sincronizar.'));
 render(<FeedGroupEditor group="etfs" preferences={defaultFeedPreferences()} labels={{}} onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'Personalizar etf principales'}));
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
