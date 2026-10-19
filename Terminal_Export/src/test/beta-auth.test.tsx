import {render,screen,waitFor,fireEvent,act,cleanup} from '@testing-library/react';
import {BrowserRouter,MemoryRouter} from 'react-router-dom';
import {useEffect} from 'react';
import {useTerminalEntry,type TerminalEntry} from '@/lib/terminal-entry';
import AuthGate from '@/components/AuthGate';
const fake=vi.hoisted(()=>({getSession:vi.fn(),signInWithPassword:vi.fn(),signUp:vi.fn(),updateUser:vi.fn(),onAuthStateChange:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:fake},isPasswordRecovery:false}));
beforeEach(()=>{vi.clearAllMocks();fake.getSession.mockResolvedValue({data:{session:null}});fake.onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe:vi.fn()}}});fake.signInWithPassword.mockResolvedValue({data:{session:null},error:{status:400}});fake.signUp.mockResolvedValue({data:{session:null},error:{status:400}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
async function open(){render(<BrowserRouter><AuthGate><p>Private terminal</p></AuthGate></BrowserRouter>);await screen.findByRole('button',{name:'Entrar a la terminal'});}
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
it('keeps the terminal private and submits email/password login',async()=>{
 await open();expect(screen.queryByText('Private terminal')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'Person@example.com'}});
 fireEvent.change(screen.getByLabelText('Contraseña',{exact:true}),{target:{value:'long-password-123'}});
 fireEvent.click(screen.getByRole('button',{name:'Entrar a la terminal'}));
 await waitFor(()=>expect(fake.signInWithPassword).toHaveBeenCalledWith({email:'person@example.com',password:'long-password-123'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('E-mail o contraseña incorrectos');
 expect(fake.signUp).not.toHaveBeenCalled();
});
it('requires matching passwords before signup',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'No tengo cuenta · Registrarme'}));
 fireEvent.change(screen.getByLabelText('Nombre'),{target:{value:'María O’Neill'}});
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'person@example.com'}});
 fireEvent.change(screen.getByLabelText('Contraseña',{exact:true}),{target:{value:'long-password-123'}});
 fireEvent.change(screen.getByLabelText('Repetir contraseña'),{target:{value:'different-password'}});
 fireEvent.click(screen.getByRole('button',{name:'Crear cuenta'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('no coinciden');expect(fake.signUp).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Repetir contraseña'),{target:{value:'long-password-123'}});
 fireEvent.click(screen.getByRole('button',{name:'Crear cuenta'}));
 await waitFor(()=>expect(fake.signUp).toHaveBeenCalledWith({email:'person@example.com',password:'long-password-123',options:{data:{display_name:'María O’Neill'}}}));
});
it('rejects unsafe registration names before sending signup metadata',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'No tengo cuenta · Registrarme'}));
 fireEvent.change(screen.getByLabelText('Nombre'),{target:{value:'<img src=x onerror=alert(1)>'}});
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'person@example.com'}});
 for(const label of ['Contraseña','Repetir contraseña'])fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value:'long-password-123'}});
 fireEvent.click(screen.getByRole('button',{name:'Crear cuenta'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Escribe tu nombre');expect(fake.signUp).not.toHaveBeenCalled();
});
it('recovers the submit button after a network failure',async()=>{
 fake.signInWithPassword.mockRejectedValue(new Error('network'));await open();
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'person@example.com'}});
 fireEvent.change(screen.getByLabelText('Contraseña',{exact:true}),{target:{value:'long-password-123'}});
 fireEvent.click(screen.getByRole('button',{name:'Entrar a la terminal'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar');expect(screen.getByRole('button',{name:'Entrar a la terminal'})).toBeEnabled();
});
it('opens password recovery without exposing the terminal and preserves the account',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'existing-owner',email:'owner@example.test',isAdmin:true})}));
 fake.updateUser.mockResolvedValue({error:null});
 try {
  await open();
  await act(async()=>fake.onAuthStateChange.mock.calls[0][0]('PASSWORD_RECOVERY',{access_token:'test-session'}));
  expect(await screen.findByRole('heading',{name:'Establecer nueva contraseña'})).toBeInTheDocument();
  expect(screen.queryByText('Private terminal')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Contraseña',{exact:true}),{target:{value:'new-password-12345'}});
  fireEvent.change(screen.getByLabelText('Repetir contraseña'),{target:{value:'new-password-12345'}});
  fireEvent.click(screen.getByRole('button',{name:'Guardar contraseña'}));
  await waitFor(()=>expect(fake.updateUser).toHaveBeenCalledWith({password:'new-password-12345'}));
  expect(await screen.findByText('Private terminal')).toBeInTheDocument();
  expect(fake.signUp).not.toHaveBeenCalled();
 } finally {vi.unstubAllGlobals();}
});
