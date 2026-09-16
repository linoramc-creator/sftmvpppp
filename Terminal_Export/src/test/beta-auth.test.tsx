import {render,screen,waitFor,fireEvent} from '@testing-library/react';
import {BrowserRouter} from 'react-router-dom';
import AuthGate from '@/components/AuthGate';
const fake=vi.hoisted(()=>({getSession:vi.fn(),signInWithPassword:vi.fn(),signUp:vi.fn(),onAuthStateChange:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:fake}}));
beforeEach(()=>{vi.clearAllMocks();fake.getSession.mockResolvedValue({data:{session:null}});fake.onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe:vi.fn()}}});fake.signInWithPassword.mockResolvedValue({data:{session:null},error:{status:400}});fake.signUp.mockResolvedValue({data:{session:null},error:{status:400}});});
async function open(){render(<BrowserRouter><AuthGate><p>Private terminal</p></AuthGate></BrowserRouter>);await screen.findByRole('button',{name:'Entrar'});}
it('keeps the terminal private and submits email/password login',async()=>{
 await open();expect(screen.queryByText('Private terminal')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'Person@example.com'}});
 fireEvent.change(screen.getByLabelText('Contraseña',{exact:true}),{target:{value:'long-password-123'}});
 fireEvent.click(screen.getByRole('button',{name:'Entrar'}));
 await waitFor(()=>expect(fake.signInWithPassword).toHaveBeenCalledWith({email:'person@example.com',password:'long-password-123'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('E-mail o contraseña incorrectos');
 expect(fake.signUp).not.toHaveBeenCalled();
});
it('requires matching passwords before signup',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'No tengo cuenta · Registrarme'}));
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'person@example.com'}});
 fireEvent.change(screen.getByLabelText('Contraseña',{exact:true}),{target:{value:'long-password-123'}});
 fireEvent.change(screen.getByLabelText('Repetir contraseña'),{target:{value:'different-password'}});
 fireEvent.click(screen.getByRole('button',{name:'Crear cuenta'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('no coinciden');expect(fake.signUp).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Repetir contraseña'),{target:{value:'long-password-123'}});
 fireEvent.click(screen.getByRole('button',{name:'Crear cuenta'}));
 await waitFor(()=>expect(fake.signUp).toHaveBeenCalledWith({email:'person@example.com',password:'long-password-123'}));
});
it('recovers the submit button after a network failure',async()=>{
 fake.signInWithPassword.mockRejectedValue(new Error('network'));await open();
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'person@example.com'}});
 fireEvent.change(screen.getByLabelText('Contraseña',{exact:true}),{target:{value:'long-password-123'}});
 fireEvent.click(screen.getByRole('button',{name:'Entrar'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar');expect(screen.getByRole('button',{name:'Entrar'})).toBeEnabled();
});
