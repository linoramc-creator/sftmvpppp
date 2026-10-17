import {render,screen,waitFor,fireEvent,act,cleanup} from '@testing-library/react';
import {BrowserRouter} from 'react-router-dom';
import AuthGate from '@/components/AuthGate';
const fake=vi.hoisted(()=>({getSession:vi.fn(),signInWithPassword:vi.fn(),signUp:vi.fn(),updateUser:vi.fn(),onAuthStateChange:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:fake},isPasswordRecovery:false}));
beforeEach(()=>{vi.clearAllMocks();fake.getSession.mockResolvedValue({data:{session:null}});fake.onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe:vi.fn()}}});fake.signInWithPassword.mockResolvedValue({data:{session:null},error:{status:400}});fake.signUp.mockResolvedValue({data:{session:null},error:{status:400}});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
async function open(){render(<BrowserRouter><AuthGate><p>Private terminal</p></AuthGate></BrowserRouter>);await screen.findByRole('button',{name:'Entrar a la terminal'});}
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
it('greets by name once while keeping the terminal usable and does not replay after profile or token refresh',async()=>{
 const session={access_token:'test-session',user:{id:'person-id',user_metadata:{display_name:'María'}}};
 fake.getSession.mockResolvedValue({data:{session}});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'person-id',email:'person@example.test',displayName:'María',isAdmin:false})}));
 render(<BrowserRouter><AuthGate><button>Open market</button></AuthGate></BrowserRouter>);
 expect(await screen.findByText('Bienvenido, María')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Open market'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Omitir bienvenida'}));
 expect(screen.queryByLabelText('Bienvenida a la terminal')).not.toBeInTheDocument();
 await act(async()=>window.dispatchEvent(new Event('beta-access-check')));
 await act(async()=>fake.onAuthStateChange.mock.calls[0][0]('TOKEN_REFRESHED',{...session,access_token:'refreshed-session'}));
 expect(screen.queryByText('Bienvenido, María')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Open market'})).toBeEnabled();
});
it('dismisses the entry welcome without animation events under reduced motion and sanitizes old account names',async()=>{
 const session={access_token:'test-session',user:{id:'person-id',user_metadata:{display_name:'<img src=x onerror=alert(1)>'}}};
 fake.getSession.mockResolvedValue({data:{session}});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'person-id',email:'existing.person@example.test',displayName:'<script>danger</script>',isAdmin:false})}));
 const media=vi.spyOn(window,'matchMedia').mockImplementation(query=>({matches:true,media:query,onchange:null,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:vi.fn()}));
 try{
  vi.useFakeTimers();
  await act(async()=>{render(<BrowserRouter><AuthGate><button>Open market</button></AuthGate></BrowserRouter>);});
  expect(screen.getByText('Bienvenido, existing person')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByRole('button',{name:'Open market'})).toBeEnabled();
  await act(async()=>vi.advanceTimersByTime(1400));
  expect(screen.queryByLabelText('Bienvenida a la terminal')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Open market'})).toBeEnabled();
 }finally{media.mockRestore();}
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
