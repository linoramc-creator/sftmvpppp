import {render,screen,waitFor,fireEvent,act,cleanup} from '@testing-library/react';
import {BrowserRouter,MemoryRouter} from 'react-router-dom';
import {useEffect} from 'react';
import {useTerminalEntry,type TerminalEntry} from '@/lib/terminal-entry';
import AuthGate from '@/components/AuthGate';
const fake=vi.hoisted(()=>({getSession:vi.fn(),signInWithPassword:vi.fn(),signUp:vi.fn(),updateUser:vi.fn(),setSession:vi.fn(),signOut:vi.fn(),access:vi.fn(),onAuthStateChange:vi.fn()}));
vi.mock('@/lib/access-code-api',async()=>({...await vi.importActual('@/lib/access-code-api'),accessCodeApi:fake.access}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:fake},isPasswordRecovery:false}));
beforeEach(()=>{vi.clearAllMocks();fake.access.mockReset();fake.access.mockRejectedValue(new Error('Código incorrecto.'));fake.signOut.mockResolvedValue({error:null});fake.getSession.mockResolvedValue({data:{session:null}});fake.onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe:vi.fn()}}});fake.signInWithPassword.mockResolvedValue({data:{session:null},error:{status:400}});fake.signUp.mockResolvedValue({data:{session:null},error:{status:400}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
async function open(){render(<BrowserRouter><AuthGate><p>Private terminal</p></AuthGate></BrowserRouter>);await screen.findByRole('button',{name:'Entrar a la terminal'});}
const privateCode='MNSR-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';
it('offers only a personal code for normal entry and never signs in with the retired password flow',async()=>{
 await open();expect(screen.queryByLabelText('E-mail')).toBeNull();expect(screen.queryByLabelText('Contraseña')).toBeNull();
 fireEvent.change(screen.getByLabelText('Código personal'),{target:{value:privateCode}});fireEvent.click(screen.getByRole('button',{name:'Entrar a la terminal'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Código incorrecto');expect(fake.access).toHaveBeenCalledExactlyOnceWith('login',{code:privateCode});expect(fake.signInWithPassword).not.toHaveBeenCalled();expect(screen.queryByText('Private terminal')).toBeNull();
});
it('requires creating and saving a private code for registration without an email/password signup',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:/^Crear cuenta$/}));
 fireEvent.change(screen.getByLabelText('Nombre'),{target:{value:'María'}});fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'person@example.test'}});
 expect(screen.getByRole('button',{name:'Crear cuenta y entrar'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Generar código'}));
 const code=(screen.getByLabelText('Código personal nuevo') as HTMLInputElement).value;expect(code).toMatch(/^MNSR-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
 expect(screen.getByRole('button',{name:'Crear cuenta y entrar'})).toBeDisabled();fireEvent.click(screen.getByRole('checkbox',{name:'He guardado mi código en un lugar seguro.'}));fireEvent.click(screen.getByRole('button',{name:'Crear cuenta y entrar'}));
 await waitFor(()=>expect(fake.access).toHaveBeenCalledExactlyOnceWith('register',{code,email:'person@example.test',name:'María'},''));expect(fake.signUp).not.toHaveBeenCalled();
});
it('uses the old credentials only for first activation and never exposes private content during setup',async()=>{
 fake.access.mockResolvedValueOnce({bootstrapToken:'legacy-setup-token'}).mockRejectedValueOnce(new Error('No se pudo activar.'));
 await open();fireEvent.click(screen.getByRole('button',{name:'Activar mi código'}));fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'person@example.test'}});fireEvent.change(screen.getByLabelText('Contraseña actual'),{target:{value:'old-password-123'}});fireEvent.click(screen.getByRole('button',{name:'Comprobar cuenta'}));
 expect(await screen.findByRole('button',{name:'Generar código'})).toBeVisible();expect(fake.access).toHaveBeenNthCalledWith(1,'bootstrap',{email:'person@example.test',password:'old-password-123'});
 expect(fake.setSession).not.toHaveBeenCalled();expect(screen.queryByText('Private terminal')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Generar código'}));const code=(screen.getByLabelText('Código personal nuevo') as HTMLInputElement).value;fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Activar y entrar'}));await screen.findByRole('alert');expect(fake.access).toHaveBeenNthCalledWith(2,'activate',{code},'legacy-setup-token');
});
it('starts the existing complete-feed welcome only after a successful code session is established',async()=>{
 const session={access_token:'code-session',user:{id:'person-id',user_metadata:{display_name:'María'}}};fake.access.mockResolvedValue({access_token:'code-session',refresh_token:'refresh'});fake.setSession.mockResolvedValue({data:{session},error:null});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'person-id',email:'person@example.test',displayName:'María',isAdmin:false})}));
 await open();fireEvent.change(screen.getByLabelText('Código personal'),{target:{value:privateCode}});fireEvent.click(screen.getByRole('button',{name:'Entrar a la terminal'}));
 expect(await screen.findByRole('dialog')).toHaveTextContent('Bienvenido, María');expect(fake.setSession).toHaveBeenCalledExactlyOnceWith({access_token:'code-session',refresh_token:'refresh'});expect(screen.queryByRole('button',{name:'Open market'})).toBeNull();
});
it('returns expired code grants to code entry instead of a permanently failed welcome',async()=>{
 signedIn();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:401,json:async()=>({error:'Introduce tu código personal.'})}));render(<MemoryRouter><AuthGate><p>Private terminal</p></AuthGate></MemoryRouter>);
 expect(await screen.findByLabelText('Código personal')).toBeVisible();expect(fake.signOut).toHaveBeenCalledWith({scope:'local'});expect(screen.queryByText('Private terminal')).toBeNull();
});
it('does not let an old profile response sign out a newly established code session',async()=>{
 const session=signedIn();let finish!:(value:unknown)=>void;const request=vi.fn().mockReturnValueOnce(new Promise(resolve=>finish=resolve)).mockResolvedValue({ok:true,json:async()=>({id:'person-id',email:'person@example.test',isAdmin:false})});vi.stubGlobal('fetch',request);
 render(<MemoryRouter><AuthGate><p>Private terminal</p></AuthGate></MemoryRouter>);await waitFor(()=>expect(request).toHaveBeenCalled());
 await act(async()=>fake.onAuthStateChange.mock.calls[0][0]('TOKEN_REFRESHED',{...session,access_token:'new-code-session'}));
 await act(async()=>finish({ok:false,status:401,json:async()=>({error:'Old token'})}));expect(fake.signOut).not.toHaveBeenCalled();
});
function ReadyFeed(){const entry=useTerminalEntry();useEffect(()=>{if(entry)entry.report(entry.sessionId,entry.attempt,{status:'ready',detail:'Feed listo.'});},[entry?.sessionId,entry?.attempt]);return <button>Open market</button>;}
function signedIn(){const session={access_token:'test-session',user:{id:'person-id',user_metadata:{display_name:'María'}}};fake.getSession.mockResolvedValue({data:{session}});vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'person-id',email:'person@example.test',displayName:'María',isAdmin:false})}));return session;}
it('keeps one branded welcome mounted through session, profile and feed preparation without the blue access screen',async()=>{
 const session=signedIn();let restoreSession!:(value:unknown)=>void,restoreProfile!:(value:unknown)=>void;
 fake.getSession.mockReturnValue(new Promise(resolve=>{restoreSession=resolve;}));
 vi.stubGlobal('fetch',vi.fn().mockReturnValue(new Promise(resolve=>{restoreProfile=resolve;})));
 await act(async()=>{render(<MemoryRouter><AuthGate><ReadyFeed/></AuthGate></MemoryRouter>);});
 const welcome=screen.getByRole('dialog');expect(welcome).toHaveTextContent('MensorTerminal');expect(document.querySelector('.auth-page')).toBeNull();
 await act(async()=>restoreSession({data:{session}}));
 expect(screen.getByRole('dialog')).toBe(welcome);expect(welcome).toHaveTextContent('Bienvenido, María');expect(document.querySelector('.auth-intro')).toBeNull();
 await act(async()=>restoreProfile({ok:true,json:async()=>({id:'person-id',email:'person@example.test',displayName:'María',isAdmin:false})}));
 expect(screen.getByRole('dialog')).toBe(welcome);expect(document.querySelector('.auth-card')).toBeNull();
});
it('keeps failed access checks in the branded welcome without a continue action or private content',async()=>{
 signedIn();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({error:'Tu acceso está revocado.'})}));
 render(<MemoryRouter><AuthGate><p>Private terminal</p></AuthGate></MemoryRouter>);
 expect(await screen.findByText('Tu acceso está revocado.')).toBeVisible();expect(screen.getByRole('button',{name:'Reintentar'})).toBeEnabled();
 expect(screen.queryByRole('button',{name:'Continuar con lo disponible'})).toBeNull();expect(screen.queryByText('Private terminal')).toBeNull();expect(document.querySelector('.auth-page')).toBeNull();
});
it('waits for feed readiness and the minimum greeting, then never replays on profile or token refresh',async()=>{
 const session=signedIn();vi.useFakeTimers();let channel:TerminalEntry|null=null;
 function Feed(){channel=useTerminalEntry();return <button>Open market</button>;}
 await act(async()=>{render(<MemoryRouter><AuthGate><Feed/></AuthGate></MemoryRouter>);});
 expect(screen.getByRole('dialog')).toHaveTextContent('Bienvenido, María');
 expect(screen.queryByRole('button',{name:'Open market'})).not.toBeInTheDocument();
 expect(screen.getByText('Open market')).toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTime(5000));expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>channel!.report(channel!.sessionId,channel!.attempt,{status:'ready',detail:'Feed listo.'}));
 await act(async()=>vi.advanceTimersByTime(0));await act(async()=>vi.advanceTimersByTime(380));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Open market'})).toBeEnabled();
 await act(async()=>window.dispatchEvent(new Event('beta-access-check')));
 await act(async()=>fake.onAuthStateChange.mock.calls[0][0]('TOKEN_REFRESHED',{...session,access_token:'refreshed-session'}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('keeps a failed feed covered until an explicit action and ignores readiness from an older retry',async()=>{
 signedIn();vi.useFakeTimers();let channel:TerminalEntry|null=null;
 function Feed(){channel=useTerminalEntry();return <p>Feed behind overlay</p>;}
 await act(async()=>{render(<MemoryRouter><AuthGate><Feed/></AuthGate></MemoryRouter>);});
 const old=channel!;
 await act(async()=>old.report(old.sessionId,old.attempt,{status:'error',detail:'Las noticias no están disponibles.'}));
 expect(screen.getByRole('dialog')).toHaveTextContent('Las noticias no están disponibles.');
 await act(async()=>vi.advanceTimersByTime(10000));expect(screen.getByRole('dialog')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));expect(channel!.attempt).toBe(1);
 await act(async()=>old.report(old.sessionId,old.attempt,{status:'ready'}));
 await act(async()=>vi.advanceTimersByTime(3000));expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>channel!.report(channel!.sessionId,channel!.attempt,{status:'error',detail:'Fallo de red.'}));
 fireEvent.click(screen.getByRole('button',{name:'Continuar con lo disponible'}));
 await act(async()=>vi.advanceTimersByTime(380));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('uses a bounded loading timeout with explicit recovery rather than opening a partial feed',async()=>{
 signedIn();vi.useFakeTimers();await act(async()=>{render(<MemoryRouter><AuthGate><p>Pending feed</p></AuthGate></MemoryRouter>);});
 await act(async()=>vi.advanceTimersByTime(90000));expect(screen.getByRole('dialog')).toHaveTextContent('La carga está tardando');expect(screen.getByRole('button',{name:'Reintentar'})).toBeEnabled();
});
it('opens the administrator workspace after the complete feed without the retired portfolio gate',async()=>{
 signedIn();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'person-id',email:'linoramc@gmail.com',displayName:'María',isAdmin:true})}));vi.useFakeTimers();let channel:TerminalEntry|null=null;
 function Workspace(){channel=useTerminalEntry();return <button>Workspace disponible</button>;}
 await act(async()=>{render(<MemoryRouter><AuthGate><Workspace/></AuthGate></MemoryRouter>);});
 expect(channel!.portfolioRequired).toBe(false);
 await act(async()=>channel!.report(channel!.sessionId,channel!.attempt,{status:'error',detail:'Retired module'},'portfolio'));
 expect(screen.getByRole('dialog')).not.toHaveTextContent('Retired module');
 await act(async()=>vi.advanceTimersByTime(6000));expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>channel!.report(channel!.sessionId,channel!.attempt,{status:'ready'},'feed'));
 await act(async()=>vi.advanceTimersByTime(0));await act(async()=>vi.advanceTimersByTime(380));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('button',{name:'Workspace disponible'})).toBeEnabled();
});
it('does not require or accept a private portfolio gate for a different account',async()=>{
 signedIn();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'person-id',email:'other@example.test',isAdmin:true})}));vi.useFakeTimers();let channel:TerminalEntry|null=null;
 function Workspace(){channel=useTerminalEntry();return <p>Workspace</p>;}
 await act(async()=>{render(<MemoryRouter><AuthGate><Workspace/></AuthGate></MemoryRouter>);});expect(channel!.portfolioRequired).toBe(false);
 await act(async()=>channel!.report(channel!.sessionId,channel!.attempt,{status:'error',detail:'Privado'},'portfolio'));
 await act(async()=>channel!.report(channel!.sessionId,channel!.attempt,{status:'ready'},'feed'));
 await act(async()=>vi.advanceTimersByTime(3500));await act(async()=>vi.advanceTimersByTime(380));expect(screen.queryByRole('dialog')).toBeNull();
});
it('respects reduced motion and sanitizes the greeting while keeping the 3.5 second minimum',async()=>{
 const session=signedIn();session.user.user_metadata.display_name='<img src=x onerror=alert(1)>';
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'person-id',email:'existing.person@example.test',displayName:'<script>danger</script>',isAdmin:false})}));
 const media=vi.spyOn(window,'matchMedia').mockImplementation(query=>({matches:true,media:query,onchange:null,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:vi.fn()}));
 try{vi.useFakeTimers();await act(async()=>{render(<MemoryRouter><AuthGate><ReadyFeed/></AuthGate></MemoryRouter>);});expect(screen.getByRole('dialog')).toHaveTextContent('Bienvenido, existing person');expect(document.querySelectorAll('img')).toHaveLength(1);expect(document.querySelector('img')).toHaveAttribute('src','/mensor-icon.png?v=2');expect(document.querySelector('[onerror]')).toBeNull();
 await act(async()=>vi.advanceTimersByTime(3499));expect(screen.getByRole('dialog')).toBeInTheDocument();
 await act(async()=>vi.advanceTimersByTime(1));await act(async()=>vi.advanceTimersByTime(0));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 }finally{media.mockRestore();}
});
it('opens direct administration without waiting for a feed that is not mounted',async()=>{
 signedIn();await act(async()=>{render(<MemoryRouter initialEntries={['/admin']}><AuthGate><p>Administration</p></AuthGate></MemoryRouter>);});expect(screen.getByText('Administration')).toBeVisible();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
